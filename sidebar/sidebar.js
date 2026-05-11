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

import { TOOL_ICONS, escapeHtml, renderMd, summarize } from "./utils.js";

const messagesEl = document.getElementById("messages");
const inputText = document.getElementById("input-text");
const btnSend = document.getElementById("btn-send");
const btnClear = document.getElementById("btn-clear");
const btnSettings = document.getElementById("btn-settings");
const btnStop = document.getElementById("btn-stop");
const stopBar = document.getElementById("stop-bar");
const statusBar = document.getElementById("status-bar");
const statusText = document.getElementById("status-text");
const turnCounter = document.getElementById("turn-counter");
const providerLabel = document.getElementById("provider-label");
const noProviderWarning = document.getElementById("no-provider-warning");
const btnOpenSettings = document.getElementById("btn-open-settings");
const modeChat = document.getElementById("mode-chat");
const modeAgent = document.getElementById("mode-agent");

const state = {
  mode: "chat",
  port: null,
  isRunning: false,
};

const RECONNECT_DELAY_MS = 500;

function connectPort() {
  state.port = browser.runtime.connect({ name: "topologica-sidebar" });
  state.port.onMessage.addListener(handleMsg);
  state.port.onDisconnect.addListener(() => setTimeout(connectPort, RECONNECT_DELAY_MS));
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
      break;
    case "ASSISTANT_TEXT":
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
      addError(msg.message);
      if (msg.message?.includes("No LLM provider")) {
        noProviderWarning.classList.remove("hidden");
      }
      break;
    case "HISTORY_CLEARED":
      clearMessages();
      break;
  }
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
  // Assistant text supports a small Markdown subset; user text is plain.
  div.innerHTML = role === "assistant" ? renderMd(text) : escapeHtml(text);
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

function addError(text) {
  const div = document.createElement("div");
  div.className = "msg msg-error";
  div.textContent = text;
  messagesEl.appendChild(div);
  scrollToBottom();
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
      inputText.value = btn.dataset.action;
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
modeChat.addEventListener("click", () => setMode("chat"));
modeAgent.addEventListener("click", () => setMode("agent"));

bindQuick();
connectPort();
checkPending();
