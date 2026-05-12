import { describe, it, expect } from "vitest";
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
      globalThis.fetch.mockResolvedValueOnce(fetchResponse({ models: [{ name: "x" }] }));
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
      const out = ollama.formatTools([
        { name: "x", description: "y", input_schema: { type: "object" } },
      ]);
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

    it("formatMessages converts image+text array to multi-part parts", () => {
      const out = ollama.formatMessages([
        {
          role: "user",
          content: [
            { type: "image", dataUrl: "data:image/png;base64,xxx" },
            { type: "text", text: "what?" },
          ],
        },
      ]);
      expect(out[0].content).toEqual([
        { type: "image_url", image_url: { url: "data:image/png;base64,xxx" } },
        { type: "text", text: "what?" },
      ]);
    });

    it("formatMessages drops unknown blocks from user array", () => {
      const out = ollama.formatMessages([
        {
          role: "user",
          content: [{ type: "image" }, { type: "weird" }, { type: "text", text: "ok" }],
        },
      ]);
      expect(out[0].content).toEqual([{ type: "text", text: "ok" }]);
    });
  });

  describe("call", () => {
    it("calls OpenAI-compatible endpoint, normalizes response", async () => {
      globalThis.fetch.mockResolvedValueOnce(
        fetchResponse({
          choices: [{ message: { content: "hi" }, finish_reason: "stop" }],
        }),
      );
      const res = await ollama.call(
        null,
        "llama3.1",
        "sys",
        [{ role: "user", content: "hi" }],
        [],
        null,
      );
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
      await ollama.call(
        null,
        "m",
        "s",
        [],
        [{ name: "n", description: "d", input_schema: { type: "object" } }],
        null,
      );
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

    it("throws helpful 'Cannot connect to Ollama' on persistent network failure", async () => {
      // fetchWithRetry retries 3× on transient network errors before giving up.
      globalThis.fetch
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockRejectedValueOnce(new TypeError("Failed to fetch"));
      await expect(ollama.call(null, "m", "s", [], [], null)).rejects.toThrow(
        /Cannot connect to Ollama/,
      );
    }, 30000);

    it("preserves the typed NetworkError as `.cause` on the helpful message", async () => {
      globalThis.fetch
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockRejectedValueOnce(new TypeError("Failed to fetch"));
      try {
        await ollama.call(null, "m", "s", [], [], null);
        throw new Error("should have thrown");
      } catch (e) {
        expect(e.cause?.code).toBe("NETWORK");
        expect(e.cause?.providerId).toBe("ollama");
      }
    }, 30000);

    it("propagates AbortError when the caller signal aborts mid-call", async () => {
      const controller = new AbortController();
      const abortErr = Object.assign(new Error("aborted"), { name: "AbortError" });
      globalThis.fetch.mockImplementationOnce(() => {
        controller.abort();
        return Promise.reject(abortErr);
      });
      // fetchWithRetry prefers `callerSignal.reason` (a DOMException in modern
      // engines) over the originally-thrown error, but either way it must be
      // an AbortError that the agent loop can recognise to skip wrapping.
      await expect(ollama.call(null, "m", "s", [], [], controller.signal)).rejects.toMatchObject({
        name: "AbortError",
      });
    });

    it("throws typed ProviderError on non-2xx (non-retryable 4xx)", async () => {
      globalThis.fetch.mockResolvedValueOnce(
        fetchResponse("model not found", { ok: false, status: 404 }),
      );
      await expect(ollama.call(null, "m", "s", [], [], null)).rejects.toMatchObject({
        code: "PROVIDER_404",
        providerId: "ollama",
        status: 404,
      });
    });

    it("throws when no choices", async () => {
      globalThis.fetch.mockResolvedValueOnce(fetchResponse({ choices: [] }));
      await expect(ollama.call(null, "m", "s", [], [], null)).rejects.toThrow(/no choices/);
    });
  });

  describe("call (streaming, NDJSON, sovereign path)", () => {
    function ndjsonResponse(values) {
      const lines = values.map((v) => JSON.stringify(v) + "\n");
      return Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              const enc = new TextEncoder();
              for (const l of lines) controller.enqueue(enc.encode(l));
              controller.close();
            },
          }),
          { status: 200, headers: { "Content-Type": "application/x-ndjson" } },
        ),
      );
    }

    it("streams text deltas across line-delimited chunks", async () => {
      globalThis.fetch.mockReturnValueOnce(
        ndjsonResponse([
          { choices: [{ delta: { content: "Hel" } }] },
          { choices: [{ delta: { content: "lo" } }] },
          { choices: [{ delta: {}, finish_reason: "stop" }] },
        ]),
      );

      const chunks = [];
      const r = await ollama.call(
        null,
        "llama3.1",
        "sys",
        [{ role: "user", content: "hi" }],
        [],
        null,
        undefined,
        (t) => chunks.push(t),
      );
      expect(chunks).toEqual(["Hel", "lo"]);
      expect(r.content[0]).toEqual({ type: "text", text: "Hello" });
      expect(r.stop_reason).toBe("end_turn");
    });

    it("reconstructs a streamed tool_call from delta fragments", async () => {
      globalThis.fetch.mockReturnValueOnce(
        ndjsonResponse([
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    { index: 0, id: "c1", function: { name: "click", arguments: '{"sel' } },
                  ],
                },
              },
            ],
          },
          {
            choices: [
              {
                delta: {
                  tool_calls: [{ index: 0, function: { arguments: '":"#x"}' } }],
                },
                finish_reason: "tool_calls",
              },
            ],
          },
        ]),
      );
      const r = await ollama.call(null, "m", "s", [], [], null, undefined, () => {});
      expect(r.stop_reason).toBe("tool_use");
      expect(r.content[0]).toEqual({
        type: "tool_use",
        id: "c1",
        name: "click",
        input: { sel: "#x" },
      });
    });

    it("emits empty input when streamed tool args fail to parse", async () => {
      globalThis.fetch.mockReturnValueOnce(
        ndjsonResponse([
          {
            choices: [
              {
                delta: {
                  tool_calls: [{ index: 0, id: "x", function: { name: "n", arguments: "nope" } }],
                },
              },
            ],
          },
        ]),
      );
      const r = await ollama.call(null, "m", "s", [], [], null, undefined, () => {});
      expect(r.content[0].input).toEqual({});
    });

    it("captures usage when present in the final chunk", async () => {
      globalThis.fetch.mockReturnValueOnce(
        ndjsonResponse([
          { choices: [{ delta: { content: "ok" } }] },
          {
            usage: { prompt_tokens: 3, completion_tokens: 4 },
            choices: [{ delta: {}, finish_reason: "stop" }],
          },
        ]),
      );
      const r = await ollama.call(null, "m", "s", [], [], null, undefined, () => {});
      expect(r.usage).toEqual({ promptTokens: 3, completionTokens: 4 });
    });

    it("tolerates a choice without a delta object", async () => {
      globalThis.fetch.mockReturnValueOnce(
        ndjsonResponse([{ choices: [{ finish_reason: "stop" }] }]),
      );
      const r = await ollama.call(null, "m", "s", [], [], null, undefined, () => {});
      expect(r.content).toEqual([]);
    });

    it("skips lines without choices and tolerates an empty tool_call without index", async () => {
      globalThis.fetch.mockReturnValueOnce(
        ndjsonResponse([
          { not: "a chat chunk" },
          {
            choices: [
              {
                delta: {
                  tool_calls: [{ function: { name: "x", arguments: "" } }],
                },
              },
            ],
          },
        ]),
      );
      const r = await ollama.call(null, "m", "s", [], [], null, undefined, () => {});
      expect(r.content[0]).toMatchObject({ type: "tool_use", name: "x", input: {} });
    });

    it("surfaces the helpful 'Cannot connect to Ollama' message on streaming network failure", async () => {
      globalThis.fetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      await expect(ollama.call(null, "m", "s", [], [], null, undefined, () => {})).rejects.toThrow(
        /Cannot connect to Ollama/,
      );
    });

    it("propagates streaming AbortError without wrapping", async () => {
      const err = Object.assign(new Error("aborted"), { name: "AbortError" });
      globalThis.fetch.mockRejectedValueOnce(err);
      await expect(ollama.call(null, "m", "s", [], [], null, undefined, () => {})).rejects.toBe(
        err,
      );
    });

    it("throws a typed ProviderError on a streaming non-2xx response", async () => {
      globalThis.fetch.mockResolvedValueOnce(
        fetchResponse("not found", { ok: false, status: 404 }),
      );
      await expect(
        ollama.call(null, "m", "s", [], [], null, undefined, () => {}),
      ).rejects.toMatchObject({ code: "PROVIDER_404", providerId: "ollama", status: 404 });
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
