/**
 * ANTHROPIC PROVIDER
 * Firefox LLM Bridge | TOPOLOGICA LLC
 *
 * Handles communication with Anthropic's Messages API.
 * Tool calls use input_schema, content blocks, tool_result messages.
 * Supports streaming responses via the standard SSE protocol.
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
   */
  formatTools(tools) {
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    }));
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
   */
  async call(apiKey, model, systemPrompt, messages, tools, signal, _endpoint, onTextChunk) {
    const stream = typeof onTextChunk === "function";
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: model,
        max_tokens: 4096,
        system: systemPrompt,
        tools: this.formatTools(tools),
        messages: this.formatMessages(messages),
        stream,
      }),
      signal,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Anthropic API ${response.status}: ${body.substring(0, 200)}`);
    }

    if (!stream) {
      const data = await response.json();
      return {
        content: data.content,
        stop_reason: data.stop_reason === "tool_use" ? "tool_use" : "end_turn",
        usage: normalizeUsage(data.usage),
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
 * `content_block_start`, `content_block_delta` (text or input_json),
 * `content_block_stop`, `message_delta`, `message_stop`. We track each
 * content block by its `index` so concurrent text + tool_use blocks both
 * accumulate correctly.
 *
 * @param {Response} response
 * @param {(text: string) => void} onTextChunk
 */
async function consumeAnthropicStream(response, onTextChunk) {
  /** @type {Array<{type: string, text?: string, id?: string, name?: string, input?: any, _argsBuffer?: string}>} */
  const blocks = [];
  let stopReason = "end_turn";
  let usage = { promptTokens: 0, completionTokens: 0 };

  for await (const { data } of readSSE(response)) {
    if (data === "[DONE]") continue;
    let evt;
    try {
      evt = JSON.parse(data);
    } catch {
      continue;
    }

    if (evt.type === "message_start" && evt.message?.usage) {
      usage = { ...usage, promptTokens: evt.message.usage.input_tokens || 0 };
    } else if (evt.type === "content_block_start" && evt.content_block) {
      const block = evt.content_block;
      if (block.type === "text") {
        blocks[evt.index] = { type: "text", text: "" };
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
