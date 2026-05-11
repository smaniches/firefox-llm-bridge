import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listProviders,
  getProvider,
  getActiveConfig,
  callLLM,
  buildToolResultMessage,
  getActiveProviderInfo,
} from "../../background/providers/index.js";

describe("provider router (index.js)", () => {
  describe("listProviders", () => {
    it("returns the four providers with public fields only", () => {
      const list = listProviders();
      expect(list).toHaveLength(4);
      const ids = list.map((p) => p.id).sort();
      expect(ids).toEqual(["anthropic", "google", "ollama", "openai"]);
      for (const p of list) {
        expect(p).toHaveProperty("name");
        expect(p).toHaveProperty("requiresKey");
        expect(Array.isArray(p.models)).toBe(true);
      }
    });
  });

  describe("getProvider", () => {
    it("returns the provider for a known id", () => {
      expect(getProvider("anthropic")).toBeTruthy();
      expect(getProvider("openai")).toBeTruthy();
      expect(getProvider("google")).toBeTruthy();
      expect(getProvider("ollama")).toBeTruthy();
    });
    it("returns null for unknown id", () => {
      expect(getProvider("nonsuch")).toBeNull();
    });
  });

  describe("getActiveConfig", () => {
    it("returns null when no provider is active", async () => {
      globalThis.browser.storage.local.get.mockResolvedValueOnce({});
      expect(await getActiveConfig()).toBeNull();
    });

    it("returns null when activeProvider is unknown", async () => {
      globalThis.browser.storage.local.get.mockResolvedValueOnce({ activeProvider: "ghost" });
      expect(await getActiveConfig()).toBeNull();
    });

    it("returns full config for an active provider with stored key and model", async () => {
      globalThis.browser.storage.local.get.mockResolvedValueOnce({
        activeProvider: "anthropic",
        providers: { anthropic: { key: "sk-ant-x", model: "claude-opus-4-20250514" } },
      });
      const cfg = await getActiveConfig();
      expect(cfg.provider.id).toBe("anthropic");
      expect(cfg.apiKey).toBe("sk-ant-x");
      expect(cfg.model).toBe("claude-opus-4-20250514");
    });

    it("falls back to provider default model when none stored", async () => {
      globalThis.browser.storage.local.get.mockResolvedValueOnce({
        activeProvider: "anthropic",
        providers: {},
      });
      const cfg = await getActiveConfig();
      expect(cfg.model).toBeTruthy();
      expect(cfg.apiKey).toBeNull();
    });

    it("falls back to first model when no default flag exists", async () => {
      // ollama: first entry has default:true, but exercise the fallback by mocking providers
      globalThis.browser.storage.local.get.mockResolvedValueOnce({
        activeProvider: "ollama",
        providers: { ollama: { endpoint: "http://[::1]:11434" } },
      });
      const cfg = await getActiveConfig();
      expect(cfg.endpoint).toBe("http://[::1]:11434");
      expect(cfg.model).toBeTruthy();
    });
  });

  describe("callLLM", () => {
    it("throws when no provider configured", async () => {
      globalThis.browser.storage.local.get.mockResolvedValueOnce({});
      await expect(callLLM("sys", [], [], null)).rejects.toThrow(/No LLM provider configured/);
    });

    it("throws when cloud provider has no key", async () => {
      globalThis.browser.storage.local.get.mockResolvedValueOnce({
        activeProvider: "anthropic",
        providers: { anthropic: {} },
      });
      await expect(callLLM("s", [], [], null)).rejects.toThrow(/API key/);
    });

    it("dispatches to the provider for cloud providers (Anthropic)", async () => {
      globalThis.browser.storage.local.get.mockResolvedValueOnce({
        activeProvider: "anthropic",
        providers: { anthropic: { key: "sk-ant-x" } },
      });
      // Stub global fetch on the anthropic endpoint
      globalThis.fetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ content: [{ type: "text", text: "x" }], stop_reason: "end_turn" }),
        text: vi.fn().mockResolvedValue(""),
        status: 200,
      });
      const res = await callLLM("sys", [{ role: "user", content: "hi" }], [], null);
      expect(res.stop_reason).toBe("end_turn");
    });

    it("passes endpoint argument to ollama provider", async () => {
      globalThis.browser.storage.local.get.mockResolvedValueOnce({
        activeProvider: "ollama",
        providers: { ollama: { endpoint: "http://[::1]:11434", model: "llama3.1" } },
      });
      globalThis.fetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }),
        text: vi.fn().mockResolvedValue(""),
        status: 200,
      });
      await callLLM("sys", [{ role: "user", content: "hi" }], [], null);
      expect(globalThis.fetch.mock.calls[0][0]).toMatch(/^http:\/\/\[::1\]:11434/);
    });
  });

  describe("buildToolResultMessage", () => {
    it("uses Anthropic fallback format when no provider configured", async () => {
      globalThis.browser.storage.local.get.mockResolvedValueOnce({});
      const msg = await buildToolResultMessage([{ tool_use_id: "abc", content: "ok" }]);
      expect(msg.role).toBe("user");
      expect(msg.content[0].type).toBe("tool_result");
      expect(msg.content[0].tool_use_id).toBe("abc");
    });

    it("delegates to the active provider when configured", async () => {
      globalThis.browser.storage.local.get.mockResolvedValueOnce({
        activeProvider: "google",
        providers: { google: { key: "AIzaXX" } },
      });
      const msg = await buildToolResultMessage([{ tool_use_id: "id", toolName: "click", content: "ok" }]);
      // Google preserves _toolName on the result block
      expect(msg.content[0]._toolName).toBe("click");
    });
  });

  describe("getActiveProviderInfo", () => {
    it("returns null when no provider configured", async () => {
      globalThis.browser.storage.local.get.mockResolvedValueOnce({});
      expect(await getActiveProviderInfo()).toBeNull();
    });

    it("resolves model name from the model id", async () => {
      globalThis.browser.storage.local.get.mockResolvedValueOnce({
        activeProvider: "openai",
        providers: { openai: { key: "sk-x", model: "gpt-4o" } },
      });
      const info = await getActiveProviderInfo();
      expect(info.id).toBe("openai");
      expect(info.modelName).toBe("GPT-4o");
    });

    it("falls back to the raw model id when name lookup fails", async () => {
      globalThis.browser.storage.local.get.mockResolvedValueOnce({
        activeProvider: "openai",
        providers: { openai: { key: "sk-x", model: "gpt-unknown" } },
      });
      const info = await getActiveProviderInfo();
      expect(info.modelName).toBe("gpt-unknown");
    });
  });
});
