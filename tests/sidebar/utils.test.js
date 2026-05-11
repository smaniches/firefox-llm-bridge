import { describe, it, expect } from "vitest";
import {
  TOOL_ICONS,
  escapeHtml,
  renderMd,
  summarize,
  safeHostname,
} from "../../sidebar/utils.js";

describe("TOOL_ICONS", () => {
  it("covers every tool exposed by the agent", () => {
    expect(Object.keys(TOOL_ICONS).sort()).toEqual([
      "click_element",
      "extract_text",
      "get_tab_info",
      "go_back",
      "navigate",
      "read_page",
      "screenshot",
      "scroll_page",
      "task_complete",
      "type_text",
      "wait",
    ]);
  });

  it("is frozen", () => {
    expect(Object.isFrozen(TOOL_ICONS)).toBe(true);
  });
});

describe("escapeHtml", () => {
  it("escapes <, >, & via DOM textContent", () => {
    const out = escapeHtml("<script>&");
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;");
    expect(out).toContain("&amp;");
  });

  it("returns empty for empty input", () => {
    expect(escapeHtml("")).toBe("");
  });

  it("preserves regular text", () => {
    expect(escapeHtml("hello world")).toBe("hello world");
  });
});

describe("renderMd", () => {
  it("escapes HTML first", () => {
    expect(renderMd("<x>")).toBe("&lt;x&gt;");
  });

  it("renders **bold**", () => {
    expect(renderMd("**X**")).toContain("<strong>X</strong>");
  });

  it("renders `inline code`", () => {
    expect(renderMd("`x`")).toContain("<code>x</code>");
  });

  it("renders [text](url) for http(s) URLs only", () => {
    expect(renderMd("[a](https://example.com)")).toContain(
      'href="https://example.com"',
    );
    // javascript: URI should not be converted (regex requires http/https)
    expect(renderMd("[a](javascript:alert(1))")).not.toContain("<a");
  });

  it("link has rel=noopener noreferrer and target=_blank", () => {
    const out = renderMd("[t](https://example.com)");
    expect(out).toContain("rel=\"noopener noreferrer\"");
    expect(out).toContain("target=\"_blank\"");
  });

  it("converts newlines to <br>", () => {
    expect(renderMd("a\nb")).toContain("<br>");
  });

  it("ampersand in plain text is escaped", () => {
    expect(renderMd("a & b")).toContain("&amp;");
  });
});

describe("summarize", () => {
  it("returns empty for missing input", () => {
    expect(summarize("anything", null)).toBe("");
    expect(summarize("anything", undefined)).toBe("");
  });

  it("navigate shows the hostname", () => {
    expect(summarize("navigate", { url: "https://example.com/a/b" })).toBe(
      "→ example.com",
    );
  });

  it("navigate without URL returns empty", () => {
    expect(summarize("navigate", {})).toBe("");
  });

  it("navigate with malformed URL returns arrow + empty", () => {
    expect(summarize("navigate", { url: "::::not-a-url" })).toBe("→ ");
  });

  it("click_element prefers selector, truncated to 30 chars", () => {
    const sel = "a".repeat(60);
    const out = summarize("click_element", { selector: sel });
    expect(out.length).toBe(30);
  });

  it("click_element falls back to element_index", () => {
    expect(summarize("click_element", { element_index: 7 })).toBe("[7]");
  });

  it("type_text truncates at 20 chars and adds ellipsis", () => {
    expect(summarize("type_text", { text: "x".repeat(50) })).toMatch(/\.\.\."$/);
  });

  it("type_text handles missing text", () => {
    expect(summarize("type_text", {})).toBe('""');
  });

  it("scroll_page returns the direction", () => {
    expect(summarize("scroll_page", { direction: "down" })).toBe("down");
  });

  it("scroll_page returns empty if no direction", () => {
    expect(summarize("scroll_page", {})).toBe("");
  });

  it("extract_text returns selector or '(full page)'", () => {
    expect(summarize("extract_text", { selector: ".x" })).toBe(".x");
    expect(summarize("extract_text", {})).toBe("(full page)");
  });

  it("wait returns milliseconds with default 1000", () => {
    expect(summarize("wait", { milliseconds: 500 })).toBe("500ms");
    expect(summarize("wait", {})).toBe("1000ms");
  });

  it("returns empty for unknown tools", () => {
    expect(summarize("screenshot", {})).toBe("");
    expect(summarize("read_page", {})).toBe("");
    expect(summarize("task_complete", { summary: "done" })).toBe("");
  });
});

describe("safeHostname", () => {
  it("returns hostname for valid URL", () => {
    expect(safeHostname("https://example.com/x")).toBe("example.com");
  });

  it("returns empty string for invalid URL", () => {
    expect(safeHostname("not a url")).toBe("");
  });
});
