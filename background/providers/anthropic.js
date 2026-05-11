/**
 * ANTHROPIC PROVIDER
 * Firefox LLM Bridge | TOPOLOGICA LLC
 *
 * Handles communication with Anthropic's Messages API.
 * Tool calls use input_schema, content blocks, tool_result messages.
 * Supports streaming responses via the standard SSE protocol.
 *
 * Prompt caching: enabled via the `prompt-caching-1` beta header.
 *   - The system prompt is wrapped as a structured content block with
 *     `cache_control: { type: "ephemeral" }` so the system turns into a
 *     cacheable prefix.
 *   - The last tool definition also carries `cache_control` so the tool
 *     list is cached alongside the system prompt.
 *   Both cache breakpoints are placed at the natural "stable prefix" of every
 *   request, maximising hit rates across multi-turn agent loops.
 *
 * Extended thinking: opt-in via `extendedThinking: true` in provider settings.
 *   - Adds `thinking: { type: "enabled", budget_tokens: N }` to the body.
 *   - Thinking content blocks are captured in the returned `content` array but
 *     are NOT forwarded to `onTextChunk` (they are not displayed inline).
 */

import { parseDataUrl } from "../lib/vision.js";
import { readSSE } from "../lib/stream.js";
import { normalizeUsage } from "../lib/pricing.js";

export const anthropic = {
  id: "anthropic",
  name: "Anthropic Claude",
  requiresKey: true,
  keyPrefix: "sk-ant-",
  endpoint: "https://api.anthropic.com/v1/messages",

  models: [
    { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", default: true },
    { id: "claude-opus-4-20250514", name: "Claude Opus 4" },
    { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5 (fast)" },
  ],

  validateKey(key) {
    return typeof key === "string" && key.startsWith("sk-ant-") && key.length > 20;
  },

  /**
   * Convert unified tool definitions to Anthropic format.
   * Anthropic uses `input_schema` instead of `parameters`.
   *
   * The last tool in the array receives a `cache_control` breakpoint so the
   * entire tool list is cached as part of the stable request prefix.
   */
  formatTools(tools) {
    const formatted = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    }));
    if (formatted.length > 0) {
      formatted[formatted.length - 1].cache_control = { type: "ephemeral" };
    }
    return formatted;
  },

  /**
   * Convert our unified message stream to Anthropic format.
   *
   * Anthropic's native format already matches ours for text, tool_use, and
   * tool_result blocks, so most messages pass through. The one transformation
   * is the `{type:"image", dataUrl}` block we use for vision payloads — it
   * becomes `{type:"image", source:{type:"base64", media_type, data}}`.
   */
  formatMessages(messages) {
    return messages.map((msg) => {
      if (!Array.isArray(msg.content)) return msg;
      const blocks = msg.content.map((b) => {
        if (b.type === "image" && b.dataUrl) {
          const parsed = parseDataUrl(b.dataUrl);
          return {
            type: "image",
            source: { type: "base64", media_type: parsed.mediaType, data: parsed.data },
          };
        }
        return b;
      });
      return { ...msg, content: blocks };
    });
  },

  /**
   * Call the Anthropic Messages API and return a normalized response.
   *
   * If `onTextChunk` is supplied, the request is made in streaming mode and
   * the callback receives each text delta as it arrives. The final return
   * value always carries the fully reconstructed `content`, the normalized
   * `stop_reason`, and a canonical `usage` object — the shape is identical
   * to the non-streaming path so callers don't have to branch.
   *
   * Prompt caching is always requested (beta header + cache_control markers on
   * system prompt and last tool). When extended thinking is enabled via
   * `options.extendedThinking`, the request body includes a `thinking` block
   * and `max_tokens` is raised to accommodate the budget.
   *
   * @param {string} apiKey
   * @param {string} model
   * @param {string} systemPrompt
   * @param {Array} messages
   * @param {Array} tools
   * @param {AbortSignal|null} signal
   * @param {string|undefined} _endpoint  - unused (cloud provider)
   * @param {((text: string) => void)|undefined} onTextChunk
   * @param {{ extendedThinking?: boolean, thinkingBudget?: number }} [options]
   */
  async call(apiKey, model, systemPrompt, messages, tools, signal, _endpoint, onTextChunk, options = {}) {
    const stream = typeof onTextChunk === "function";

    // Build the system array with a cache_control breakpoint on the last element
    // so the system prompt is promoted to the cacheable prefix tier.
    const systemArray = [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }];

    // Assemble the base request body.
    const body = {
      model: model,
      max_tokens: 4096,
      system: systemArray,
      tools: this.formatTools(tools),
      messages: this.formatMessages(messages),
      stream,
    };

    // Extended thinking support. Requires `max_tokens > budget_tokens`.
    if (options.extendedThinking) {
      const budget = options.thinkingBudget ?? 8000;
      body.thinking = { type: "enabled", budget_tokens: budget };
      // Ensure max_tokens is large enough to contain both thinking and output.
      body.max_tokens = Math.max(body.max_tokens, budget + 1000);
    }

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "prompt-caching-1",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Anthropic API ${response.status}: ${text.substring(0, 200)}`);
    }

    if (!stream) {
      const data = await response.json();
      const base = normalizeUsage(data.usage);
      return {
        content: data.content,
        stop_reason: data.stop_reason === "tool_use" ? "tool_use" : "end_turn",
        usage: {
          ...base,
          cacheCreationTokens: data.usage?.cache_creation_input_tokens ?? 0,
          cacheReadTokens: data.usage?.cache_read_input_tokens ?? 0,
        },
      };
    }

    return await consumeAnthropicStream(response, onTextChunk);
  },

  /**
   * Build the tool result messages in Anthropic format.
   * Anthropic expects tool results as user messages with tool_result content blocks.
   */
  buildToolResultMessage(toolResults) {
    return {
      role: "user",
      content: toolResults.map((r) => ({
        type: "tool_result",
        tool_use_id: r.tool_use_id,
        content: r.content,
      })),
    };
  },
};

/**
 * Consume an Anthropic Messages-API stream and rebuild a normalized response.
 *
 * The stream is a sequence of SSE events that describe `message_start`,
 * `content_block_start`, `content_block_delta` (text, thinking, or input_json),
 * `content_block_stop`, `message_delta`, `message_stop`. We track each
 * content block by its `index` so concurrent text + tool_use blocks both
 * accumulate correctly.
 *
 * Thinking blocks (`type: "thinking"`) are accumulated via `thinking_delta`
 * events and included in the returned content array, but their deltas are NOT
 * forwarded to `onTextChunk` — they are internal reasoning, not display text.
 *
 * Cache usage fields (`cache_creation_input_tokens`, `cache_read_input_tokens`)
 * are extracted from `message_start` and surfaced in the returned usage object.
 *
 * @param {Response} response
 * @param {(text: string) => void} onTextChunk
 */
async function consumeAnthropicStream(response, onTextChunk) {
  /** @type {Array<{type: string, text?: string, thinking?: string, id?: string, name?: string, input?: any, _argsBuffer?: string}>} */
  const blocks = [];
  let stopReason = "end_turn";
  let usage = {
    promptTokens: 0,
    completionTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
  };

  for await (const { data } of readSSE(response)) {
    if (data === "[DONE]") continue;
    let evt;
    try {
      evt = JSON.parse(data);
    } catch {
      continue;
    }

    if (evt.type === "message_start" && evt.message?.usage) {
      const u = evt.message.usage;
      usage = {
        ...usage,
        promptTokens: u.input_tokens || 0,
        cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
        cacheReadTokens: u.cache_read_input_tokens ?? 0,
      };
    } else if (evt.type === "content_block_start" && evt.content_block) {
      const block = evt.content_block;
      if (block.type === "text") {
        blocks[evt.index] = { type: "text", text: "" };
      } else if (block.type === "thinking") {
        blocks[evt.index] = { type: "thinking", thinking: "" };
      } else if (block.type === "tool_use") {
        blocks[evt.index] = {
          type: "tool_use",
          id: block.id,
          name: block.name,
          input: {},
          _argsBuffer: "",
        };
      }
    } else if (evt.type === "content_block_delta" && evt.delta) {
      const block = blocks[evt.index];
      if (!block) continue;
      if (evt.delta.type === "text_delta") {
        block.text += evt.delta.text;
        onTextChunk(evt.delta.text);
      } else if (evt.delta.type === "thinking_delta") {
        // Accumulate thinking text but do NOT emit to onTextChunk.
        block.thinking += evt.delta.thinking || "";
      } else if (evt.delta.type === "input_json_delta") {
        block._argsBuffer += evt.delta.partial_json || "";
      }
    } else if (evt.type === "content_block_stop") {
      const block = blocks[evt.index];
      if (block && block.type === "tool_use" && block._argsBuffer) {
        try {
          block.input = JSON.parse(block._argsBuffer);
        } catch {
          block.input = {};
        }
        delete block._argsBuffer;
      }
    } else if (evt.type === "message_delta") {
      if (evt.delta?.stop_reason) {
        stopReason = evt.delta.stop_reason === "tool_use" ? "tool_use" : "end_turn";
      }
      if (evt.usage?.output_tokens) {
        usage = { ...usage, completionTokens: evt.usage.output_tokens };
      }
    }
  }

  return { content: blocks.filter(Boolean), stop_reason: stopReason, usage };
}
