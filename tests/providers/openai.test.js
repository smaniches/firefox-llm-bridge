import { describe, it, expect } from "vitest";
import { openai } from "../../background/providers/openai.js";
import { fetchResponse } from "../setup.js";

describe("openai provider", () => {
  it("exposes correct metadata", () => {
    expect(openai.id).toBe("openai");
    expect(openai.requiresKey).toBe(true);
    expect(openai.endpoint).toBe("https://api.openai.com/v1/chat/completions");
    expect(openai.models.find((m) => m.default)).toBeDefined();
  });

  describe("validateKey", () => {
    it("accepts sk- prefix with sufficient length", () => {
      expect(openai.validateKey("sk-" + "x".repeat(30))).toBe(true);
    });
    it("rejects wrong prefix", () => {
      expect(openai.validateKey("xx-abc")).toBe(false);
    });
    it("rejects non-string", () => {
      expect(openai.validateKey(null)).toBe(false);
    });
  });

  describe("formatTools", () => {
    it("wraps in function envelope", () => {
      const out = openai.formatTools([
        { name: "x", description: "y", input_schema: { type: "object" } },
      ]);
      expect(out[0]).toEqual({
        type: "function",
        function: { name: "x", description: "y", parameters: { type: "object" } },
      });
    });
  });

  describe("formatMessages", () => {
    it("passes through plain user string", () => {
      expect(openai.formatMessages([{ role: "user", content: "hi" }])).toEqual([
        { role: "user", content: "hi" },
      ]);
    });

    it("stringifies non-string user content", () => {
      const out = openai.formatMessages([{ role: "user", content: { complex: true } }]);
      expect(out[0].content).toBe('{"complex":true}');
    });

    it("converts tool_result blocks to role=tool messages", () => {
      const out = openai.formatMessages([
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "abc", content: "ok" },
            { type: "tool_result", tool_use_id: "def", content: { a: 1 } },
          ],
        },
      ]);
      expect(out).toHaveLength(2);
      expect(out[0]).toEqual({ role: "tool", tool_call_id: "abc", content: "ok" });
      expect(out[1].content).toBe('{"a":1}');
    });

    it("converts assistant text + tool_use blocks", () => {
      const out = openai.formatMessages([
        {
          role: "assistant",
          content: [
            { type: "text", text: "thinking..." },
            { type: "tool_use", id: "call_1", name: "click", input: { selector: "#x" } },
          ],
        },
      ]);
      expect(out[0].role).toBe("assistant");
      expect(out[0].content).toBe("thinking...");
      expect(out[0].tool_calls).toHaveLength(1);
      expect(out[0].tool_calls[0].function.name).toBe("click");
      expect(JSON.parse(out[0].tool_calls[0].function.arguments)).toEqual({ selector: "#x" });
    });

    it("handles assistant with only text", () => {
      const out = openai.formatMessages([
        { role: "assistant", content: [{ type: "text", text: "x" }] },
      ]);
      expect(out[0]).toEqual({ role: "assistant", content: "x" });
    });

    it("handles assistant with only tool_use (null text)", () => {
      const out = openai.formatMessages([
        { role: "assistant", content: [{ type: "tool_use", id: "1", name: "x", input: {} }] },
      ]);
      expect(out[0].content).toBeNull();
      expect(out[0].tool_calls).toHaveLength(1);
    });

    it("passes assistant string content through", () => {
      const out = openai.formatMessages([{ role: "assistant", content: "plain" }]);
      expect(out[0]).toEqual({ role: "assistant", content: "plain" });
    });
  });

  describe("call", () => {
    it("includes tools when present", async () => {
      globalThis.fetch.mockResolvedValueOnce(
        fetchResponse({
          choices: [{ message: { content: "hi", tool_calls: null }, finish_reason: "stop" }],
        }),
      );
      const res = await openai.call(
        "sk-x",
        "gpt-4o",
        "sys",
        [{ role: "user", content: "hi" }],
        [{ name: "n", description: "d", input_schema: { type: "object" } }],
        null,
      );
      const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
      expect(body.tools).toBeDefined();
      expect(body.messages[0].role).toBe("system");
      expect(res.content[0]).toEqual({ type: "text", text: "hi" });
      expect(res.stop_reason).toBe("end_turn");
    });

    it("omits tools when empty", async () => {
      globalThis.fetch.mockResolvedValueOnce(
        fetchResponse({ choices: [{ message: { content: "x" }, finish_reason: "stop" }] }),
      );
      await openai.call("sk-x", "gpt-4o", "sys", [], [], null);
      const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
      expect(body.tools).toBeUndefined();
    });

    it("normalizes tool_calls into tool_use blocks", async () => {
      globalThis.fetch.mockResolvedValueOnce(
        fetchResponse({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: "c1",
                    type: "function",
                    function: { name: "click", arguments: '{"selector":"#a"}' },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        }),
      );
      const res = await openai.call("k", "m", "s", [], [], null);
      expect(res.stop_reason).toBe("tool_use");
      expect(res.content[0]).toEqual({
        type: "tool_use",
        id: "c1",
        name: "click",
        input: { selector: "#a" },
      });
    });

    it("handles tool arguments that fail JSON.parse", async () => {
      globalThis.fetch.mockResolvedValueOnce(
        fetchResponse({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  { id: "c1", type: "function", function: { name: "x", arguments: "not json" } },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        }),
      );
      const res = await openai.call("k", "m", "s", [], [], null);
      expect(res.content[0].input).toEqual({});
    });

    it("throws on non-200", async () => {
      globalThis.fetch.mockResolvedValueOnce(fetchResponse("err", { ok: false, status: 500 }));
      await expect(openai.call("k", "m", "s", [], [], null)).rejects.toThrow(/OpenAI API 500/);
    });

    it("throws when no choices are returned", async () => {
      globalThis.fetch.mockResolvedValueOnce(fetchResponse({ choices: [] }));
      await expect(openai.call("k", "m", "s", [], [], null)).rejects.toThrow(/no choices/);
    });
  });

  describe("buildToolResultMessage", () => {
    it("stringifies non-string content", () => {
      const msg = openai.buildToolResultMessage([{ tool_use_id: "a", content: { x: 1 } }]);
      expect(msg.content[0].content).toBe('{"x":1}');
    });

    it("preserves string content", () => {
      const msg = openai.buildToolResultMessage([{ tool_use_id: "a", content: "ok" }]);
      expect(msg.content[0].content).toBe("ok");
    });
  });
});
