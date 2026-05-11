import { describe, it, expect } from "vitest";
import {
  TOOL_ICONS,
  escapeHtml,
  renderMd,
  renderMdInto,
  tokenizeMd,
  summarize,
  safeHostname,
} from "../../sidebar/utils.js";

describe("TOOL_ICONS", () => {
  it("covers every tool exposed by the agent", () => {
    expect(Object.keys(TOOL_ICONS).sort()).toEqual([
      "click_element",
      "download_file",
      "drag_drop",
      "extract_text",
      "get_tab_info",
      "go_back",
      "hover_element",
      "list_tabs",
      "navigate",
      "press_key",
      "read_page",
      "screenshot",
      "screenshot_for_vision",
      "scroll_page",
      "switch_tab",
      "task_complete",
      "type_text",
      "upload_file",
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
    expect(renderMd("[a](https://example.com)")).toContain('href="https://example.com"');
    // javascript: URI should not be converted (regex requires http/https)
    expect(renderMd("[a](javascript:alert(1))")).not.toContain("<a");
  });

  it("link has rel=noopener noreferrer and target=_blank", () => {
    const out = renderMd("[t](https://example.com)");
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('target="_blank"');
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
    expect(summarize("navigate", { url: "https://example.com/a/b" })).toBe("→ example.com");
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

  it("click_element shows [?] when neither selector nor index is given", () => {
    expect(summarize("click_element", {})).toBe("[?]");
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

  it("hover_element prefers selector then index, with [?] fallback", () => {
    expect(summarize("hover_element", { selector: ".x" })).toBe(".x");
    expect(summarize("hover_element", { element_index: 3 })).toBe("[3]");
    expect(summarize("hover_element", {})).toBe("[?]");
  });

  it("press_key formats modifiers + key", () => {
    expect(summarize("press_key", { key: "a", modifiers: { ctrl: true, shift: true } })).toBe(
      "Ctrl+Shift+a",
    );
    expect(summarize("press_key", { key: "Enter" })).toBe("Enter");
    expect(summarize("press_key", { key: "x", modifiers: { alt: true, meta: true } })).toBe(
      "Alt+Meta+x",
    );
  });

  it("press_key with no key returns just modifiers", () => {
    expect(summarize("press_key", { modifiers: { ctrl: true } })).toBe("Ctrl");
  });

  it("drag_drop shows from→to with fallback to index", () => {
    expect(
      summarize("drag_drop", {
        from_selector: "#a",
        to_selector: "#b",
      }),
    ).toBe("#a → #b");
    expect(
      summarize("drag_drop", {
        from_index: 1,
        to_index: 2,
      }),
    ).toBe("[1] → [2]");
  });

  it("drag_drop shows [?] when both endpoints are missing", () => {
    expect(summarize("drag_drop", {})).toBe("[?] → [?]");
  });

  it("upload_file shows the file_name", () => {
    expect(summarize("upload_file", { file_name: "report.pdf" })).toBe("report.pdf");
    expect(summarize("upload_file", {})).toBe("(file)");
  });

  it("switch_tab shows tab id", () => {
    expect(summarize("switch_tab", { tab_id: 42 })).toBe("→ tab 42");
  });

  it("list_tabs returns static label", () => {
    expect(summarize("list_tabs", {})).toBe("(current window)");
  });

  it("screenshot_for_vision returns static label", () => {
    expect(summarize("screenshot_for_vision", {})).toBe("(image to next turn)");
  });

  it("download_file shows hostname when url given", () => {
    expect(summarize("download_file", { url: "https://files.example.com/x.pdf" })).toBe(
      "↓ files.example.com",
    );
  });

  it("download_file empty when url missing", () => {
    expect(summarize("download_file", {})).toBe("");
  });
});

describe("tokenizeMd", () => {
  it("returns empty for non-string or empty input", () => {
    expect(tokenizeMd("")).toEqual([]);
    expect(tokenizeMd(null)).toEqual([]);
    expect(tokenizeMd(undefined)).toEqual([]);
  });

  it("emits plain text when there's nothing to mark up", () => {
    expect(tokenizeMd("hello world")).toEqual([{ kind: "text", value: "hello world" }]);
  });

  it("recognises **bold**", () => {
    const toks = tokenizeMd("a **b** c");
    expect(toks).toEqual([
      { kind: "text", value: "a " },
      { kind: "bold", value: "b" },
      { kind: "text", value: " c" },
    ]);
  });

  it("recognises `inline code`", () => {
    const toks = tokenizeMd("a `x` b");
    expect(toks.find((t) => t.kind === "code")).toEqual({ kind: "code", value: "x" });
  });

  it("recognises [text](https://url) and rejects javascript: URIs", () => {
    expect(tokenizeMd("[a](https://example.com)").find((t) => t.kind === "link")).toEqual({
      kind: "link",
      value: "a",
      href: "https://example.com",
    });
    expect(
      tokenizeMd("[evil](javascript:alert(1))").find((t) => t.kind === "link"),
    ).toBeUndefined();
  });

  it("emits br for newlines", () => {
    const toks = tokenizeMd("a\nb");
    expect(toks).toEqual([
      { kind: "text", value: "a" },
      { kind: "br" },
      { kind: "text", value: "b" },
    ]);
  });
});

describe("renderMdInto", () => {
  it("clears parent and renders text-only content", () => {
    const div = document.createElement("div");
    div.textContent = "stale";
    renderMdInto(div, "hello");
    expect(div.textContent).toBe("hello");
    // No <strong> / <code> / <a> nodes for plain text.
    expect(div.querySelector("strong, code, a")).toBeNull();
  });

  it("renders bold + code + link + br via real DOM nodes", () => {
    const div = document.createElement("div");
    renderMdInto(div, "**bold** and `code` and [link](https://example.com)\nnext");
    expect(div.querySelector("strong").textContent).toBe("bold");
    expect(div.querySelector("code").textContent).toBe("code");
    const a = div.querySelector("a");
    expect(a.href).toBe("https://example.com/");
    expect(a.target).toBe("_blank");
    expect(a.rel).toBe("noopener noreferrer");
    expect(a.textContent).toBe("link");
    expect(div.querySelector("br")).not.toBeNull();
  });

  it("escapes < > & properly because we use text nodes", () => {
    const div = document.createElement("div");
    renderMdInto(div, "<script>alert(1)</script>");
    // No real <script> child — the string ends up as text.
    expect(div.querySelector("script")).toBeNull();
    expect(div.textContent).toBe("<script>alert(1)</script>");
  });

  it("rejects javascript: URIs (link not produced)", () => {
    const div = document.createElement("div");
    renderMdInto(div, "[evil](javascript:alert(1))");
    expect(div.querySelector("a")).toBeNull();
    expect(div.textContent).toBe("[evil](javascript:alert(1))");
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
