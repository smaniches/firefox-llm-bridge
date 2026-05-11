/**
 * PRICING + COST TRACKING
 *
 * Approximate per-token pricing for each model exposed by the extension.
 * Rates are in USD per million tokens, separated into prompt (input) and
 * completion (output). Numbers are intentionally fixed in source — they
 * change rarely and we'd rather lag a few cents than fetch them at runtime.
 *
 * Ollama is local; cost is always zero.
 *
 * The values were current as of early 2026. Update via PR when providers
 * publish new rates.
 */

/** @typedef {{ inputPerMTok: number, outputPerMTok: number }} ModelRate */

/**
 * Pricing table. Keys are model ids. Values are USD per **million** tokens.
 * Models not in this table default to `{0,0}` (no estimate available).
 *
 * @type {Record<string, ModelRate>}
 */
export const PRICING = Object.freeze({
  // Anthropic
  "claude-sonnet-4-20250514": { inputPerMTok: 3.0, outputPerMTok: 15.0 },
  "claude-opus-4-20250514": { inputPerMTok: 15.0, outputPerMTok: 75.0 },
  "claude-haiku-4-5-20251001": { inputPerMTok: 1.0, outputPerMTok: 5.0 },

  // OpenAI
  "gpt-4o": { inputPerMTok: 2.5, outputPerMTok: 10.0 },
  "gpt-4o-mini": { inputPerMTok: 0.15, outputPerMTok: 0.6 },
  o1: { inputPerMTok: 15.0, outputPerMTok: 60.0 },
  "o3-mini": { inputPerMTok: 1.1, outputPerMTok: 4.4 },

  // Google
  "gemini-2.5-flash": { inputPerMTok: 0.075, outputPerMTok: 0.3 },
  "gemini-2.5-pro": { inputPerMTok: 1.25, outputPerMTok: 5.0 },
  "gemini-2.0-flash": { inputPerMTok: 0.075, outputPerMTok: 0.3 },
});

/**
 * Compute a cost (USD) for a single LLM call given its token usage and
 * model id. Returns 0 for unknown models or zero usage so the cost tracker
 * cannot break the agent loop.
 *
 * @param {string} model
 * @param {{ promptTokens?: number, completionTokens?: number }} usage
 * @returns {number}
 */
export function computeCost(model, usage) {
  const rate = PRICING[model];
  if (!rate) return 0;
  const inTok = Math.max(0, usage?.promptTokens || 0);
  const outTok = Math.max(0, usage?.completionTokens || 0);
  return (inTok * rate.inputPerMTok + outTok * rate.outputPerMTok) / 1_000_000;
}

/**
 * Format a USD cost for sidebar display. Sub-cent values render as
 * `<$0.01`; otherwise we show two decimal places with a `$` prefix.
 *
 * @param {number} cost
 */
export function formatCost(cost) {
  if (typeof cost !== "number" || !isFinite(cost) || cost <= 0) return "$0.00";
  if (cost < 0.01) return "<$0.01";
  return `$${cost.toFixed(2)}`;
}

/**
 * Normalize an LLM-provider response's usage block to our internal shape.
 *
 * Providers report token usage under different keys (`input_tokens` for
 * Anthropic, `prompt_tokens` for OpenAI/Ollama, `promptTokenCount` for
 * Google). This function accepts any of them and returns the canonical
 * `{ promptTokens, completionTokens }` we use in computeCost.
 *
 * @param {object} usage
 * @returns {{ promptTokens: number, completionTokens: number }}
 */
export function normalizeUsage(usage) {
  if (!usage || typeof usage !== "object") {
    return { promptTokens: 0, completionTokens: 0 };
  }
  const prompt =
    usage.promptTokens ?? usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokenCount ?? 0;
  const completion =
    usage.completionTokens ??
    usage.completion_tokens ??
    usage.output_tokens ??
    usage.candidatesTokenCount ??
    0;
  return {
    promptTokens: clampNonNegativeInt(prompt),
    completionTokens: clampNonNegativeInt(completion),
  };
}

/**
 * Coerce `n` to a non-negative finite integer. Truncates toward zero so a
 * fractional token count cannot accumulate rounding error across a session.
 * Returns 0 for NaN, Infinity, non-numbers, or negative values. Unlike
 * bitwise `| 0`, this preserves precision past 2^31 — sessions in the
 * billions of tokens still accumulate correctly.
 *
 * @param {unknown} n
 */
function clampNonNegativeInt(n) {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.trunc(v);
}
