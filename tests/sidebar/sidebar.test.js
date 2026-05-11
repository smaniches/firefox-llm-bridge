/**
 * Integration tests for sidebar/sidebar.js (module).
 *
 * Strategy: build the minimum DOM the script expects, mock browser, then
 * import the module so its top-level wiring runs against our fixture.
 * Each test gets a fresh import via vi.resetModules + a fresh DOM.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SIDEBAR_HTML = readFileSync(join(__dirname, "..", "..", "sidebar", "sidebar.html"), "utf8");

let port;
let handleMsg;
let onDisconnect;

function extractBody(html) {
  const m = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  return m ? m[1].replace(/<script[\s\S]*?<\/script>/gi, "") : "";
}

async function setup({ pendingSelection } = {}) {
  document.body.innerHTML = extractBody(SIDEBAR_HTML);

  // Configure browser mock specifics
  port = {
    postMessage: vi.fn(),
    onMessage: {
      addListener: vi.fn((fn) => {
        handleMsg = fn;
      }),
    },
    onDisconnect: {
      addListener: vi.fn((fn) => {
        onDisconnect = fn;
      }),
    },
  };
  globalThis.browser.runtime.connect.mockImplementation(() => port);
  globalThis.browser.storage.session.get.mockResolvedValue(
    pendingSelection ? { pendingSelection } : {},
  );

  vi.resetModules();
  await import("../../sidebar/sidebar.js");

  // Allow microtasks from checkPending to settle
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(async () => {
  handleMsg = null;
  onDisconnect = null;
});

describe("sidebar: connection lifecycle", () => {
  it("connects to the background port on load", async () => {
    await setup();
    expect(globalThis.browser.runtime.connect).toHaveBeenCalledWith({
      name: "topologica-sidebar",
    });
  });

  it("sends GET_STATUS on connect", async () => {
    await setup();
    expect(port.postMessage).toHaveBeenCalledWith({ type: "GET_STATUS" });
  });

  it("reconnects after a delay when the port disconnects", async () => {
    vi.useFakeTimers();
    await setup();
    expect(typeof onDisconnect).toBe("function");
    const before = globalThis.browser.runtime.connect.mock.calls.length;
    onDisconnect();
    await vi.advanceTimersByTimeAsync(600);
    expect(globalThis.browser.runtime.connect.mock.calls.length).toBe(before + 1);
    vi.useRealTimers();
  });

  it("disconnect during an active stream clears streaming state", async () => {
    vi.useFakeTimers();
    await setup();
    handleMsg({ type: "STREAM_START", id: "sDisc" });
    handleMsg({ type: "STREAM_DELTA", id: "sDisc", text: "x" });
    const beforeMsgs = document.querySelectorAll(".msg.msg-assistant.streaming").length;
    expect(beforeMsgs).toBe(1);
    onDisconnect();
    // The bubble no longer has the .streaming class — it's frozen as
    // whatever text it had, not actively painting deltas.
    expect(document.querySelectorAll(".msg.msg-assistant.streaming").length).toBe(0);
    // Subsequent STREAM_DELTA for the dead id is ignored.
    handleMsg({ type: "STREAM_DELTA", id: "sDisc", text: "should not append" });
    await vi.advanceTimersByTimeAsync(700);
    vi.useRealTimers();
  });
});

describe("sidebar: STATUS handling", () => {
  it("shows 'Not configured' when no provider", async () => {
    await setup();
    handleMsg({ type: "STATUS", status: "idle", hasProvider: false });
    expect(document.getElementById("provider-label").textContent).toBe("Not configured");
    expect(document.getElementById("no-provider-warning").classList.contains("hidden")).toBe(false);
  });

  it("shows the model name when configured", async () => {
    await setup();
    handleMsg({
      type: "STATUS",
      status: "idle",
      hasProvider: true,
      modelName: "Claude Sonnet 4",
    });
    expect(document.getElementById("provider-label").textContent).toBe("Claude Sonnet 4");
  });

  it("falls back to provider name when modelName missing", async () => {
    await setup();
    handleMsg({
      type: "STATUS",
      status: "idle",
      hasProvider: true,
      providerName: "OpenAI",
    });
    expect(document.getElementById("provider-label").textContent).toBe("OpenAI");
  });

  it("switches statusBar class for each status", async () => {
    await setup();
    const bar = document.getElementById("status-bar");
    handleMsg({ type: "STATUS", status: "thinking", message: "..." });
    expect(bar.classList.contains("status-thinking")).toBe(true);
    handleMsg({ type: "STATUS", status: "running", message: "go" });
    expect(bar.classList.contains("status-running")).toBe(true);
    handleMsg({ type: "STATUS", status: "error", message: "x" });
    expect(bar.classList.contains("status-error")).toBe(true);
    handleMsg({ type: "STATUS", status: "idle" });
    expect(bar.classList.contains("status-idle")).toBe(true);
  });

  it("thinking with no message uses default text", async () => {
    await setup();
    handleMsg({ type: "STATUS", status: "thinking" });
    expect(document.getElementById("status-text").textContent).toBe("Thinking...");
  });

  it("running with no message uses default text", async () => {
    await setup();
    handleMsg({ type: "STATUS", status: "running" });
    expect(document.getElementById("status-text").textContent).toBe("Executing...");
  });

  it("error with no message uses default text", async () => {
    await setup();
    handleMsg({ type: "STATUS", status: "error" });
    expect(document.getElementById("status-text").textContent).toBe("Error");
  });
});

describe("sidebar: message rendering", () => {
  it("renders ASSISTANT_TEXT with Markdown support", async () => {
    await setup();
    handleMsg({ type: "ASSISTANT_TEXT", text: "**bold**" });
    expect(document.querySelector(".msg-assistant").innerHTML).toContain("<strong>bold</strong>");
  });

  it("renders TOOL_USE entry with icon/name/summary", async () => {
    await setup();
    handleMsg({ type: "TOOL_USE", tool: "click_element", input: { selector: "#x" }, turn: 1 });
    const t = document.querySelector(".msg-tool");
    expect(t).toBeTruthy();
    expect(document.getElementById("turn-counter").textContent).toBe("Turn 1");
  });

  it("uses fallback gear icon for an unknown tool name", async () => {
    await setup();
    handleMsg({ type: "TOOL_USE", tool: "some_future_tool", input: {}, turn: 1 });
    const icon = document.querySelector(".msg-tool span:first-child");
    expect(icon.textContent).toBe("⚙");
  });

  it("marks last tool as success/failure on TOOL_RESULT", async () => {
    await setup();
    handleMsg({ type: "TOOL_USE", tool: "click_element", input: {}, turn: 1 });
    handleMsg({ type: "TOOL_RESULT", success: true });
    expect(document.querySelector(".msg-tool").classList.contains("success")).toBe(true);
    handleMsg({ type: "TOOL_USE", tool: "navigate", input: {}, turn: 2 });
    handleMsg({ type: "TOOL_RESULT", success: false });
    const tools = document.querySelectorAll(".msg-tool");
    expect(tools[tools.length - 1].classList.contains("failure")).toBe(true);
  });

  it("renders SCREENSHOT as an img element", async () => {
    await setup();
    handleMsg({ type: "SCREENSHOT", image: "data:image/png;base64,xxx" });
    const img = document.querySelector(".msg-screenshot img");
    expect(img.src).toBe("data:image/png;base64,xxx");
  });

  it("renders TASK_COMPLETE as a system message", async () => {
    await setup();
    handleMsg({ type: "TASK_COMPLETE", summary: "done" });
    expect(document.querySelector(".msg-system").textContent).toContain("done");
  });

  it("renders AGENT_STOPPED with default text when message missing", async () => {
    await setup();
    handleMsg({ type: "AGENT_STOPPED" });
    expect(document.querySelector(".msg-system").textContent).toBe("Stopped.");
  });

  it("renders ERROR and reveals the no-provider warning for that error class", async () => {
    await setup();
    handleMsg({ type: "ERROR", message: "No LLM provider configured." });
    expect(document.getElementById("no-provider-warning").classList.contains("hidden")).toBe(false);
    expect(document.querySelector(".msg-error").textContent).toContain("No LLM provider");
  });

  it("renders ERROR without unhiding the warning for other messages", async () => {
    await setup();
    document.getElementById("no-provider-warning").classList.add("hidden");
    handleMsg({ type: "ERROR", message: "Generic failure" });
    expect(document.getElementById("no-provider-warning").classList.contains("hidden")).toBe(true);
  });

  it("HISTORY_CLEARED resets the welcome panel", async () => {
    await setup();
    handleMsg({ type: "ASSISTANT_TEXT", text: "hello" });
    expect(document.querySelector(".msg-assistant")).toBeTruthy();
    handleMsg({ type: "HISTORY_CLEARED" });
    expect(document.querySelector(".welcome-msg")).toBeTruthy();
    expect(document.querySelectorAll(".msg-assistant").length).toBe(0);
  });

  it("HISTORY_RESTORE repopulates user + assistant messages", async () => {
    await setup();
    handleMsg({
      type: "HISTORY_RESTORE",
      messages: [
        { role: "user", text: "first prompt" },
        { role: "assistant", text: "first reply" },
        { role: "user", text: "**second**" },
        { role: "assistant", text: "second reply" },
      ],
    });
    const userMsgs = document.querySelectorAll(".msg-user");
    const asstMsgs = document.querySelectorAll(".msg-assistant");
    expect(userMsgs.length).toBe(2);
    expect(asstMsgs.length).toBe(2);
    // Markdown is rendered on assistant turns
    expect(userMsgs[1].textContent).toBe("**second**");
    expect(asstMsgs[1].textContent).toBe("second reply");
  });

  it("HISTORY_RESTORE is a no-op for empty or missing messages", async () => {
    await setup();
    handleMsg({ type: "HISTORY_RESTORE", messages: [] });
    handleMsg({ type: "HISTORY_RESTORE" });
    handleMsg({ type: "HISTORY_RESTORE", messages: null });
    expect(document.querySelector(".welcome-msg")).toBeTruthy();
    expect(document.querySelectorAll(".msg-assistant").length).toBe(0);
  });

  it("HISTORY_RESTORE skips malformed entries", async () => {
    await setup();
    handleMsg({
      type: "HISTORY_RESTORE",
      messages: [
        null,
        { role: "system", text: "ignored" },
        { role: "user", text: 42 },
        { role: "assistant", text: "ok" },
      ],
    });
    expect(document.querySelectorAll(".msg-assistant").length).toBe(1);
    expect(document.querySelectorAll(".msg-user").length).toBe(0);
  });
});

describe("sidebar: send + mode toggle", () => {
  it("send button posts a CHAT_ONLY message in chat mode", async () => {
    await setup();
    const inp = document.getElementById("input-text");
    inp.value = "hi";
    inp.dispatchEvent(new Event("input"));
    document.getElementById("btn-send").click();
    expect(port.postMessage).toHaveBeenCalledWith({ type: "CHAT_ONLY", text: "hi" });
  });

  it("send button posts a SEND_MESSAGE in agent mode", async () => {
    await setup();
    document.getElementById("mode-agent").click();
    const inp = document.getElementById("input-text");
    inp.value = "do it";
    inp.dispatchEvent(new Event("input"));
    document.getElementById("btn-send").click();
    expect(port.postMessage).toHaveBeenCalledWith({ type: "SEND_MESSAGE", text: "do it" });
  });

  it("does not send when input is empty", async () => {
    await setup();
    const before = port.postMessage.mock.calls.length;
    document.getElementById("btn-send").click();
    expect(port.postMessage.mock.calls.length).toBe(before);
  });

  it("does not send while agent is running, even with text", async () => {
    await setup();
    // Mark running via STATUS message
    handleMsg({ type: "STATUS", status: "running", message: "..." });
    const before = port.postMessage.mock.calls.length;
    // Bypass the disabled-attr by setting value + dispatching Enter
    const input = document.getElementById("input-text");
    input.disabled = false;
    input.value = "hello";
    const evt = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    input.dispatchEvent(evt);
    expect(port.postMessage.mock.calls.length).toBe(before);
  });

  it("Enter submits, Shift+Enter does not", async () => {
    await setup();
    const input = document.getElementById("input-text");
    input.value = "test";
    const enterEvt = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(enterEvt);
    expect(port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "CHAT_ONLY", text: "test" }),
    );

    port.postMessage.mockClear();
    input.value = "more";
    const shiftEvt = new KeyboardEvent("keydown", { key: "Enter", shiftKey: true });
    input.dispatchEvent(shiftEvt);
    expect(port.postMessage).not.toHaveBeenCalled();
  });

  it("Stop button posts STOP_AGENT", async () => {
    await setup();
    document.getElementById("btn-stop").click();
    expect(port.postMessage).toHaveBeenCalledWith({ type: "STOP_AGENT" });
  });

  it("Clear button posts CLEAR_HISTORY", async () => {
    await setup();
    document.getElementById("btn-clear").click();
    expect(port.postMessage).toHaveBeenCalledWith({ type: "CLEAR_HISTORY" });
  });

  it("Settings buttons open the options page", async () => {
    await setup();
    document.getElementById("btn-settings").click();
    expect(globalThis.browser.runtime.openOptionsPage).toHaveBeenCalled();
    document.getElementById("btn-open-settings").click();
    expect(globalThis.browser.runtime.openOptionsPage).toHaveBeenCalledTimes(2);
  });

  it("mode toggle updates classes and placeholder", async () => {
    await setup();
    const chat = document.getElementById("mode-chat");
    const agent = document.getElementById("mode-agent");
    const input = document.getElementById("input-text");
    agent.click();
    expect(agent.classList.contains("active")).toBe(true);
    expect(input.placeholder).toBe("Tell me what to do...");
    chat.click();
    expect(chat.classList.contains("active")).toBe(true);
    expect(input.placeholder).toBe("Ask about this page...");
  });

  it("quick-action button populates input and sends in chat mode", async () => {
    await setup();
    const quick = document.querySelector(".quick-btn");
    quick.click();
    expect(port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "CHAT_ONLY", text: expect.any(String) }),
    );
  });

  it("auto-resize textarea recalculates height on input", async () => {
    await setup();
    const input = document.getElementById("input-text");
    input.value = "a";
    input.dispatchEvent(new Event("input"));
    expect(input.style.height).toBeTruthy();
  });
});

describe("sidebar: pending selection", () => {
  it("auto-sends 'Explain:' when pendingSelection is stored", async () => {
    await setup({ pendingSelection: "some text" });
    // checkPending runs at startup; allow microtasks
    await new Promise((r) => setTimeout(r, 5));
    const calls = port.postMessage.mock.calls;
    expect(
      calls.some(
        (c) =>
          c[0].type === "CHAT_ONLY" &&
          typeof c[0].text === "string" &&
          c[0].text.includes("Explain:"),
      ),
    ).toBe(true);
  });

  it("silently handles storage failures", async () => {
    document.body.innerHTML = extractBody(SIDEBAR_HTML);
    port = {
      postMessage: vi.fn(),
      onMessage: { addListener: vi.fn() },
      onDisconnect: { addListener: vi.fn() },
    };
    globalThis.browser.runtime.connect.mockImplementation(() => port);
    globalThis.browser.storage.session.get.mockRejectedValueOnce(new Error("no session storage"));
    vi.resetModules();
    await expect(import("../../sidebar/sidebar.js")).resolves.toBeDefined();
  });
});

/** Wait for a rAF flush so the streaming renderer paints. */
function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

describe("sidebar: streaming + cost", () => {
  it("STREAM_START creates a streaming assistant bubble", async () => {
    await setup();
    handleMsg({ type: "STREAM_START", id: "s1" });
    const el = document.querySelector(".msg.msg-assistant.streaming");
    expect(el).not.toBeNull();
    expect(el.dataset.streamId).toBe("s1");
  });

  it("STREAM_DELTA appends to the active streaming message (rAF-coalesced)", async () => {
    await setup();
    handleMsg({ type: "STREAM_START", id: "s2" });
    handleMsg({ type: "STREAM_DELTA", id: "s2", text: "Hel" });
    handleMsg({ type: "STREAM_DELTA", id: "s2", text: "lo" });
    await nextFrame();
    const el = document.querySelector(".msg.msg-assistant.streaming");
    expect(el.textContent).toBe("Hello");
  });

  it("coalesces multiple deltas in the same frame into a single render", async () => {
    await setup();
    handleMsg({ type: "STREAM_START", id: "sCoalesce" });
    // Five deltas back-to-back — all flushed in one rAF tick.
    for (const t of ["a", "b", "c", "d", "e"]) {
      handleMsg({ type: "STREAM_DELTA", id: "sCoalesce", text: t });
    }
    await nextFrame();
    expect(document.querySelector(".msg.msg-assistant.streaming").textContent).toBe("abcde");
  });

  it("ignores STREAM_DELTA for a different active stream id", async () => {
    await setup();
    handleMsg({ type: "STREAM_START", id: "s3" });
    handleMsg({ type: "STREAM_DELTA", id: "other", text: "lost" });
    await nextFrame();
    expect(document.querySelector(".msg.msg-assistant").textContent).toBe("");
  });

  it("STREAM_END removes the streaming class and runs a final synchronous render", async () => {
    await setup();
    handleMsg({ type: "STREAM_START", id: "s4" });
    handleMsg({ type: "STREAM_DELTA", id: "s4", text: "hi" });
    // STREAM_END runs synchronously: it must paint even when the pending
    // rAF hasn't fired yet.
    handleMsg({ type: "STREAM_END", id: "s4" });
    const el = document.querySelector(".msg.msg-assistant");
    expect(el).not.toBeNull();
    expect(el.classList.contains("streaming")).toBe(false);
    expect(el.textContent).toBe("hi");
    // ASSISTANT_TEXT with text differing from the just-streamed text DOES
    // render (e.g. a "turn limit reached" system message that comes after).
    handleMsg({ type: "ASSISTANT_TEXT", text: "different follow-up" });
    expect(document.querySelectorAll(".msg.msg-assistant").length).toBe(2);
  });

  it("suppresses the duplicate ASSISTANT_TEXT that immediately follows a stream", async () => {
    // The agent loop emits both STREAM_END and a trailing ASSISTANT_TEXT
    // carrying the same text. Without suppression, every assistant turn
    // would render twice.
    await setup();
    handleMsg({ type: "STREAM_START", id: "sDup" });
    handleMsg({ type: "STREAM_DELTA", id: "sDup", text: "hello world" });
    handleMsg({ type: "STREAM_END", id: "sDup" });
    handleMsg({ type: "ASSISTANT_TEXT", text: "hello world" });
    // Exactly ONE bubble, not two.
    expect(document.querySelectorAll(".msg.msg-assistant").length).toBe(1);
  });

  it("only the FIRST matching ASSISTANT_TEXT is suppressed (next renders)", async () => {
    await setup();
    handleMsg({ type: "STREAM_START", id: "sOnce" });
    handleMsg({ type: "STREAM_DELTA", id: "sOnce", text: "x" });
    handleMsg({ type: "STREAM_END", id: "sOnce" });
    handleMsg({ type: "ASSISTANT_TEXT", text: "x" }); // suppressed
    handleMsg({ type: "ASSISTANT_TEXT", text: "x" }); // second copy renders
    expect(document.querySelectorAll(".msg.msg-assistant").length).toBe(2);
  });

  it("empty stream lets the following ASSISTANT_TEXT render normally", async () => {
    await setup();
    handleMsg({ type: "STREAM_START", id: "sEmpty" });
    handleMsg({ type: "STREAM_END", id: "sEmpty" });
    handleMsg({ type: "ASSISTANT_TEXT", text: "fallback text" });
    expect(document.querySelectorAll(".msg.msg-assistant").length).toBe(1);
    expect(document.querySelector(".msg.msg-assistant").textContent).toBe("fallback text");
  });

  it("rAF callback that fires after STREAM_END is a no-op (no orphan paint)", async () => {
    await setup();
    handleMsg({ type: "STREAM_START", id: "sLate" });
    handleMsg({ type: "STREAM_DELTA", id: "sLate", text: "x" });
    // STREAM_END synchronously: cancels rAF and clears state.streaming.
    handleMsg({ type: "STREAM_END", id: "sLate" });
    // Now wait for the next animation frame; the scheduled rAF (if any
    // leaked) would fire here and read from null state.streaming.
    await nextFrame();
    // No exception thrown above, no second .streaming message:
    expect(document.querySelectorAll(".msg.msg-assistant").length).toBe(1);
  });

  it("STREAM_END for an unknown id is a no-op", async () => {
    await setup();
    handleMsg({ type: "STREAM_END", id: "missing" });
    expect(document.querySelectorAll(".msg.msg-assistant").length).toBe(0);
  });

  it("STREAM_END for an empty stream removes the empty placeholder", async () => {
    await setup();
    handleMsg({ type: "STREAM_START", id: "s5" });
    handleMsg({ type: "STREAM_END", id: "s5" });
    expect(document.querySelector(".msg.msg-assistant")).toBeNull();
  });

  it("during streaming, ASSISTANT_TEXT does not double-render", async () => {
    await setup();
    handleMsg({ type: "STREAM_START", id: "s6" });
    handleMsg({ type: "STREAM_DELTA", id: "s6", text: "ok" });
    // ASSISTANT_TEXT while streaming: should be suppressed
    handleMsg({ type: "ASSISTANT_TEXT", text: "ok" });
    expect(document.querySelectorAll(".msg.msg-assistant").length).toBe(1);
  });

  it("STATUS with cost populates the cost counter", async () => {
    await setup();
    handleMsg({ type: "STATUS", status: "idle", cost: "$0.42" });
    const cc = document.getElementById("cost-counter");
    expect(cc.textContent).toBe("$0.42");
    expect(cc.classList.contains("hidden")).toBe(false);
  });

  it("STATUS with $0.00 cost hides the counter", async () => {
    await setup();
    handleMsg({ type: "STATUS", status: "idle", cost: "$0.42" });
    handleMsg({ type: "STATUS", status: "idle", cost: "$0.00" });
    expect(document.getElementById("cost-counter").classList.contains("hidden")).toBe(true);
  });

  it("STATUS with no cost field leaves counter hidden", async () => {
    await setup();
    handleMsg({ type: "STATUS", status: "idle" });
    expect(document.getElementById("cost-counter").classList.contains("hidden")).toBe(true);
  });
});

describe("sidebar: TOOL_PREVIEW overlay", () => {
  it("shows the overlay with tool name and JSON-formatted input", async () => {
    await setup();
    handleMsg({
      type: "TOOL_PREVIEW",
      id: "preview-1",
      tool: "click_element",
      input: { selector: "#x" },
    });
    const overlay = document.getElementById("preview-overlay");
    expect(overlay.classList.contains("hidden")).toBe(false);
    expect(document.getElementById("preview-tool-name").textContent).toBe("click_element");
    expect(document.getElementById("preview-tool-input").textContent).toContain('"selector"');
    expect(document.getElementById("preview-tool-input").textContent).toContain("#x");
  });

  it("posts PREVIEW_RESPONSE { approved: true } on Approve click", async () => {
    await setup();
    handleMsg({ type: "TOOL_PREVIEW", id: "p2", tool: "navigate", input: { url: "https://x" } });
    document.getElementById("btn-preview-approve").click();
    const sent = port.postMessage.mock.calls.find((c) => c[0].type === "PREVIEW_RESPONSE");
    expect(sent[0]).toEqual({ type: "PREVIEW_RESPONSE", id: "p2", approved: true });
    expect(document.getElementById("preview-overlay").classList.contains("hidden")).toBe(true);
  });

  it("posts PREVIEW_RESPONSE { approved: false } on Cancel click", async () => {
    await setup();
    handleMsg({ type: "TOOL_PREVIEW", id: "p3", tool: "navigate", input: {} });
    document.getElementById("btn-preview-cancel").click();
    const sent = port.postMessage.mock.calls.find((c) => c[0].type === "PREVIEW_RESPONSE");
    expect(sent[0].approved).toBe(false);
    expect(document.getElementById("preview-overlay").classList.contains("hidden")).toBe(true);
  });

  it("Approve/Cancel are no-ops when no preview is pending", async () => {
    await setup();
    const before = port.postMessage.mock.calls.length;
    document.getElementById("btn-preview-approve").click();
    document.getElementById("btn-preview-cancel").click();
    const after = port.postMessage.mock.calls.length;
    expect(after).toBe(before);
  });

  it("renders {} as input when none is provided", async () => {
    await setup();
    handleMsg({ type: "TOOL_PREVIEW", id: "p4", tool: "screenshot", input: undefined });
    expect(document.getElementById("preview-tool-input").textContent).toBe("{}");
  });
});

describe("sidebar: POLICY_WARNING banner", () => {
  it("inserts a policy-banner at the top of the messages list", async () => {
    await setup();
    handleMsg({
      type: "POLICY_WARNING",
      message: "Page content matched 2 heuristic patterns.",
      patterns: ["ignore-previous", "system-override"],
    });
    const banner = document.querySelector(".policy-banner");
    expect(banner).not.toBeNull();
    expect(banner.querySelector(".policy-banner-title").textContent).toMatch(/heuristic/);
    expect(banner.querySelector(".policy-banner-patterns").textContent).toBe(
      "ignore-previous, system-override",
    );
  });

  it("removes the banner when clicked", async () => {
    await setup();
    handleMsg({ type: "POLICY_WARNING", message: "x", patterns: ["a"] });
    const banner = document.querySelector(".policy-banner");
    banner.click();
    expect(document.querySelector(".policy-banner")).toBeNull();
  });

  it("falls back to default title when message is missing", async () => {
    await setup();
    handleMsg({ type: "POLICY_WARNING", patterns: [] });
    const banner = document.querySelector(".policy-banner");
    expect(banner.querySelector(".policy-banner-title").textContent).toBe("Policy warning");
  });

  it("renders an empty patterns line when patterns is not an array", async () => {
    await setup();
    handleMsg({ type: "POLICY_WARNING", message: "Heads up", patterns: undefined });
    const banner = document.querySelector(".policy-banner");
    expect(banner.querySelector(".policy-banner-patterns").textContent).toBe("");
  });

  it("auto-removes the banner after 12 seconds", async () => {
    vi.useFakeTimers();
    try {
      await setup();
      handleMsg({ type: "POLICY_WARNING", message: "x", patterns: ["a"] });
      expect(document.querySelector(".policy-banner")).not.toBeNull();
      vi.advanceTimersByTime(12_001);
      expect(document.querySelector(".policy-banner")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("manual dismiss cancels the auto-remove timeout (no double-remove)", async () => {
    vi.useFakeTimers();
    try {
      await setup();
      handleMsg({ type: "POLICY_WARNING", message: "x", patterns: ["a"] });
      const banner = document.querySelector(".policy-banner");
      banner.click();
      expect(document.querySelector(".policy-banner")).toBeNull();
      // Advance past the auto-remove deadline; the cleared timer must not
      // fire a remove() on the (already detached) element.
      const removeSpy = vi.spyOn(banner, "remove");
      vi.advanceTimersByTime(20_000);
      expect(removeSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
