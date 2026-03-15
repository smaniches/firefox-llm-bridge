/**
 * TOPOLOGICA BRIDGE - Content Script (Sensor + Actor)
 * Santiago Maniches | TOPOLOGICA LLC
 *
 * Injected into every page. Two responsibilities:
 * 1. SENSOR: Extract semantic accessibility map of the page
 * 2. ACTOR: Execute click, type, scroll actions dispatched from background
 *
 * The semantic map is 10x more effective than raw HTML for AI agent comprehension.
 * We walk the DOM extracting ARIA roles, labels, and bounding rects to produce
 * a structured representation that Claude can reason about.
 */

(() => {
  "use strict";

  // Avoid double injection
  if (window.__topologicaBridgeInjected) return;
  window.__topologicaBridgeInjected = true;

  // ============================================================
  // SEMANTIC MAP CACHE
  // ============================================================

  let lastSemanticMap = [];

  // ============================================================
  // SENSOR: Accessibility Tree Extraction
  // ============================================================

  const INTERACTIVE_ROLES = new Set([
    "button", "link", "textbox", "checkbox", "radio", "combobox",
    "listbox", "menuitem", "menu", "menubar", "tab", "tablist",
    "switch", "slider", "spinbutton", "searchbox", "option",
    "treeitem", "gridcell", "row", "columnheader", "rowheader",
  ]);

  const INTERACTIVE_TAGS = {
    BUTTON: "button",
    A: "link",
    INPUT: null,  // determined by type
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
    // Explicit ARIA role
    const ariaRole = node.getAttribute("role");
    if (ariaRole && INTERACTIVE_ROLES.has(ariaRole)) return ariaRole;

    // Tag-based inference
    const tagRole = INTERACTIVE_TAGS[node.tagName];
    if (tagRole) return tagRole;

    // Input type mapping
    if (node.tagName === "INPUT") {
      return INPUT_TYPE_ROLES[node.type] || "textbox";
    }

    // Elements with click handlers or tabindex
    if (node.getAttribute("tabindex") !== null && node.getAttribute("tabindex") !== "-1") {
      return "button";
    }
    if (node.getAttribute("onclick") || node.getAttribute("data-action")) {
      return "button";
    }

    // Contenteditable
    if (node.contentEditable === "true") return "textbox";

    return null;
  }

  function isVisible(node) {
    if (!node.offsetParent && node.tagName !== "BODY" && node.tagName !== "HTML") {
      // Could be position:fixed, check differently
      const style = window.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return false;
      if (style.position !== "fixed" && style.position !== "sticky") return false;
    }
    const rect = node.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    return true;
  }

  function getLabel(node) {
    // Priority: aria-label > aria-labelledby > associated label > text content > placeholder > title
    const ariaLabel = node.getAttribute("aria-label");
    if (ariaLabel) return ariaLabel.trim();

    const labelledBy = node.getAttribute("aria-labelledby");
    if (labelledBy) {
      const labelEl = document.getElementById(labelledBy);
      if (labelEl) return labelEl.textContent.trim().substring(0, 200);
    }

    // Associated <label>
    if (node.id) {
      const label = document.querySelector(`label[for="${CSS.escape(node.id)}"]`);
      if (label) return label.textContent.trim().substring(0, 200);
    }

    // Direct text content (for buttons, links)
    if (node.tagName === "BUTTON" || node.tagName === "A" || node.tagName === "SUMMARY") {
      const text = node.textContent.trim();
      if (text) return text.substring(0, 200);
    }

    // Input value, placeholder
    if (node.value && (node.tagName === "INPUT" || node.tagName === "TEXTAREA")) {
      return `[value: ${node.value.substring(0, 100)}]`;
    }
    if (node.placeholder) return `[placeholder: ${node.placeholder}]`;

    if (node.title) return node.title.substring(0, 200);

    // Alt text for images within
    const img = node.querySelector("img[alt]");
    if (img && img.alt) return img.alt.substring(0, 200);

    return "";
  }

  function generateSelector(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;

    // Try data-testid or data-* attributes
    for (const attr of ["data-testid", "data-test", "data-cy", "data-action"]) {
      const val = el.getAttribute(attr);
      if (val) return `[${attr}="${CSS.escape(val)}"]`;
    }

    // Build a specific path
    const parts = [];
    let current = el;
    while (current && current !== document.body && parts.length < 4) {
      let part = current.tagName.toLowerCase();
      if (current.id) {
        parts.unshift(`#${CSS.escape(current.id)}`);
        break;
      }
      if (current.className && typeof current.className === "string") {
        const classes = current.className.trim().split(/\s+/).filter(c => c && !c.includes(":")).slice(0, 2);
        if (classes.length > 0) {
          part += "." + classes.map(c => CSS.escape(c)).join(".");
        }
      }
      // Add nth-child if needed for uniqueness
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(s => s.tagName === current.tagName);
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

  function buildSemanticMap(includeText = false) {
    const map = [];
    let index = 0;

    function walk(node) {
      if (!node || node.nodeType !== Node.ELEMENT_NODE) return;

      const role = inferRole(node);
      if (role && isVisible(node)) {
        const rect = node.getBoundingClientRect();
        const entry = {
          i: index,
          role: role,
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

        // Additional attributes for specific roles
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
        index++;
      }

      // Walk children (skip script, style, svg internals)
      if (node.tagName !== "SCRIPT" && node.tagName !== "STYLE" && node.tagName !== "NOSCRIPT") {
        for (const child of node.children) {
          walk(child);
        }
      }
    }

    walk(document.body);
    lastSemanticMap = map;

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
  // ACTOR: Action Execution
  // ============================================================

  function resolveElement(selector, elementIndex) {
    // By index from last semantic map
    if (elementIndex !== null && elementIndex !== undefined && lastSemanticMap[elementIndex]) {
      const entry = lastSemanticMap[elementIndex];
      const el = document.querySelector(entry.selector);
      if (el) return el;
    }

    // By selector
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

  async function executeClick(selector, elementIndex) {
    const el = resolveElement(selector, elementIndex);
    if (!el) {
      return { error: "Element not found", selector, elementIndex };
    }

    await scrollIntoViewIfNeeded(el);

    // Focus first
    el.focus();

    // Dispatch mousedown -> mouseup -> click sequence
    const rect = el.getBoundingClientRect();
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;

    const eventInit = {
      bubbles: true,
      cancelable: true,
      clientX: cx,
      clientY: cy,
      button: 0,
    };

    el.dispatchEvent(new MouseEvent("mousedown", eventInit));
    el.dispatchEvent(new MouseEvent("mouseup", eventInit));
    el.dispatchEvent(new MouseEvent("click", eventInit));

    // Also try .click() for stubborn elements
    if (typeof el.click === "function") {
      el.click();
    }

    return {
      success: true,
      clicked: getLabel(el) || selector || `element[${elementIndex}]`,
    };
  }

  async function executeType(selector, elementIndex, text, clearFirst, pressEnter) {
    const el = resolveElement(selector, elementIndex);
    if (!el) {
      return { error: "Element not found", selector, elementIndex };
    }

    await scrollIntoViewIfNeeded(el);
    el.focus();

    if (clearFirst) {
      // Select all and delete
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
        el.value = "";
        el.dispatchEvent(new Event("input", { bubbles: true }));
      } else if (el.contentEditable === "true") {
        el.textContent = "";
      }
    }

    // Set value directly
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      // Use native setter to trigger React/framework listeners
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, "value"
      )?.set || Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, "value"
      )?.set;

      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(el, text);
      } else {
        el.value = text;
      }

      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (el.contentEditable === "true") {
      el.textContent = text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }

    if (pressEnter) {
      el.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          which: 13,
          bubbles: true,
        })
      );
      el.dispatchEvent(
        new KeyboardEvent("keypress", {
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          which: 13,
          bubbles: true,
        })
      );
      el.dispatchEvent(
        new KeyboardEvent("keyup", {
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          which: 13,
          bubbles: true,
        })
      );
      // Also submit the form if there is one
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

  // ============================================================
  // MESSAGE HANDLER
  // ============================================================

  browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
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
          msg.pressEnter
        );

      case "ACTION_SCROLL":
        return Promise.resolve(executeScroll(msg.direction, msg.amount));

      case "PING":
        return Promise.resolve({ alive: true });

      default:
        return Promise.resolve({ error: "Unknown message type" });
    }
  });

})();
