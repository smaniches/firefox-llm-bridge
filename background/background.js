/**
 * FIREFOX LLM BRIDGE - Background Service Worker
 * Santiago Maniches | TOPOLOGICA LLC
 *
 * Orchestrates: Sidebar <-> Content Script <-> LLM Provider
 * Provider-agnostic: routes through background/providers/ for all LLM calls.
 */

import { callLLM, buildToolResultMessage, getActiveProviderInfo } from "./providers/index.js";
import {
  loadPolicy,
  isNavigationAllowed,
  shouldPreview,
  scanPageContent,
  frameUntrustedText,
  URL_BEARING_TOOLS,
} from "./lib/policy.js";
import { computeCost, formatCost } from "./lib/pricing.js";

const PERSIST_KEY = "conversationState";

/**
 * Default ceiling on the in-memory conversation history. Older messages are
 * dropped from the front when this is exceeded; the trim only fires between
 * LLM calls, never mid-stream. Configurable via `maxHistory` in storage.
 */
const DEFAULT_MAX_HISTORY = 50;

const state = {
  conversationHistory: [],
  currentTabId: null,
  isAgentRunning: false,
  abortController: null,
  maxTurns: 25,
  maxHistory: DEFAULT_MAX_HISTORY,
  turnCount: 0,
  /** @type {import("./lib/policy.js").SafetyPolicy | null} */
  policy: null,
  /** Pending tool preview resolvers, keyed by tool_use id. */
  pendingPreviews: new Map(),
  /** Cumulative token + cost totals for this session, per model. */
  cost: {
    sessionUsd: 0,
    promptTokens: 0,
    completionTokens: 0,
  },
  /** Image attached to the next assistant turn (from screenshot_for_vision). */
  pendingVisionImage: null,
};

const BROWSER_TOOLS = [
  {
    name: "read_page",
    description:
      "Read the current page's semantic structure. Returns an accessibility-tree representation of all interactive elements with roles, labels, bounding boxes, and stable identifiers.",
    input_schema: {
      type: "object",
      properties: {
        include_text: { type: "boolean", description: "Include full text content. Default false." },
      },
      required: [],
    },
  },
  {
    name: "click_element",
    description: "Click on an element by CSS selector or element index from read_page.",
    input_schema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector or #id." },
        element_index: { type: "integer", description: "Index from read_page." },
      },
      required: [],
    },
  },
  {
    name: "type_text",
    description: "Type text into an input field.",
    input_schema: {
      type: "object",
      properties: {
        selector: { type: "string" },
        element_index: { type: "integer" },
        text: { type: "string", description: "Text to type." },
        clear_first: { type: "boolean", description: "Clear first. Default true." },
        press_enter: { type: "boolean", description: "Press Enter after. Default false." },
      },
      required: ["text"],
    },
  },
  {
    name: "navigate",
    description: "Navigate the current tab to a URL.",
    input_schema: {
      type: "object",
      properties: { url: { type: "string", description: "URL to navigate to." } },
      required: ["url"],
    },
  },
  {
    name: "scroll_page",
    description: "Scroll the page.",
    input_schema: {
      type: "object",
      properties: {
        direction: { type: "string", enum: ["up", "down", "top", "bottom"] },
        amount: { type: "integer", description: "Pixels. Default 600." },
      },
      required: ["direction"],
    },
  },
  {
    name: "extract_text",
    description: "Extract visible text from the page or a specific element.",
    input_schema: {
      type: "object",
      properties: { selector: { type: "string", description: "Optional CSS selector." } },
      required: [],
    },
  },
  {
    name: "screenshot",
    description: "Capture a screenshot of the visible tab.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "wait",
    description: "Wait before the next action.",
    input_schema: {
      type: "object",
      properties: { milliseconds: { type: "integer", description: "Default 1000." } },
      required: [],
    },
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
    name: "hover_element",
    description:
      "Hover the mouse over an element. Useful for revealing menus, tooltips, or hover-only buttons.",
    input_schema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector or #id." },
        element_index: { type: "integer", description: "Index from read_page." },
        duration_ms: {
          type: "integer",
          description: "Milliseconds to dwell before continuing. Default 0. Max 5000.",
        },
      },
      required: [],
    },
  },
  {
    name: "press_key",
    description:
      "Dispatch a keyboard key press. Use named keys (Enter, Escape, Tab, ArrowDown, ...) or single characters. Optional modifiers (ctrl, alt, shift, meta).",
    input_schema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Named key or single character." },
        selector: {
          type: "string",
          description: "Optional target selector. Defaults to the focused element.",
        },
        element_index: { type: "integer", description: "Optional index from read_page." },
        modifiers: {
          type: "object",
          description: "Optional. { ctrl, alt, shift, meta } booleans.",
          properties: {
            ctrl: { type: "boolean" },
            alt: { type: "boolean" },
            shift: { type: "boolean" },
            meta: { type: "boolean" },
          },
        },
      },
      required: ["key"],
    },
  },
  {
    name: "drag_drop",
    description: "Drag one element and drop it on another.",
    input_schema: {
      type: "object",
      properties: {
        from_selector: { type: "string" },
        from_index: { type: "integer" },
        to_selector: { type: "string" },
        to_index: { type: "integer" },
      },
      required: [],
    },
  },
  {
    name: "upload_file",
    description:
      "Upload a file into an <input type=file>. The file is provided as base64 by the user; do not invent contents.",
    input_schema: {
      type: "object",
      properties: {
        selector: { type: "string" },
        element_index: { type: "integer" },
        file_name: { type: "string" },
        mime_type: { type: "string" },
        base64_data: { type: "string", description: "Base64-encoded file bytes." },
      },
      required: ["file_name", "base64_data"],
    },
  },
  {
    name: "list_tabs",
    description: "List all open tabs in the current window with their URL and title.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "switch_tab",
    description: "Activate a tab by its id (from list_tabs). The agent will then operate on it.",
    input_schema: {
      type: "object",
      properties: { tab_id: { type: "integer", description: "Tab id from list_tabs." } },
      required: ["tab_id"],
    },
  },
  {
    name: "screenshot_for_vision",
    description:
      "Capture a screenshot and attach it as an image to the next model turn. Use when the accessibility tree is ambiguous (canvas, complex SVG, visual layout).",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "download_file",
    description:
      "Initiate a browser download from a URL. Symmetric counterpart to upload_file. The user sees the standard Firefox download prompt.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL of the resource to download." },
        filename: { type: "string", description: "Optional suggested filename." },
      },
      required: ["url"],
    },
  },
  {
    name: "task_complete",
    description: "Signal the task is complete.",
    input_schema: {
      type: "object",
      properties: { summary: { type: "string", description: "Summary of what was accomplished." } },
      required: ["summary"],
    },
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
        return await browser.tabs.sendMessage(tabId, {
          type: "SENSOR_READ",
          includeText: toolInput.include_text || false,
        });
      case "click_element": {
        const r = await browser.tabs.sendMessage(tabId, {
          type: "ACTION_CLICK",
          selector: toolInput.selector || null,
          elementIndex: toolInput.element_index ?? null,
        });
        await sleep(300);
        return r;
      }
      case "type_text": {
        const r = await browser.tabs.sendMessage(tabId, {
          type: "ACTION_TYPE",
          selector: toolInput.selector || null,
          elementIndex: toolInput.element_index ?? null,
          text: toolInput.text,
          clearFirst: toolInput.clear_first !== false,
          pressEnter: toolInput.press_enter || false,
        });
        await sleep(200);
        return r;
      }
      case "navigate":
        await browser.tabs.update(tabId, { url: toolInput.url });
        await new Promise((resolve) => {
          const fn = (d) => {
            if (d.tabId === tabId && d.frameId === 0) {
              browser.webNavigation.onCompleted.removeListener(fn);
              resolve();
            }
          };
          browser.webNavigation.onCompleted.addListener(fn);
          setTimeout(() => {
            browser.webNavigation.onCompleted.removeListener(fn);
            resolve();
          }, 15000);
        });
        await sleep(500);
        return { success: true, url: toolInput.url };
      case "scroll_page": {
        const r = await browser.tabs.sendMessage(tabId, {
          type: "ACTION_SCROLL",
          direction: toolInput.direction,
          amount: toolInput.amount || 600,
        });
        await sleep(300);
        return r;
      }
      case "extract_text":
        return await browser.tabs.sendMessage(tabId, {
          type: "SENSOR_EXTRACT_TEXT",
          selector: toolInput.selector || null,
        });
      case "screenshot":
        return {
          image: await browser.tabs.captureVisibleTab(null, { format: "png", quality: 85 }),
        };
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
      case "hover_element": {
        const r = await browser.tabs.sendMessage(tabId, {
          type: "ACTION_HOVER",
          selector: toolInput.selector || null,
          elementIndex: toolInput.element_index ?? null,
          durationMs: toolInput.duration_ms || 0,
        });
        await sleep(150);
        return r;
      }
      case "press_key": {
        const r = await browser.tabs.sendMessage(tabId, {
          type: "ACTION_PRESS_KEY",
          selector: toolInput.selector || null,
          elementIndex: toolInput.element_index ?? null,
          key: toolInput.key,
          modifiers: toolInput.modifiers || {},
        });
        await sleep(150);
        return r;
      }
      case "drag_drop": {
        const r = await browser.tabs.sendMessage(tabId, {
          type: "ACTION_DRAG_DROP",
          fromSelector: toolInput.from_selector || null,
          fromIndex: toolInput.from_index ?? null,
          toSelector: toolInput.to_selector || null,
          toIndex: toolInput.to_index ?? null,
        });
        await sleep(300);
        return r;
      }
      case "upload_file": {
        const r = await browser.tabs.sendMessage(tabId, {
          type: "ACTION_FILE_UPLOAD",
          selector: toolInput.selector || null,
          elementIndex: toolInput.element_index ?? null,
          fileName: toolInput.file_name,
          mimeType: toolInput.mime_type || "application/octet-stream",
          base64Data: toolInput.base64_data,
        });
        await sleep(150);
        return r;
      }
      case "list_tabs": {
        const tabs = await browser.tabs.query({ currentWindow: true });
        return {
          tabs: tabs.map((t) => ({
            id: t.id,
            url: t.url,
            title: t.title,
            active: !!t.active,
          })),
        };
      }
      case "switch_tab": {
        const id = toolInput.tab_id;
        await browser.tabs.update(id, { active: true });
        state.currentTabId = id;
        await sleep(200);
        return { success: true, tab_id: id };
      }
      case "screenshot_for_vision":
        return {
          image: await browser.tabs.captureVisibleTab(null, { format: "png", quality: 85 }),
          forVision: true,
        };
      case "download_file": {
        const id = await browser.downloads.download({
          url: toolInput.url,
          ...(toolInput.filename ? { filename: toolInput.filename } : {}),
        });
        return { success: true, download_id: id, url: toolInput.url };
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Send the sidebar a preview prompt for a single tool call and return a
 * promise that resolves to true (approved) or false (cancelled). The sidebar
 * replies with `PREVIEW_RESPONSE` which is handled in the port message
 * dispatcher below.
 */
function previewToolCall(port, toolUseId, name, input) {
  return new Promise((resolve) => {
    state.pendingPreviews.set(toolUseId, resolve);
    send(port, { type: "TOOL_PREVIEW", id: toolUseId, tool: name, input });
  });
}

/**
 * Persist the current conversation history and cost totals to
 * `browser.storage.local` so the session survives a service-worker restart
 * or a browser reload. Best-effort: storage failures are swallowed because
 * persistence is a convenience, not a correctness invariant.
 */
async function persistSession() {
  try {
    await browser.storage.local.set({
      [PERSIST_KEY]: {
        // Vision base64 payloads (1–5 MB each) and tool_result blobs would
        // quickly exhaust the 10 MB local-storage quota. Strip them before
        // persisting — restored sessions show the text trail, not the
        // image/tool-result internals.
        conversationHistory: persistableHistory(state.conversationHistory),
        cost: state.cost,
        turnCount: state.turnCount,
      },
    });
  } catch {
    /* storage unavailable */
  }
}

/**
 * Project conversationHistory to a slim, storage-safe form: text-only.
 * Drops content arrays containing tool_result, tool_use, or image blocks
 * — they're either internal scaffolding or megabyte-scale payloads. What
 * survives is the user-facing text trail, identical to what the sidebar
 * shows when it replays a restored session.
 *
 * @param {Array<{ role: string, content: any }>} history
 * @returns {Array<{ role: string, content: string }>}
 */
function persistableHistory(history) {
  /** @type {Array<{ role: string, content: string }>} */
  const out = [];
  for (const msg of history) {
    if (msg.role === "user") {
      if (typeof msg.content === "string" && msg.content.length > 0) {
        out.push({ role: "user", content: msg.content });
      } else if (Array.isArray(msg.content)) {
        // Mixed user content blocks (e.g. text + image, or text + tool_result)
        // can still carry user-visible text. Keep the text, drop the rest.
        const text = msg.content
          .filter((b) => b && b.type === "text" && typeof b.text === "string")
          .map((b) => b.text)
          .join("");
        if (text.length > 0) out.push({ role: "user", content: text });
      }
    } else if (msg.role === "assistant") {
      if (typeof msg.content === "string" && msg.content.length > 0) {
        out.push({ role: "assistant", content: msg.content });
      } else if (Array.isArray(msg.content)) {
        const text = msg.content
          .filter((b) => b && b.type === "text" && typeof b.text === "string")
          .map((b) => b.text)
          .join("");
        if (text.length > 0) out.push({ role: "assistant", content: text });
      }
    }
  }
  return out;
}

/**
 * Restore a previously persisted session into `state`. Called once at module
 * load; missing or malformed data resets to a clean slate.
 */
async function restoreSession() {
  try {
    const stored = await browser.storage.local.get([PERSIST_KEY]);
    const s = stored[PERSIST_KEY];
    if (s && Array.isArray(s.conversationHistory)) {
      state.conversationHistory = s.conversationHistory;
      state.turnCount = typeof s.turnCount === "number" ? s.turnCount : 0;
      if (s.cost && typeof s.cost === "object") {
        state.cost = {
          sessionUsd: Number(s.cost.sessionUsd) || 0,
          promptTokens: Number(s.cost.promptTokens) || 0,
          completionTokens: Number(s.cost.completionTokens) || 0,
        };
      }
    }
  } catch {
    /* storage unavailable */
  }
}

/**
 * Update session cost totals after a callLLM response.
 *
 * @param {string} model
 * @param {{ promptTokens: number, completionTokens: number } | undefined} usage
 */
function recordUsage(model, usage) {
  if (!usage) return;
  state.cost.promptTokens += usage.promptTokens || 0;
  state.cost.completionTokens += usage.completionTokens || 0;
  state.cost.sessionUsd += computeCost(model, usage);
}

/**
 * After tool results land in conversation history, push a follow-up user
 * message carrying the screenshot as an `image` content block. Each provider's
 * formatMessages translates this to its native vision format. Non-vision
 * models receive a text label instead.
 */
function pushPendingVisionImage(history) {
  if (!state.pendingVisionImage) return;
  const dataUrl = state.pendingVisionImage;
  state.pendingVisionImage = null;
  history.push({
    role: "user",
    content: [
      { type: "image", dataUrl },
      { type: "text", text: "(Screenshot captured by screenshot_for_vision is above.)" },
    ],
  });
}

// ============================================================
// AGENT LOOP
// ============================================================

async function runAgentLoop(userMessage, port) {
  state.isAgentRunning = true;
  state.turnCount = 0;
  state.abortController = new AbortController();
  state.policy = await loadPolicy();
  state.pendingPreviews.clear();
  state.pendingVisionImage = null;

  const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (activeTab) state.currentTabId = activeTab.id;

  state.conversationHistory.push({ role: "user", content: userMessage });

  const info = await getActiveProviderInfo();
  send(port, {
    type: "STATUS",
    status: "thinking",
    message: info ? `${info.modelName}...` : "Processing...",
  });

  try {
    let loop = true;
    while (loop && state.turnCount < state.maxTurns) {
      if (state.abortController.signal.aborted) {
        send(port, { type: "AGENT_STOPPED", message: "Stopped." });
        break;
      }

      // Begin a streamed assistant turn. The sidebar opens an in-flight
      // message on STREAM_START and appends each STREAM_DELTA. STREAM_END
      // MUST fire whether or not the LLM call succeeds — otherwise the
      // sidebar's streaming state is left dangling and every subsequent
      // ASSISTANT_TEXT is suppressed by the dedup logic.
      const streamId = `t${state.turnCount}-${Date.now()}`;
      send(port, { type: "STREAM_START", id: streamId });
      const onTextChunk = (text) => {
        send(port, { type: "STREAM_DELTA", id: streamId, text });
      };

      let response;
      try {
        response = await callLLM(
          SYSTEM_PROMPT,
          state.conversationHistory,
          BROWSER_TOOLS,
          state.abortController.signal,
          onTextChunk,
        );
      } finally {
        // Emit STREAM_END before propagating any error from callLLM so the
        // sidebar can release its streaming state.
        send(port, {
          type: "STREAM_END",
          id: streamId,
          cost: formatCost(state.cost.sessionUsd),
          tokens: {
            prompt: state.cost.promptTokens,
            completion: state.cost.completionTokens,
          },
        });
      }
      state.conversationHistory.push({ role: "assistant", content: response.content });
      if (info?.model) recordUsage(info.model, response.usage);

      for (const b of response.content) {
        if (b.type === "text" && b.text) send(port, { type: "ASSISTANT_TEXT", text: b.text });
      }

      if (response.stop_reason !== "tool_use") {
        loop = false;
        break;
      }

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

        // Policy: domain allow/blocklist for any tool that takes a URL.
        // Currently `navigate` and `download_file`; URL_BEARING_TOOLS is the
        // single source of truth so adding a tool only touches policy.js.
        if (URL_BEARING_TOOLS.has(b.name) && state.policy) {
          const verdict = isNavigationAllowed(b.input?.url || "", state.policy);
          if (!verdict.allowed) {
            const denied = {
              error: `Tool ${b.name} denied: ${verdict.reason}`,
              url: b.input?.url,
            };
            results.push({
              tool_use_id: b.id,
              toolName: b.name,
              content: JSON.stringify(denied),
            });
            send(port, {
              type: "TOOL_RESULT",
              tool: b.name,
              success: false,
              turn: state.turnCount,
            });
            continue;
          }
        }

        // Policy: preview gate — surface destructive actions for user OK.
        if (state.policy && shouldPreview(b.name, state.policy)) {
          const ok = await previewToolCall(port, b.id, b.name, b.input);
          if (!ok) {
            const denied = { error: "Tool call cancelled by user.", tool: b.name };
            results.push({
              tool_use_id: b.id,
              toolName: b.name,
              content: JSON.stringify(denied),
            });
            send(port, {
              type: "TOOL_RESULT",
              tool: b.name,
              success: false,
              turn: state.turnCount,
            });
            continue;
          }
        }

        const result = await executeTool(b.name, b.input);
        if ((b.name === "screenshot" || b.name === "screenshot_for_vision") && result.image) {
          send(port, { type: "SCREENSHOT", image: result.image });
        }

        let content = JSON.stringify(result);
        if (content.length > 50000) content = content.substring(0, 50000) + "...[truncated]";
        if (b.name === "screenshot" && result.image) {
          content = "Screenshot captured and displayed to user.";
        }
        if (b.name === "screenshot_for_vision" && result.image) {
          // Strip the base64 from the textual tool_result; the next assistant
          // turn receives the image as a real content block via attachImage().
          content = "Screenshot attached to next turn as a vision input.";
          state.pendingVisionImage = result.image;
        }

        results.push({ tool_use_id: b.id, toolName: b.name, content });
        send(port, {
          type: "TOOL_RESULT",
          tool: b.name,
          success: !result.error,
          turn: state.turnCount,
        });
      }

      if (results.length > 0) {
        state.conversationHistory.push(await buildToolResultMessage(results));
        pushPendingVisionImage(state.conversationHistory);
      }
      // Trim only between turns. The current turn's messages are safe.
      trimHistory();
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
    await persistSession();
    send(port, {
      type: "STATUS",
      status: "idle",
      cost: formatCost(state.cost.sessionUsd),
    });
  }
}

// ============================================================
// CHAT-ONLY MODE
// ============================================================

async function runChatOnly(userMessage, port) {
  state.isAgentRunning = true;
  state.abortController = new AbortController();
  state.policy = await loadPolicy();

  let pageContext = "";
  let injectionMatches = [];
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      state.currentTabId = tab.id;
      const t = await browser.tabs.sendMessage(tab.id, { type: "SENSOR_EXTRACT_TEXT" });
      if (t?.text) pageContext = t.text.substring(0, 8000);
    }
  } catch {
    /* no content script */
  }

  if (pageContext && state.policy.warnOnInjectionPatterns) {
    injectionMatches = scanPageContent(pageContext);
    if (injectionMatches.length > 0) {
      send(port, {
        type: "POLICY_WARNING",
        patterns: injectionMatches,
        message: `Page content matched ${injectionMatches.length} heuristic injection pattern(s).`,
      });
    }
  }

  const framed = pageContext ? frameUntrustedText(pageContext, injectionMatches) : "";
  const msg = framed ? `${framed}\n\n[USER QUESTION]\n${userMessage}` : userMessage;
  state.conversationHistory.push({ role: "user", content: msg });

  const info = await getActiveProviderInfo();
  send(port, {
    type: "STATUS",
    status: "thinking",
    message: info ? `${info.modelName}...` : "Thinking...",
  });

  // Chat mode now streams, persists, and accrues cost the same way the agent
  // loop does. The previous implementation was a silent regression: long
  // answers blocked with no feedback, conversations vanished on restart,
  // and BYOK costs were invisible.
  const streamId = `chat-${Date.now()}`;
  send(port, { type: "STREAM_START", id: streamId });
  const onTextChunk = (text) => send(port, { type: "STREAM_DELTA", id: streamId, text });

  try {
    let r;
    try {
      r = await callLLM(
        "You are Firefox LLM Bridge. Answer questions about the page or have a general conversation. Be concise.",
        state.conversationHistory,
        [],
        state.abortController.signal,
        onTextChunk,
      );
    } finally {
      send(port, {
        type: "STREAM_END",
        id: streamId,
        cost: formatCost(state.cost.sessionUsd),
        tokens: {
          prompt: state.cost.promptTokens,
          completion: state.cost.completionTokens,
        },
      });
    }
    const text = r.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    state.conversationHistory.push({ role: "assistant", content: text });
    if (info?.model) recordUsage(info.model, r.usage);
    trimHistory();
    send(port, { type: "ASSISTANT_TEXT", text });
  } catch (err) {
    if (err.name !== "AbortError") send(port, { type: "ERROR", message: err.message });
  } finally {
    state.isAgentRunning = false;
    state.abortController = null;
    await persistSession();
    send(port, {
      type: "STATUS",
      status: "idle",
      cost: formatCost(state.cost.sessionUsd),
    });
  }
}

// ============================================================
// SIDEBAR PORT
// ============================================================

function send(port, msg) {
  try {
    port.postMessage(msg);
  } catch {
    /* closed */
  }
}

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
        if (state.isAgentRunning) {
          send(port, { type: "ERROR", message: "Agent running. Stop first." });
          return;
        }
        await loadSettings();
        runAgentLoop(msg.text, port);
        break;
      case "STOP_AGENT":
        if (state.abortController) state.abortController.abort();
        break;
      case "CLEAR_HISTORY":
        state.conversationHistory = [];
        state.turnCount = 0;
        state.cost = { sessionUsd: 0, promptTokens: 0, completionTokens: 0 };
        try {
          await browser.storage.local.remove(PERSIST_KEY);
        } catch {
          /* storage unavailable */
        }
        send(port, { type: "HISTORY_CLEARED" });
        break;
      case "GET_STATUS": {
        const info = await getActiveProviderInfo();
        send(port, {
          type: "STATUS",
          status: state.isAgentRunning ? "running" : "idle",
          hasProvider: !!info,
          providerName: info?.name || null,
          modelName: info?.modelName || null,
          providerId: info?.id || null,
          cost: formatCost(state.cost.sessionUsd),
        });
        // If there's a restored conversation, hand the renderable view to the
        // sidebar so it can repopulate the message list. Without this,
        // persistence felt half-broken — the background remembered the
        // session, but the user couldn't see it.
        const renderable = sidebarHistoryView(state.conversationHistory);
        if (renderable.length > 0) {
          send(port, { type: "HISTORY_RESTORE", messages: renderable });
        }
        break;
      }
      case "CHAT_ONLY":
        if (state.isAgentRunning) return;
        await loadSettings();
        runChatOnly(msg.text, port);
        break;
      case "PREVIEW_RESPONSE": {
        const resolver = state.pendingPreviews.get(msg.id);
        if (resolver) {
          state.pendingPreviews.delete(msg.id);
          resolver(msg.approved === true);
        }
        break;
      }
    }
  });
});

async function loadSettings() {
  const s = await browser.storage.local.get(["maxTurns", "maxHistory"]);
  state.maxTurns = s.maxTurns || 25;
  state.maxHistory = s.maxHistory || DEFAULT_MAX_HISTORY;
}

/**
 * Strip the chat-mode untrusted-content framing from a user prompt so the
 * sidebar shows the original user question. Chat mode wraps page content
 * with `[BEGIN UNTRUSTED PAGE CONTENT … END]` and a `[USER QUESTION]`
 * trailer; restored sessions should display only the question.
 *
 * @param {string} content
 * @returns {string}
 */
function unframeUserContent(content) {
  if (typeof content !== "string") return "";
  const m = /\n\n\[USER QUESTION\]\n([\s\S]*)$/.exec(content);
  return m ? m[1] : content;
}

/**
 * Produce a compact, render-safe view of `conversationHistory` for the
 * sidebar to display when the user reopens the panel. Filters out internal
 * messages (tool_result blocks, vision image payloads, assistant turns
 * that were purely tool calls) and unwraps chat-mode framing.
 *
 * @param {Array<{ role: string, content: any }>} history
 * @returns {Array<{ role: "user" | "assistant", text: string }>}
 */
function sidebarHistoryView(history) {
  const out = [];
  for (const msg of history) {
    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        out.push({ role: "user", text: unframeUserContent(msg.content) });
      }
      // Arrays (tool_result + image) are internal — skip.
    } else if (msg.role === "assistant") {
      if (typeof msg.content === "string" && msg.content.length > 0) {
        out.push({ role: "assistant", text: msg.content });
      } else if (Array.isArray(msg.content)) {
        const text = msg.content
          .filter((b) => b.type === "text" && typeof b.text === "string")
          .map((b) => b.text)
          .join("");
        if (text.length > 0) out.push({ role: "assistant", text });
      }
    }
  }
  return out;
}

/**
 * Trim `state.conversationHistory` to at most `state.maxHistory` entries.
 * Always preserves whole user→assistant pairs by dropping from the front in
 * pairs of two. Called between LLM calls so it never deletes a message that
 * is still being streamed.
 */
function trimHistory() {
  const max = state.maxHistory;
  while (state.conversationHistory.length > max) {
    state.conversationHistory.splice(0, 2);
  }
}
loadSettings();
restoreSession();
browser.storage.onChanged.addListener(() => loadSettings());

// `contextMenus.create` throws if the id already exists. That happens when
// the background module is re-evaluated (service-worker restart, dev reload).
// Wrap in try/catch and check runtime.lastError to swallow the duplicate-id
// case silently.
try {
  browser.contextMenus.create(
    {
      id: "bridge-explain",
      title: "Ask LLM Bridge about selection",
      contexts: ["selection"],
    },
    () => {
      // Touch lastError so the runtime doesn't log it.
      void browser.runtime.lastError;
    },
  );
} catch {
  /* duplicate id — already registered, ignore */
}
browser.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId === "bridge-explain") {
    await browser.sidebarAction.open();
    await browser.storage.session.set({ pendingSelection: info.selectionText });
  }
});

console.info("[Firefox LLM Bridge] Initialized.");

// Exports for unit testing. The module-level side effects above (onConnect,
// contextMenus.create, storage.onChanged.addListener) run on import even in
// test environments — they register against the mocked `browser` global.
export {
  state,
  BROWSER_TOOLS,
  SYSTEM_PROMPT,
  PERSIST_KEY,
  DEFAULT_MAX_HISTORY,
  executeTool,
  sleep,
  runAgentLoop,
  runChatOnly,
  send,
  loadSettings,
  persistSession,
  persistableHistory,
  restoreSession,
  recordUsage,
  trimHistory,
  sidebarHistoryView,
  unframeUserContent,
};
