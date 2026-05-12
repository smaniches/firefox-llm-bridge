import { describe, it, expect } from "vitest";
import { anthropic } from "../../background/providers/anthropic.js";
import { fetchResponse } from "../setup.js";

describe("anthropic provider", () => {
  describe("metadata", () => {
    it("exposes id, name, requiresKey, endpoint, models", () => {
      expect(anthropic.id).toBe("anthropic");
      expect(anthropic.name).toBe("Anthropic Claude");
      expect(anthropic.requiresKey).toBe(true);
      expect(anthropic.endpoint).toMatch(/^https:\/\/api\.anthropic\.com/);
      expect(anthropic.models.length).toBeGreaterThan(0);
      expect(anthropic.models.find((m) => m.default)).toBeDefined();
    });
  });

  describe("validateKey", () => {
    it("accepts a properly formed key", () => {
      expect(anthropic.validateKey("sk-ant-api03-" + "x".repeat(30))).toBe(true);
    });

    it("rejects a key missing the prefix", () => {
      expect(anthropic.validateKey("sk-xxxxxxxxxxxxxxxxxxxxx")).toBe(false);
    });

    it("rejects a too-short key", () => {
      expect(anthropic.validateKey("sk-ant-")).toBe(false);
    });

    it("rejects a non-string", () => {
      expect(anthropic.validateKey(null)).toBe(false);
      expect(anthropic.validateKey(undefined)).toBe(false);
      expect(anthropic.validateKey(123)).toBe(false);
    });
  });

  describe("formatTools", () => {
    it("returns empty array for empty input", () => {
      expect(anthropic.formatTools([])).toEqual([]);
    });

    it("preserves name, description, and input_schema", () => {
      const tools = [
        {
          name: "click",
          description: "Click an element",
          input_schema: { type: "object", properties: { selector: { type: "string" } } },
        },
      ];
      const out = anthropic.formatTools(tools);
      expect(out).toHaveLength(1);
      expect(out[0].name).toBe("click");
      expect(out[0].description).toBe("Click an element");
      expect(out[0].input_schema).toEqual(tools[0].input_schema);
    });
  });

  describe("formatMessages", () => {
    it("passes plain user/assistant strings through unchanged", () => {
      const messages = [
        { role: "user", content: "hello" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "hi" },
            { type: "tool_use", id: "1", name: "x", input: {} },
          ],
        },
      ];
      const out = anthropic.formatMessages(messages);
      expect(out).toHaveLength(2);
      expect(out[0]).toEqual(messages[0]);
      expect(out[1].content).toEqual(messages[1].content);
    });

    it("translates image blocks to Anthropic source format", () => {
      const out = anthropic.formatMessages([
        {
          role: "user",
          content: [
            { type: "image", dataUrl: "data:image/png;base64,iVBOR" },
            { type: "text", text: "what is this?" },
          ],
        },
      ]);
      expect(out[0].content[0]).toEqual({
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "iVBOR" },
      });
      expect(out[0].content[1]).toEqual({ type: "text", text: "what is this?" });
    });

    it("leaves array content without images unchanged", () => {
      const out = anthropic.formatMessages([
        { role: "user", content: [{ type: "tool_result", tool_use_id: "a", content: "ok" }] },
      ]);
      expect(out[0].content[0].type).toBe("tool_result");
    });
  });

  describe("call", () => {
    it("sends a POST with auth headers and returns normalized response (end_turn)", async () => {
      globalThis.fetch.mockResolvedValueOnce(
        fetchResponse({
          content: [{ type: "text", text: "hello" }],
          stop_reason: "end_turn",
        }),
      );

      const res = await anthropic.call(
        "sk-ant-key",
        "claude-sonnet-4-20250514",
        "sys",
        [{ role: "user", content: "hi" }],
        [],
        null,
      );

      expect(globalThis.fetch).toHaveBeenCalledOnce();
      const [url, init] = globalThis.fetch.mock.calls[0];
      expect(url).toBe(anthropic.endpoint);
      expect(init.method).toBe("POST");
      expect(init.headers["x-api-key"]).toBe("sk-ant-key");
      expect(init.headers["anthropic-version"]).toBeDefined();
      expect(init.headers["anthropic-dangerous-direct-browser-access"]).toBe("true");

      expect(res.stop_reason).toBe("end_turn");
      expect(res.content).toEqual([{ type: "text", text: "hello" }]);
    });

    it("normalizes tool_use stop_reason", async () => {
      globalThis.fetch.mockResolvedValueOnce(
        fetchResponse({
          content: [{ type: "tool_use", id: "1", name: "click", input: { selector: "#x" } }],
          stop_reason: "tool_use",
        }),
      );

      const res = await anthropic.call("k", "m", "s", [], [], null);
      expect(res.stop_reason).toBe("tool_use");
    });

    it("maps unknown stop_reason to end_turn", async () => {
      globalThis.fetch.mockResolvedValueOnce(
        fetchResponse({
          content: [{ type: "text", text: "x" }],
          stop_reason: "max_tokens",
        }),
      );

      const res = await anthropic.call("k", "m", "s", [], [], null);
      expect(res.stop_reason).toBe("end_turn");
    });

    it("throws an AuthError with provider+status on 401", async () => {
      globalThis.fetch.mockResolvedValueOnce(
        fetchResponse("invalid api key", { ok: false, status: 401 }),
      );

      await expect(anthropic.call("bad", "m", "s", [], [], null)).rejects.toMatchObject({
        name: "AuthError",
        code: "AUTH_REJECTED",
        status: 401,
        providerId: "anthropic",
      });
    });

    it("propagates the abort signal into the underlying fetch (composed)", async () => {
      globalThis.fetch.mockResolvedValueOnce(
        fetchResponse({ content: [], stop_reason: "end_turn" }),
      );
      const controller = new AbortController();
      await anthropic.call("k", "m", "s", [], [], controller.signal);
      // fetchWithRetry composes the caller signal with a per-attempt timeout,
      // so the passed signal is no longer identity-equal — but it must still
      // be an AbortSignal and fetch must have been called.
      const passedSignal = globalThis.fetch.mock.calls[0][1].signal;
      expect(passedSignal).toBeInstanceOf(AbortSignal);
    });
  });

  describe("call (streaming)", () => {
    function sseResponse(events) {
      const lines = events.map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`);
      return Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              const enc = new TextEncoder();
              for (const l of lines) controller.enqueue(enc.encode(l));
              controller.close();
            },
          }),
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        ),
      );
    }

    it("invokes onTextChunk for every text_delta and reconstructs content", async () => {
      globalThis.fetch.mockReturnValueOnce(
        sseResponse([
          {
            event: "message_start",
            data: { type: "message_start", message: { usage: { input_tokens: 10 } } },
          },
          {
            event: "content_block_start",
            data: {
              type: "content_block_start",
              index: 0,
              content_block: { type: "text", text: "" },
            },
          },
          {
            event: "content_block_delta",
            data: {
              type: "content_block_delta",
              index: 0,
              delta: { type: "text_delta", text: "Hello" },
            },
          },
          {
            event: "content_block_delta",
            data: {
              type: "content_block_delta",
              index: 0,
              delta: { type: "text_delta", text: " world" },
            },
          },
          { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
          {
            event: "message_delta",
            data: {
              type: "message_delta",
              delta: { stop_reason: "end_turn" },
              usage: { output_tokens: 5 },
            },
          },
          { event: "message_stop", data: { type: "message_stop" } },
        ]),
      );

      const chunks = [];
      const r = await anthropic.call(
        "k",
        "claude-sonnet-4-20250514",
        "s",
        [{ role: "user", content: "hi" }],
        [],
        null,
        undefined,
        (t) => chunks.push(t),
      );
      expect(chunks).toEqual(["Hello", " world"]);
      expect(r.content).toEqual([{ type: "text", text: "Hello world" }]);
      expect(r.stop_reason).toBe("end_turn");
      expect(r.usage).toEqual({
        promptTokens: 10,
        completionTokens: 5,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      });
    });

    it("rebuilds a streamed tool_use block from input_json_delta chunks", async () => {
      globalThis.fetch.mockReturnValueOnce(
        sseResponse([
          {
            event: "content_block_start",
            data: {
              type: "content_block_start",
              index: 0,
              content_block: { type: "tool_use", id: "tu_1", name: "click", input: {} },
            },
          },
          {
            event: "content_block_delta",
            data: {
              type: "content_block_delta",
              index: 0,
              delta: { type: "input_json_delta", partial_json: '{"sel' },
            },
          },
          {
            event: "content_block_delta",
            data: {
              type: "content_block_delta",
              index: 0,
              delta: { type: "input_json_delta", partial_json: 'ector":"#x"}' },
            },
          },
          { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
          {
            event: "message_delta",
            data: { type: "message_delta", delta: { stop_reason: "tool_use" } },
          },
        ]),
      );

      const r = await anthropic.call("k", "m", "s", [], [], null, undefined, () => {});
      expect(r.content[0]).toEqual({
        type: "tool_use",
        id: "tu_1",
        name: "click",
        input: { selector: "#x" },
      });
      expect(r.stop_reason).toBe("tool_use");
    });

    it("recovers from a malformed tool_use JSON buffer", async () => {
      globalThis.fetch.mockReturnValueOnce(
        sseResponse([
          {
            event: "content_block_start",
            data: {
              type: "content_block_start",
              index: 0,
              content_block: { type: "tool_use", id: "x", name: "y", input: {} },
            },
          },
          {
            event: "content_block_delta",
            data: {
              type: "content_block_delta",
              index: 0,
              delta: { type: "input_json_delta", partial_json: "not json" },
            },
          },
          { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
        ]),
      );
      const r = await anthropic.call("k", "m", "s", [], [], null, undefined, () => {});
      expect(r.content[0].input).toEqual({});
    });

    it("silently skips SSE events whose data is not parseable JSON", async () => {
      // Build a raw SSE response with one event whose `data` is not JSON,
      // then a valid event after it. Only the second should affect output.
      const enc = new TextEncoder();
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(enc.encode("data: not-json\n\n"));
          controller.enqueue(
            enc.encode(
              'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
            ),
          );
          controller.enqueue(
            enc.encode(
              'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}\n\n',
            ),
          );
          controller.close();
        },
      });
      globalThis.fetch.mockResolvedValueOnce(
        new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
      );
      const r = await anthropic.call("k", "m", "s", [], [], null, undefined, () => {});
      expect(r.content[0]).toEqual({ type: "text", text: "ok" });
    });

    it("silently skips non-JSON SSE data and unknown event types", async () => {
      globalThis.fetch.mockReturnValueOnce(
        sseResponse([
          { event: "message", data: "[DONE]" },
          { event: "ping", data: { type: "ping" } },
          {
            event: "content_block_delta",
            data: {
              type: "content_block_delta",
              index: 0,
              delta: { type: "text_delta", text: "x" },
            },
          },
        ]),
      );
      const r = await anthropic.call("k", "m", "s", [], [], null, undefined, () => {});
      // delta arrived but its block_start was missing — block is undefined,
      // accumulator quietly skips. Result has no content.
      expect(r.content).toEqual([]);
    });

    it("ignores [DONE] sentinels in SSE data", async () => {
      // Build raw SSE to send `data: [DONE]` literally (not JSON-quoted)
      const enc = new TextEncoder();
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(enc.encode("data: [DONE]\n\n"));
          controller.enqueue(
            enc.encode(
              'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
            ),
          );
          controller.enqueue(
            enc.encode(
              'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}\n\n',
            ),
          );
          controller.close();
        },
      });
      globalThis.fetch.mockResolvedValueOnce(
        new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
      );
      const r = await anthropic.call("k", "m", "s", [], [], null, undefined, () => {});
      expect(r.content[0].text).toBe("ok");
    });

    it("handles message_start without usage and message_delta without output_tokens", async () => {
      globalThis.fetch.mockReturnValueOnce(
        sseResponse([
          { event: "message_start", data: { type: "message_start", message: {} } },
          {
            event: "message_delta",
            data: { type: "message_delta", delta: { stop_reason: "end_turn" } },
          },
        ]),
      );
      const r = await anthropic.call("k", "m", "s", [], [], null, undefined, () => {});
      expect(r.usage).toEqual({
        promptTokens: 0,
        completionTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      });
    });

    it("handles message_start with an empty usage object (input_tokens missing)", async () => {
      globalThis.fetch.mockReturnValueOnce(
        sseResponse([
          { event: "message_start", data: { type: "message_start", message: { usage: {} } } },
        ]),
      );
      const r = await anthropic.call("k", "m", "s", [], [], null, undefined, () => {});
      expect(r.usage.promptTokens).toBe(0);
    });

    it("handles message_start with no message field at all", async () => {
      globalThis.fetch.mockReturnValueOnce(
        sseResponse([{ event: "message_start", data: { type: "message_start" } }]),
      );
      const r = await anthropic.call("k", "m", "s", [], [], null, undefined, () => {});
      expect(r.usage.promptTokens).toBe(0);
    });

    it("handles message_delta with no delta field and no usage", async () => {
      globalThis.fetch.mockReturnValueOnce(
        sseResponse([{ event: "message_delta", data: { type: "message_delta" } }]),
      );
      const r = await anthropic.call("k", "m", "s", [], [], null, undefined, () => {});
      expect(r.stop_reason).toBe("end_turn");
    });

    it("input_json_delta without partial_json contributes nothing", async () => {
      globalThis.fetch.mockReturnValueOnce(
        sseResponse([
          {
            event: "content_block_start",
            data: {
              type: "content_block_start",
              index: 0,
              content_block: { type: "tool_use", id: "x", name: "y", input: {} },
            },
          },
          {
            event: "content_block_delta",
            data: { type: "content_block_delta", index: 0, delta: { type: "input_json_delta" } },
          },
          { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
        ]),
      );
      const r = await anthropic.call("k", "m", "s", [], [], null, undefined, () => {});
      expect(r.content[0].input).toEqual({});
    });

    it("propagates non-200 streaming errors as typed AuthError", async () => {
      globalThis.fetch.mockResolvedValueOnce(fetchResponse("nope", { ok: false, status: 401 }));
      await expect(
        anthropic.call("k", "m", "s", [], [], null, undefined, () => {}),
      ).rejects.toMatchObject({ code: "AUTH_REJECTED", providerId: "anthropic", status: 401 });
    });

    it("wraps network failures during streaming as NetworkError", async () => {
      globalThis.fetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      await expect(
        anthropic.call("k", "m", "s", [], [], null, undefined, () => {}),
      ).rejects.toMatchObject({ code: "NETWORK", providerId: "anthropic" });
    });

    it("propagates AbortError during streaming without wrapping", async () => {
      const err = Object.assign(new Error("aborted"), { name: "AbortError" });
      globalThis.fetch.mockRejectedValueOnce(err);
      await expect(
        anthropic.call("k", "m", "s", [], [], null, undefined, () => {}),
      ).rejects.toThrow("aborted");
    });

    it("falls back to String(e) in the NetworkError message when e has no .message", async () => {
      // Some test stubs and exotic environments throw bare strings or objects;
      // exercise the `?? e` branch in the streaming network-error wrap.
      globalThis.fetch.mockRejectedValueOnce("connection reset");
      await expect(
        anthropic.call("k", "m", "s", [], [], null, undefined, () => {}),
      ).rejects.toMatchObject({ code: "NETWORK", message: /connection reset/ });
    });
  });

  describe("call (non-streaming retries)", () => {
    it("retries a 5xx response and succeeds on retry", async () => {
      globalThis.fetch
        .mockResolvedValueOnce(fetchResponse("oops", { ok: false, status: 503 }))
        .mockResolvedValueOnce(fetchResponse({ content: [], stop_reason: "end_turn" }));
      const r = await anthropic.call("k", "m", "s", [], [], null);
      expect(r.stop_reason).toBe("end_turn");
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    it("retries 429 and honors Retry-After", async () => {
      const headers = new Headers({ "retry-after": "0" });
      const limited = {
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        headers,
        text: () => Promise.resolve("rate limited"),
        json: () => Promise.resolve({}),
      };
      globalThis.fetch
        .mockResolvedValueOnce(limited)
        .mockResolvedValueOnce(fetchResponse({ content: [], stop_reason: "end_turn" }));
      const r = await anthropic.call("k", "m", "s", [], [], null);
      expect(r.stop_reason).toBe("end_turn");
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("buildToolResultMessage", () => {
    it("wraps results in a user-role tool_result message", () => {
      const msg = anthropic.buildToolResultMessage([
        { tool_use_id: "abc", content: "ok" },
        { tool_use_id: "def", content: '{"x":1}' },
      ]);
      expect(msg.role).toBe("user");
      expect(msg.content).toHaveLength(2);
      expect(msg.content[0]).toEqual({
        type: "tool_result",
        tool_use_id: "abc",
        content: "ok",
      });
      expect(msg.content[1].tool_use_id).toBe("def");
    });
  });

  describe("prompt caching", () => {
    it("sends anthropic-beta prompt-caching-1 header", async () => {
      globalThis.fetch.mockResolvedValueOnce(
        fetchResponse({ content: [], stop_reason: "end_turn" }),
      );
      await anthropic.call("sk-ant-key", "m", "sys", [], [], null);
      const [, init] = globalThis.fetch.mock.calls[0];
      expect(init.headers["anthropic-beta"]).toBe("prompt-caching-1");
    });

    it("wraps system prompt as structured array with cache_control", async () => {
      globalThis.fetch.mockResolvedValueOnce(
        fetchResponse({ content: [], stop_reason: "end_turn" }),
      );
      await anthropic.call("sk-ant-key", "m", "Be helpful", [], [], null);
      const [, init] = globalThis.fetch.mock.calls[0];
      const body = JSON.parse(init.body);
      expect(body.system).toEqual([
        { type: "text", text: "Be helpful", cache_control: { type: "ephemeral" } },
      ]);
    });

    it("adds cache_control to the last formatted tool", () => {
      const tools = [
        { name: "click", description: "Click", input_schema: { type: "object", properties: {} } },
        { name: "type", description: "Type", input_schema: { type: "object", properties: {} } },
      ];
      const formatted = anthropic.formatTools(tools);
      expect(formatted[0].cache_control).toBeUndefined();
      expect(formatted[1].cache_control).toEqual({ type: "ephemeral" });
    });

    it("returns cache token counts in non-streaming usage", async () => {
      globalThis.fetch.mockResolvedValueOnce(
        fetchResponse({
          content: [{ type: "text", text: "hi" }],
          stop_reason: "end_turn",
          usage: {
            input_tokens: 100,
            output_tokens: 20,
            cache_creation_input_tokens: 80,
            cache_read_input_tokens: 40,
          },
        }),
      );
      const res = await anthropic.call("k", "m", "s", [], [], null);
      expect(res.usage.cacheCreationTokens).toBe(80);
      expect(res.usage.cacheReadTokens).toBe(40);
      expect(res.usage.promptTokens).toBe(100);
      expect(res.usage.completionTokens).toBe(20);
    });

    it("returns zero cache tokens when absent from non-streaming usage", async () => {
      globalThis.fetch.mockResolvedValueOnce(
        fetchResponse({
          content: [],
          stop_reason: "end_turn",
          usage: { input_tokens: 5, output_tokens: 3 },
        }),
      );
      const res = await anthropic.call("k", "m", "s", [], [], null);
      expect(res.usage.cacheCreationTokens).toBe(0);
      expect(res.usage.cacheReadTokens).toBe(0);
    });
  });

  describe("extended thinking", () => {
    it("includes thinking block and raised max_tokens when extendedThinking is true", async () => {
      globalThis.fetch.mockResolvedValueOnce(
        fetchResponse({ content: [], stop_reason: "end_turn" }),
      );
      await anthropic.call("k", "m", "s", [], [], null, undefined, undefined, {
        extendedThinking: true,
        thinkingBudget: 5000,
      });
      const [, init] = globalThis.fetch.mock.calls[0];
      const body = JSON.parse(init.body);
      expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 5000 });
      expect(body.max_tokens).toBeGreaterThanOrEqual(6000);
    });

    it("uses default thinkingBudget of 8000 when none supplied", async () => {
      globalThis.fetch.mockResolvedValueOnce(
        fetchResponse({ content: [], stop_reason: "end_turn" }),
      );
      await anthropic.call("k", "m", "s", [], [], null, undefined, undefined, {
        extendedThinking: true,
      });
      const [, init] = globalThis.fetch.mock.calls[0];
      const body = JSON.parse(init.body);
      expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 8000 });
    });

    it("does not include thinking block when extendedThinking is false/absent", async () => {
      globalThis.fetch.mockResolvedValueOnce(
        fetchResponse({ content: [], stop_reason: "end_turn" }),
      );
      await anthropic.call("k", "m", "s", [], [], null);
      const [, init] = globalThis.fetch.mock.calls[0];
      const body = JSON.parse(init.body);
      expect(body.thinking).toBeUndefined();
    });
  });

  describe("call (streaming) — thinking blocks", () => {
    function sseResponse(events) {
      const lines = events.map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`);
      return Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              const enc = new TextEncoder();
              for (const l of lines) controller.enqueue(enc.encode(l));
              controller.close();
            },
          }),
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        ),
      );
    }

    it("captures thinking blocks and does NOT forward to onTextChunk", async () => {
      globalThis.fetch.mockReturnValueOnce(
        sseResponse([
          {
            event: "content_block_start",
            data: {
              type: "content_block_start",
              index: 0,
              content_block: { type: "thinking" },
            },
          },
          {
            event: "content_block_delta",
            data: {
              type: "content_block_delta",
              index: 0,
              delta: { type: "thinking_delta", thinking: "Let me think..." },
            },
          },
          {
            event: "content_block_delta",
            data: {
              type: "content_block_delta",
              index: 0,
              delta: { type: "thinking_delta", thinking: " Done." },
            },
          },
          { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
          {
            event: "content_block_start",
            data: {
              type: "content_block_start",
              index: 1,
              content_block: { type: "text", text: "" },
            },
          },
          {
            event: "content_block_delta",
            data: {
              type: "content_block_delta",
              index: 1,
              delta: { type: "text_delta", text: "Answer" },
            },
          },
          { event: "content_block_stop", data: { type: "content_block_stop", index: 1 } },
          {
            event: "message_delta",
            data: {
              type: "message_delta",
              delta: { stop_reason: "end_turn" },
              usage: { output_tokens: 8 },
            },
          },
        ]),
      );

      const chunks = [];
      const r = await anthropic.call("k", "m", "s", [], [], null, undefined, (t) => chunks.push(t));

      // Thinking delta must NOT reach onTextChunk
      expect(chunks).toEqual(["Answer"]);

      // Thinking block IS in content array
      expect(r.content[0]).toEqual({ type: "thinking", thinking: "Let me think... Done." });
      expect(r.content[1]).toEqual({ type: "text", text: "Answer" });
    });

    it("handles thinking_delta with no thinking field gracefully", async () => {
      globalThis.fetch.mockReturnValueOnce(
        sseResponse([
          {
            event: "content_block_start",
            data: {
              type: "content_block_start",
              index: 0,
              content_block: { type: "thinking" },
            },
          },
          {
            event: "content_block_delta",
            data: {
              type: "content_block_delta",
              index: 0,
              // No `thinking` field — tests the `|| ""` fallback branch
              delta: { type: "thinking_delta" },
            },
          },
          { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
        ]),
      );
      const r = await anthropic.call("k", "m", "s", [], [], null, undefined, () => {});
      expect(r.content[0]).toEqual({ type: "thinking", thinking: "" });
    });

    it("returns cache tokens from message_start in streaming usage", async () => {
      globalThis.fetch.mockReturnValueOnce(
        sseResponse([
          {
            event: "message_start",
            data: {
              type: "message_start",
              message: {
                usage: {
                  input_tokens: 50,
                  cache_creation_input_tokens: 30,
                  cache_read_input_tokens: 20,
                },
              },
            },
          },
          {
            event: "message_delta",
            data: {
              type: "message_delta",
              delta: { stop_reason: "end_turn" },
              usage: { output_tokens: 10 },
            },
          },
        ]),
      );

      const r = await anthropic.call("k", "m", "s", [], [], null, undefined, () => {});
      expect(r.usage.promptTokens).toBe(50);
      expect(r.usage.cacheCreationTokens).toBe(30);
      expect(r.usage.cacheReadTokens).toBe(20);
      expect(r.usage.completionTokens).toBe(10);
    });
  });
});
