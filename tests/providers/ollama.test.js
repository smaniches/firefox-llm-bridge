import { describe, it, expect, vi } from "vitest";
import { ollama } from "../../background/providers/ollama.js";
import { fetchResponse } from "../setup.js";

describe("ollama provider", () => {
  it("exposes correct metadata", () => {
    expect(ollama.id).toBe("ollama");
    expect(ollama.requiresKey).toBe(false);
    expect(ollama.defaultEndpoint).toBe("http://localhost:11434");
  });

  describe("validateKey", () => {
    it("always returns true (no key needed)", () => {
      expect(ollama.validateKey()).toBe(true);
      expect(ollama.validateKey("anything")).toBe(true);
    });
  });

  describe("detectModels", () => {
    it("returns models with formatted size labels (GB)", async () => {
      globalThis.fetch.mockResolvedValueOnce(
        fetchResponse({
          models: [
            { name: "llama3.1:8b", size: 5 * 1024 * 1024 * 1024 },
            { name: "qwen2.5:7b", size: 100 * 1024 * 1024 },
          ],
        }),
      );
      const list = await ollama.detectModels();
      expect(list).toHaveLength(2);
      expect(list[0]).toEqual({ id: "llama3.1:8b", name: "llama3.1:8b (5.0GB)", default: false });
      expect(list[1].name).toMatch(/100MB/);
    });

    it("formats unknown size as '?'", async () => {
      globalThis.fetch.mockResolvedValueOnce(
        fetchResponse({ models: [{ name: "x" }] }),
      );
      const list = await ollama.detectModels();
      expect(list[0].name).toMatch(/\?\)/);
    });

    it("returns empty array on non-ok response", async () => {
      globalThis.fetch.mockResolvedValueOnce(fetchResponse("err", { ok: false, status: 500 }));
      expect(await ollama.detectModels()).toEqual([]);
    });

    it("returns empty array when no models", async () => {
      globalThis.fetch.mockResolvedValueOnce(fetchResponse({ models: [] }));
      expect(await ollama.detectModels()).toEqual([]);
    });

    it("returns empty array when models field missing", async () => {
      globalThis.fetch.mockResolvedValueOnce(fetchResponse({}));
      expect(await ollama.detectModels()).toEqual([]);
    });

    it("returns empty array when fetch throws", async () => {
      globalThis.fetch.mockRejectedValueOnce(new Error("network"));
      expect(await ollama.detectModels()).toEqual([]);
    });

    it("uses custom endpoint when provided", async () => {
      globalThis.fetch.mockResolvedValueOnce(fetchResponse({ models: [] }));
      await ollama.detectModels("http://[::1]:11434");
      expect(globalThis.fetch.mock.calls[0][0]).toMatch(/^http:\/\/\[::1\]/);
    });
  });

  describe("checkConnection", () => {
    it("returns true when /api/tags responds 200", async () => {
      globalThis.fetch.mockResolvedValueOnce(fetchResponse({}));
      expect(await ollama.checkConnection()).toBe(true);
    });

    it("returns false on non-ok", async () => {
      globalThis.fetch.mockResolvedValueOnce(fetchResponse("err", { ok: false, status: 500 }));
      expect(await ollama.checkConnection()).toBe(false);
    });

    it("returns false on fetch throw", async () => {
      globalThis.fetch.mockRejectedValueOnce(new Error("net"));
      expect(await ollama.checkConnection()).toBe(false);
    });

    it("uses provided endpoint", async () => {
      globalThis.fetch.mockResolvedValueOnce(fetchResponse({}));
      await ollama.checkConnection("http://custom:9999");
      expect(globalThis.fetch.mock.calls[0][0]).toMatch(/custom:9999/);
    });
  });

  describe("formatTools / formatMessages", () => {
    it("formatTools wraps in function envelope", () => {
      const out = ollama.formatTools([{ name: "x", description: "y", input_schema: { type: "object" } }]);
      expect(out[0].function.name).toBe("x");
    });

    it("formatMessages handles user string", () => {
      expect(ollama.formatMessages([{ role: "user", content: "hi" }])).toEqual([
        { role: "user", content: "hi" },
      ]);
    });

    it("formatMessages stringifies non-string user content", () => {
      const out = ollama.formatMessages([{ role: "user", content: { a: 1 } }]);
      expect(out[0].content).toBe('{"a":1}');
    });

    it("formatMessages converts tool_result to role=tool", () => {
      const out = ollama.formatMessages([
        { role: "user", content: [{ type: "tool_result", tool_use_id: "i", content: "ok" }] },
      ]);
      expect(out[0].role).toBe("tool");
      expect(out[0].tool_call_id).toBe("i");
    });

    it("formatMessages stringifies non-string tool_result content", () => {
      const out = ollama.formatMessages([
        { role: "user", content: [{ type: "tool_result", tool_use_id: "i", content: { a: 1 } }] },
      ]);
      expect(out[0].content).toBe('{"a":1}');
    });

    it("formatMessages handles assistant text + tool_use", () => {
      const out = ollama.formatMessages([
        {
          role: "assistant",
          content: [
            { type: "text", text: "hi" },
            { type: "tool_use", id: "1", name: "x", input: { a: 1 } },
          ],
        },
      ]);
      expect(out[0].tool_calls[0].function.name).toBe("x");
    });

    it("formatMessages handles assistant string", () => {
      const out = ollama.formatMessages([{ role: "assistant", content: "plain" }]);
      expect(out[0]).toEqual({ role: "assistant", content: "plain" });
    });

    it("formatMessages assigns null content when no text", () => {
      const out = ollama.formatMessages([
        { role: "assistant", content: [{ type: "tool_use", id: "1", name: "x", input: {} }] },
      ]);
      expect(out[0].content).toBeNull();
    });
  });

  describe("call", () => {
    it("calls OpenAI-compatible endpoint, normalizes response", async () => {
      globalThis.fetch.mockResolvedValueOnce(
        fetchResponse({
          choices: [{ message: { content: "hi" }, finish_reason: "stop" }],
        }),
      );
      const res = await ollama.call(null, "llama3.1", "sys", [{ role: "user", content: "hi" }], [], null);
      expect(globalThis.fetch.mock.calls[0][0]).toMatch(/\/v1\/chat\/completions$/);
      expect(res.content[0]).toEqual({ type: "text", text: "hi" });
      expect(res.stop_reason).toBe("end_turn");
    });

    it("uses custom endpoint when provided", async () => {
      globalThis.fetch.mockResolvedValueOnce(
        fetchResponse({ choices: [{ message: { content: "x" }, finish_reason: "stop" }] }),
      );
      await ollama.call(null, "m", "s", [], [], null, "http://[::1]:11434");
      expect(globalThis.fetch.mock.calls[0][0]).toBe("http://[::1]:11434/v1/chat/completions");
    });

    it("includes tools when provided", async () => {
      globalThis.fetch.mockResolvedValueOnce(
        fetchResponse({ choices: [{ message: { content: "x" }, finish_reason: "stop" }] }),
      );
      await ollama.call(null, "m", "s", [], [{ name: "n", description: "d", input_schema: { type: "object" } }], null);
      const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
      expect(body.tools).toBeDefined();
    });

    it("normalizes tool_calls with string arguments", async () => {
      globalThis.fetch.mockResolvedValueOnce(
        fetchResponse({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [{ id: "c1", function: { name: "click", arguments: '{"sel":"#x"}' } }],
              },
              finish_reason: "tool_calls",
            },
          ],
        }),
      );
      const res = await ollama.call(null, "m", "s", [], [], null);
      expect(res.stop_reason).toBe("tool_use");
      expect(res.content[0].input).toEqual({ sel: "#x" });
    });

    it("normalizes tool_calls with object arguments", async () => {
      globalThis.fetch.mockResolvedValueOnce(
        fetchResponse({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [{ id: "c1", function: { name: "click", arguments: { sel: "#x" } } }],
              },
              finish_reason: "tool_calls",
            },
          ],
        }),
      );
      const res = await ollama.call(null, "m", "s", [], [], null);
      expect(res.content[0].input).toEqual({ sel: "#x" });
    });

    it("falls back to empty input on JSON.parse failure", async () => {
      globalThis.fetch.mockResolvedValueOnce(
        fetchResponse({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [{ id: "c1", function: { name: "x", arguments: "not-json" } }],
              },
              finish_reason: "tool_calls",
            },
          ],
        }),
      );
      const res = await ollama.call(null, "m", "s", [], [], null);
      expect(res.content[0].input).toEqual({});
    });

    it("assigns generated id when tc.id missing", async () => {
      globalThis.fetch.mockResolvedValueOnce(
        fetchResponse({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [{ function: { name: "x", arguments: "{}" } }],
              },
              finish_reason: "tool_calls",
            },
          ],
        }),
      );
      const res = await ollama.call(null, "m", "s", [], [], null);
      expect(res.content[0].id).toMatch(/^ollama-/);
    });

    it("throws helpful message on network failure (with url)", async () => {
      globalThis.fetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      await expect(ollama.call(null, "m", "s", [], [], null)).rejects.toThrow(/Cannot connect to Ollama/);
    });

    it("propagates AbortError without wrapping", async () => {
      const abortErr = Object.assign(new Error("aborted"), { name: "AbortError" });
      globalThis.fetch.mockRejectedValueOnce(abortErr);
      await expect(ollama.call(null, "m", "s", [], [], null)).rejects.toBe(abortErr);
    });

    it("throws on non-200", async () => {
      globalThis.fetch.mockResolvedValueOnce(fetchResponse("model not found", { ok: false, status: 404 }));
      await expect(ollama.call(null, "m", "s", [], [], null)).rejects.toThrow(/Ollama 404/);
    });

    it("throws when no choices", async () => {
      globalThis.fetch.mockResolvedValueOnce(fetchResponse({ choices: [] }));
      await expect(ollama.call(null, "m", "s", [], [], null)).rejects.toThrow(/no choices/);
    });
  });

  describe("buildToolResultMessage", () => {
    it("stringifies non-string content", () => {
      const msg = ollama.buildToolResultMessage([{ tool_use_id: "i", content: { a: 1 } }]);
      expect(msg.content[0].content).toBe('{"a":1}');
    });
    it("preserves string content", () => {
      const msg = ollama.buildToolResultMessage([{ tool_use_id: "i", content: "ok" }]);
      expect(msg.content[0].content).toBe("ok");
    });
  });
});
