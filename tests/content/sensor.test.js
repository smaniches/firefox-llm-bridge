/**
 * Tests for content/sensor.js.
 *
 * Strategy:
 *  - sensor.js is an IIFE that registers a `browser.runtime.onMessage` listener.
 *  - Our test setup mocks `browser.runtime.onMessage.addListener` to capture
 *    the registered function.
 *  - We import sensor.js, capture the listener, then call it directly with
 *    message payloads.
 *  - For sensor (read) tests, we build jsdom fixtures and call SENSOR_READ.
 *  - For actor (click/type/scroll) tests, we use the SENSOR_READ result to
 *    populate the internal last-semantic-map, then call ACTION_*.
 *
 * We never modify sensor.js (CLAUDE.md constraint).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let listener;

async function importSensorFresh() {
  // The IIFE guards against double-injection via window.__topologicaBridgeInjected.
  // Clear it before each import so the IIFE actually runs.
  delete window.__topologicaBridgeInjected;
  vi.resetModules();
  // Re-stub browser since vi.resetModules also clears it via afterEach reset
  // (browser is re-stubbed in tests/setup.js beforeEach already)
  await import("../../content/sensor.js");
  const calls = globalThis.browser.runtime.onMessage.addListener.mock.calls;
  listener = calls[calls.length - 1][0];
}

/**
 * jsdom does not compute layout — `offsetParent` is null and
 * `getBoundingClientRect()` returns zero-sized rects for every element.
 * That makes the sensor's `isVisible` check reject everything. Patch the
 * HTMLElement prototype so tests can exercise the real DOM-walking logic.
 */
function patchVisibility() {
  // HTMLElement defines offsetParent in jsdom; patch there.
  Object.defineProperty(HTMLElement.prototype, "offsetParent", {
    configurable: true,
    get() {
      return this.tagName === "BODY" || this.tagName === "HTML" ? null : document.body;
    },
  });
  const fakeRect = () => ({
    x: 10,
    y: 10,
    width: 100,
    height: 20,
    top: 10,
    left: 10,
    right: 110,
    bottom: 30,
    toJSON() {
      return this;
    },
  });
  Element.prototype.getBoundingClientRect = fakeRect;
  HTMLElement.prototype.getBoundingClientRect = fakeRect;

  // jsdom's HTMLElement.innerText returns undefined; patch to fall back to textContent.
  Object.defineProperty(HTMLElement.prototype, "innerText", {
    configurable: true,
    get() {
      return this.textContent;
    },
    set(v) {
      this.textContent = v;
    },
  });

  // jsdom's `contentEditable` property does not always reflect the attribute;
  // back it with the attribute so the sensor's check sees the right value.
  Object.defineProperty(HTMLElement.prototype, "contentEditable", {
    configurable: true,
    get() {
      const attr = this.getAttribute("contenteditable");
      if (attr === "true" || attr === "false" || attr === "plaintext-only") {
        return attr;
      }
      return "inherit";
    },
    set(v) {
      this.setAttribute("contenteditable", v);
    },
  });
}

beforeEach(async () => {
  document.body.innerHTML = "";
  patchVisibility();
  await importSensorFresh();
});

afterEach(() => {
  document.body.innerHTML = "";
});

/** Helper to invoke the listener and resolve its return value. */
async function send(msg) {
  return await Promise.resolve(listener(msg, {}, () => {}));
}

describe("sensor: double-injection guard", () => {
  it("does not re-register if imported twice", async () => {
    const initialCount = globalThis.browser.runtime.onMessage.addListener.mock.calls.length;
    // Import again WITHOUT clearing the flag
    vi.resetModules();
    await import("../../content/sensor.js");
    expect(globalThis.browser.runtime.onMessage.addListener.mock.calls.length).toBe(initialCount);
  });
});

describe("sensor: SENSOR_READ - role inference", () => {
  it("returns elements with stable indices, roles, labels, bounds", async () => {
    document.body.innerHTML = `
      <button id="b">Save</button>
      <a href="https://example.com">Link</a>
      <input type="text" id="t" placeholder="name" />
    `;
    const r = await send({ type: "SENSOR_READ" });
    expect(r.elements.length).toBeGreaterThanOrEqual(3);
    expect(r.elements[0].role).toBe("button");
    expect(r.elements[0].label).toBe("Save");
    expect(r.elements[0].selector).toContain("#b");
    expect(r.url).toBeDefined();
    expect(r.title).toBeDefined();
  });

  it("falls back to textbox for input types not in the role map (e.g. color, date)", async () => {
    document.body.innerHTML = `<input type="color" id="c" /><input type="date" id="d" />`;
    const r = await send({ type: "SENSOR_READ" });
    // Both should be present and use the fallback role
    expect(r.elements.length).toBeGreaterThanOrEqual(2);
    expect(r.elements.every((e) => e.role === "textbox")).toBe(true);
  });

  it("infers roles from input types", async () => {
    document.body.innerHTML = `
      <input type="search" />
      <input type="checkbox" />
      <input type="radio" />
      <input type="submit" value="Go" />
      <input type="range" />
      <input type="email" />
      <input type="password" />
      <input type="number" />
      <input type="file" />
      <input type="unknownX" />
    `;
    const r = await send({ type: "SENSOR_READ" });
    const roles = r.elements.map((e) => e.role);
    expect(roles).toContain("searchbox");
    expect(roles).toContain("checkbox");
    expect(roles).toContain("radio");
    expect(roles).toContain("button");
    expect(roles).toContain("slider");
    expect(roles).toContain("textbox");
    expect(roles).toContain("spinbutton");
  });

  it("respects explicit aria-role when in interactive set", async () => {
    document.body.innerHTML = `<div role="button" id="d">X</div>`;
    const r = await send({ type: "SENSOR_READ" });
    expect(r.elements[0].role).toBe("button");
  });

  it("ignores explicit aria-role not in interactive set", async () => {
    document.body.innerHTML = `<div role="banner">Header</div><button>real</button>`;
    const r = await send({ type: "SENSOR_READ" });
    const roles = r.elements.map((e) => e.role);
    expect(roles).not.toContain("banner");
    expect(roles).toContain("button");
  });

  it("treats element with tabindex>=0 as a button", async () => {
    document.body.innerHTML = `<div tabindex="0">tabbable</div>`;
    const r = await send({ type: "SENSOR_READ" });
    expect(r.elements[0].role).toBe("button");
  });

  it("ignores tabindex=-1", async () => {
    document.body.innerHTML = `<div tabindex="-1">ignored</div>`;
    const r = await send({ type: "SENSOR_READ" });
    expect(r.elements).toEqual([]);
  });

  it("treats element with onclick or data-action as button", async () => {
    document.body.innerHTML = `
      <div onclick="doX()">A</div>
      <div data-action="x">B</div>
    `;
    const r = await send({ type: "SENSOR_READ" });
    expect(r.elements.map((e) => e.role)).toEqual(["button", "button"]);
  });

  it("treats contenteditable as textbox", async () => {
    document.body.innerHTML = `<div contenteditable="true">editor</div>`;
    const r = await send({ type: "SENSOR_READ" });
    expect(r.elements[0].role).toBe("textbox");
  });

  it("handles details/summary as buttons", async () => {
    document.body.innerHTML = `<details><summary>Toggle</summary></details>`;
    const r = await send({ type: "SENSOR_READ" });
    const roles = r.elements.map((e) => e.role);
    expect(roles).toContain("button");
  });

  it("respects aria-disabled and disabled attributes", async () => {
    document.body.innerHTML = `<button disabled>X</button><button aria-disabled="true">Y</button>`;
    const r = await send({ type: "SENSOR_READ" });
    expect(r.elements[0].disabled).toBe(true);
    expect(r.elements[1].disabled).toBe(true);
  });

  it("records checked state for checkbox/radio/switch", async () => {
    document.body.innerHTML = `
      <input type="checkbox" checked />
      <div role="switch" aria-checked="true">on</div>
    `;
    const r = await send({ type: "SENSOR_READ" });
    expect(r.elements[0].checked).toBe(true);
    expect(r.elements[1].checked).toBe(true);
  });

  it("records value for textbox/searchbox/spinbutton", async () => {
    document.body.innerHTML = `<input type="text" value="hello" />`;
    const r = await send({ type: "SENSOR_READ" });
    expect(r.elements[0].value).toBe("hello");
  });

  it("records href for links", async () => {
    document.body.innerHTML = `<a href="https://example.com/path">L</a>`;
    const r = await send({ type: "SENSOR_READ" });
    expect(r.elements[0].href).toMatch(/example\.com/);
  });

  it("records expanded state for combobox", async () => {
    document.body.innerHTML = `<div role="combobox" aria-expanded="true">x</div>`;
    const r = await send({ type: "SENSOR_READ" });
    expect(r.elements[0].expanded).toBe(true);
  });

  it("includes pageText when includeText is true", async () => {
    document.body.innerHTML = `<p>Some readable content</p><button>X</button>`;
    const r = await send({ type: "SENSOR_READ", includeText: true });
    expect(r.pageText).toContain("readable");
  });

  it("skips script and style tags", async () => {
    document.body.innerHTML = `
      <script>doStuff()</script>
      <style>.x{}</style>
      <button>real</button>
    `;
    const r = await send({ type: "SENSOR_READ" });
    expect(r.elements).toHaveLength(1);
  });

  it("treats position:fixed elements as visible even with no offsetParent", async () => {
    document.body.innerHTML = `<button id="b" style="position:fixed">X</button>`;
    const el = document.querySelector("#b");
    Object.defineProperty(el, "offsetParent", { value: null, configurable: true });
    // jsdom doesn't compute style.position from inline style perfectly in all
    // configurations; stub getComputedStyle for this element specifically.
    const orig = window.getComputedStyle;
    window.getComputedStyle = function (n) {
      if (n === el) {
        return { display: "block", visibility: "visible", position: "fixed" };
      }
      return orig.call(window, n);
    };
    try {
      const r = await send({ type: "SENSOR_READ" });
      expect(r.elements.some((e) => e.selector.includes("#b"))).toBe(true);
    } finally {
      window.getComputedStyle = orig;
    }
  });

  it("rejects elements with display:none when offsetParent is null", async () => {
    document.body.innerHTML = `<button id="b">X</button>`;
    const el = document.querySelector("#b");
    Object.defineProperty(el, "offsetParent", { value: null, configurable: true });
    const orig = window.getComputedStyle;
    window.getComputedStyle = function (n) {
      if (n === el) {
        return { display: "none", visibility: "visible", position: "static" };
      }
      return orig.call(window, n);
    };
    try {
      const r = await send({ type: "SENSOR_READ" });
      expect(r.elements.some((e) => e.selector.includes("#b"))).toBe(false);
    } finally {
      window.getComputedStyle = orig;
    }
  });

  it("rejects elements with visibility:hidden when offsetParent is null", async () => {
    document.body.innerHTML = `<button id="b">X</button>`;
    const el = document.querySelector("#b");
    Object.defineProperty(el, "offsetParent", { value: null, configurable: true });
    const orig = window.getComputedStyle;
    window.getComputedStyle = function (n) {
      if (n === el) {
        return { display: "block", visibility: "hidden", position: "static" };
      }
      return orig.call(window, n);
    };
    try {
      const r = await send({ type: "SENSOR_READ" });
      expect(r.elements.some((e) => e.selector.includes("#b"))).toBe(false);
    } finally {
      window.getComputedStyle = orig;
    }
  });

  it("rejects elements with zero-sized bounding rect", async () => {
    document.body.innerHTML = `<button id="zero">X</button>`;
    const el = document.querySelector("#zero");
    el.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    });
    const r = await send({ type: "SENSOR_READ" });
    expect(r.elements.some((e) => e.selector.includes("#zero"))).toBe(false);
  });

  it("rejects elements with non-fixed/sticky position when offsetParent is null", async () => {
    document.body.innerHTML = `<button id="abs">X</button>`;
    const el = document.querySelector("#abs");
    Object.defineProperty(el, "offsetParent", { value: null, configurable: true });
    const orig = window.getComputedStyle;
    window.getComputedStyle = function (n) {
      if (n === el) {
        return { display: "block", visibility: "visible", position: "static" };
      }
      return orig.call(window, n);
    };
    try {
      const r = await send({ type: "SENSOR_READ" });
      expect(r.elements.some((e) => e.selector.includes("#abs"))).toBe(false);
    } finally {
      window.getComputedStyle = orig;
    }
  });

  it("treats position:sticky elements as visible when offsetParent is null", async () => {
    document.body.innerHTML = `<button id="s">X</button>`;
    const el = document.querySelector("#s");
    Object.defineProperty(el, "offsetParent", { value: null, configurable: true });
    const orig = window.getComputedStyle;
    window.getComputedStyle = function (n) {
      if (n === el) {
        return { display: "block", visibility: "visible", position: "sticky" };
      }
      return orig.call(window, n);
    };
    try {
      const r = await send({ type: "SENSOR_READ" });
      expect(r.elements.some((e) => e.selector.includes("#s"))).toBe(true);
    } finally {
      window.getComputedStyle = orig;
    }
  });

  it("shows textarea value when set", async () => {
    document.body.innerHTML = "";
    const ta = document.createElement("textarea");
    ta.id = "txt";
    ta.value = "draft message";
    document.body.appendChild(ta);
    const r = await send({ type: "SENSOR_READ" });
    const entry = r.elements.find((e) => e.selector.includes("#txt"));
    expect(entry.label).toMatch(/draft message/);
  });
});

describe("sensor: getLabel priority", () => {
  it("aria-label wins over text content", async () => {
    document.body.innerHTML = `<button aria-label="Close">X</button>`;
    const r = await send({ type: "SENSOR_READ" });
    expect(r.elements[0].label).toBe("Close");
  });

  it("uses aria-labelledby when present", async () => {
    document.body.innerHTML = `
      <span id="lbl">My Label</span>
      <button aria-labelledby="lbl">X</button>
    `;
    const r = await send({ type: "SENSOR_READ" });
    expect(r.elements.find((e) => e.role === "button").label).toBe("My Label");
  });

  it("falls through when aria-labelledby target missing", async () => {
    document.body.innerHTML = `<button aria-labelledby="missing">Fallback</button>`;
    const r = await send({ type: "SENSOR_READ" });
    expect(r.elements[0].label).toBe("Fallback");
  });

  it("uses associated label[for]", async () => {
    document.body.innerHTML = `<label for="i">Email</label><input id="i" type="text" />`;
    const r = await send({ type: "SENSOR_READ" });
    const input = r.elements.find((e) => e.role === "textbox");
    expect(input.label).toBe("Email");
  });

  it("uses placeholder as fallback for inputs", async () => {
    document.body.innerHTML = `<input type="text" placeholder="Search" />`;
    const r = await send({ type: "SENSOR_READ" });
    expect(r.elements[0].label).toMatch(/Search/);
  });

  it("uses title attribute as fallback", async () => {
    document.body.innerHTML = `<div tabindex="0" title="Hover me"></div>`;
    const r = await send({ type: "SENSOR_READ" });
    expect(r.elements[0].label).toBe("Hover me");
  });

  it("uses img[alt] as fallback for buttons containing images", async () => {
    document.body.innerHTML = `<button><img alt="Settings icon" src="" /></button>`;
    const r = await send({ type: "SENSOR_READ" });
    expect(r.elements[0].label).toBe("Settings icon");
  });

  it("returns empty string when no label can be derived", async () => {
    document.body.innerHTML = `<div tabindex="0"></div>`;
    const r = await send({ type: "SENSOR_READ" });
    expect(r.elements[0].label).toBe("");
  });

  it("shows input value when set", async () => {
    document.body.innerHTML = `<input type="text" value="prefilled" />`;
    const r = await send({ type: "SENSOR_READ" });
    expect(r.elements[0].label).toMatch(/prefilled/);
  });
});

describe("sensor: generateSelector", () => {
  it("prefers id", async () => {
    document.body.innerHTML = `<button id="save-btn">Save</button>`;
    const r = await send({ type: "SENSOR_READ" });
    expect(r.elements[0].selector).toMatch(/^#save-btn/);
  });

  it("prefers data-testid over class path", async () => {
    document.body.innerHTML = `<button data-testid="primary" class="x">Save</button>`;
    const r = await send({ type: "SENSOR_READ" });
    expect(r.elements[0].selector).toContain('data-testid="primary"');
  });

  it("uses data-test, data-cy, data-action when others absent", async () => {
    document.body.innerHTML = `
      <button data-test="t">T</button>
      <button data-cy="c">C</button>
      <button data-action="a">A</button>
    `;
    const r = await send({ type: "SENSOR_READ" });
    const selectors = r.elements.map((e) => e.selector).join(" ");
    expect(selectors).toContain('data-test="t"');
    expect(selectors).toContain('data-cy="c"');
    expect(selectors).toContain('data-action="a"');
  });

  it("falls back to tag+class+nth-of-type chain", async () => {
    document.body.innerHTML = `
      <div class="container">
        <button class="btn">A</button>
        <button class="btn">B</button>
      </div>
    `;
    const r = await send({ type: "SENSOR_READ" });
    expect(r.elements[1].selector).toMatch(/nth-of-type/);
  });

  it("handles elements without any className", async () => {
    document.body.innerHTML = `<section><div tabindex="0">x</div></section>`;
    const r = await send({ type: "SENSOR_READ" });
    expect(r.elements[0].selector).toMatch(/div/);
  });

  it("filters out Tailwind-style classes (containing ':')", async () => {
    document.body.innerHTML = `<div class="hover:bg-red dark:text-white" tabindex="0">x</div>`;
    const r = await send({ type: "SENSOR_READ" });
    // Selector should NOT contain hover: / dark: tokens
    expect(r.elements[0].selector).not.toContain("hover:");
    expect(r.elements[0].selector).not.toContain("dark:");
  });

  it("walks up to an ancestor with an id and stops there", async () => {
    document.body.innerHTML = `
      <section id="root">
        <div><button class="btn">A</button></div>
      </section>
    `;
    const r = await send({ type: "SENSOR_READ" });
    expect(r.elements[0].selector).toMatch(/#root/);
  });
});

describe("sensor: ACTION_CLICK", () => {
  it("clicks an element by selector", async () => {
    document.body.innerHTML = `<button id="b">X</button>`;
    let clicked = false;
    document.querySelector("#b").addEventListener("click", () => {
      clicked = true;
    });
    const r = await send({ type: "ACTION_CLICK", selector: "#b" });
    expect(r.success).toBe(true);
    expect(clicked).toBe(true);
  });

  it("clicks an element by index from last read", async () => {
    document.body.innerHTML = `<button id="a">A</button><button id="b">B</button>`;
    await send({ type: "SENSOR_READ" });
    let clicked = "";
    document.querySelector("#b").addEventListener("click", () => {
      clicked = "b";
    });
    const r = await send({ type: "ACTION_CLICK", elementIndex: 1 });
    expect(r.success).toBe(true);
    expect(clicked).toBe("b");
  });

  it("returns error when element not found", async () => {
    const r = await send({ type: "ACTION_CLICK", selector: "#nope" });
    expect(r.error).toMatch(/not found/i);
  });

  it("falls back to element[index] label when getLabel returns empty and no selector given", async () => {
    document.body.innerHTML = `<div tabindex="0" id="anon"></div>`;
    await send({ type: "SENSOR_READ" });
    // Element has no aria-label, no text content, no placeholder, no title.
    // Clicking by index should report `clicked: element[0]`.
    const r = await send({ type: "ACTION_CLICK", elementIndex: 0 });
    expect(r.success).toBe(true);
    expect(r.clicked).toMatch(/element\[0\]|^#anon$/);
  });

  it("scrolls element into view when out of viewport", async () => {
    document.body.innerHTML = `<button id="b">X</button>`;
    const el = document.querySelector("#b");
    // Force out-of-view via mocked getBoundingClientRect
    el.getBoundingClientRect = () => ({
      top: 5000,
      left: 0,
      bottom: 5020,
      right: 100,
      width: 100,
      height: 20,
      x: 0,
      y: 5000,
    });
    el.scrollIntoView = vi.fn();
    const r = await send({ type: "ACTION_CLICK", selector: "#b" });
    expect(el.scrollIntoView).toHaveBeenCalled();
    expect(r.success).toBe(true);
  });
});

describe("sensor: ACTION_TYPE", () => {
  it("types into an input with clearFirst and pressEnter", async () => {
    document.body.innerHTML = `<form id="f"><input id="i" type="text" /></form>`;
    const r = await send({
      type: "ACTION_TYPE",
      selector: "#i",
      text: "hello",
      clearFirst: true,
      pressEnter: true,
    });
    expect(r.success).toBe(true);
    expect(document.querySelector("#i").value).toBe("hello");
  });

  it("types into a contenteditable element", async () => {
    document.body.innerHTML = `<div id="e" contenteditable="true"></div>`;
    const r = await send({
      type: "ACTION_TYPE",
      selector: "#e",
      text: "hi",
      clearFirst: true,
    });
    expect(r.success).toBe(true);
    expect(document.querySelector("#e").textContent).toBe("hi");
  });

  it("returns error when element not found", async () => {
    const r = await send({ type: "ACTION_TYPE", selector: "#nope", text: "x" });
    expect(r.error).toMatch(/not found/i);
  });

  it("types into a textarea", async () => {
    document.body.innerHTML = `<textarea id="t"></textarea>`;
    const r = await send({
      type: "ACTION_TYPE",
      selector: "#t",
      text: "long input",
      clearFirst: true,
    });
    expect(r.success).toBe(true);
    expect(document.querySelector("#t").value).toBe("long input");
  });

  it("falls back to direct el.value assignment when the native setter is unavailable", async () => {
    document.body.innerHTML = `<input id="i" type="text" />`;
    // Force Object.getOwnPropertyDescriptor to return undefined for the
    // HTMLInputElement.prototype.value descriptor so the sensor's `nativeSetter`
    // lookup returns undefined and falls through to `el.value = text`.
    const orig = Object.getOwnPropertyDescriptor;
    const spy = vi.spyOn(Object, "getOwnPropertyDescriptor").mockImplementation((obj, prop) => {
      if (
        prop === "value" &&
        (obj === HTMLInputElement.prototype || obj === HTMLTextAreaElement.prototype)
      ) {
        return undefined;
      }
      return orig.call(Object, obj, prop);
    });
    try {
      const r = await send({
        type: "ACTION_TYPE",
        selector: "#i",
        text: "fallback",
        clearFirst: true,
      });
      expect(r.success).toBe(true);
      expect(document.querySelector("#i").value).toBe("fallback");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("sensor: ACTION_SCROLL", () => {
  it("scrolls down by the given amount", async () => {
    window.scrollBy = vi.fn();
    const r = await send({ type: "ACTION_SCROLL", direction: "down", amount: 100 });
    expect(window.scrollBy).toHaveBeenCalledWith({ top: 100, behavior: "smooth" });
    expect(r.success).toBe(true);
  });

  it("scrolls up by the given amount", async () => {
    window.scrollBy = vi.fn();
    await send({ type: "ACTION_SCROLL", direction: "up", amount: 50 });
    expect(window.scrollBy).toHaveBeenCalledWith({ top: -50, behavior: "smooth" });
  });

  it("scrolls to top", async () => {
    window.scrollTo = vi.fn();
    await send({ type: "ACTION_SCROLL", direction: "top" });
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });

  it("scrolls to bottom", async () => {
    window.scrollTo = vi.fn();
    await send({ type: "ACTION_SCROLL", direction: "bottom" });
    expect(window.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: "smooth" }));
  });
});

describe("sensor: SENSOR_EXTRACT_TEXT", () => {
  it("extracts text from the whole page when no selector", async () => {
    document.body.innerHTML = `<p>This is content</p>`;
    const r = await send({ type: "SENSOR_EXTRACT_TEXT" });
    expect(r.text).toContain("This is content");
  });

  it("extracts text from a specific element", async () => {
    document.body.innerHTML = `<div id="x">Target text</div><div>other</div>`;
    const r = await send({ type: "SENSOR_EXTRACT_TEXT", selector: "#x" });
    expect(r.text).toBe("Target text");
  });

  it("returns error when selector not found", async () => {
    const r = await send({ type: "SENSOR_EXTRACT_TEXT", selector: "#missing" });
    expect(r.error).toMatch(/not found/i);
  });
});

describe("sensor: PING and unknown messages", () => {
  it("responds to PING with alive:true", async () => {
    const r = await send({ type: "PING" });
    expect(r).toEqual({ alive: true });
  });

  it("returns error for unknown message types", async () => {
    const r = await send({ type: "DOES_NOT_EXIST" });
    expect(r.error).toMatch(/Unknown message type/i);
  });
});

describe("sensor: shadow DOM traversal", () => {
  it("descends into open shadow roots", async () => {
    const host = document.createElement("div");
    host.id = "host";
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: "open" });
    const btn = document.createElement("button");
    btn.textContent = "Inside Shadow";
    root.appendChild(btn);

    const r = await send({ type: "SENSOR_READ" });
    const insideShadow = r.elements.find((e) => e.label === "Inside Shadow");
    expect(insideShadow).toBeDefined();
    expect(insideShadow.shadow).toBe(true);
  });

  it("does not error on closed shadow roots (they appear as null)", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    // Closed shadow root: jsdom supports it; sensor checks node.shadowRoot
    // which returns null for closed mode, so we just verify no throw.
    host.attachShadow({ mode: "closed" });
    await expect(send({ type: "SENSOR_READ" })).resolves.toBeDefined();
  });
});

describe("sensor: iframe traversal", () => {
  it("emits an iframe entry for cross-origin iframes without descending", async () => {
    const iframe = document.createElement("iframe");
    iframe.src = "https://other.example.com/page";
    document.body.appendChild(iframe);

    // Force contentDocument access to throw, simulating cross-origin.
    Object.defineProperty(iframe, "contentDocument", {
      configurable: true,
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });

    const r = await send({ type: "SENSOR_READ" });
    const iframeEntry = r.elements.find((e) => e.role === "iframe");
    expect(iframeEntry).toBeDefined();
  });

  it("descends into same-origin iframes", async () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    // Stub the contentDocument so the sensor walks into a body we own in the
    // current realm (where our prototype patches apply).
    const fakeBody = document.createElement("div");
    const innerBtn = document.createElement("button");
    innerBtn.textContent = "InsideFrame";
    fakeBody.appendChild(innerBtn);
    Object.defineProperty(iframe, "contentDocument", {
      configurable: true,
      get() {
        return { body: fakeBody };
      },
    });

    const r = await send({ type: "SENSOR_READ" });
    const inner = r.elements.find((e) => e.label === "InsideFrame");
    expect(inner).toBeDefined();
    expect(Array.isArray(inner.frame)).toBe(true);
  });

  it("tolerates iframes with no contentDocument body", async () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    Object.defineProperty(iframe, "contentDocument", {
      configurable: true,
      get() {
        return { body: null };
      },
    });
    await expect(send({ type: "SENSOR_READ" })).resolves.toBeDefined();
  });
});

describe("sensor: ACTION_HOVER", () => {
  it("dispatches mouseover/mouseenter/mousemove on found element", async () => {
    const btn = document.createElement("button");
    btn.id = "h";
    btn.textContent = "Hover me";
    document.body.appendChild(btn);
    await send({ type: "SENSOR_READ" });

    const events = [];
    for (const ev of ["mouseover", "mouseenter", "mousemove"]) {
      btn.addEventListener(ev, () => events.push(ev));
    }

    const r = await send({ type: "ACTION_HOVER", selector: "#h", elementIndex: null });
    expect(r.success).toBe(true);
    expect(events).toContain("mouseover");
    expect(events).toContain("mousemove");
  });

  it("waits for durationMs (capped at 5000)", async () => {
    const btn = document.createElement("button");
    btn.textContent = "x";
    document.body.appendChild(btn);
    await send({ type: "SENSOR_READ" });

    const start = Date.now();
    await send({ type: "ACTION_HOVER", elementIndex: 0, durationMs: 50 });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(45);
  });

  it("returns error when element not found", async () => {
    const r = await send({ type: "ACTION_HOVER", selector: "#missing", elementIndex: null });
    expect(r.error).toMatch(/not found/i);
  });
});

describe("sensor: ACTION_PRESS_KEY", () => {
  it("dispatches keyboard events on the matched element", async () => {
    const input = document.createElement("input");
    input.id = "in";
    document.body.appendChild(input);
    await send({ type: "SENSOR_READ" });

    const events = [];
    input.addEventListener("keydown", (e) => events.push(["down", e.key, e.ctrlKey]));
    input.addEventListener("keyup", (e) => events.push(["up", e.key]));

    const r = await send({
      type: "ACTION_PRESS_KEY",
      selector: "#in",
      elementIndex: null,
      key: "a",
      modifiers: { ctrl: true },
    });
    expect(r.success).toBe(true);
    expect(events).toContainEqual(["down", "a", true]);
    expect(events).toContainEqual(["up", "a"]);
  });

  it("falls back to document.activeElement when no target given", async () => {
    const r = await send({
      type: "ACTION_PRESS_KEY",
      selector: null,
      elementIndex: null,
      key: "Escape",
    });
    expect(r.success).toBe(true);
    expect(r.key).toBe("Escape");
  });

  it("handles named keys with keyCode lookup", async () => {
    const r = await send({ type: "ACTION_PRESS_KEY", key: "ArrowDown" });
    expect(r.success).toBe(true);
  });

  it("handles single-character keys via charCodeAt", async () => {
    const r = await send({ type: "ACTION_PRESS_KEY", key: "x" });
    expect(r.success).toBe(true);
  });

  it("accepts a missing modifiers object", async () => {
    const r = await send({ type: "ACTION_PRESS_KEY", key: "Enter" });
    expect(r.success).toBe(true);
  });
});

describe("sensor: ACTION_DRAG_DROP", () => {
  it("dispatches the full HTML5 drag sequence on success", async () => {
    const src = document.createElement("div");
    src.id = "src";
    src.textContent = "Source";
    src.setAttribute("role", "button");
    const dst = document.createElement("div");
    dst.id = "dst";
    dst.textContent = "Dest";
    dst.setAttribute("role", "button");
    document.body.append(src, dst);
    await send({ type: "SENSOR_READ" });

    const seen = [];
    for (const ev of ["dragstart", "drag", "dragenter", "dragover", "drop", "dragend"]) {
      const target = ev === "dragenter" || ev === "dragover" || ev === "drop" ? dst : src;
      target.addEventListener(ev, () => seen.push(ev));
    }

    const r = await send({
      type: "ACTION_DRAG_DROP",
      fromSelector: "#src",
      fromIndex: null,
      toSelector: "#dst",
      toIndex: null,
    });
    expect(r.success).toBe(true);
    expect(seen).toContain("dragstart");
    expect(seen).toContain("drop");
    expect(seen).toContain("dragend");
  });

  it("returns error when source missing", async () => {
    const r = await send({
      type: "ACTION_DRAG_DROP",
      fromSelector: "#x",
      fromIndex: null,
      toSelector: "#y",
      toIndex: null,
    });
    expect(r.error).toMatch(/Source/);
  });

  it("returns error when destination missing", async () => {
    const src = document.createElement("div");
    src.id = "src2";
    src.setAttribute("role", "button");
    src.textContent = "S";
    document.body.appendChild(src);
    const r = await send({
      type: "ACTION_DRAG_DROP",
      fromSelector: "#src2",
      fromIndex: null,
      toSelector: "#missingDst",
      toIndex: null,
    });
    expect(r.error).toMatch(/Destination/);
  });
});

describe("sensor: ACTION_FILE_UPLOAD", () => {
  it("populates the input.files via DataTransfer", async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.id = "f";
    document.body.appendChild(input);
    await send({ type: "SENSOR_READ" });

    const r = await send({
      type: "ACTION_FILE_UPLOAD",
      selector: "#f",
      elementIndex: null,
      fileName: "hello.txt",
      mimeType: "text/plain",
      base64Data: btoa("hello"),
    });
    expect(r.success).toBe(true);
    expect(r.uploaded).toBe("hello.txt");
    expect(input.files.length).toBe(1);
    expect(input.files[0].name).toBe("hello.txt");
  });

  it("defaults mimeType when not given", async () => {
    const input = document.createElement("input");
    input.type = "file";
    document.body.appendChild(input);
    await send({ type: "SENSOR_READ" });
    const r = await send({
      type: "ACTION_FILE_UPLOAD",
      elementIndex: 0,
      fileName: "x.bin",
      base64Data: btoa("x"),
    });
    expect(r.success).toBe(true);
  });

  it("rejects non-file inputs", async () => {
    const input = document.createElement("input");
    input.type = "text";
    input.id = "txt";
    document.body.appendChild(input);
    await send({ type: "SENSOR_READ" });
    const r = await send({
      type: "ACTION_FILE_UPLOAD",
      selector: "#txt",
      elementIndex: null,
      fileName: "x",
      mimeType: "text/plain",
      base64Data: btoa("x"),
    });
    expect(r.error).toMatch(/not an <input/);
  });

  it("returns error when element not found", async () => {
    const r = await send({
      type: "ACTION_FILE_UPLOAD",
      selector: "#none",
      elementIndex: null,
      fileName: "x",
      mimeType: "text/plain",
      base64Data: btoa("x"),
    });
    expect(r.error).toMatch(/not found/);
  });
});

describe("sensor: ACTION_HOVER fallback labels and ACTION_PRESS_KEY edge cases", () => {
  it("hover falls back to selector when label is empty and no index", async () => {
    const div = document.createElement("div");
    div.setAttribute("role", "button");
    div.setAttribute("tabindex", "0");
    // No id, no text, no aria-label — getLabel returns empty.
    document.body.appendChild(div);

    // Provide a selector match path: give it a data attribute we can target.
    div.setAttribute("data-action", "hov");
    await send({ type: "SENSOR_READ" });

    const r = await send({
      type: "ACTION_HOVER",
      selector: '[data-action="hov"]',
      elementIndex: null,
    });
    expect(r.hovered).toBe('[data-action="hov"]');
  });

  it("hover falls back to element[idx] when neither label nor selector", async () => {
    const div = document.createElement("div");
    div.setAttribute("role", "button");
    div.setAttribute("tabindex", "0");
    document.body.appendChild(div);
    await send({ type: "SENSOR_READ" });

    const r = await send({ type: "ACTION_HOVER", selector: null, elementIndex: 0 });
    expect(r.hovered).toMatch(/element\[0\]/);
  });

  it("press_key falls back to document.body when no active element exists", async () => {
    // Force activeElement to null via property override (it normally returns body)
    const originalActiveElement = Object.getOwnPropertyDescriptor(
      Document.prototype,
      "activeElement",
    );
    Object.defineProperty(document, "activeElement", { configurable: true, value: null });
    try {
      const r = await send({ type: "ACTION_PRESS_KEY", key: "Tab" });
      expect(r.target).toBe("body");
    } finally {
      if (originalActiveElement) {
        Object.defineProperty(Document.prototype, "activeElement", originalActiveElement);
      }
    }
  });
});

describe("sensor: resolveElement uses cached ref before selector", () => {
  it("uses the cached element ref when stored at elementIndex", async () => {
    const btn = document.createElement("button");
    btn.id = "cached";
    btn.textContent = "Cached";
    document.body.appendChild(btn);
    const map = await send({ type: "SENSOR_READ" });
    const idx = map.elements.findIndex((e) => e.label === "Cached");

    // Remove the id so a selector lookup by "#cached" would fail; the cached
    // ref must still be used.
    btn.removeAttribute("id");

    const events = [];
    btn.addEventListener("click", () => events.push("click"));
    const r = await send({ type: "ACTION_CLICK", selector: null, elementIndex: idx });
    expect(r.success).toBe(true);
    expect(events.length).toBeGreaterThan(0);
  });

  it("falls back to selector when ref is disconnected", async () => {
    const btn = document.createElement("button");
    btn.id = "fall";
    btn.textContent = "Fall";
    document.body.appendChild(btn);
    await send({ type: "SENSOR_READ" });

    // Disconnect, then re-create with the same id so selector finds the new one.
    btn.remove();
    const replacement = document.createElement("button");
    replacement.id = "fall";
    replacement.textContent = "Replacement";
    document.body.appendChild(replacement);

    const r = await send({ type: "ACTION_CLICK", selector: "#fall", elementIndex: 0 });
    expect(r.success).toBe(true);
  });
});

// ── New tools added in v0.5.x ─────────────────────────────────────────────

describe("sensor: SENSOR_FIND_TEXT", () => {
  beforeEach(() => {
    document.body.innerHTML = "<p>Hello world</p><p>hello again</p>";
  });

  it("finds text case-insensitively by default", async () => {
    const r = await send({ type: "SENSOR_FIND_TEXT", text: "hello", caseSensitive: false });
    expect(r.found).toBe(true);
    expect(r.count).toBe(2);
  });

  it("finds text case-sensitively when requested", async () => {
    const r = await send({ type: "SENSOR_FIND_TEXT", text: "Hello", caseSensitive: true });
    expect(r.found).toBe(true);
    expect(r.count).toBe(1);
  });

  it("returns found:false when text is not present", async () => {
    const r = await send({ type: "SENSOR_FIND_TEXT", text: "xyzzy", caseSensitive: false });
    expect(r.found).toBe(false);
    expect(r.count).toBe(0);
    expect(r.matches).toHaveLength(0);
  });

  it("returns error when text is empty", async () => {
    const r = await send({ type: "SENSOR_FIND_TEXT", text: "" });
    expect(r.error).toBeTruthy();
  });

  it("caps results at 20 matches", async () => {
    document.body.innerHTML = Array.from({ length: 25 }, (_, i) => `<p>match${i}</p>`).join("");
    // Searching for "match" appears in all 25 but result is capped at 20.
    const r = await send({ type: "SENSOR_FIND_TEXT", text: "match", caseSensitive: false });
    expect(r.count).toBeLessThanOrEqual(20);
  });
});

describe("sensor: SENSOR_GET_SELECTION", () => {
  it("returns the current selection text", async () => {
    document.body.innerHTML = "<p id='p'>Select me</p>";
    const range = document.createRange();
    range.selectNodeContents(document.getElementById("p"));
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    const r = await send({ type: "SENSOR_GET_SELECTION" });
    expect(r.text).toBe("Select me");
    sel.removeAllRanges();
  });

  it("returns empty string when nothing is selected", async () => {
    window.getSelection().removeAllRanges();
    const r = await send({ type: "SENSOR_GET_SELECTION" });
    expect(typeof r.text).toBe("string");
  });
});

describe("sensor: ACTION_FOCUS", () => {
  it("focuses a resolvable element by selector", async () => {
    document.body.innerHTML = "<input id='f' type='text' />";
    await send({ type: "SENSOR_READ" });
    const r = await send({ type: "ACTION_FOCUS", selector: "#f", elementIndex: null });
    expect(r.success).toBe(true);
    // jsdom does not reliably update document.activeElement; verify via response
    expect(r.focused).toBeTruthy();
  });

  it("returns error when element not found", async () => {
    document.body.innerHTML = "";
    await send({ type: "SENSOR_READ" });
    const r = await send({ type: "ACTION_FOCUS", selector: "#missing", elementIndex: null });
    expect(r.error).toBeTruthy();
  });

  it("uses aria-label as the focused label when present", async () => {
    document.body.innerHTML = "<button aria-label='Submit'>Click</button>";
    await send({ type: "SENSOR_READ" });
    const r = await send({ type: "ACTION_FOCUS", selector: "button", elementIndex: null });
    expect(r.success).toBe(true);
    expect(r.focused).toBe("Submit");
  });

  it("falls back to element[N] when selector and label are both absent", async () => {
    document.body.innerHTML = "<input type='text' />";
    await send({ type: "SENSOR_READ" });
    // elementIndex 0 resolves via lastElementRefs; no selector, no aria-label
    const r = await send({ type: "ACTION_FOCUS", selector: null, elementIndex: 0 });
    expect(r.success).toBe(true);
    expect(r.focused).toMatch(/element\[0\]/);
  });
});

describe("sensor: ACTION_SET_VALUE", () => {
  it("sets value on an input and fires change events", async () => {
    document.body.innerHTML = "<input id='v' type='text' />";
    await send({ type: "SENSOR_READ" });
    const events = [];
    document.getElementById("v").addEventListener("input", () => events.push("input"));
    document.getElementById("v").addEventListener("change", () => events.push("change"));
    const r = await send({ type: "ACTION_SET_VALUE", selector: "#v", elementIndex: null, value: "42" });
    expect(r.success).toBe(true);
    expect(r.value).toBe("42");
    expect(document.getElementById("v").value).toBe("42");
    expect(events).toContain("input");
    expect(events).toContain("change");
  });

  it("sets value on a textarea", async () => {
    document.body.innerHTML = "<textarea id='ta'></textarea>";
    await send({ type: "SENSOR_READ" });
    const r = await send({ type: "ACTION_SET_VALUE", selector: "#ta", elementIndex: null, value: "hello" });
    expect(r.success).toBe(true);
    expect(document.getElementById("ta").value).toBe("hello");
  });

  it("returns error when element not found", async () => {
    document.body.innerHTML = "";
    await send({ type: "SENSOR_READ" });
    const r = await send({ type: "ACTION_SET_VALUE", selector: "#nope", elementIndex: null, value: "x" });
    expect(r.error).toBeTruthy();
  });

  it("falls back to direct assignment when no native setter", async () => {
    document.body.innerHTML = "<input id='nosetter' type='text' />";
    await send({ type: "SENSOR_READ" });
    const orig = Object.getOwnPropertyDescriptor;
    const spy = vi.spyOn(Object, "getOwnPropertyDescriptor").mockImplementation((obj, prop) => {
      if (prop === "value" && (obj === HTMLInputElement.prototype || obj === HTMLTextAreaElement.prototype)) {
        return undefined;
      }
      return orig.call(Object, obj, prop);
    });
    try {
      const r = await send({
        type: "ACTION_SET_VALUE", selector: "#nosetter", elementIndex: null, value: "fallback",
      });
      expect(r.success).toBe(true);
      expect(r.value).toBe("fallback");
    } finally {
      spy.mockRestore();
    }
  });
});
