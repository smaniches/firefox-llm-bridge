import { describe, it, expect } from "vitest";
import { PRICING, computeCost, formatCost, normalizeUsage } from "../../background/lib/pricing.js";

describe("PRICING", () => {
  it("is frozen", () => {
    expect(Object.isFrozen(PRICING)).toBe(true);
  });

  it("covers every cloud model exposed by the extension", () => {
    for (const id of [
      "claude-sonnet-4-20250514",
      "claude-opus-4-20250514",
      "claude-haiku-4-5-20251001",
      "gpt-4o",
      "gpt-4o-mini",
      "o1",
      "o3-mini",
      "gemini-2.5-flash",
      "gemini-2.5-pro",
      "gemini-2.0-flash",
    ]) {
      expect(PRICING[id]).toBeDefined();
      expect(PRICING[id].inputPerMTok).toBeGreaterThanOrEqual(0);
      expect(PRICING[id].outputPerMTok).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("computeCost", () => {
  it("multiplies tokens by per-million rate", () => {
    // gpt-4o-mini: $0.15 in / $0.60 out per Mtok
    // 1000 in + 500 out = 0.00015 + 0.00030 = 0.00045
    const c = computeCost("gpt-4o-mini", { promptTokens: 1000, completionTokens: 500 });
    expect(c).toBeCloseTo(0.00045, 8);
  });

  it("returns 0 for unknown models", () => {
    expect(computeCost("unknown-model", { promptTokens: 100, completionTokens: 100 })).toBe(0);
  });

  it("returns 0 for ollama models (not priced)", () => {
    expect(computeCost("llama3.1:8b", { promptTokens: 100, completionTokens: 100 })).toBe(0);
  });

  it("handles missing usage object", () => {
    expect(computeCost("gpt-4o", undefined)).toBe(0);
    expect(computeCost("gpt-4o", null)).toBe(0);
  });

  it("clamps negative usage to zero", () => {
    expect(computeCost("gpt-4o", { promptTokens: -5, completionTokens: -5 })).toBe(0);
  });

  it("zero usage returns zero cost", () => {
    expect(computeCost("gpt-4o", { promptTokens: 0, completionTokens: 0 })).toBe(0);
  });
});

describe("formatCost", () => {
  it("formats sub-cent costs as <$0.01", () => {
    expect(formatCost(0.001)).toBe("<$0.01");
  });

  it("formats normal costs with two decimal places", () => {
    expect(formatCost(0.05)).toBe("$0.05");
    expect(formatCost(1.23456)).toBe("$1.23");
  });

  it("formats zero and negative as $0.00", () => {
    expect(formatCost(0)).toBe("$0.00");
    expect(formatCost(-1)).toBe("$0.00");
  });

  it("rejects non-numeric input", () => {
    expect(formatCost("nope")).toBe("$0.00");
    expect(formatCost(NaN)).toBe("$0.00");
    expect(formatCost(Infinity)).toBe("$0.00");
  });
});

describe("normalizeUsage", () => {
  it("recognises Anthropic-style keys", () => {
    expect(normalizeUsage({ input_tokens: 12, output_tokens: 34 })).toEqual({
      promptTokens: 12,
      completionTokens: 34,
    });
  });

  it("recognises OpenAI/Ollama-style keys", () => {
    expect(normalizeUsage({ prompt_tokens: 5, completion_tokens: 6 })).toEqual({
      promptTokens: 5,
      completionTokens: 6,
    });
  });

  it("recognises Google-style keys", () => {
    expect(normalizeUsage({ promptTokenCount: 7, candidatesTokenCount: 8 })).toEqual({
      promptTokens: 7,
      completionTokens: 8,
    });
  });

  it("recognises canonical keys directly", () => {
    expect(normalizeUsage({ promptTokens: 9, completionTokens: 10 })).toEqual({
      promptTokens: 9,
      completionTokens: 10,
    });
  });

  it("defaults to zero on missing/non-object input", () => {
    expect(normalizeUsage(null)).toEqual({ promptTokens: 0, completionTokens: 0 });
    expect(normalizeUsage("nope")).toEqual({ promptTokens: 0, completionTokens: 0 });
    expect(normalizeUsage({})).toEqual({ promptTokens: 0, completionTokens: 0 });
  });

  it("clamps negative values to zero", () => {
    expect(normalizeUsage({ prompt_tokens: -1, completion_tokens: -2 })).toEqual({
      promptTokens: 0,
      completionTokens: 0,
    });
  });
});
