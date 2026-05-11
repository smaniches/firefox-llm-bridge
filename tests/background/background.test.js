/**
 * Tests for background/background.js.
 *
 * Strategy: vi.mock the providers/index.js module so the agent loop is
 * isolated from any real network. The `browser` global is mocked in
 * tests/setup.js. We import the module fresh per test group so the
 * module-level side effects (onConnect, contextMenus.create, etc.)
 * are observable.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../background/providers/index.js", () => {
  return {
    callLLM: vi.fn(),
    buildToolResultMessage: vi.fn(async (results) => ({
      role: "user",
      content: results.map((r) => ({
        type: "tool_result",
        tool_use_id: r.tool_use_id,
        content: r.content,
      })),
    })),
    getActiveProviderInfo: vi.fn(async () => ({
      id: "anthropic",
      name: "Anthropic Claude",
      model: "claude-sonnet-4-20250514",
      modelName: "Claude Sonnet 4",
    })),
  };
});

let bridge;
let providers;

beforeEach(async () => {
  vi.resetModules();
  providers = await import("../../background/providers/index.js");
  bridge = await import("../../background/background.js");
  bridge.state.conversationHistory = [];
  bridge.state.currentTabId = null;
  bridge.state.isAgentRunning = false;
  bridge.state.abortController = null;
  bridge.state.turnCount = 0;
  bridge.state.maxTurns = 25;
});

describe("module-level side effects", () => {
  it("registers an onConnect listener", () => {
    expect(globalThis.browser.runtime.onConnect.addListener).toHaveBeenCalled();
  });

  it("creates the context menu", () => {
    expect(globalThis.browser.contextMenus.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: "bridge-explain", contexts: ["selection"] }),
    );
  });

  it("registers a storage onChanged listener", () => {
    expect(globalThis.browser.storage.onChanged.addListener).toHaveBeenCalled();
  });
});

describe("constants", () => {
  it("BROWSER_TOOLS contains the eleven core tools", () => {
    const names = bridge.BROWSER_TOOLS.map((t) => t.name).sort();
    expect(names).toContain("read_page");
    expect(names).toContain("click_element");
    expect(names).toContain("type_text");
    expect(names).toContain("navigate");
    expect(names).toContain("scroll_page");
    expect(names).toContain("extract_text");
    expect(names).toContain("screenshot");
    expect(names).toContain("wait");
    expect(names).toContain("go_back");
    expect(names).toContain("get_tab_info");
    expect(names).toContain("task_complete");
  });

  it("SYSTEM_PROMPT exists", () => {
    expect(typeof bridge.SYSTEM_PROMPT).toBe("string");
    expect(bridge.SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });
});

describe("sleep", () => {
  it("resolves after the given delay", async () => {
    const t0 = Date.now();
    await bridge.sleep(15);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(10);
  });
});

describe("loadSettings", () => {
  it("loads maxTurns from storage", async () => {
    globalThis.browser.storage.local.get.mockResolvedValueOnce({ maxTurns: 42 });
    await bridge.loadSettings();
    expect(bridge.state.maxTurns).toBe(42);
  });

  it("falls back to default 25 when not stored", async () => {
    globalThis.browser.storage.local.get.mockResolvedValueOnce({});
    await bridge.loadSettings();
    expect(bridge.state.maxTurns).toBe(25);
  });
});

describe("send", () => {
  it("posts a message via the port", () => {
    const port = { postMessage: vi.fn() };
    bridge.send(port, { type: "X" });
    expect(port.postMessage).toHaveBeenCalledWith({ type: "X" });
  });

  it("swallows errors from a closed port", () => {
    const port = {
      postMessage: vi.fn(() => {
        throw new Error("closed");
      }),
    };
    expect(() => bridge.send(port, { type: "X" })).not.toThrow();
  });
});

describe("executeTool", () => {
  beforeEach(() => {
    bridge.state.currentTabId = 1;
  });

  it("returns error when no tabId and tool requires one", async () => {
    bridge.state.currentTabId = null;
    const r = await bridge.executeTool("read_page", {});
    expect(r.error).toBe("No active tab.");
  });

  it("read_page sends SENSOR_READ", async () => {
    globalThis.browser.tabs.sendMessage.mockResolvedValueOnce({ url: "u", elements: [] });
    await bridge.executeTool("read_page", { include_text: true });
    expect(globalThis.browser.tabs.sendMessage).toHaveBeenCalledWith(1, {
      type: "SENSOR_READ",
      includeText: true,
    });
  });

  it("read_page defaults includeText to false", async () => {
    globalThis.browser.tabs.sendMessage.mockResolvedValueOnce({});
    await bridge.executeTool("read_page", {});
    expect(globalThis.browser.tabs.sendMessage).toHaveBeenCalledWith(1, {
      type: "SENSOR_READ",
      includeText: false,
    });
  });

  it("click_element dispatches ACTION_CLICK", async () => {
    globalThis.browser.tabs.sendMessage.mockResolvedValueOnce({ success: true });
    const r = await bridge.executeTool("click_element", { selector: "#x", element_index: 2 });
    expect(globalThis.browser.tabs.sendMessage.mock.calls[0][1]).toMatchObject({
      type: "ACTION_CLICK",
      selector: "#x",
      elementIndex: 2,
    });
    expect(r.success).toBe(true);
  });

  it("click_element passes null selector when omitted", async () => {
    globalThis.browser.tabs.sendMessage.mockResolvedValueOnce({ success: true });
    await bridge.executeTool("click_element", {});
    expect(globalThis.browser.tabs.sendMessage.mock.calls[0][1]).toMatchObject({
      selector: null,
      elementIndex: null,
    });
  });

  it("type_text dispatches ACTION_TYPE with defaults", async () => {
    globalThis.browser.tabs.sendMessage.mockResolvedValueOnce({ success: true });
    await bridge.executeTool("type_text", { text: "hi" });
    expect(globalThis.browser.tabs.sendMessage.mock.calls[0][1]).toMatchObject({
      type: "ACTION_TYPE",
      text: "hi",
      clearFirst: true,
      pressEnter: false,
    });
  });

  it("type_text respects clear_first=false and press_enter=true", async () => {
    globalThis.browser.tabs.sendMessage.mockResolvedValueOnce({ success: true });
    await bridge.executeTool("type_text", { text: "x", clear_first: false, press_enter: true });
    expect(globalThis.browser.tabs.sendMessage.mock.calls[0][1]).toMatchObject({
      clearFirst: false,
      pressEnter: true,
    });
  });

  it("navigate calls tabs.update and resolves on onCompleted", async () => {
    let captured;
    globalThis.browser.webNavigation.onCompleted.addListener.mockImplementationOnce((fn) => {
      captured = fn;
      // Fire shortly
      setTimeout(() => captured({ tabId: 1, frameId: 0 }), 5);
    });
    const r = await bridge.executeTool("navigate", { url: "https://example.com" });
    expect(globalThis.browser.tabs.update).toHaveBeenCalledWith(1, { url: "https://example.com" });
    expect(r.success).toBe(true);
  });

  it("navigate ignores onCompleted for other tabs/frames", async () => {
    let captured;
    globalThis.browser.webNavigation.onCompleted.addListener.mockImplementationOnce((fn) => {
      captured = fn;
      setTimeout(() => captured({ tabId: 999, frameId: 0 }), 2);
      setTimeout(() => captured({ tabId: 1, frameId: 1 }), 4);
      setTimeout(() => captured({ tabId: 1, frameId: 0 }), 6);
    });
    const r = await bridge.executeTool("navigate", { url: "u" });
    expect(r.success).toBe(true);
  });

  it("navigate falls back to timeout when onCompleted never fires", async () => {
    vi.useFakeTimers();
    globalThis.browser.webNavigation.onCompleted.addListener.mockImplementationOnce(() => {});
    const p = bridge.executeTool("navigate", { url: "u" });
    await vi.advanceTimersByTimeAsync(15001);
    const r = await p;
    expect(r.success).toBe(true);
    vi.useRealTimers();
  });

  it("scroll_page dispatches ACTION_SCROLL with default amount", async () => {
    globalThis.browser.tabs.sendMessage.mockResolvedValueOnce({ success: true });
    await bridge.executeTool("scroll_page", { direction: "down" });
    expect(globalThis.browser.tabs.sendMessage.mock.calls[0][1]).toMatchObject({
      type: "ACTION_SCROLL",
      direction: "down",
      amount: 600,
    });
  });

  it("scroll_page passes custom amount", async () => {
    globalThis.browser.tabs.sendMessage.mockResolvedValueOnce({ success: true });
    await bridge.executeTool("scroll_page", { direction: "up", amount: 100 });
    expect(globalThis.browser.tabs.sendMessage.mock.calls[0][1].amount).toBe(100);
  });

  it("extract_text dispatches SENSOR_EXTRACT_TEXT", async () => {
    globalThis.browser.tabs.sendMessage.mockResolvedValueOnce({ text: "hi" });
    await bridge.executeTool("extract_text", { selector: ".a" });
    expect(globalThis.browser.tabs.sendMessage.mock.calls[0][1]).toMatchObject({
      type: "SENSOR_EXTRACT_TEXT",
      selector: ".a",
    });
  });

  it("extract_text passes null selector by default", async () => {
    globalThis.browser.tabs.sendMessage.mockResolvedValueOnce({ text: "" });
    await bridge.executeTool("extract_text", {});
    expect(globalThis.browser.tabs.sendMessage.mock.calls[0][1].selector).toBeNull();
  });

  it("screenshot captures the visible tab", async () => {
    globalThis.browser.tabs.captureVisibleTab.mockResolvedValueOnce("data:image/png;base64,xxx");
    const r = await bridge.executeTool("screenshot", {});
    expect(r.image).toMatch(/^data:image/);
  });

  it("wait sleeps for the given ms (default 1000)", async () => {
    const t0 = Date.now();
    await bridge.executeTool("wait", { milliseconds: 5 });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1);
  });

  it("wait uses 1000ms default when omitted", async () => {
    vi.useFakeTimers();
    const p = bridge.executeTool("wait", {});
    await vi.advanceTimersByTimeAsync(1000);
    const r = await p;
    expect(r.success).toBe(true);
    vi.useRealTimers();
  });

  it("go_back calls tabs.goBack", async () => {
    const r = await bridge.executeTool("go_back", {});
    expect(globalThis.browser.tabs.goBack).toHaveBeenCalledWith(1);
    expect(r.success).toBe(true);
  });

  it("get_tab_info returns url and title", async () => {
    globalThis.browser.tabs.get.mockResolvedValueOnce({ url: "u", title: "t" });
    const r = await bridge.executeTool("get_tab_info", {});
    expect(r).toEqual({ url: "u", title: "t" });
  });

  it("task_complete returns the summary", async () => {
    const r = await bridge.executeTool("task_complete", { summary: "done" });
    expect(r).toEqual({ complete: true, summary: "done" });
  });

  it("unknown tool returns an error object", async () => {
    const r = await bridge.executeTool("unknown_tool", {});
    expect(r.error).toMatch(/Unknown tool/);
  });

  it("wraps thrown errors", async () => {
    globalThis.browser.tabs.sendMessage.mockRejectedValueOnce(new Error("boom"));
    const r = await bridge.executeTool("read_page", {});
    expect(r.error).toMatch(/Tool failed.*boom/);
  });
});

describe("runAgentLoop", () => {
  function makePort() {
    return { postMessage: vi.fn() };
  }

  it("emits ASSISTANT_TEXT and exits on end_turn", async () => {
    providers.callLLM.mockResolvedValueOnce({
      content: [{ type: "text", text: "all done" }],
      stop_reason: "end_turn",
    });

    const port = makePort();
    await bridge.runAgentLoop("hi", port);

    const types = port.postMessage.mock.calls.map((c) => c[0].type);
    expect(types).toContain("STATUS");
    expect(types).toContain("ASSISTANT_TEXT");
    const last = port.postMessage.mock.calls[port.postMessage.mock.calls.length - 1][0];
    expect(last.type).toBe("STATUS");
    expect(last.status).toBe("idle");
  });

  it("handles a tool_use turn that calls task_complete", async () => {
    providers.callLLM
      .mockResolvedValueOnce({
        content: [{ type: "tool_use", id: "t1", name: "task_complete", input: { summary: "done" } }],
        stop_reason: "tool_use",
      });

    const port = makePort();
    await bridge.runAgentLoop("hi", port);

    const types = port.postMessage.mock.calls.map((c) => c[0].type);
    expect(types).toContain("TOOL_USE");
    expect(types).toContain("TASK_COMPLETE");
  });

  it("stops when turn limit is reached", async () => {
    bridge.state.maxTurns = 1;
    providers.callLLM.mockResolvedValue({
      content: [{ type: "tool_use", id: "tX", name: "wait", input: { milliseconds: 1 } }],
      stop_reason: "tool_use",
    });

    const port = makePort();
    await bridge.runAgentLoop("hi", port);

    const texts = port.postMessage.mock.calls
      .filter((c) => c[0].type === "ASSISTANT_TEXT")
      .map((c) => c[0].text);
    expect(texts.some((t) => /turn limit/i.test(t))).toBe(true);
  });

  it("propagates SCREENSHOT message when screenshot tool runs", async () => {
    providers.callLLM
      .mockResolvedValueOnce({
        content: [{ type: "tool_use", id: "s1", name: "screenshot", input: {} }],
        stop_reason: "tool_use",
      })
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "done" }],
        stop_reason: "end_turn",
      });

    globalThis.browser.tabs.captureVisibleTab.mockResolvedValueOnce("data:image/png;base64,abc");

    const port = makePort();
    await bridge.runAgentLoop("snap", port);

    const screenshots = port.postMessage.mock.calls.filter((c) => c[0].type === "SCREENSHOT");
    expect(screenshots).toHaveLength(1);
  });

  it("emits ERROR when callLLM throws non-abort", async () => {
    providers.callLLM.mockRejectedValueOnce(new Error("provider down"));
    const port = makePort();
    await bridge.runAgentLoop("hi", port);
    const errors = port.postMessage.mock.calls.filter((c) => c[0].type === "ERROR");
    expect(errors).toHaveLength(1);
    expect(errors[0][0].message).toMatch(/provider down/);
  });

  it("emits AGENT_STOPPED on AbortError", async () => {
    providers.callLLM.mockRejectedValueOnce(Object.assign(new Error("aborted"), { name: "AbortError" }));
    const port = makePort();
    await bridge.runAgentLoop("hi", port);
    const stopped = port.postMessage.mock.calls.filter((c) => c[0].type === "AGENT_STOPPED");
    expect(stopped.length).toBeGreaterThan(0);
  });

  it("emits AGENT_STOPPED when the abort signal fires mid-loop", async () => {
    providers.callLLM.mockImplementationOnce(async () => {
      bridge.state.abortController.abort();
      return {
        content: [{ type: "tool_use", id: "x", name: "wait", input: { milliseconds: 1 } }],
        stop_reason: "tool_use",
      };
    });
    const port = makePort();
    await bridge.runAgentLoop("hi", port);
    const stopped = port.postMessage.mock.calls.filter((c) => c[0].type === "AGENT_STOPPED");
    expect(stopped.length).toBeGreaterThan(0);
  });

  it("falls back to 'Processing...' status when getActiveProviderInfo returns null", async () => {
    providers.getActiveProviderInfo.mockResolvedValueOnce(null);
    providers.callLLM.mockResolvedValueOnce({
      content: [{ type: "text", text: "hi" }],
      stop_reason: "end_turn",
    });
    const port = makePort();
    await bridge.runAgentLoop("hi", port);
    const status = port.postMessage.mock.calls.find(
      (c) => c[0].type === "STATUS" && c[0].status === "thinking",
    );
    expect(status[0].message).toBe("Processing...");
  });

  it("truncates oversized tool_result content", async () => {
    const huge = "x".repeat(60_000);
    providers.callLLM
      .mockResolvedValueOnce({
        content: [{ type: "tool_use", id: "t", name: "extract_text", input: {} }],
        stop_reason: "tool_use",
      })
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn",
      });
    globalThis.browser.tabs.sendMessage.mockResolvedValueOnce({ text: huge });
    bridge.state.currentTabId = 1;
    const port = makePort();
    await bridge.runAgentLoop("hi", port);

    const trMsg = bridge.state.conversationHistory.find(
      (m) => Array.isArray(m.content) && m.content[0]?.type === "tool_result",
    );
    expect(trMsg.content[0].content.length).toBeLessThan(50_200);
  });
});

describe("runChatOnly", () => {
  it("includes page context and emits ASSISTANT_TEXT", async () => {
    providers.callLLM.mockResolvedValueOnce({
      content: [{ type: "text", text: "answer" }],
      stop_reason: "end_turn",
    });
    globalThis.browser.tabs.sendMessage.mockResolvedValueOnce({ text: "page body" });
    const port = { postMessage: vi.fn() };
    await bridge.runChatOnly("what?", port);
    expect(port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ASSISTANT_TEXT", text: "answer" }),
    );
  });

  it("handles a tab with no content script (sendMessage throws)", async () => {
    providers.callLLM.mockResolvedValueOnce({
      content: [{ type: "text", text: "hi" }],
      stop_reason: "end_turn",
    });
    globalThis.browser.tabs.sendMessage.mockRejectedValueOnce(new Error("no content script"));
    const port = { postMessage: vi.fn() };
    await bridge.runChatOnly("?", port);
    expect(port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ASSISTANT_TEXT" }),
    );
  });

  it("emits ERROR on non-abort failure", async () => {
    providers.callLLM.mockRejectedValueOnce(new Error("fail"));
    const port = { postMessage: vi.fn() };
    await bridge.runChatOnly("?", port);
    expect(
      port.postMessage.mock.calls.some((c) => c[0].type === "ERROR"),
    ).toBe(true);
  });

  it("silently exits on AbortError", async () => {
    providers.callLLM.mockRejectedValueOnce(
      Object.assign(new Error("aborted"), { name: "AbortError" }),
    );
    const port = { postMessage: vi.fn() };
    await bridge.runChatOnly("?", port);
    expect(
      port.postMessage.mock.calls.some((c) => c[0].type === "ERROR"),
    ).toBe(false);
  });

  it("uses 'Thinking...' status when no provider info available", async () => {
    providers.getActiveProviderInfo.mockResolvedValueOnce(null);
    providers.callLLM.mockResolvedValueOnce({
      content: [{ type: "text", text: "x" }],
      stop_reason: "end_turn",
    });
    const port = { postMessage: vi.fn() };
    await bridge.runChatOnly("?", port);
    const s = port.postMessage.mock.calls.find(
      (c) => c[0].type === "STATUS" && c[0].status === "thinking",
    );
    expect(s[0].message).toBe("Thinking...");
  });

  it("handles no active tab gracefully", async () => {
    globalThis.browser.tabs.query.mockResolvedValueOnce([]);
    providers.callLLM.mockResolvedValueOnce({
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
    });
    const port = { postMessage: vi.fn() };
    await bridge.runChatOnly("?", port);
    expect(port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ASSISTANT_TEXT" }),
    );
  });
});

describe("port message handlers", () => {
  function getConnectListener() {
    const calls = globalThis.browser.runtime.onConnect.addListener.mock.calls;
    return calls[calls.length - 1][0];
  }

  function makePortWithName(name = "topologica-sidebar", sender = {}) {
    const port = {
      name,
      sender,
      postMessage: vi.fn(),
      onMessage: { addListener: vi.fn() },
    };
    return port;
  }

  it("ignores ports with the wrong name", () => {
    const port = makePortWithName("other");
    getConnectListener()(port);
    expect(port.onMessage.addListener).not.toHaveBeenCalled();
  });

  it("rejects ports whose sender has a tab (content-script origin)", () => {
    const port = makePortWithName("topologica-sidebar", { tab: { id: 5 } });
    getConnectListener()(port);
    expect(port.onMessage.addListener).not.toHaveBeenCalled();
  });

  it("rejects ports from other extensions", () => {
    globalThis.browser.runtime.id = "self";
    const port = makePortWithName("topologica-sidebar", { id: "other-ext" });
    getConnectListener()(port);
    expect(port.onMessage.addListener).not.toHaveBeenCalled();
  });

  it("accepts a port without sender.tab and dispatches GET_STATUS", async () => {
    const port = makePortWithName();
    getConnectListener()(port);
    const handler = port.onMessage.addListener.mock.calls[0][0];
    await handler({ type: "GET_STATUS" });
    expect(port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "STATUS" }),
    );
  });

  it("CLEAR_HISTORY resets state and emits HISTORY_CLEARED", async () => {
    bridge.state.conversationHistory = [{ role: "user", content: "x" }];
    bridge.state.turnCount = 3;
    const port = makePortWithName();
    getConnectListener()(port);
    const handler = port.onMessage.addListener.mock.calls[0][0];
    await handler({ type: "CLEAR_HISTORY" });
    expect(bridge.state.conversationHistory).toEqual([]);
    expect(bridge.state.turnCount).toBe(0);
    expect(port.postMessage).toHaveBeenCalledWith({ type: "HISTORY_CLEARED" });
  });

  it("STOP_AGENT triggers abort", async () => {
    const port = makePortWithName();
    getConnectListener()(port);
    const handler = port.onMessage.addListener.mock.calls[0][0];
    bridge.state.abortController = new AbortController();
    await handler({ type: "STOP_AGENT" });
    expect(bridge.state.abortController.signal.aborted).toBe(true);
  });

  it("STOP_AGENT with no controller is a no-op", async () => {
    const port = makePortWithName();
    getConnectListener()(port);
    const handler = port.onMessage.addListener.mock.calls[0][0];
    bridge.state.abortController = null;
    await handler({ type: "STOP_AGENT" });
    // no throw
  });

  it("SEND_MESSAGE is rejected when agent already running", async () => {
    const port = makePortWithName();
    getConnectListener()(port);
    const handler = port.onMessage.addListener.mock.calls[0][0];
    bridge.state.isAgentRunning = true;
    await handler({ type: "SEND_MESSAGE", text: "x" });
    expect(port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ERROR" }),
    );
  });

  it("CHAT_ONLY no-ops while agent running", async () => {
    const port = makePortWithName();
    getConnectListener()(port);
    const handler = port.onMessage.addListener.mock.calls[0][0];
    bridge.state.isAgentRunning = true;
    await handler({ type: "CHAT_ONLY", text: "x" });
    // postMessage may have been called for ERROR previously; here we just want
    // no STATUS:thinking emitted
    const thinking = port.postMessage.mock.calls.find(
      (c) => c[0].type === "STATUS" && c[0].status === "thinking",
    );
    expect(thinking).toBeUndefined();
  });

  it("SEND_MESSAGE triggers agent loop", async () => {
    providers.callLLM.mockResolvedValueOnce({
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
    });
    globalThis.browser.storage.local.get.mockResolvedValue({ maxTurns: 10 });
    const port = makePortWithName();
    getConnectListener()(port);
    const handler = port.onMessage.addListener.mock.calls[0][0];
    await handler({ type: "SEND_MESSAGE", text: "go" });
    await new Promise((r) => setTimeout(r, 5));
    expect(providers.callLLM).toHaveBeenCalled();
  });

  it("CHAT_ONLY triggers runChatOnly", async () => {
    providers.callLLM.mockResolvedValueOnce({
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
    });
    globalThis.browser.storage.local.get.mockResolvedValue({});
    const port = makePortWithName();
    getConnectListener()(port);
    const handler = port.onMessage.addListener.mock.calls[0][0];
    await handler({ type: "CHAT_ONLY", text: "?" });
    await new Promise((r) => setTimeout(r, 5));
    expect(providers.callLLM).toHaveBeenCalled();
  });
});

describe("context menu", () => {
  it("opens sidebar and stores selection on bridge-explain click", async () => {
    const listenerCalls = globalThis.browser.contextMenus.onClicked.addListener.mock.calls;
    const handler = listenerCalls[listenerCalls.length - 1][0];
    await handler({ menuItemId: "bridge-explain", selectionText: "hello" });
    expect(globalThis.browser.sidebarAction.open).toHaveBeenCalled();
    expect(globalThis.browser.storage.session.set).toHaveBeenCalledWith({
      pendingSelection: "hello",
    });
  });

  it("ignores other menu ids", async () => {
    const listenerCalls = globalThis.browser.contextMenus.onClicked.addListener.mock.calls;
    const handler = listenerCalls[listenerCalls.length - 1][0];
    const before = globalThis.browser.sidebarAction.open.mock.calls.length;
    await handler({ menuItemId: "other" });
    expect(globalThis.browser.sidebarAction.open.mock.calls.length).toBe(before);
  });
});
