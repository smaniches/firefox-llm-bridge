/**
 * Pure utility functions for the sidebar UI.
 *
 * Kept in a separate module so they can be unit-tested without spinning up
 * the full DOM controller. No side effects, no browser.* calls.
 */

/** Icons displayed next to each agent tool name in the message list. */
export const TOOL_ICONS = Object.freeze({
  read_page: "👁",
  click_element: "👆",
  type_text: "⌨",
  navigate: "🌐",
  scroll_page: "↕",
  extract_text: "📄",
  screenshot: "📸",
  wait: "⏳",
  go_back: "↩",
  get_tab_info: "ℹ",
  hover_element: "🖱",
  press_key: "⌨",
  drag_drop: "✋",
  upload_file: "📎",
  download_file: "💾",
  list_tabs: "🗂",
  switch_tab: "🔀",
  screenshot_for_vision: "🔍",
  task_complete: "✅",
});

/**
 * Escape a string for safe insertion as HTML text content.
 *
 * Uses the DOM textContent technique rather than a regex chain so it
 * benefits from the browser's own escaper.
 *
 * @param {string} t
 */
export function escapeHtml(t) {
  const d = document.createElement("div");
  d.textContent = t;
  return d.innerHTML;
}

/**
 * Render a minimal Markdown subset to HTML.
 *
 * Supports: **bold**, `inline code`, [text](https://...) links, newlines.
 * Output is HTML-escaped first; only the four whitelisted constructs become
 * tags. Links require an `http(s)://` URL so `javascript:` URIs cannot leak.
 *
 * Kept for callers that need an HTML string; new code should prefer
 * `renderMdInto(parent, text)` which produces DOM nodes directly and avoids
 * the `innerHTML` assignment that Mozilla's web-ext lint flags as unsafe.
 *
 * @param {string} t
 */
export function renderMd(t) {
  return t
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
    )
    .replace(/\n/g, "<br>");
}

/**
 * Token shape produced by `tokenizeMd`. One of:
 *   { kind: "text",   value: string }
 *   { kind: "bold",   value: string }
 *   { kind: "code",   value: string }
 *   { kind: "link",   value: string, href: string }
 *   { kind: "br" }
 *
 * @typedef {(
 *   | { kind: "text" | "bold" | "code", value: string }
 *   | { kind: "link", value: string, href: string }
 *   | { kind: "br" }
 * )} MdToken
 */

/**
 * Tokenize our small markdown subset into a flat array. Pure function so
 * tests can exercise every branch without the DOM.
 *
 * Precedence — earliest match wins, scanning left to right:
 *   1. `**bold**`
 *   2. `` `inline code` ``
 *   3. `[text](https://url)` (http(s) only)
 *   4. `\n` → `br`
 *   5. plain text
 *
 * @param {string} t
 * @returns {MdToken[]}
 */
export function tokenizeMd(t) {
  /** @type {MdToken[]} */
  const out = [];
  if (typeof t !== "string" || t.length === 0) return out;

  // Matches one of bold | code | link | newline. We capture group indices so
  // we can tell what fired.
  const re = /\*\*([\s\S]+?)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)]+)\)|(\n)/g;
  let last = 0;
  let m;
  while ((m = re.exec(t)) !== null) {
    if (m.index > last) {
      out.push({ kind: "text", value: t.slice(last, m.index) });
    }
    if (m[1] !== undefined) out.push({ kind: "bold", value: m[1] });
    else if (m[2] !== undefined) out.push({ kind: "code", value: m[2] });
    else if (m[3] !== undefined) out.push({ kind: "link", value: m[3], href: m[4] });
    else if (m[5] !== undefined) out.push({ kind: "br" });
    last = re.lastIndex;
  }
  if (last < t.length) out.push({ kind: "text", value: t.slice(last) });
  return out;
}

/**
 * Render `text` (markdown subset) into `parent` using safe DOM construction.
 * Replaces all children of `parent`. No `innerHTML` involved — Mozilla's
 * web-ext lint accepts this construction without warnings.
 *
 * @param {HTMLElement} parent
 * @param {string} text
 */
export function renderMdInto(parent, text) {
  parent.textContent = "";
  for (const tok of tokenizeMd(text)) {
    switch (tok.kind) {
      case "text":
        parent.appendChild(document.createTextNode(tok.value));
        break;
      case "bold": {
        const el = document.createElement("strong");
        el.textContent = tok.value;
        parent.appendChild(el);
        break;
      }
      case "code": {
        const el = document.createElement("code");
        el.textContent = tok.value;
        parent.appendChild(el);
        break;
      }
      case "link": {
        const el = document.createElement("a");
        el.href = tok.href;
        el.target = "_blank";
        el.rel = "noopener noreferrer";
        el.textContent = tok.value;
        parent.appendChild(el);
        break;
      }
      case "br":
        parent.appendChild(document.createElement("br"));
        break;
    }
  }
}

/**
 * Build a short human-readable summary string for a tool invocation,
 * displayed alongside the tool name in the sidebar message list.
 *
 * @param {string} tool   Tool name (see TOOL_ICONS keys)
 * @param {object} input  Tool input as provided by the LLM
 */
export function summarize(tool, input) {
  if (!input) return "";
  switch (tool) {
    case "navigate":
      return input.url ? `→ ${safeHostname(input.url)}` : "";
    case "click_element":
      return input.selector ? input.selector.substring(0, 30) : `[${input.element_index ?? "?"}]`;
    case "type_text": {
      const text = input.text || "";
      const truncated = text.length > 20 ? `${text.substring(0, 20)}...` : text;
      return `"${truncated}"`;
    }
    case "scroll_page":
      return input.direction || "";
    case "extract_text":
      return input.selector || "(full page)";
    case "wait":
      return `${input.milliseconds || 1000}ms`;
    case "hover_element":
      return input.selector ? input.selector.substring(0, 30) : `[${input.element_index ?? "?"}]`;
    case "press_key": {
      const mods = input.modifiers || {};
      const parts = [];
      if (mods.ctrl) parts.push("Ctrl");
      if (mods.alt) parts.push("Alt");
      if (mods.shift) parts.push("Shift");
      if (mods.meta) parts.push("Meta");
      parts.push(input.key || "");
      return parts.filter(Boolean).join("+");
    }
    case "drag_drop":
      return `${input.from_selector || `[${input.from_index ?? "?"}]`} → ${input.to_selector || `[${input.to_index ?? "?"}]`}`;
    case "upload_file":
      return input.file_name || "(file)";
    case "switch_tab":
      return `→ tab ${input.tab_id}`;
    case "list_tabs":
      return "(current window)";
    case "screenshot_for_vision":
      return "(image to next turn)";
    case "download_file":
      return input.url ? `↓ ${safeHostname(input.url)}` : "";
    default:
      return "";
  }
}

/**
 * Parse `url` and return its hostname, or empty string if it cannot be parsed.
 * Used so an LLM-supplied invalid URL does not throw inside summarize().
 *
 * @param {string} url
 */
export function safeHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}
