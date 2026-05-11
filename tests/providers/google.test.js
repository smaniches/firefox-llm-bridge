import { describe, it, expect } from "vitest";
import { google } from "../../background/providers/google.js";
import { fetchResponse } from "../setup.js";

describe("google provider", () => {
  it("exposes correct metadata", () => {
    expect(google.id).toBe("google");
    expect(google.requiresKey).toBe(true);
    expect(google.endpoint).toMatch(/generativelanguage\.googleapis\.com/);
  });

  describe("validateKey", () => {
    it("accepts AIza prefix", () => {
      expect(google.validateKey("AIza" + "x".repeat(30))).toBe(true);
    });
    it("rejects wrong prefix", () => {
      expect(google.validateKey("sk-xxx")).toBe(false);
    });
    it("rejects non-string", () => {
      expect(google.validateKey(null)).toBe(false);
    });
  });

  describe("_convertSchema", () => {
    it("returns empty object for null/undefined", () => {
      expect(google._convertSchema(null)).toEqual({});
      expect(google._convertSchema(undefined)).toEqual({});
    });

    it("uppercases the type", () => {
      expect(google._convertSchema({ type: "object" })).toEqual({ type: "OBJECT" });
    });

    it("preserves description, enum, required", () => {
      const r = google._convertSchema({
        type: "string",
        description: "d",
        enum: ["a", "b"],
        required: ["x"],
      });
      expect(r.description).toBe("d");
      expect(r.enum).toEqual(["a", "b"]);
      expect(r.required).toEqual(["x"]);
    });

    it("recurses into properties and items", () => {
      const r = google._convertSchema({
        type: "object",
        properties: {
          name: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
        },
      });
      expect(r.properties.name.type).toBe("STRING");
      expect(r.properties.tags.type).toBe("ARRAY");
      expect(r.properties.tags.items.type).toBe("STRING");
    });
  });

  describe("formatTools", () => {
    it("wraps in functionDeclarations with UPPERCASE types", () => {
      const out = google.formatTools([
        {
          name: "click",
          description: "Click",
          input_schema: { type: "object", properties: { sel: { type: "string" } } },
        },
      ]);
      expect(out[0].functionDeclarations[0].name).toBe("click");
      expect(out[0].functionDeclarations[0].parameters.type).toBe("OBJECT");
      expect(out[0].functionDeclarations[0].parameters.properties.sel.type).toBe("STRING");
    });
  });

  describe("formatMessages", () => {
    it("converts plain user message to user/parts/text", () => {
      const out = google.formatMessages([{ role: "user", content: "hi" }]);
      expect(out[0]).toEqual({ role: "user", parts: [{ text: "hi" }] });
    });

    it("stringifies non-string user content", () => {
      const out = google.formatMessages([{ role: "user", content: { x: 1 } }]);
      expect(out[0].parts[0].text).toBe('{"x":1}');
    });

    it("converts tool_result to functionResponse parts", () => {
      const out = google.formatMessages([
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "id1", _toolName: "click", content: "ok" }],
        },
      ]);
      expect(out[0].parts[0].functionResponse.name).toBe("click");
      expect(out[0].parts[0].functionResponse.response.result).toBe("ok");
    });

    it("falls back to 'unknown' tool name when _toolName missing", () => {
      const out = google.formatMessages([
        { role: "user", content: [{ type: "tool_result", tool_use_id: "id", content: "x" }] },
      ]);
      expect(out[0].parts[0].functionResponse.name).toBe("unknown");
    });

    it("stringifies non-string tool_result content", () => {
      const out = google.formatMessages([
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "id", _toolName: "x", content: { a: 1 } }],
        },
      ]);
      expect(out[0].parts[0].functionResponse.response.result).toBe('{"a":1}');
    });

    it("converts assistant blocks to model/parts", () => {
      const out = google.formatMessages([
        {
          role: "assistant",
          content: [
            { type: "text", text: "hello" },
            { type: "tool_use", id: "1", name: "click", input: { x: 1 } },
          ],
        },
      ]);
      expect(out[0].role).toBe("model");
      expect(out[0].parts).toEqual([
        { text: "hello" },
        { functionCall: { name: "click", args: { x: 1 } } },
      ]);
    });

    it("skips assistant message with no usable parts", () => {
      const out = google.formatMessages([{ role: "assistant", content: [] }]);
      expect(out).toEqual([]);
    });

    it("handles assistant with string content", () => {
      const out = google.formatMessages([{ role: "assistant", content: "plain" }]);
      expect(out[0]).toEqual({ role: "model", parts: [{ text: "plain" }] });
    });

    it("skips text blocks with empty text", () => {
      const out = google.formatMessages([
        {
          role: "assistant",
          content: [
            { type: "text", text: "" },
            { type: "tool_use", id: "1", name: "x", input: {} },
          ],
        },
      ]);
      expect(out[0].parts).toHaveLength(1);
      expect(out[0].parts[0].functionCall).toBeDefined();
    });
  });

  describe("call", () => {
    it("uses x-goog-api-key header (not URL query) and returns text response", async () => {
      globalThis.fetch.mockResolvedValueOnce(
        fetchResponse({ candidates: [{ content: { parts: [{ text: "hello" }] } }] }),
      );
      const res = await google.call(
        "AIzaKey",
        "gemini-2.5-flash",
        "sys",
        [{ role: "user", content: "hi" }],
        [],
        null,
      );

      const [url, init] = globalThis.fetch.mock.calls[0];
      expect(url).not.toMatch(/[?&]key=/);
      expect(init.headers["x-goog-api-key"]).toBe("AIzaKey");
      expect(res.content[0]).toEqual({ type: "text", text: "hello" });
      expect(res.stop_reason).toBe("end_turn");
    });

    it("includes tools when provided", async () => {
      globalThis.fetch.mockResolvedValueOnce(
        fetchResponse({ candidates: [{ content: { parts: [{ text: "x" }] } }] }),
      );
      await google.call(
        "k",
        "m",
        "s",
        [],
        [{ name: "n", description: "d", input_schema: { type: "object" } }],
        null,
      );
      const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
      expect(body.tools).toBeDefined();
    });

    it("normalizes functionCall to tool_use", async () => {
      globalThis.fetch.mockResolvedValueOnce(
        fetchResponse({
          candidates: [
            {
              content: {
                parts: [
                  { text: "thinking" },
                  { functionCall: { name: "click", args: { sel: "#x" } } },
                ],
              },
            },
          ],
        }),
      );
      const res = await google.call("k", "m", "s", [], [], null);
      expect(res.stop_reason).toBe("tool_use");
      expect(res.content).toHaveLength(2);
      expect(res.content[1].type).toBe("tool_use");
      expect(res.content[1].name).toBe("click");
      expect(res.content[1].input).toEqual({ sel: "#x" });
    });

    it("handles functionCall with missing args", async () => {
      globalThis.fetch.mockResolvedValueOnce(
        fetchResponse({
          candidates: [{ content: { parts: [{ functionCall: { name: "x" } }] } }],
        }),
      );
      const res = await google.call("k", "m", "s", [], [], null);
      expect(res.content[0].input).toEqual({});
    });

    it("throws on non-200", async () => {
      globalThis.fetch.mockResolvedValueOnce(fetchResponse("bad", { ok: false, status: 400 }));
      await expect(google.call("k", "m", "s", [], [], null)).rejects.toThrow(/Gemini API 400/);
    });

    it("throws when no candidates", async () => {
      globalThis.fetch.mockResolvedValueOnce(fetchResponse({ candidates: [] }));
      await expect(google.call("k", "m", "s", [], [], null)).rejects.toThrow(/no content/);
    });

    it("throws when candidate has no parts", async () => {
      globalThis.fetch.mockResolvedValueOnce(fetchResponse({ candidates: [{ content: {} }] }));
      await expect(google.call("k", "m", "s", [], [], null)).rejects.toThrow(/no content/);
    });
  });

  describe("buildToolResultMessage", () => {
    it("includes _toolName for Gemini conversion", () => {
      const msg = google.buildToolResultMessage([
        { tool_use_id: "id", toolName: "click", content: "ok" },
      ]);
      expect(msg.content[0]._toolName).toBe("click");
    });

    it("stringifies non-string content", () => {
      const msg = google.buildToolResultMessage([
        { tool_use_id: "id", toolName: "x", content: { a: 1 } },
      ]);
      expect(msg.content[0].content).toBe('{"a":1}');
    });
  });
});
