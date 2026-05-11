/**
 * FIREFOX LLM BRIDGE - Sidebar UI Controller
 * Handles message rendering, mode toggle, provider display, and onboarding.
 */
(() => {
  "use strict";

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

  let mode = "chat";
  let port = null;
  let isRunning = false;

  function connectPort() {
    port = browser.runtime.connect({ name: "topologica-sidebar" });
    port.onMessage.addListener(handleMsg);
    port.onDisconnect.addListener(() => setTimeout(connectPort, 500));
    port.postMessage({ type: "GET_STATUS" });
  }
  connectPort();

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
      case "ASSISTANT_TEXT": addMessage("assistant", msg.text); break;
      case "TOOL_USE":
        addToolMessage(msg.tool, msg.input, msg.turn);
        turnCounter.textContent = `Turn ${msg.turn}`;
        turnCounter.classList.remove("hidden");
        break;
      case "TOOL_RESULT": updateLastTool(msg.success); break;
      case "SCREENSHOT": addScreenshot(msg.image); break;
      case "TASK_COMPLETE": addSystem(`Task complete: ${msg.summary}`); break;
      case "AGENT_STOPPED": addSystem(msg.message || "Stopped."); break;
      case "ERROR":
        addError(msg.message);
        if (msg.message?.includes("No LLM provider")) noProviderWarning.classList.remove("hidden");
        break;
      case "HISTORY_CLEARED": clearMessages(); break;
    }
  }

  function updateStatus(status, message) {
    statusBar.className = "";
    switch (status) {
      case "idle":
        statusBar.classList.add("status-idle"); statusText.textContent = "Ready";
        isRunning = false; stopBar.classList.add("hidden"); inputText.disabled = false; turnCounter.classList.add("hidden");
        break;
      case "thinking":
        statusBar.classList.add("status-thinking"); statusText.textContent = message || "Thinking...";
        isRunning = true; stopBar.classList.remove("hidden"); inputText.disabled = true;
        break;
      case "running":
        statusBar.classList.add("status-running"); statusText.textContent = message || "Executing...";
        isRunning = true; stopBar.classList.remove("hidden"); inputText.disabled = true;
        break;
      case "error":
        statusBar.classList.add("status-error"); statusText.textContent = message || "Error";
        isRunning = false; stopBar.classList.add("hidden"); inputText.disabled = false;
        break;
    }
    updateSend();
  }

  function removeWelcome() { const w = messagesEl.querySelector(".welcome-msg"); if (w) w.remove(); }

  function addMessage(role, text) {
    removeWelcome();
    const div = document.createElement("div");
    div.className = `msg msg-${role}`;
    div.innerHTML = role === "assistant" ? renderMd(text) : escapeHtml(text);
    messagesEl.appendChild(div);
    scroll();
  }

  const TOOL_ICONS = { read_page:"👁", click_element:"👆", type_text:"⌨", navigate:"🌐", scroll_page:"↕", extract_text:"📄", screenshot:"📸", wait:"⏳", go_back:"↩", get_tab_info:"ℹ", task_complete:"✅" };

  function addToolMessage(tool, input, turn) {
    removeWelcome();
    const div = document.createElement("div");
    div.className = "msg msg-tool";
    div.dataset.turn = turn;

    // Build via DOM nodes (defense-in-depth: tool name + summary come from the
    // LLM, which is influenced by attacker-controlled page content).
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
    scroll();
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
    scroll();
  }

  function addSystem(text) {
    const div = document.createElement("div");
    div.className = "msg msg-system";
    div.textContent = text;
    messagesEl.appendChild(div);
    scroll();
  }

  function addError(text) {
    const div = document.createElement("div");
    div.className = "msg msg-error";
    div.textContent = text;
    messagesEl.appendChild(div);
    scroll();
  }

  function clearMessages() {
    messagesEl.innerHTML = `<div class="welcome-msg"><p>Tell me what to do on this page, or ask a question.</p><div class="quick-actions"><button class="quick-btn" data-action="Summarize this page">Summarize page</button><button class="quick-btn" data-action="What are the main links on this page?">List links</button><button class="quick-btn" data-action="Extract all text from this page">Extract text</button></div></div>`;
    bindQuick();
  }

  function scroll() { requestAnimationFrame(() => { messagesEl.scrollTop = messagesEl.scrollHeight; }); }

  function renderMd(t) {
    return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
      .replace(/\*\*(.*?)\*\*/g,"<strong>$1</strong>")
      .replace(/`([^`]+)`/g,"<code>$1</code>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\n/g,"<br>");
  }

  function escapeHtml(t) { const d = document.createElement("div"); d.textContent = t; return d.innerHTML; }

  function summarize(tool, input) {
    if (!input) return "";
    switch (tool) {
      case "navigate": return input.url ? `→ ${new URL(input.url).hostname}` : "";
      case "click_element": return input.selector ? input.selector.substring(0,30) : `[${input.element_index}]`;
      case "type_text": return `"${(input.text||"").substring(0,20)}${input.text?.length>20?"...":""}"`;
      case "scroll_page": return input.direction || "";
      case "extract_text": return input.selector || "(full page)";
      case "wait": return `${input.milliseconds||1000}ms`;
      default: return "";
    }
  }

  function sendMessage() {
    const text = inputText.value.trim();
    if (!text || isRunning) return;
    addMessage("user", text);
    inputText.value = ""; inputText.style.height = "auto"; updateSend();
    port.postMessage({ type: mode === "agent" ? "SEND_MESSAGE" : "CHAT_ONLY", text });
  }

  function updateSend() { btnSend.disabled = !inputText.value.trim() || isRunning; }

  inputText.addEventListener("input", () => {
    inputText.style.height = "auto";
    inputText.style.height = Math.min(inputText.scrollHeight, 120) + "px";
    updateSend();
  });
  inputText.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
  btnSend.addEventListener("click", sendMessage);
  btnStop.addEventListener("click", () => port.postMessage({ type: "STOP_AGENT" }));
  btnClear.addEventListener("click", () => port.postMessage({ type: "CLEAR_HISTORY" }));
  btnSettings.addEventListener("click", () => browser.runtime.openOptionsPage());
  btnOpenSettings.addEventListener("click", () => browser.runtime.openOptionsPage());

  modeChat.addEventListener("click", () => { mode = "chat"; modeChat.classList.add("active"); modeAgent.classList.remove("active"); inputText.placeholder = "Ask about this page..."; });
  modeAgent.addEventListener("click", () => { mode = "agent"; modeAgent.classList.add("active"); modeChat.classList.remove("active"); inputText.placeholder = "Tell me what to do..."; });

  function bindQuick() {
    document.querySelectorAll(".quick-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        inputText.value = btn.dataset.action;
        mode = "chat"; modeChat.classList.add("active"); modeAgent.classList.remove("active");
        sendMessage();
      });
    });
  }
  bindQuick();

  async function checkPending() {
    try {
      const r = await browser.storage.session.get("pendingSelection");
      if (r.pendingSelection) { inputText.value = `Explain: "${r.pendingSelection}"`; await browser.storage.session.remove("pendingSelection"); sendMessage(); }
    } catch (e) {}
  }
  checkPending();
})();
