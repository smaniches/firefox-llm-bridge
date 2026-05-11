/**
 * FIREFOX LLM BRIDGE - Background Service Worker
 * Santiago Maniches | TOPOLOGICA LLC
 *
 * Orchestrates: Sidebar <-> Content Script <-> LLM Provider
 * Provider-agnostic: routes through background/providers/ for all LLM calls.
 */

import { callLLM, buildToolResultMessage, getActiveProviderInfo } from "./providers/index.js";

const state = {
  conversationHistory: [],
  currentTabId: null,
  isAgentRunning: false,
  abortController: null,
  maxTurns: 25,
  turnCount: 0,
};

const BROWSER_TOOLS = [
  {
    name: "read_page",
    description: "Read the current page's semantic structure. Returns an accessibility-tree representation of all interactive elements with roles, labels, bounding boxes, and stable identifiers.",
    input_schema: { type: "object", properties: { include_text: { type: "boolean", description: "Include full text content. Default false." } }, required: [] },
  },
  {
    name: "click_element",
    description: "Click on an element by CSS selector or element index from read_page.",
    input_schema: { type: "object", properties: { selector: { type: "string", description: "CSS selector or #id." }, element_index: { type: "integer", description: "Index from read_page." } }, required: [] },
  },
  {
    name: "type_text",
    description: "Type text into an input field.",
    input_schema: { type: "object", properties: { selector: { type: "string" }, element_index: { type: "integer" }, text: { type: "string", description: "Text to type." }, clear_first: { type: "boolean", description: "Clear first. Default true." }, press_enter: { type: "boolean", description: "Press Enter after. Default false." } }, required: ["text"] },
  },
  {
    name: "navigate",
    description: "Navigate the current tab to a URL.",
    input_schema: { type: "object", properties: { url: { type: "string", description: "URL to navigate to." } }, required: ["url"] },
  },
  {
    name: "scroll_page",
    description: "Scroll the page.",
    input_schema: { type: "object", properties: { direction: { type: "string", enum: ["up", "down", "top", "bottom"] }, amount: { type: "integer", description: "Pixels. Default 600." } }, required: ["direction"] },
  },
  {
    name: "extract_text",
    description: "Extract visible text from the page or a specific element.",
    input_schema: { type: "object", properties: { selector: { type: "string", description: "Optional CSS selector." } }, required: [] },
  },
  {
    name: "screenshot",
    description: "Capture a screenshot of the visible tab.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "wait",
    description: "Wait before the next action.",
    input_schema: { type: "object", properties: { milliseconds: { type: "integer", description: "Default 1000." } }, required: [] },
  },
  {
    name: "go_back",
    description: "Navigate back in history.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_tab_info",
    description: "Get current tab URL and title.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "task_complete",
    description: "Signal the task is complete.",
    input_schema: { type: "object", properties: { summary: { type: "string", description: "Summary of what was accomplished." } }, required: ["summary"] },
  },
];

const SYSTEM_PROMPT = `You are Firefox LLM Bridge, an AI assistant operating inside Mozilla Firefox. You can see and interact with web pages on behalf of the user.

WORKFLOW:
1. Use read_page to understand the current page before acting.
2. Execute actions one at a time, checking results after each.
3. If something fails, read_page again to re-assess.
4. When done, use task_complete with a summary.

RULES:
- Always read_page before acting on a new page or after navigation.
- Prefer element IDs, then specific CSS selectors.
- Never perform financial transactions or enter passwords without explicit user confirmation.
- If you encounter a CAPTCHA, stop and ask the user.
- Be concise.`;

// ============================================================
// TOOL EXECUTION
// ============================================================

async function executeTool(toolName, toolInput) {
  const tabId = state.currentTabId;
  if (!tabId && toolName !== "navigate" && toolName !== "get_tab_info") {
    return { error: "No active tab." };
  }
  try {
    switch (toolName) {
      case "read_page":
        return await browser.tabs.sendMessage(tabId, { type: "SENSOR_READ", includeText: toolInput.include_text || false });
      case "click_element": {
        const r = await browser.tabs.sendMessage(tabId, { type: "ACTION_CLICK", selector: toolInput.selector || null, elementIndex: toolInput.element_index ?? null });
        await sleep(300);
        return r;
      }
      case "type_text": {
        const r = await browser.tabs.sendMessage(tabId, { type: "ACTION_TYPE", selector: toolInput.selector || null, elementIndex: toolInput.element_index ?? null, text: toolInput.text, clearFirst: toolInput.clear_first !== false, pressEnter: toolInput.press_enter || false });
        await sleep(200);
        return r;
      }
      case "navigate":
        await browser.tabs.update(tabId, { url: toolInput.url });
        await new Promise((resolve) => {
          const fn = (d) => { if (d.tabId === tabId && d.frameId === 0) { browser.webNavigation.onCompleted.removeListener(fn); resolve(); } };
          browser.webNavigation.onCompleted.addListener(fn);
          setTimeout(() => { browser.webNavigation.onCompleted.removeListener(fn); resolve(); }, 15000);
        });
        await sleep(500);
        return { success: true, url: toolInput.url };
      case "scroll_page": {
        const r = await browser.tabs.sendMessage(tabId, { type: "ACTION_SCROLL", direction: toolInput.direction, amount: toolInput.amount || 600 });
        await sleep(300);
        return r;
      }
      case "extract_text":
        return await browser.tabs.sendMessage(tabId, { type: "SENSOR_EXTRACT_TEXT", selector: toolInput.selector || null });
      case "screenshot":
        return { image: await browser.tabs.captureVisibleTab(null, { format: "png", quality: 85 }) };
      case "wait":
        await sleep(toolInput.milliseconds || 1000);
        return { success: true };
      case "go_back":
        await browser.tabs.goBack(tabId);
        await sleep(1000);
        return { success: true };
      case "get_tab_info": {
        const tab = await browser.tabs.get(tabId);
        return { url: tab.url, title: tab.title };
      }
      case "task_complete":
        return { complete: true, summary: toolInput.summary };
      default:
        return { error: `Unknown tool: ${toolName}` };
    }
  } catch (err) {
    return { error: `Tool failed: ${err.message}` };
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ============================================================
// AGENT LOOP
// ============================================================

async function runAgentLoop(userMessage, port) {
  state.isAgentRunning = true;
  state.turnCount = 0;
  state.abortController = new AbortController();

  const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (activeTab) state.currentTabId = activeTab.id;

  state.conversationHistory.push({ role: "user", content: userMessage });

  const info = await getActiveProviderInfo();
  send(port, { type: "STATUS", status: "thinking", message: info ? `${info.modelName}...` : "Processing..." });

  try {
    let loop = true;
    while (loop && state.turnCount < state.maxTurns) {
      if (state.abortController.signal.aborted) { send(port, { type: "AGENT_STOPPED", message: "Stopped." }); break; }

      const response = await callLLM(SYSTEM_PROMPT, state.conversationHistory, BROWSER_TOOLS, state.abortController.signal);
      state.conversationHistory.push({ role: "assistant", content: response.content });

      for (const b of response.content) {
        if (b.type === "text" && b.text) send(port, { type: "ASSISTANT_TEXT", text: b.text });
      }

      if (response.stop_reason !== "tool_use") { loop = false; break; }

      const results = [];
      for (const b of response.content) {
        if (b.type !== "tool_use") continue;
        state.turnCount++;
        send(port, { type: "TOOL_USE", tool: b.name, input: b.input, turn: state.turnCount });

        if (b.name === "task_complete") {
          send(port, { type: "TASK_COMPLETE", summary: b.input.summary });
          loop = false;
          results.push({ tool_use_id: b.id, toolName: b.name, content: '{"complete":true}' });
          break;
        }

        const result = await executeTool(b.name, b.input);
        if (b.name === "screenshot" && result.image) send(port, { type: "SCREENSHOT", image: result.image });

        let content = JSON.stringify(result);
        if (content.length > 50000) content = content.substring(0, 50000) + "...[truncated]";
        if (b.name === "screenshot" && result.image) content = "Screenshot captured and displayed to user.";

        results.push({ tool_use_id: b.id, toolName: b.name, content });
        send(port, { type: "TOOL_RESULT", tool: b.name, success: !result.error, turn: state.turnCount });
      }

      if (results.length > 0) {
        state.conversationHistory.push(await buildToolResultMessage(results));
      }
    }

    if (state.turnCount >= state.maxTurns) {
      send(port, { type: "ASSISTANT_TEXT", text: `Reached ${state.maxTurns} turn limit.` });
    }
  } catch (err) {
    if (err.name === "AbortError") send(port, { type: "AGENT_STOPPED", message: "Stopped." });
    else send(port, { type: "ERROR", message: err.message });
  } finally {
    state.isAgentRunning = false;
    state.abortController = null;
    send(port, { type: "STATUS", status: "idle" });
  }
}

// ============================================================
// CHAT-ONLY MODE
// ============================================================

async function runChatOnly(userMessage, port) {
  state.isAgentRunning = true;
  state.abortController = new AbortController();

  let pageContext = "";
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab) { state.currentTabId = tab.id; const t = await browser.tabs.sendMessage(tab.id, { type: "SENSOR_EXTRACT_TEXT" }); if (t?.text) pageContext = t.text.substring(0, 8000); }
  } catch (e) { /* no content script */ }

  const msg = pageContext ? `[Page content]\n${pageContext}\n\n[Question]\n${userMessage}` : userMessage;
  state.conversationHistory.push({ role: "user", content: msg });

  const info = await getActiveProviderInfo();
  send(port, { type: "STATUS", status: "thinking", message: info ? `${info.modelName}...` : "Thinking..." });

  try {
    const r = await callLLM("You are Firefox LLM Bridge. Answer questions about the page or have a general conversation. Be concise.", state.conversationHistory, [], state.abortController.signal);
    const text = r.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    state.conversationHistory.push({ role: "assistant", content: text });
    send(port, { type: "ASSISTANT_TEXT", text });
  } catch (err) {
    if (err.name !== "AbortError") send(port, { type: "ERROR", message: err.message });
  } finally {
    state.isAgentRunning = false;
    state.abortController = null;
    send(port, { type: "STATUS", status: "idle" });
  }
}

// ============================================================
// SIDEBAR PORT
// ============================================================

function send(port, msg) { try { port.postMessage(msg); } catch (e) { /* closed */ } }

browser.runtime.onConnect.addListener((port) => {
  // Reject ports that did not originate from this extension's own pages.
  // Content scripts attempting to connect carry a populated `port.sender.tab`;
  // privileged extension pages (sidebar, options) do not.
  if (port.name !== "topologica-sidebar") return;
  if (port.sender?.tab) return;
  if (port.sender?.id && port.sender.id !== browser.runtime.id) return;
  port.onMessage.addListener(async (msg) => {
    switch (msg.type) {
      case "SEND_MESSAGE":
        if (state.isAgentRunning) { send(port, { type: "ERROR", message: "Agent running. Stop first." }); return; }
        await loadSettings();
        runAgentLoop(msg.text, port);
        break;
      case "STOP_AGENT":
        if (state.abortController) state.abortController.abort();
        break;
      case "CLEAR_HISTORY":
        state.conversationHistory = [];
        state.turnCount = 0;
        send(port, { type: "HISTORY_CLEARED" });
        break;
      case "GET_STATUS": {
        const info = await getActiveProviderInfo();
        send(port, { type: "STATUS", status: state.isAgentRunning ? "running" : "idle", hasProvider: !!info, providerName: info?.name || null, modelName: info?.modelName || null, providerId: info?.id || null });
        break;
      }
      case "CHAT_ONLY":
        if (state.isAgentRunning) return;
        await loadSettings();
        runChatOnly(msg.text, port);
        break;
    }
  });
});

async function loadSettings() {
  const s = await browser.storage.local.get(["maxTurns"]);
  state.maxTurns = s.maxTurns || 25;
}
loadSettings();
browser.storage.onChanged.addListener(() => loadSettings());

browser.contextMenus.create({ id: "bridge-explain", title: "Ask LLM Bridge about selection", contexts: ["selection"] });
browser.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId === "bridge-explain") { await browser.sidebarAction.open(); await browser.storage.session.set({ pendingSelection: info.selectionText }); }
});

console.info("[Firefox LLM Bridge] Initialized.");

// Exports for unit testing. The module-level side effects above (onConnect,
// contextMenus.create, storage.onChanged.addListener) run on import even in
// test environments — they register against the mocked `browser` global.
export {
  state,
  BROWSER_TOOLS,
  SYSTEM_PROMPT,
  executeTool,
  sleep,
  runAgentLoop,
  runChatOnly,
  send,
  loadSettings,
};
