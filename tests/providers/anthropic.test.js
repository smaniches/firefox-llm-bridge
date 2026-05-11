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
    it("returns messages unchanged (canonical format)", () => {
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
      expect(anthropic.formatMessages(messages)).toBe(messages);
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

    it("throws on non-200 with status and body excerpt", async () => {
      globalThis.fetch.mockResolvedValueOnce(
        fetchResponse("invalid api key", { ok: false, status: 401 }),
      );

      await expect(anthropic.call("bad", "m", "s", [], [], null)).rejects.toThrow(
        /Anthropic API 401/,
      );
    });

    it("propagates abort signal", async () => {
      globalThis.fetch.mockResolvedValueOnce(
        fetchResponse({ content: [], stop_reason: "end_turn" }),
      );
      const controller = new AbortController();
      await anthropic.call("k", "m", "s", [], [], controller.signal);
      expect(globalThis.fetch.mock.calls[0][1].signal).toBe(controller.signal);
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
});
