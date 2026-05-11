/**
 * Integration tests for options/options.js (module).
 *
 * Builds the options-page DOM from the real options.html, mocks `browser.storage`
 * and `fetch`, then imports the module so its top-level wiring runs.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fetchResponse } from "../setup.js";

const OPTIONS_HTML = readFileSync(join(__dirname, "..", "..", "options", "options.html"), "utf8");

function extractBody(html) {
  const m = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  return m ? m[1].replace(/<script[\s\S]*?<\/script>/gi, "") : "";
}

async function setup(stored = {}) {
  document.body.innerHTML = extractBody(OPTIONS_HTML);
  globalThis.browser.storage.local.get.mockImplementation(async (keys) => {
    if (Array.isArray(keys)) {
      const out = {};
      for (const k of keys) if (k in stored) out[k] = stored[k];
      return out;
    }
    return { ...stored };
  });
  vi.resetModules();
  await import("../../options/options.js");
  // Allow load() microtasks to settle
  await new Promise((r) => setTimeout(r, 5));
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("options: load + restore saved settings", () => {
  it("populates all input fields from storage", async () => {
    globalThis.fetch.mockResolvedValueOnce(
      fetchResponse({ models: [{ name: "llama3.1", size: 1024 * 1024 * 1024 }] }),
    );
    await setup({
      activeProvider: "anthropic",
      providers: {
        ollama: { endpoint: "http://[::1]:11434", model: "llama3.1" },
        anthropic: { key: "sk-ant-zzz", model: "claude-opus-4-20250514" },
        openai: { key: "sk-zzz", model: "gpt-4o-mini" },
        google: { key: "AIzaZZZ", model: "gemini-2.5-pro" },
      },
      maxTurns: 13,
    });

    expect(document.getElementById("ollama-endpoint").value).toBe("http://[::1]:11434");
    expect(document.getElementById("anthropic-key").value).toBe("sk-ant-zzz");
    expect(document.getElementById("openai-key").value).toBe("sk-zzz");
    expect(document.getElementById("google-key").value).toBe("AIzaZZZ");
    expect(document.getElementById("max-turns").value).toBe("13");

    // Active provider card highlighted
    const card = document.querySelector('.provider-card[data-provider="anthropic"]');
    expect(card.classList.contains("active")).toBe(true);
  });

  it("triggers Ollama detect when active or on fresh load", async () => {
    globalThis.fetch.mockResolvedValueOnce(
      fetchResponse({ models: [{ name: "mistral", size: 4 * 1024 * 1024 * 1024 }] }),
    );
    await setup();
    expect(globalThis.fetch).toHaveBeenCalled();
    expect(globalThis.fetch.mock.calls.some((c) => /api\/tags$/.test(c[0]))).toBe(true);
  });
});

describe("options: provider card selection", () => {
  it("clicking a card switches the visible config panel", async () => {
    globalThis.fetch.mockResolvedValue(fetchResponse({ models: [] }));
    await setup();
    document.querySelector('.provider-card[data-provider="anthropic"]').click();
    expect(document.getElementById("config-anthropic").classList.contains("visible")).toBe(true);
    expect(document.getElementById("config-openai").classList.contains("visible")).toBe(false);
  });

  it("clicking Ollama card re-detects models", async () => {
    globalThis.fetch.mockResolvedValue(
      fetchResponse({ models: [{ name: "x", size: 1024 * 1024 * 1024 }] }),
    );
    await setup();
    const before = globalThis.fetch.mock.calls.length;
    document.querySelector('.provider-card[data-provider="ollama"]').click();
    await new Promise((r) => setTimeout(r, 5));
    expect(globalThis.fetch.mock.calls.length).toBeGreaterThan(before);
  });
});

describe("options: Ollama configuration", () => {
  it("Test button shows Connected on 200", async () => {
    globalThis.fetch.mockResolvedValue(
      fetchResponse({ models: [{ name: "m", size: 1024 * 1024 * 1024 }] }),
    );
    await setup();
    document.getElementById("ollama-test").click();
    await new Promise((r) => setTimeout(r, 10));
    expect(document.getElementById("ollama-status").textContent).toMatch(/Connected/);
  });

  it("Test button shows error code on non-200", async () => {
    globalThis.fetch.mockResolvedValue(fetchResponse("nope", { ok: false, status: 503 }));
    await setup();
    document.getElementById("ollama-test").click();
    await new Promise((r) => setTimeout(r, 10));
    expect(document.getElementById("ollama-status").textContent).toMatch(/503/);
  });

  it("Test button shows 'Cannot connect' when fetch throws", async () => {
    globalThis.fetch.mockRejectedValue(new TypeError("Failed to fetch"));
    await setup();
    document.getElementById("ollama-test").click();
    await new Promise((r) => setTimeout(r, 10));
    expect(document.getElementById("ollama-status").textContent).toMatch(/Cannot connect/);
  });

  it("Save with a selected model writes to storage", async () => {
    globalThis.fetch.mockResolvedValue(
      fetchResponse({ models: [{ name: "llama3.1", size: 1024 * 1024 * 1024 }] }),
    );
    await setup();
    await new Promise((r) => setTimeout(r, 10));
    document.getElementById("ollama-model").value = "llama3.1";
    document.getElementById("ollama-save").click();
    await new Promise((r) => setTimeout(r, 5));
    expect(globalThis.browser.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ activeProvider: "ollama" }),
    );
  });

  it("Save without a model shows an error status", async () => {
    globalThis.fetch.mockResolvedValue(fetchResponse({ models: [] }));
    await setup();
    document.getElementById("ollama-save").click();
    expect(document.getElementById("ollama-status").textContent).toMatch(/No model/);
  });

  it("Refresh shows fallback when no models are returned", async () => {
    globalThis.fetch.mockResolvedValue(fetchResponse({ models: [] }));
    await setup();
    await new Promise((r) => setTimeout(r, 10));
    expect(document.getElementById("ollama-model").innerHTML).toMatch(/No models/);
  });

  it("Refresh shows 'not detected' when fetch fails", async () => {
    globalThis.fetch.mockRejectedValue(new TypeError("net"));
    await setup();
    await new Promise((r) => setTimeout(r, 10));
    expect(document.getElementById("ollama-model").innerHTML).toMatch(/not detected/i);
  });

  it("Refresh restores the saved model selection", async () => {
    globalThis.fetch.mockResolvedValue(
      fetchResponse({
        models: [
          { name: "llama3.1", size: 5 * 1024 * 1024 * 1024 },
          { name: "mistral", size: 4 * 1024 * 1024 * 1024 },
        ],
      }),
    );
    await setup({ providers: { ollama: { model: "mistral" } } });
    await new Promise((r) => setTimeout(r, 10));
    document.getElementById("ollama-refresh").click();
    await new Promise((r) => setTimeout(r, 10));
    expect(document.getElementById("ollama-model").value).toBe("mistral");
  });
});

describe("options: Anthropic configuration", () => {
  beforeEach(async () => {
    globalThis.fetch.mockResolvedValue(fetchResponse({ models: [] }));
  });

  it("Save with a valid sk-ant- key persists and shows success", async () => {
    await setup();
    document.getElementById("anthropic-key").value = "sk-ant-xxx";
    document.getElementById("anthropic-save").click();
    await new Promise((r) => setTimeout(r, 5));
    expect(globalThis.browser.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ activeProvider: "anthropic" }),
    );
    expect(document.getElementById("anthropic-status").textContent).toMatch(/activated/i);
  });

  it("Save with an invalid key shows an error", async () => {
    await setup();
    document.getElementById("anthropic-key").value = "bad";
    document.getElementById("anthropic-save").click();
    expect(document.getElementById("anthropic-status").textContent).toMatch(/Invalid/);
  });

  it("Test with no key shows a hint", async () => {
    await setup();
    document.getElementById("anthropic-test").click();
    expect(document.getElementById("anthropic-status").textContent).toMatch(/Enter a key/);
  });

  it("Test success path", async () => {
    await setup();
    document.getElementById("anthropic-key").value = "sk-ant-xxx";
    globalThis.fetch.mockResolvedValueOnce(
      fetchResponse({ content: [{ type: "text", text: "OK" }] }),
    );
    document.getElementById("anthropic-test").click();
    await new Promise((r) => setTimeout(r, 5));
    expect(document.getElementById("anthropic-status").textContent).toMatch(/Connected/);
  });

  it("Test reports non-200 status", async () => {
    await setup();
    document.getElementById("anthropic-key").value = "sk-ant-xxx";
    globalThis.fetch.mockResolvedValueOnce(fetchResponse("nope", { ok: false, status: 401 }));
    document.getElementById("anthropic-test").click();
    await new Promise((r) => setTimeout(r, 5));
    expect(document.getElementById("anthropic-status").textContent).toMatch(/Error 401/);
  });

  it("Test handles fetch throw", async () => {
    await setup();
    document.getElementById("anthropic-key").value = "sk-ant-xxx";
    globalThis.fetch.mockRejectedValueOnce(new TypeError("net"));
    document.getElementById("anthropic-test").click();
    await new Promise((r) => setTimeout(r, 5));
    expect(document.getElementById("anthropic-status").textContent).toMatch(/Failed/);
  });
});

describe("options: OpenAI configuration", () => {
  beforeEach(async () => {
    globalThis.fetch.mockResolvedValue(fetchResponse({ models: [] }));
  });

  it("Save validates sk- prefix", async () => {
    await setup();
    document.getElementById("openai-key").value = "sk-something";
    document.getElementById("openai-save").click();
    await new Promise((r) => setTimeout(r, 5));
    expect(globalThis.browser.storage.local.set).toHaveBeenCalled();
  });

  it("Save with invalid key shows error", async () => {
    await setup();
    document.getElementById("openai-key").value = "bad";
    document.getElementById("openai-save").click();
    expect(document.getElementById("openai-status").textContent).toMatch(/Invalid/);
  });

  it("Test without key prompts user", async () => {
    await setup();
    document.getElementById("openai-test").click();
    expect(document.getElementById("openai-status").textContent).toMatch(/Enter a key/);
  });

  it("Test success", async () => {
    await setup();
    document.getElementById("openai-key").value = "sk-xxx";
    globalThis.fetch.mockResolvedValueOnce(
      fetchResponse({ choices: [{ message: { content: "OK" }, finish_reason: "stop" }] }),
    );
    document.getElementById("openai-test").click();
    await new Promise((r) => setTimeout(r, 5));
    expect(document.getElementById("openai-status").textContent).toMatch(/Connected/);
  });

  it("Test non-200", async () => {
    await setup();
    document.getElementById("openai-key").value = "sk-xxx";
    globalThis.fetch.mockResolvedValueOnce(fetchResponse("nope", { ok: false, status: 429 }));
    document.getElementById("openai-test").click();
    await new Promise((r) => setTimeout(r, 5));
    expect(document.getElementById("openai-status").textContent).toMatch(/Error 429/);
  });

  it("Test handles fetch throw", async () => {
    await setup();
    document.getElementById("openai-key").value = "sk-xxx";
    globalThis.fetch.mockRejectedValueOnce(new TypeError("net"));
    document.getElementById("openai-test").click();
    await new Promise((r) => setTimeout(r, 5));
    expect(document.getElementById("openai-status").textContent).toMatch(/Failed/);
  });
});

describe("options: Google configuration", () => {
  beforeEach(async () => {
    globalThis.fetch.mockResolvedValue(fetchResponse({ models: [] }));
  });

  it("Save persists the key + model", async () => {
    await setup();
    document.getElementById("google-key").value = "AIzaXX";
    document.getElementById("google-save").click();
    await new Promise((r) => setTimeout(r, 5));
    expect(globalThis.browser.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ activeProvider: "google" }),
    );
  });

  it("Save without a key shows an error", async () => {
    await setup();
    document.getElementById("google-key").value = "";
    document.getElementById("google-save").click();
    expect(document.getElementById("google-status").textContent).toMatch(/Enter a key/);
  });

  it("Test without a key prompts", async () => {
    await setup();
    document.getElementById("google-test").click();
    expect(document.getElementById("google-status").textContent).toMatch(/Enter a key/);
  });

  it("Test success uses x-goog-api-key header (not URL query)", async () => {
    await setup();
    document.getElementById("google-key").value = "AIzaXX";
    globalThis.fetch.mockResolvedValueOnce(
      fetchResponse({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }),
    );
    document.getElementById("google-test").click();
    await new Promise((r) => setTimeout(r, 5));
    const [url, init] = globalThis.fetch.mock.calls[globalThis.fetch.mock.calls.length - 1];
    expect(url).not.toMatch(/[?&]key=/);
    expect(init.headers["x-goog-api-key"]).toBe("AIzaXX");
    expect(document.getElementById("google-status").textContent).toMatch(/Connected/);
  });

  it("Test reports non-200 status", async () => {
    await setup();
    document.getElementById("google-key").value = "AIzaXX";
    globalThis.fetch.mockResolvedValueOnce(fetchResponse("err", { ok: false, status: 403 }));
    document.getElementById("google-test").click();
    await new Promise((r) => setTimeout(r, 5));
    expect(document.getElementById("google-status").textContent).toMatch(/Error 403/);
  });

  it("Test handles fetch throw", async () => {
    await setup();
    document.getElementById("google-key").value = "AIzaXX";
    globalThis.fetch.mockRejectedValueOnce(new TypeError("net"));
    document.getElementById("google-test").click();
    await new Promise((r) => setTimeout(r, 5));
    expect(document.getElementById("google-status").textContent).toMatch(/Failed/);
  });
});

describe("options: safety panel", () => {
  beforeEach(async () => {
    globalThis.fetch.mockResolvedValue(fetchResponse({ models: [] }));
  });

  it("saves valid maxTurns to storage", async () => {
    await setup();
    document.getElementById("max-turns").value = "10";
    document.getElementById("safety-save").click();
    await new Promise((r) => setTimeout(r, 5));
    expect(globalThis.browser.storage.local.set).toHaveBeenCalledWith({ maxTurns: 10 });
  });

  it("rejects out-of-range values", async () => {
    await setup();
    document.getElementById("max-turns").value = "1000";
    document.getElementById("safety-save").click();
    expect(document.getElementById("safety-status").textContent).toMatch(/Must be 1-100/);
  });

  it("rejects non-numeric values", async () => {
    await setup();
    document.getElementById("max-turns").value = "abc";
    document.getElementById("safety-save").click();
    expect(document.getElementById("safety-status").textContent).toMatch(/Must be 1-100/);
  });

  it("rejects zero", async () => {
    await setup();
    document.getElementById("max-turns").value = "0";
    document.getElementById("safety-save").click();
    expect(document.getElementById("safety-status").textContent).toMatch(/Must be 1-100/);
  });
});

describe("options: safety policy panel", () => {
  beforeEach(async () => {
    globalThis.fetch.mockResolvedValue(fetchResponse({ models: [] }));
  });

  it("restores stored policy fields on load", async () => {
    await setup({
      safetyPolicy: {
        previewMode: "all",
        allowlist: ["github.com", "*.wikipedia.org"],
        blocklist: ["evil.example"],
        warnOnInjectionPatterns: false,
      },
    });
    expect(document.getElementById("policy-preview-mode").value).toBe("all");
    expect(document.getElementById("policy-allowlist").value).toBe("github.com\n*.wikipedia.org");
    expect(document.getElementById("policy-blocklist").value).toBe("evil.example");
    expect(document.getElementById("policy-warn-injection").checked).toBe(false);
  });

  it("saves the policy on click", async () => {
    await setup();
    document.getElementById("policy-preview-mode").value = "off";
    document.getElementById("policy-allowlist").value = "  github.com  \n\n*.wikipedia.org\n";
    document.getElementById("policy-blocklist").value = "evil.example";
    document.getElementById("policy-warn-injection").checked = false;
    document.getElementById("policy-save").click();
    await new Promise((r) => setTimeout(r, 5));

    const call = globalThis.browser.storage.local.set.mock.calls.find(
      (c) => c[0].safetyPolicy !== undefined,
    );
    expect(call[0].safetyPolicy).toEqual({
      previewMode: "off",
      allowlist: ["github.com", "*.wikipedia.org"],
      blocklist: ["evil.example"],
      warnOnInjectionPatterns: false,
    });
    expect(document.getElementById("policy-status").textContent).toMatch(/saved/i);
  });

  it("rejects an invalid preview mode", async () => {
    await setup();
    const sel = document.getElementById("policy-preview-mode");
    // Force an invalid value (select normally constrains, but we override).
    const opt = document.createElement("option");
    opt.value = "yolo";
    sel.appendChild(opt);
    sel.value = "yolo";
    document.getElementById("policy-save").click();
    expect(document.getElementById("policy-status").textContent).toMatch(/Invalid/);
  });

  it("treats empty textareas as empty arrays", async () => {
    await setup();
    document.getElementById("policy-allowlist").value = "";
    document.getElementById("policy-blocklist").value = "   \n\n  ";
    document.getElementById("policy-save").click();
    await new Promise((r) => setTimeout(r, 5));
    const call = globalThis.browser.storage.local.set.mock.calls.find(
      (c) => c[0].safetyPolicy !== undefined,
    );
    expect(call[0].safetyPolicy.allowlist).toEqual([]);
    expect(call[0].safetyPolicy.blocklist).toEqual([]);
  });
});
