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
