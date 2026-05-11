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
 * @param {string} t
 */
export function renderMd(t) {
  return t
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\n/g, "<br>");
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
      return input.selector ? input.selector.substring(0, 30) : `[${input.element_index}]`;
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
