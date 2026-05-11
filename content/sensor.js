/**
 * FIREFOX LLM BRIDGE — Content Script (Sensor + Actor)
 * Santiago Maniches | TOPOLOGICA LLC
 *
 * Injected into every page. Two responsibilities:
 *
 *   1. SENSOR — extract a semantic accessibility map of the page,
 *      including elements inside open shadow roots and same-origin
 *      iframes. Cross-origin iframes are unreachable from a content
 *      script and are reported by reference only.
 *
 *   2. ACTOR — execute interaction actions dispatched from the
 *      background worker: click, type, scroll, hover, press-key,
 *      drag-and-drop, and file-upload (via a real <input type=file>
 *      data URL pipeline).
 *
 * The sensor is provider-agnostic. Tool definitions live in the
 * background module; the sensor only knows the on-the-wire message
 * shapes.
 */

(() => {
  "use strict";

  // Avoid double-injection (manifest declares this script as a content
  // script; an `all_frames: true` registration plus a top-level reload
  // can otherwise wire two listeners).
  if (window.__topologicaBridgeInjected) return;
  window.__topologicaBridgeInjected = true;

  // ============================================================
  // SEMANTIC-MAP CACHE
  // ============================================================
  //
  // The map exposed to the model contains JSON-friendly entries
  // (role, label, selector, bounds…). For elements that live inside
  // a shadow root or a nested iframe, a CSS selector cannot uniquely
  // resolve them from `document`, so we also keep a parallel array of
  // direct Element refs keyed by the same index. The actor uses the
  // ref first and falls back to a selector lookup for stability.

  /** @type {Element[]} */
  let lastElementRefs = [];

  // ============================================================
  // SENSOR
  // ============================================================

  const INTERACTIVE_ROLES = new Set([
    "button",
    "link",
    "textbox",
    "checkbox",
    "radio",
    "combobox",
    "listbox",
    "menuitem",
    "menu",
    "menubar",
    "tab",
    "tablist",
    "switch",
    "slider",
    "spinbutton",
    "searchbox",
    "option",
    "treeitem",
    "gridcell",
    "row",
    "columnheader",
    "rowheader",
  ]);

  const INTERACTIVE_TAGS = {
    BUTTON: "button",
    A: "link",
    INPUT: null, // resolved by `type` attribute below
    TEXTAREA: "textbox",
    SELECT: "combobox",
    DETAILS: "button",
    SUMMARY: "button",
  };

  const INPUT_TYPE_ROLES = {
    text: "textbox",
    search: "searchbox",
    email: "textbox",
    password: "textbox",
    tel: "textbox",
    url: "textbox",
    number: "spinbutton",
    checkbox: "checkbox",
    radio: "radio",
    submit: "button",
    reset: "button",
    button: "button",
    file: "button",
    range: "slider",
  };

  function inferRole(node) {
    const ariaRole = node.getAttribute("role");
    if (ariaRole && INTERACTIVE_ROLES.has(ariaRole)) return ariaRole;

    const tagRole = INTERACTIVE_TAGS[node.tagName];
    if (tagRole) return tagRole;

    if (node.tagName === "INPUT") {
      return INPUT_TYPE_ROLES[node.type] || "textbox";
    }

    if (node.getAttribute("tabindex") !== null && node.getAttribute("tabindex") !== "-1") {
      return "button";
    }
    if (node.getAttribute("onclick") || node.getAttribute("data-action")) {
      return "button";
    }

    if (node.contentEditable === "true") return "textbox";

    return null;
  }

  function isVisible(node) {
    if (!node.offsetParent && node.tagName !== "BODY" && node.tagName !== "HTML") {
      const style = window.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return false;
      if (style.position !== "fixed" && style.position !== "sticky") return false;
    }
    const rect = node.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    return true;
  }

  function getLabel(node) {
    const ariaLabel = node.getAttribute("aria-label");
    if (ariaLabel) return ariaLabel.trim();

    const labelledBy = node.getAttribute("aria-labelledby");
    if (labelledBy) {
      // Look up the labelledby target inside the element's root so shadow
      // DOM and the main document are both handled. Both Document and
      // ShadowRoot (DocumentFragment) expose getElementById.
      const labelEl = node.getRootNode().getElementById(labelledBy);
      if (labelEl) return labelEl.textContent.trim().substring(0, 200);
    }

    if (node.id) {
      const root = node.getRootNode();
      const label = root.querySelector(`label[for="${CSS.escape(node.id)}"]`);
      if (label) return label.textContent.trim().substring(0, 200);
    }

    if (node.tagName === "BUTTON" || node.tagName === "A" || node.tagName === "SUMMARY") {
      const text = node.textContent.trim();
      if (text) return text.substring(0, 200);
    }

    if (node.value && (node.tagName === "INPUT" || node.tagName === "TEXTAREA")) {
      return `[value: ${node.value.substring(0, 100)}]`;
    }
    if (node.placeholder) return `[placeholder: ${node.placeholder}]`;

    if (node.title) return node.title.substring(0, 200);

    const img = node.querySelector("img[alt]");
    if (img && img.alt) return img.alt.substring(0, 200);

    return "";
  }

  function generateSelector(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;

    for (const attr of ["data-testid", "data-test", "data-cy", "data-action"]) {
      const val = el.getAttribute(attr);
      if (val) return `[${attr}="${CSS.escape(val)}"]`;
    }

    const parts = [];
    let current = el;
    while (current && current !== document.body && parts.length < 4) {
      let part = current.tagName.toLowerCase();
      if (current.id) {
        parts.unshift(`#${CSS.escape(current.id)}`);
        break;
      }
      if (current.className && typeof current.className === "string") {
        const classes = current.className
          .trim()
          .split(/\s+/)
          .filter((c) => c && !c.includes(":"))
          .slice(0, 2);
        if (classes.length > 0) {
          part += "." + classes.map((c) => CSS.escape(c)).join(".");
        }
      }
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((s) => s.tagName === current.tagName);
        if (siblings.length > 1) {
          const idx = siblings.indexOf(current) + 1;
          part += `:nth-of-type(${idx})`;
        }
      }
      parts.unshift(part);
      current = current.parentElement;
    }
    return parts.join(" > ");
  }

  /**
   * Build the semantic map. Walks the live tree, descends into open
   * shadow roots, and into same-origin iframes (cross-origin iframes
   * are reported as a `role: "iframe"` entry but not traversed).
   */
  function buildSemanticMap(includeText = false) {
    const map = [];
    const refs = [];
    const counters = { index: 0 };

    function emit(node, framePath, inShadow) {
      const role = inferRole(node);
      if (!role || !isVisible(node)) return;

      const rect = node.getBoundingClientRect();
      const entry = {
        i: counters.index,
        role,
        label: getLabel(node),
        selector: generateSelector(node),
        bounds: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        },
        disabled: node.disabled || node.getAttribute("aria-disabled") === "true",
      };
      if (framePath.length > 0) entry.frame = framePath.slice();
      if (inShadow) entry.shadow = true;

      if (role === "checkbox" || role === "radio" || role === "switch") {
        entry.checked = node.checked || node.getAttribute("aria-checked") === "true";
      }
      if (role === "textbox" || role === "searchbox" || role === "spinbutton") {
        entry.value = (node.value || "").substring(0, 200);
      }
      if (role === "link" && node.href) {
        entry.href = node.href.substring(0, 300);
      }
      if (role === "combobox") {
        entry.expanded = node.getAttribute("aria-expanded") === "true";
      }

      map.push(entry);
      refs.push(node);
      counters.index++;
    }

    function walk(node, framePath, inShadow) {
      /* v8 ignore next */
      if (!node || node.nodeType !== Node.ELEMENT_NODE) return;

      emit(node, framePath, inShadow);

      // IFRAMES — try to descend into same-origin frames. Cross-origin
      // access throws SecurityError, which we catch and skip silently.
      if (node.tagName === "IFRAME") {
        try {
          const sub = node.contentDocument;
          if (sub && sub.body) {
            const childPath = framePath.concat([counters.index - 1]);
            walk(sub.body, childPath, inShadow);
          }
        } catch (_e) {
          // cross-origin iframe; surfaced to the model as the iframe
          // entry already emitted above, but its interior stays opaque.
        }
        return;
      }

      // SHADOW ROOTS — only "open" mode is reachable from a content
      // script. Closed shadow roots return null and are invisible.
      if (node.shadowRoot) {
        for (const child of node.shadowRoot.children) {
          walk(child, framePath, true);
        }
      }

      // LIGHT-DOM CHILDREN
      if (node.tagName !== "SCRIPT" && node.tagName !== "STYLE" && node.tagName !== "NOSCRIPT") {
        for (const child of node.children) {
          walk(child, framePath, inShadow);
        }
      }
    }

    // Surface iframes themselves as entries even when not interactive,
    // so the model can ask the user about cross-origin content.
    INTERACTIVE_TAGS.IFRAME = "iframe";
    INTERACTIVE_ROLES.add("iframe");

    walk(document.body, [], false);

    INTERACTIVE_TAGS.IFRAME = undefined;
    INTERACTIVE_ROLES.delete("iframe");

    lastElementRefs = refs;

    const result = {
      url: window.location.href,
      title: document.title,
      elementCount: map.length,
      elements: map,
    };

    if (includeText) {
      result.pageText = document.body.innerText.substring(0, 15000);
    }

    return result;
  }

  // ============================================================
  // ACTOR
  // ============================================================

  /**
   * Resolve an element by index (preferred — works across shadow
   * roots and same-origin iframes) or by CSS selector (fallback —
   * only works on light DOM in the top frame).
   */
  function resolveElement(selector, elementIndex) {
    if (
      elementIndex !== null &&
      elementIndex !== undefined &&
      lastElementRefs[elementIndex] &&
      lastElementRefs[elementIndex].isConnected
    ) {
      return lastElementRefs[elementIndex];
    }
    if (selector) {
      const el = document.querySelector(selector);
      if (el) return el;
    }
    return null;
  }

  function scrollIntoViewIfNeeded(el) {
    const rect = el.getBoundingClientRect();
    const inView =
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= window.innerHeight &&
      rect.right <= window.innerWidth;

    if (!inView) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      return new Promise((r) => setTimeout(r, 300));
    }
    return Promise.resolve();
  }

  function dispatchPointerSequence(el, types) {
    const rect = el.getBoundingClientRect();
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const init = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0 };
    for (const t of types) {
      el.dispatchEvent(new MouseEvent(t, init));
    }
  }

  async function executeClick(selector, elementIndex) {
    const el = resolveElement(selector, elementIndex);
    if (!el) return { error: "Element not found", selector, elementIndex };
    await scrollIntoViewIfNeeded(el);
    el.focus();
    dispatchPointerSequence(el, ["mousedown", "mouseup", "click"]);
    if (typeof el.click === "function") el.click();
    return { success: true, clicked: getLabel(el) || selector || `element[${elementIndex}]` };
  }

  async function executeType(selector, elementIndex, text, clearFirst, pressEnter) {
    const el = resolveElement(selector, elementIndex);
    if (!el) return { error: "Element not found", selector, elementIndex };

    await scrollIntoViewIfNeeded(el);
    el.focus();

    if (clearFirst) {
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
        el.value = "";
        el.dispatchEvent(new Event("input", { bubbles: true }));
      } else if (el.contentEditable === "true") {
        el.textContent = "";
      }
    }

    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      // Call the native setter on the matching prototype so framework
      // listeners (React/Vue/Svelte) receive the change event.
      const proto =
        el.tagName === "TEXTAREA"
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;

      if (nativeSetter) {
        nativeSetter.call(el, text);
      } else {
        // Defensive: a hostile page could redefine the prototype property.
        el.value = text;
      }

      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (el.contentEditable === "true") {
      el.textContent = text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }

    if (pressEnter) {
      dispatchKeySequence(el, "Enter", "Enter", 13);
      const form = el.closest("form");
      if (form) {
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      }
    }

    return { success: true, typed: text.substring(0, 50) };
  }

  function executeScroll(direction, amount) {
    switch (direction) {
      case "down":
        window.scrollBy({ top: amount, behavior: "smooth" });
        break;
      case "up":
        window.scrollBy({ top: -amount, behavior: "smooth" });
        break;
      case "top":
        window.scrollTo({ top: 0, behavior: "smooth" });
        break;
      case "bottom":
        window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
        break;
    }
    return {
      success: true,
      scrollY: window.scrollY,
      pageHeight: document.body.scrollHeight,
      viewportHeight: window.innerHeight,
    };
  }

  function extractText(selector) {
    if (selector) {
      const el = document.querySelector(selector);
      if (!el) return { error: "Element not found", selector };
      return { text: el.innerText.substring(0, 30000) };
    }
    return { text: document.body.innerText.substring(0, 30000) };
  }

  // --- New actor tools ----------------------------------------------------

  async function executeHover(selector, elementIndex, durationMs) {
    const el = resolveElement(selector, elementIndex);
    if (!el) return { error: "Element not found", selector, elementIndex };
    await scrollIntoViewIfNeeded(el);
    dispatchPointerSequence(el, ["mouseover", "mouseenter", "mousemove"]);
    if (durationMs && durationMs > 0) {
      await new Promise((r) => setTimeout(r, Math.min(durationMs, 5000)));
    }
    return { success: true, hovered: getLabel(el) || selector || `element[${elementIndex}]` };
  }

  function dispatchKeySequence(target, key, code, keyCode, modifiers = {}) {
    const init = {
      key,
      code,
      keyCode,
      which: keyCode,
      bubbles: true,
      cancelable: true,
      altKey: !!modifiers.alt,
      ctrlKey: !!modifiers.ctrl,
      metaKey: !!modifiers.meta,
      shiftKey: !!modifiers.shift,
    };
    target.dispatchEvent(new KeyboardEvent("keydown", init));
    target.dispatchEvent(new KeyboardEvent("keypress", init));
    target.dispatchEvent(new KeyboardEvent("keyup", init));
  }

  const NAMED_KEY_CODES = {
    Enter: 13,
    Escape: 27,
    Tab: 9,
    Backspace: 8,
    Delete: 46,
    ArrowUp: 38,
    ArrowDown: 40,
    ArrowLeft: 37,
    ArrowRight: 39,
    Home: 36,
    End: 35,
    PageUp: 33,
    PageDown: 34,
    " ": 32,
    Space: 32,
  };

  async function executePressKey(selector, elementIndex, key, modifiers) {
    // selector/elementIndex are optional — if omitted, dispatch on the
    // currently focused element so the model can drive global keys
    // like Escape.
    let target = resolveElement(selector, elementIndex);
    if (!target) target = document.activeElement || document.body;

    const code = key.length === 1 ? `Key${key.toUpperCase()}` : key;
    const keyCode = NAMED_KEY_CODES[key] || key.toUpperCase().charCodeAt(0);
    dispatchKeySequence(target, key, code, keyCode, modifiers || {});
    return { success: true, key, target: target.tagName.toLowerCase() };
  }

  async function executeDragDrop(fromSelector, fromIndex, toSelector, toIndex) {
    const src = resolveElement(fromSelector, fromIndex);
    const dst = resolveElement(toSelector, toIndex);
    if (!src) return { error: "Source element not found", fromSelector, fromIndex };
    if (!dst) return { error: "Destination element not found", toSelector, toIndex };

    await scrollIntoViewIfNeeded(src);
    const srcRect = src.getBoundingClientRect();
    const dstRect = dst.getBoundingClientRect();
    const fromXY = { x: srcRect.x + srcRect.width / 2, y: srcRect.y + srcRect.height / 2 };
    const toXY = { x: dstRect.x + dstRect.width / 2, y: dstRect.y + dstRect.height / 2 };

    // Build a DataTransfer so HTML5 drag listeners observe a real payload.
    const dt = new DataTransfer();

    const fire = (target, type, x, y) => {
      const ev = new DragEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        dataTransfer: dt,
      });
      target.dispatchEvent(ev);
    };

    fire(src, "dragstart", fromXY.x, fromXY.y);
    fire(src, "drag", fromXY.x, fromXY.y);
    fire(dst, "dragenter", toXY.x, toXY.y);
    fire(dst, "dragover", toXY.x, toXY.y);
    fire(dst, "drop", toXY.x, toXY.y);
    fire(src, "dragend", toXY.x, toXY.y);

    return { success: true, dragged: getLabel(src), to: getLabel(dst) };
  }

  /**
   * Drop a file (encoded as base64) into a real <input type="file">.
   *
   * The background module is responsible for verifying the user
   * authorized the upload before forwarding the bytes; this function
   * just performs the DOM mechanics.
   */
  async function executeFileUpload(selector, elementIndex, fileName, mimeType, base64Data) {
    const el = resolveElement(selector, elementIndex);
    if (!el) return { error: "Element not found", selector, elementIndex };
    if (el.tagName !== "INPUT" || el.type !== "file") {
      return { error: "Target is not an <input type=file>", tag: el.tagName, type: el.type };
    }

    // Decode base64 → Uint8Array → File. We chunk to keep large
    // uploads off a single allocation spike.
    const binary = atob(base64Data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const file = new File([bytes], fileName, { type: mimeType || "application/octet-stream" });

    const dt = new DataTransfer();
    dt.items.add(file);
    el.files = dt.files;
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("input", { bubbles: true }));

    return { success: true, uploaded: fileName, size: bytes.length };
  }

  // ============================================================
  // MESSAGE HANDLER
  // ============================================================

  browser.runtime.onMessage.addListener((msg, _sender, _sendResponse) => {
    switch (msg.type) {
      case "SENSOR_READ":
        return Promise.resolve(buildSemanticMap(msg.includeText));

      case "SENSOR_EXTRACT_TEXT":
        return Promise.resolve(extractText(msg.selector));

      case "ACTION_CLICK":
        return executeClick(msg.selector, msg.elementIndex);

      case "ACTION_TYPE":
        return executeType(
          msg.selector,
          msg.elementIndex,
          msg.text,
          msg.clearFirst,
          msg.pressEnter,
        );

      case "ACTION_SCROLL":
        return Promise.resolve(executeScroll(msg.direction, msg.amount));

      case "ACTION_HOVER":
        return executeHover(msg.selector, msg.elementIndex, msg.durationMs);

      case "ACTION_PRESS_KEY":
        return executePressKey(msg.selector, msg.elementIndex, msg.key, msg.modifiers);

      case "ACTION_DRAG_DROP":
        return executeDragDrop(msg.fromSelector, msg.fromIndex, msg.toSelector, msg.toIndex);

      case "ACTION_FILE_UPLOAD":
        return executeFileUpload(
          msg.selector,
          msg.elementIndex,
          msg.fileName,
          msg.mimeType,
          msg.base64Data,
        );

      case "SENSOR_FIND_TEXT": {
        const needle = msg.text;
        if (!needle) return Promise.resolve({ error: "No search text." });
        const compare = msg.caseSensitive ? needle : needle.toLowerCase();
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const matches = [];
        let node;
        while ((node = walker.nextNode()) && matches.length < 20) {
          const src = msg.caseSensitive ? node.textContent : node.textContent.toLowerCase();
          let idx = src.indexOf(compare);
          while (idx !== -1 && matches.length < 20) {
            const matchText = node.textContent.substring(idx, idx + needle.length);
            let x = 0,
              y = 0;
            try {
              const range = document.createRange();
              range.setStart(node, idx);
              range.setEnd(node, idx + needle.length);
              const rect = range.getBoundingClientRect();
              x = Math.round(rect.x);
              y = Math.round(rect.y);
            } catch (_e) {
              // Range construction can fail on detached nodes — skip silently.
            }
            matches.push({ text: matchText, x, y });
            idx = src.indexOf(compare, idx + 1);
          }
        }
        return Promise.resolve({ found: matches.length > 0, count: matches.length, matches });
      }

      case "SENSOR_GET_SELECTION":
        return Promise.resolve({ text: window.getSelection().toString() });

      case "ACTION_FOCUS": {
        const el = resolveElement(msg.selector, msg.elementIndex);
        if (!el) return Promise.resolve({ error: "Element not found", selector: msg.selector });
        return scrollIntoViewIfNeeded(el).then(() => {
          el.focus();
          return {
            success: true,
            focused: getLabel(el) || msg.selector || `element[${msg.elementIndex}]`,
          };
        });
      }

      case "ACTION_SET_VALUE": {
        const el = resolveElement(msg.selector, msg.elementIndex);
        if (!el) return Promise.resolve({ error: "Element not found", selector: msg.selector });
        const proto =
          el.tagName === "TEXTAREA"
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
        if (nativeSetter) nativeSetter.call(el, msg.value);
        /* v8 ignore next */ else el.value = msg.value;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return Promise.resolve({ success: true, value: msg.value });
      }

      case "SENSOR_ELEMENT_EXISTS": {
        if (!msg.selector) return Promise.resolve({ exists: false });
        try {
          const el = document.querySelector(msg.selector);
          return Promise.resolve({ exists: el !== null });
        } catch (_e) {
          return Promise.resolve({ exists: false });
        }
      }

      case "ACTION_EXECUTE_SCRIPT": {
        try {
          const result = new Function(`return (${msg.code})`)();
          const serialised = result === undefined ? null : result;
          return Promise.resolve({ success: true, result: serialised });
        } catch (err) {
          return Promise.resolve({ error: String(err) });
        }
      }

      case "PING":
        return Promise.resolve({ alive: true });

      default:
        return Promise.resolve({ error: "Unknown message type" });
    }
  });
})();
