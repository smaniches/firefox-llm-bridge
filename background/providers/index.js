/**
 * PROVIDER REGISTRY & ROUTER
 * Firefox LLM Bridge | TOPOLOGICA LLC
 *
 * Central hub that loads the active provider from storage,
 * routes API calls through the correct provider module,
 * and normalizes all responses to a unified format.
 */

import { anthropic } from "./anthropic.js";
import { openai } from "./openai.js";
import { google } from "./google.js";
import { ollama } from "./ollama.js";

/** All registered providers. */
const PROVIDERS = {
  ollama,
  anthropic,
  openai,
  google,
};

/** Return all providers as an array with metadata. */
export function listProviders() {
  return Object.values(PROVIDERS).map((p) => ({
    id: p.id,
    name: p.name,
    requiresKey: p.requiresKey,
    models: p.models,
  }));
}

/** Get a provider module by ID. */
export function getProvider(id) {
  return PROVIDERS[id] || null;
}

/**
 * Load the active provider configuration from browser.storage.local.
 * Returns { provider, apiKey, model, endpoint } or null if not configured.
 */
export async function getActiveConfig() {
  const stored = await browser.storage.local.get(["activeProvider", "providers"]);

  const activeId = stored.activeProvider || null;
  if (!activeId) return null;

  const provider = PROVIDERS[activeId];
  if (!provider) return null;

  const providerConfig = stored.providers?.[activeId] || {};

  return {
    provider,
    apiKey: providerConfig.key || null,
    // Defensive triple fallback: stored model, provider default, first listed.
    // Every shipped provider has `default: true` on one model, so the third
    // branch is a guard for future provider definitions that lack one.
    model: resolveModel(providerConfig.model, provider.models),
    endpoint: providerConfig.endpoint || null,
  };
}

/**
 * Resolve a model id from the stored config, falling back to the provider's
 * default-flagged model, then the first listed model. The last fallback is a
 * guard for hypothetical providers shipping without a default; not exercised
 * by the four built-in providers.
 *
 * @param {string|undefined} stored
 * @param {Array<{id:string, default?: boolean}>} models
 * @returns {string|undefined}
 */
function resolveModel(stored, models) {
  if (stored) return stored;
  const defaulted = models.find((m) => m.default);
  /* v8 ignore next 2 */
  if (!defaulted) return models[0]?.id;
  return defaulted.id;
}

/**
 * Call the active LLM provider.
 * This is the single entry point for all LLM communication.
 *
 * @param {string} systemPrompt - System instructions for the model
 * @param {Array} messages - Conversation history in unified format
 * @param {Array} tools - Browser tool definitions (provider-agnostic)
 * @param {AbortSignal} signal - Abort signal for cancellation
 * @param {(text: string) => void} [onTextChunk] - Optional streaming
 *   callback. When provided, the provider uses its streaming API and
 *   invokes this for each text delta as it arrives. The final returned
 *   value still carries the fully reconstructed content; the callback is
 *   purely additive.
 * @returns {Promise<{
 *   content: Array<object>,
 *   stop_reason: "end_turn" | "tool_use",
 *   usage?: { promptTokens: number, completionTokens: number },
 * }>}
 */
export async function callLLM(systemPrompt, messages, tools, signal, onTextChunk) {
  const config = await getActiveConfig();

  if (!config) {
    throw new Error("No LLM provider configured. Open extension settings to set up a provider.");
  }

  const { provider, apiKey, model, endpoint } = config;

  if (provider.requiresKey && !apiKey) {
    throw new Error(`${provider.name} requires an API key. Add one in extension settings.`);
  }

  // All provider call() signatures take (apiKey, model, systemPrompt, messages,
  // tools, signal, endpoint?, onTextChunk?). Cloud providers ignore endpoint;
  // Ollama uses it. Both honour onTextChunk for streaming.
  return await provider.call(
    apiKey,
    model,
    systemPrompt,
    messages,
    tools,
    signal,
    provider.id === "ollama" ? endpoint : undefined,
    onTextChunk,
  );
}

/**
 * Resolve a model id to its current pricing rate. Returned object includes the
 * provider's `id` for routing the cost into the right per-provider bucket.
 * Returns null when no pricing data is registered for the model.
 *
 * @param {string} model
 */
export async function getActiveModel() {
  const config = await getActiveConfig();
  if (!config) return null;
  return { providerId: config.provider.id, model: config.model };
}

/**
 * Build a tool result message using the active provider's format.
 * This is needed because providers differ in how they expect tool results.
 *
 * @param {Array} toolResults - Array of { tool_use_id, content, toolName }
 * @returns {Object} A message object in the unified format
 */
export async function buildToolResultMessage(toolResults) {
  const config = await getActiveConfig();
  if (!config) {
    // Fallback to Anthropic format (our default internal format)
    return {
      role: "user",
      content: toolResults.map((r) => ({
        type: "tool_result",
        tool_use_id: r.tool_use_id,
        content: r.content,
      })),
    };
  }
  return config.provider.buildToolResultMessage(toolResults);
}

/**
 * Get display info about the active provider for the UI.
 * Returns { name, model, status } or null if not configured.
 */
export async function getActiveProviderInfo() {
  const config = await getActiveConfig();
  if (!config) return null;

  return {
    id: config.provider.id,
    name: config.provider.name,
    model: config.model,
    modelName: config.provider.models.find((m) => m.id === config.model)?.name || config.model,
  };
}
