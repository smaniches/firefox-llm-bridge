/**
 * FIREFOX LLM BRIDGE - Sidebar UI Controller
 *
 * Module-scoped (loaded as `<script type="module">`). Renders messages,
 * manages the chat/agent mode toggle, shows the active provider, and runs
 * the onboarding "configure a provider" panel.
 *
 * The pure rendering helpers (renderMd, escapeHtml, summarize, TOOL_ICONS)
 * live in ./utils.js so they can be unit-tested in isolation.
 */

import { TOOL_ICONS, renderMdInto, summarize } from "./utils.js";

/** @template T @param {T} x @returns {NonNullable<T>} */
const must = (x) => /** @type {NonNullable<T>} */ (x);

const messagesEl = must(document.getElementById("messages"));
const inputText = /** @type {HTMLTextAreaElement} */ (must(document.getElementById("input-text")));
const btnSend = /** @type {HTMLButtonElement} */ (must(document.getElementById("btn-send")));
const btnClear = must(document.getElementById("btn-clear"));
const btnSettings = must(document.getElementById("btn-settings"));
const btnStop = must(document.getElementById("btn-stop"));
const stopBar = must(document.getElementById("stop-bar"));
const statusBar = must(document.getElementById("status-bar"));
const statusText = must(document.getElementById("status-text"));
const turnCounter = must(document.getElementById("turn-counter"));
const providerLabel = must(document.getElementById("provider-label"));
const noProviderWarning = must(document.getElementById("no-provider-warning"));
const btnOpenSettings = must(document.getElementById("btn-open-settings"));
const modeChat = must(document.getElementById("mode-chat"));
const modeAgent = must(document.getElementById("mode-agent"));
const previewOverlay = must(document.getElementById("preview-overlay"));
const previewToolName = must(document.getElementById("preview-tool-name"));
const previewToolInput = must(document.getElementById("preview-tool-input"));
const btnPreviewApprove = must(document.getElementById("btn-preview-approve"));
const btnPreviewCancel = must(document.getElementById("btn-preview-cancel"));
const costCounter = must(document.getElementById("cost-counter"));

const state = {
  mode: "chat",
  port: null,
  /** Firefox window ID — resolved once at startup, sent with every message. */
  windowId: null,
  isRunning: false,
  /** @type {string | null} id of the in-flight TOOL_PREVIEW awaiting a response */
  pendingPreviewId: null,
  /** @type {{ id: string, el: HTMLElement, text: string, rafHandle: number } | null} */
  streaming: null,
  /**
   * Text rendered by the most recently finalized stream. The trailing
   * ASSISTANT_TEXT after a successful stream is a duplicate (background
   * emits it as the canonical end-of-turn marker). When it matches the
   * just-streamed text, suppress it. Consumed by the first matching
   * ASSISTANT_TEXT and cleared.
   * @type {string | null}
   */
  lastStreamedText: null,
};

const RECONNECT_DELAY_MS = 500;

function connectPort() {
  state.port = browser.runtime.connect({ name: "topologica-sidebar" });
  state.port.onMessage.addListener(handleMsg);
  state.port.onDisconnect.addListener(() => {
    // The background side may have torn down (service-worker restart). Any
    // in-flight streaming state belongs to the dead port — clear it so the
    // reconnect doesn't try to keep painting deltas into a stale bubble.
    if (state.streaming) {
      if (state.streaming.rafHandle) cancelAnimationFrame(state.streaming.rafHandle);
      if (state.streaming.text.length === 0) {
        // No text rendered yet — drop the empty placeholder bubble so the
        // user isn't left looking at a blank assistant message that will
        // never be filled. Mirrors finalizeStreamingMessage().
        state.streaming.el.remove();
      } else {
        // Synchronously render any deltas that arrived after the last rAF.
        renderMdInto(state.streaming.el, state.streaming.text);
        state.streaming.el.classList.remove("streaming");
      }
      state.streaming = null;
    }
    state.pendingPreviewId = null;
    state.lastStreamedText = null;
    setTimeout(connectPort, RECONNECT_DELAY_MS);
  });
  state.port.postMessage({ type: "GET_STATUS" });
}

function handleMsg(msg) {
  switch (msg.type) {
    case "STATUS":
      updateStatus(msg.status, msg.message);
      if (msg.hasProvider === false) {
        noProviderWarning.classList.remove("hidden");
        providerLabel.textContent = "Not configured";
      } else {
        noProviderWarning.classList.add("hidden");
        if (msg.modelName) providerLabel.textContent = msg.modelName;
        else if (msg.providerName) providerLabel.textContent = msg.providerName;
      }
      updateCostCounter(msg.cost);
      break;
    case "STREAM_START":
      beginStreamingMessage(msg.id);
      break;
    case "STREAM_DELTA":
      appendStreamingDelta(msg.id, msg.text);
      break;
    case "STREAM_END":
      finalizeStreamingMessage(msg.id);
      updateCostCounter(msg.cost);
      break;
    case "ASSISTANT_TEXT":
      // Three cases to handle:
      //   1. A stream is still active (state.streaming !== null) — deltas
      //      are rendering live; skip the message.
      //   2. A stream just finalized with text matching this ASSISTANT_TEXT
      //      (state.lastStreamedText === msg.text) — this is the canonical
      //      end-of-turn duplicate; consume the flag and skip.
      //   3. Anything else (system "turn limit" message, non-streaming
      //      fallback, follow-up text after a tool turn) — render.
      if (state.streaming !== null) break;
      if (state.lastStreamedText !== null && state.lastStreamedText === msg.text) {
        state.lastStreamedText = null;
        break;
      }
      state.lastStreamedText = null;
      addMessage("assistant", msg.text);
      break;
    case "TOOL_USE":
      addToolMessage(msg.tool, msg.input, msg.turn);
      turnCounter.textContent = `Turn ${msg.turn}`;
      turnCounter.classList.remove("hidden");
      break;
    case "TOOL_RESULT":
      updateLastTool(msg.success);
      break;
    case "SCREENSHOT":
      addScreenshot(msg.image);
      break;
    case "TASK_COMPLETE":
      addSystem(`Task complete: ${msg.summary}`);
      break;
    case "AGENT_STOPPED":
      addSystem(msg.message || "Stopped.");
      break;
    case "ERROR":
      // Typed errors carry { code, retryable, providerId } — the renderer
      // uses these to colour the row, badge the code, and decide whether a
      // Retry button is offered. Untyped errors still render as plain rows.
      addError(msg.message, {
        code: msg.code,
        retryable: msg.retryable,
        providerId: msg.providerId,
      });
      if (msg.message?.includes("No LLM provider")) {
        noProviderWarning.classList.remove("hidden");
      }
      break;
    case "HISTORY_CLEARED":
      clearMessages();
      break;
    case "HISTORY_RESTORE":
      restoreHistoryMessages(msg.messages);
      break;
    case "TOOL_PREVIEW":
      showPreview(msg.id, msg.tool, msg.input);
      break;
    case "POLICY_WARNING":
      addPolicyBanner(msg.message, msg.patterns);
      break;
  }
}

/**
 * Render the TOOL_PREVIEW overlay and wait for the user to approve or cancel.
 * Stores the pending id so the click handlers know which preview to respond to.
 */
function showPreview(id, tool, input) {
  state.pendingPreviewId = id;
  previewToolName.textContent = tool;
  previewToolInput.textContent = JSON.stringify(input ?? {}, null, 2);
  previewOverlay.classList.remove("hidden");
}

/** Respond to the pending preview and hide the overlay. */
function respondToPreview(approved) {
  if (state.pendingPreviewId === null) return;
  const id = state.pendingPreviewId;
  state.pendingPreviewId = null;
  previewOverlay.classList.add("hidden");
  state.port?.postMessage({ type: "PREVIEW_RESPONSE", id, approved });
}

/**
 * Render a transient policy warning banner above the message list.
 * The banner self-removes after 12s or when the user clicks it.
 */
function addPolicyBanner(message, patterns) {
  const div = document.createElement("div");
  div.className = "policy-banner";
  const title = document.createElement("span");
  title.className = "policy-banner-title";
  title.textContent = message || "Policy warning";
  const pats = document.createElement("div");
  pats.className = "policy-banner-patterns";
  pats.textContent = Array.isArray(patterns) && patterns.length > 0 ? patterns.join(", ") : "";
  div.appendChild(title);
  div.appendChild(pats);

  // Auto-dismiss after 12 s. Clear the timer on manual click so the callback
  // does not fire against an already-detached node.
  const timeoutId = setTimeout(() => div.remove(), 12000);
  div.addEventListener("click", () => {
    clearTimeout(timeoutId);
    div.remove();
  });

  messagesEl.insertBefore(div, messagesEl.firstChild);
}

function updateStatus(status, message) {
  statusBar.className = "";
  switch (status) {
    case "idle":
      statusBar.classList.add("status-idle");
      statusText.textContent = "Ready";
      state.isRunning = false;
      stopBar.classList.add("hidden");
      inputText.disabled = false;
      turnCounter.classList.add("hidden");
      break;
    case "thinking":
      statusBar.classList.add("status-thinking");
      statusText.textContent = message || "Thinking...";
      state.isRunning = true;
      stopBar.classList.remove("hidden");
      inputText.disabled = true;
      break;
    case "running":
      statusBar.classList.add("status-running");
      statusText.textContent = message || "Executing...";
      state.isRunning = true;
      stopBar.classList.remove("hidden");
      inputText.disabled = true;
      break;
    case "error":
      statusBar.classList.add("status-error");
      statusText.textContent = message || "Error";
      state.isRunning = false;
      stopBar.classList.add("hidden");
      inputText.disabled = false;
      break;
  }
  updateSend();
}

function removeWelcome() {
  const w = messagesEl.querySelector(".welcome-msg");
  if (w) w.remove();
}

function addMessage(role, text) {
  removeWelcome();
  const div = document.createElement("div");
  div.className = `msg msg-${role}`;
  if (role === "assistant") {
    renderMdInto(div, text);
  } else {
    div.textContent = text;
  }
  messagesEl.appendChild(div);
  scrollToBottom();
}

function addToolMessage(tool, input, turn) {
  removeWelcome();
  const div = document.createElement("div");
  div.className = "msg msg-tool";
  div.dataset.turn = String(turn);

  // DOM construction (not innerHTML) so LLM-controlled `tool` and `input`
  // cannot inject markup, even though the icon/name are short strings.
  const iconSpan = document.createElement("span");
  iconSpan.textContent = TOOL_ICONS[tool] || "⚙";
  const nameSpan = document.createElement("span");
  nameSpan.textContent = tool;
  const summarySpan = document.createElement("span");
  summarySpan.style.color = "var(--text-muted)";
  summarySpan.textContent = " " + summarize(tool, input);

  div.appendChild(iconSpan);
  div.appendChild(document.createTextNode(" "));
  div.appendChild(nameSpan);
  div.appendChild(summarySpan);
  messagesEl.appendChild(div);
  scrollToBottom();
}

function updateLastTool(success) {
  const all = messagesEl.querySelectorAll(".msg-tool");
  const last = all[all.length - 1];
  if (last) last.classList.add(success ? "success" : "failure");
}

function addScreenshot(img) {
  const div = document.createElement("div");
  div.className = "msg msg-screenshot";
  const el = document.createElement("img");
  el.src = img;
  el.alt = "Screenshot";
  div.appendChild(el);
  messagesEl.appendChild(div);
  scrollToBottom();
}

function addSystem(text) {
  const div = document.createElement("div");
  div.className = "msg msg-system";
  div.textContent = text;
  messagesEl.appendChild(div);
  scrollToBottom();
}

/**
 * Render an error bubble. When the background sends a typed error (code,
 * retryable, providerId) we badge the code so the user can quote it in a
 * bug report and offer a Retry button for the retryable subset (rate
 * limits, transient network errors, 5xx).
 *
 * @param {string} text
 * @param {{ code?: string|null, retryable?: boolean, providerId?: string|null }} [meta]
 */
function addError(text, meta) {
  const div = document.createElement("div");
  div.className = "msg msg-error";

  const body = document.createElement("span");
  body.textContent = text;
  div.appendChild(body);

  if (meta?.code) {
    const badge = document.createElement("span");
    badge.className = "err-code";
    badge.textContent = meta.code;
    div.appendChild(badge);
  }

  if (meta?.retryable) {
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "err-retry";
    retry.textContent = "Retry";
    retry.addEventListener("click", () => {
      // Re-send the most recent user message in the current mode. Empty
      // history → no-op (defensive; shouldn't happen because we only land
      // here after a turn started).
      const last = findLastUserText();
      if (!last) return;
      state.port?.postMessage({
        type: state.mode === "agent" ? "SEND_MESSAGE" : "CHAT_ONLY",
        text: last,
        windowId: state.windowId,
      });
      retry.disabled = true;
    });
    div.appendChild(retry);
  }

  messagesEl.appendChild(div);
  scrollToBottom();
}

/**
 * Walk the rendered message list backwards to find the most recent user
 * bubble's text. Used by the retry button.
 */
function findLastUserText() {
  const userMsgs = messagesEl.querySelectorAll(".msg-user");
  const last = userMsgs[userMsgs.length - 1];
  return last ? last.textContent : null;
}

function clearMessages() {
  // Build welcome card via DOM (no innerHTML) so any future change stays safe.
  messagesEl.textContent = "";
  const wrap = document.createElement("div");
  wrap.className = "welcome-msg";
  const p = document.createElement("p");
  p.textContent = "Tell me what to do on this page, or ask a question.";
  wrap.appendChild(p);

  const actions = document.createElement("div");
  actions.className = "quick-actions";
  for (const [label, action] of [
    ["Summarize page", "Summarize this page"],
    ["List links", "What are the main links on this page?"],
    ["Extract text", "Extract all text from this page"],
  ]) {
    const b = document.createElement("button");
    b.className = "quick-btn";
    b.dataset.action = action;
    b.textContent = label;
    actions.appendChild(b);
  }
  wrap.appendChild(actions);
  messagesEl.appendChild(wrap);
  bindQuick();
}

/**
 * Begin a new streaming assistant message. Creates an empty .msg.msg-assistant
 * element marked with the .streaming class (which renders the blinking caret),
 * and stores it on state so subsequent STREAM_DELTA messages can append.
 *
 * @param {string} id
 */
/**
 * Repopulate the sidebar with messages from a persisted session.
 *
 * Called when the background emits `HISTORY_RESTORE` after a `GET_STATUS`
 * exchange. We render each message via the standard `addMessage` path so
 * markdown formatting is consistent with live messages. The welcome card
 * is removed if any history exists.
 *
 * @param {Array<{ role: "user" | "assistant", text: string }>} messages
 */
function restoreHistoryMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return;
  for (const m of messages) {
    if (m && (m.role === "user" || m.role === "assistant") && typeof m.text === "string") {
      addMessage(m.role, m.text);
    }
  }
}

function beginStreamingMessage(id) {
  removeWelcome();
  const div = document.createElement("div");
  div.className = "msg msg-assistant streaming";
  div.dataset.streamId = id;
  messagesEl.appendChild(div);
  state.streaming = { id, el: div, text: "", rafHandle: 0 };
  scrollToBottom();
}

/**
 * Append a delta chunk to the active streaming message. Re-renders the
 * markdown into the message element via DOM construction (no innerHTML).
 *
 * Renders are coalesced through `requestAnimationFrame`: when many deltas
 * arrive in quick succession (typical for SSE streaming) only one paint
 * happens per frame. Without this, a 10k-token reply with ~2000 deltas
 * would re-tokenize the entire growing string 2000 times — O(n²) jank.
 *
 * @param {string} id
 * @param {string} text
 */
function appendStreamingDelta(id, text) {
  if (!state.streaming || state.streaming.id !== id) return;
  state.streaming.text += text;
  state.streaming.el.classList.add("streaming");
  scheduleStreamingFlush();
}

/**
 * Coalesce render calls through rAF. The handle is stored on state.streaming
 * so back-to-back calls in the same frame share one paint.
 */
function scheduleStreamingFlush() {
  if (!state.streaming || state.streaming.rafHandle) return;
  const s = state.streaming;
  s.rafHandle = requestAnimationFrame(() => {
    // s.rafHandle was set in this function; finalizeStreamingMessage cancels
    // it before clearing state.streaming, so the only way we reach here is
    // when the stream is still live. Capture s by closure so we don't
    // re-read state.streaming after a possible reassignment.
    renderMdInto(s.el, s.text);
    s.rafHandle = 0;
    scrollToBottom();
  });
}

/**
 * Finalize the active streaming message: cancel any pending rAF render, run
 * one final synchronous render so the final text is on screen, then drop
 * the .streaming class and clear state.streaming.
 *
 * @param {string} id
 */
function finalizeStreamingMessage(id) {
  if (!state.streaming || state.streaming.id !== id) return;
  if (state.streaming.rafHandle) {
    cancelAnimationFrame(state.streaming.rafHandle);
    state.streaming.rafHandle = 0;
  }
  const finalText = state.streaming.text;
  if (finalText.length === 0) {
    // Empty stream (assistant turn was entirely tool calls, or the call
    // aborted before any text arrived). Drop the placeholder. Also clear
    // lastStreamedText so the trailing ASSISTANT_TEXT (if any) renders.
    state.streaming.el.remove();
    state.lastStreamedText = null;
  } else {
    // Render once more so the message reflects the full accumulated text
    // even if the last rAF didn't fire.
    renderMdInto(state.streaming.el, finalText);
    state.streaming.el.classList.remove("streaming");
    // Background emits ASSISTANT_TEXT after STREAM_END as the canonical
    // end-of-turn marker. The text is identical to the streamed content —
    // suppress that exact duplicate (and only that one) below.
    state.lastStreamedText = finalText;
  }
  state.streaming = null;
}

/**
 * Update the cost counter chip in the status bar. Hides itself when cost is
 * "$0.00" or unset so users without a paid provider don't see a stale chip.
 *
 * @param {string | undefined} cost
 */
function updateCostCounter(cost) {
  if (!cost || cost === "$0.00") {
    costCounter.classList.add("hidden");
    return;
  }
  costCounter.textContent = cost;
  costCounter.classList.remove("hidden");
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  });
}

function sendMessage() {
  const text = inputText.value.trim();
  if (!text || state.isRunning) return;
  addMessage("user", text);
  inputText.value = "";
  inputText.style.height = "auto";
  updateSend();
  state.port.postMessage({
    type: state.mode === "agent" ? "SEND_MESSAGE" : "CHAT_ONLY",
    text,
    windowId: state.windowId,
  });
}

function updateSend() {
  btnSend.disabled = !inputText.value.trim() || state.isRunning;
}

function setMode(next) {
  state.mode = next;
  if (next === "agent") {
    modeAgent.classList.add("active");
    modeChat.classList.remove("active");
    inputText.placeholder = "Tell me what to do...";
  } else {
    modeChat.classList.add("active");
    modeAgent.classList.remove("active");
    inputText.placeholder = "Ask about this page...";
  }
}

function bindQuick() {
  document.querySelectorAll(".quick-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      inputText.value = /** @type {HTMLElement} */ (btn).dataset.action ?? /* v8 ignore next */ "";
      setMode("chat");
      sendMessage();
    });
  });
}

async function checkPending() {
  try {
    const r = await browser.storage.session.get("pendingSelection");
    if (r.pendingSelection) {
      inputText.value = `Explain: "${r.pendingSelection}"`;
      await browser.storage.session.remove("pendingSelection");
      sendMessage();
    }
  } catch {
    /* session storage not available in this context — ignore */
  }
}

// Event wiring
inputText.addEventListener("input", () => {
  inputText.style.height = "auto";
  inputText.style.height = Math.min(inputText.scrollHeight, 120) + "px";
  updateSend();
});
inputText.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});
btnSend.addEventListener("click", sendMessage);
btnStop.addEventListener("click", () => state.port.postMessage({ type: "STOP_AGENT" }));
btnClear.addEventListener("click", () => state.port.postMessage({ type: "CLEAR_HISTORY" }));
btnSettings.addEventListener("click", () => browser.runtime.openOptionsPage());
btnOpenSettings.addEventListener("click", () => browser.runtime.openOptionsPage());
btnPreviewApprove.addEventListener("click", () => respondToPreview(true));
btnPreviewCancel.addEventListener("click", () => respondToPreview(false));
modeChat.addEventListener("click", () => setMode("chat"));
modeAgent.addEventListener("click", () => setMode("agent"));

// Resolve the sidebar's window ID once at startup. Sent with every message so
// the background can scope tab queries and screenshots to this window rather
// than relying on "currentWindow" (which is undefined in service workers).
browser.windows.getCurrent().then(({ id }) => {
  state.windowId = id;
});

bindQuick();
connectPort();
checkPending();
