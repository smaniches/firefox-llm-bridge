/**
 * FIREFOX LLM BRIDGE - Options Page Controller
 *
 * Module-scoped (loaded as `<script type="module">`). Handles per-provider
 * configuration, connection testing, and Ollama model detection.
 */

let activeProvider = null;

// ============================================================
// LOAD SAVED SETTINGS
// ============================================================

async function load() {
  const stored = await browser.storage.local.get(["activeProvider", "providers", "maxTurns"]);
  activeProvider = stored.activeProvider || null;
  const providers = stored.providers || {};

  // Restore per-provider settings
  if (providers.ollama?.endpoint) el("ollama-endpoint").value = providers.ollama.endpoint;
  if (providers.ollama?.model) el("ollama-model").value = providers.ollama.model;
  if (providers.anthropic?.key) el("anthropic-key").value = providers.anthropic.key;
  if (providers.anthropic?.model) el("anthropic-model").value = providers.anthropic.model;
  if (providers.openai?.key) el("openai-key").value = providers.openai.key;
  if (providers.openai?.model) el("openai-model").value = providers.openai.model;
  if (providers.google?.key) el("google-key").value = providers.google.key;
  if (providers.google?.model) el("google-model").value = providers.google.model;
  if (stored.maxTurns) el("max-turns").value = stored.maxTurns;

  // Highlight active provider card
  updateCardStates();

  // Show active provider config
  if (activeProvider) showConfig(activeProvider);

  // Auto-detect Ollama models if Ollama is selected or on first load
  if (activeProvider === "ollama" || !activeProvider) {
    refreshOllamaModels();
  }
}

// ============================================================
// PROVIDER CARD SELECTION
// ============================================================

document.querySelectorAll(".provider-card").forEach((card) => {
  card.addEventListener("click", () => {
    const id = card.dataset.provider;
    showConfig(id);

    // If Ollama, auto-detect models
    if (id === "ollama") refreshOllamaModels();
  });
});

function showConfig(id) {
  // Hide all configs
  document.querySelectorAll(".provider-config").forEach((el) => el.classList.remove("visible"));
  // Show selected
  const configEl = document.getElementById(`config-${id}`);
  if (configEl) configEl.classList.add("visible");
  // Highlight card
  document.querySelectorAll(".provider-card").forEach((c) => c.classList.remove("active"));
  const card = document.querySelector(`.provider-card[data-provider="${id}"]`);
  if (card) card.classList.add("active");
}

function updateCardStates() {
  document.querySelectorAll(".provider-card").forEach((c) => {
    c.classList.toggle("active", c.dataset.provider === activeProvider);
  });
}

// ============================================================
// SAVE HELPERS
// ============================================================

async function saveProvider(id, config) {
  const stored = await browser.storage.local.get(["providers"]);
  const providers = stored.providers || {};
  providers[id] = { ...(providers[id] || {}), ...config };
  await browser.storage.local.set({ providers, activeProvider: id });
  activeProvider = id;
  updateCardStates();
}

// ============================================================
// OLLAMA
// ============================================================

el("ollama-test").addEventListener("click", async () => {
  const endpoint = el("ollama-endpoint").value.trim();
  setStatus("ollama-status", "Testing...", "");
  try {
    const r = await fetch(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (r.ok) {
      setStatus("ollama-status", "Connected.", "success");
      el("ollama-dot").className = "conn-dot connected";
      refreshOllamaModels();
    } else {
      setStatus("ollama-status", `Error: ${r.status}`, "error");
      el("ollama-dot").className = "conn-dot disconnected";
    }
  } catch {
    setStatus("ollama-status", "Cannot connect. Is Ollama running?", "error");
    el("ollama-dot").className = "conn-dot disconnected";
  }
});

async function refreshOllamaModels() {
  const endpoint = el("ollama-endpoint").value.trim();
  const select = el("ollama-model");
  try {
    const r = await fetch(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) throw new Error();
    const data = await r.json();
    select.innerHTML = "";
    if (data.models && data.models.length > 0) {
      for (const m of data.models) {
        const opt = document.createElement("option");
        opt.value = m.name;
        const gb = (m.size / (1024 * 1024 * 1024)).toFixed(1);
        opt.textContent = `${m.name} (${gb}GB)`;
        select.appendChild(opt);
      }
      el("ollama-dot").className = "conn-dot connected";
      // Restore saved model
      const stored = await browser.storage.local.get(["providers"]);
      const savedModel = stored.providers?.ollama?.model;
      if (savedModel && [...select.options].some((o) => o.value === savedModel)) {
        select.value = savedModel;
      }
    } else {
      select.innerHTML = '<option value="">No models found. Run: ollama pull llama3.1</option>';
    }
  } catch {
    select.innerHTML = '<option value="">Ollama not detected</option>';
    el("ollama-dot").className = "conn-dot disconnected";
  }
}

el("ollama-refresh").addEventListener("click", refreshOllamaModels);

el("ollama-save").addEventListener("click", async () => {
  const model = el("ollama-model").value;
  if (!model) {
    setStatus("ollama-status", "No model selected.", "error");
    return;
  }
  await saveProvider("ollama", { endpoint: el("ollama-endpoint").value.trim(), model });
  setStatus("ollama-status", "Ollama activated.", "success");
});

// ============================================================
// ANTHROPIC
// ============================================================

el("anthropic-save").addEventListener("click", async () => {
  const key = el("anthropic-key").value.trim();
  if (!key || !key.startsWith("sk-ant-")) {
    setStatus("anthropic-status", "Invalid key (should start with sk-ant-)", "error");
    return;
  }
  await saveProvider("anthropic", { key, model: el("anthropic-model").value });
  setStatus("anthropic-status", "Claude activated.", "success");
});

el("anthropic-test").addEventListener("click", async () => {
  const key = el("anthropic-key").value.trim();
  if (!key) {
    setStatus("anthropic-status", "Enter a key first.", "error");
    return;
  }
  setStatus("anthropic-status", "Testing...", "");
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: el("anthropic-model").value,
        max_tokens: 16,
        messages: [{ role: "user", content: "Reply OK" }],
      }),
    });
    if (r.ok) setStatus("anthropic-status", "Connected.", "success");
    else setStatus("anthropic-status", `Error ${r.status}`, "error");
  } catch (e) {
    setStatus("anthropic-status", `Failed: ${e.message}`, "error");
  }
});

// ============================================================
// OPENAI
// ============================================================

el("openai-save").addEventListener("click", async () => {
  const key = el("openai-key").value.trim();
  if (!key || !key.startsWith("sk-")) {
    setStatus("openai-status", "Invalid key (should start with sk-)", "error");
    return;
  }
  await saveProvider("openai", { key, model: el("openai-model").value });
  setStatus("openai-status", "OpenAI activated.", "success");
});

el("openai-test").addEventListener("click", async () => {
  const key = el("openai-key").value.trim();
  if (!key) {
    setStatus("openai-status", "Enter a key first.", "error");
    return;
  }
  setStatus("openai-status", "Testing...", "");
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: el("openai-model").value,
        max_tokens: 16,
        messages: [{ role: "user", content: "Reply OK" }],
      }),
    });
    if (r.ok) setStatus("openai-status", "Connected.", "success");
    else setStatus("openai-status", `Error ${r.status}`, "error");
  } catch (e) {
    setStatus("openai-status", `Failed: ${e.message}`, "error");
  }
});

// ============================================================
// GOOGLE
// ============================================================

el("google-save").addEventListener("click", async () => {
  const key = el("google-key").value.trim();
  if (!key) {
    setStatus("google-status", "Enter a key.", "error");
    return;
  }
  await saveProvider("google", { key, model: el("google-model").value });
  setStatus("google-status", "Gemini activated.", "success");
});

el("google-test").addEventListener("click", async () => {
  const key = el("google-key").value.trim();
  if (!key) {
    setStatus("google-status", "Enter a key first.", "error");
    return;
  }
  setStatus("google-status", "Testing...", "");
  try {
    const model = el("google-model").value;
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "Reply OK" }] }],
          generationConfig: { maxOutputTokens: 16 },
        }),
      },
    );
    if (r.ok) setStatus("google-status", "Connected.", "success");
    else setStatus("google-status", `Error ${r.status}`, "error");
  } catch (e) {
    setStatus("google-status", `Failed: ${e.message}`, "error");
  }
});

// ============================================================
// SAFETY
// ============================================================

el("safety-save").addEventListener("click", async () => {
  const maxTurns = parseInt(el("max-turns").value, 10);
  if (isNaN(maxTurns) || maxTurns < 1 || maxTurns > 100) {
    setStatus("safety-status", "Must be 1-100.", "error");
    return;
  }
  await browser.storage.local.set({ maxTurns });
  setStatus("safety-status", "Saved.", "success");
});

// ============================================================
// UTILS
// ============================================================

/**
 * Get an element by id, asserting it as an input/select-like for tsc.
 * @param {string} id
 * @returns {HTMLInputElement & HTMLSelectElement}
 */
function el(id) {
  return /** @type {HTMLInputElement & HTMLSelectElement} */ (document.getElementById(id));
}
function setStatus(id, text, type) {
  const e = document.getElementById(id);
  e.textContent = text;
  e.className = "status-msg" + (type ? ` ${type}` : "");
}

load();
