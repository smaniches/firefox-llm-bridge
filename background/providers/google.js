/**
 * GOOGLE GEMINI PROVIDER
 * Firefox LLM Bridge | TOPOLOGICA LLC
 *
 * Handles communication with Google's Gemini generateContent API.
 * Tool calls use functionDeclarations with UPPERCASED types,
 * functionCall parts, and functionResponse for results.
 * Streaming uses the `streamGenerateContent` endpoint variant with SSE.
 */

import { parseDataUrl } from "../lib/vision.js";
import { readSSE } from "../lib/stream.js";
import { normalizeUsage } from "../lib/pricing.js";
import { fetchWithRetry } from "../lib/http.js";
import { fromHttpStatus, NetworkError } from "../lib/errors.js";

export const google = {
  id: "google",
  name: "Google Gemini",
  requiresKey: true,
  keyPrefix: "AIza",
  endpoint: "https://generativelanguage.googleapis.com/v1beta/models",

  models: [
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", default: true },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash (fast)" },
  ],

  validateKey(key) {
    return typeof key === "string" && key.startsWith("AIza") && key.length > 20;
  },

  /**
   * Convert unified tool definitions to Gemini format.
   * Gemini uses functionDeclarations with UPPERCASED OpenAPI types.
   */
  formatTools(tools) {
    return [
      {
        functionDeclarations: tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: this._convertSchema(t.input_schema),
        })),
      },
    ];
  },

  /**
   * Recursively convert JSON Schema types to Gemini's UPPERCASED format.
   */
  _convertSchema(schema) {
    if (!schema) return {};

    const converted = {};

    if (schema.type) {
      converted.type = schema.type.toUpperCase();
    }

    if (schema.description) {
      converted.description = schema.description;
    }

    if (schema.enum) {
      converted.enum = schema.enum;
    }

    if (schema.properties) {
      converted.properties = {};
      for (const [key, value] of Object.entries(schema.properties)) {
        converted.properties[key] = this._convertSchema(value);
      }
    }

    if (schema.required) {
      converted.required = schema.required;
    }

    if (schema.items) {
      converted.items = this._convertSchema(schema.items);
    }

    return converted;
  },

  /**
   * Convert our internal messages to Gemini format.
   * Gemini uses "contents" with "parts" and roles "user"/"model".
   */
  formatMessages(messages) {
    const contents = [];

    for (const msg of messages) {
      if (msg.role === "user") {
        if (Array.isArray(msg.content) && msg.content[0]?.type === "tool_result") {
          // Tool results become functionResponse parts
          const parts = msg.content.map((r) => ({
            functionResponse: {
              name: r._toolName || "unknown",
              response: {
                result: typeof r.content === "string" ? r.content : JSON.stringify(r.content),
              },
            },
          }));
          contents.push({ role: "user", parts });
        } else if (Array.isArray(msg.content)) {
          // Multi-part user message — convert image blocks to Gemini's
          // inlineData parts and text blocks to text parts.
          const parts = msg.content
            .map((b) => {
              if (b.type === "image" && b.dataUrl) {
                const parsed = parseDataUrl(b.dataUrl);
                return {
                  inlineData: { mimeType: parsed.mediaType, data: parsed.data },
                };
              }
              if (b.type === "text" && typeof b.text === "string") {
                return { text: b.text };
              }
              return null;
            })
            .filter(Boolean);
          if (parts.length > 0) contents.push({ role: "user", parts });
        } else {
          // Regular user message
          const text = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
          contents.push({ role: "user", parts: [{ text }] });
        }
      } else if (msg.role === "assistant") {
        if (Array.isArray(msg.content)) {
          const parts = [];
          for (const block of msg.content) {
            if (block.type === "text" && block.text) {
              parts.push({ text: block.text });
            } else if (block.type === "tool_use") {
              parts.push({
                functionCall: {
                  name: block.name,
                  args: block.input,
                },
              });
            }
          }
          if (parts.length > 0) {
            contents.push({ role: "model", parts });
          }
        } else if (typeof msg.content === "string") {
          contents.push({ role: "model", parts: [{ text: msg.content }] });
        }
      }
    }

    return contents;
  },

  /**
   * Call Gemini and return a normalized response.
   *
   * SECURITY: The API key is passed via the `x-goog-api-key` header instead
   * of the URL query string. Keys in URLs end up in HTTP server access logs,
   * proxy logs, and browser history; header values do not.
   *
   * Streaming uses the `streamGenerateContent` endpoint with `alt=sse`.
   */
  async call(apiKey, model, systemPrompt, messages, tools, signal, _endpoint, onTextChunk) {
    const stream = typeof onTextChunk === "function";
    const url = stream
      ? `${this.endpoint}/${model}:streamGenerateContent?alt=sse`
      : `${this.endpoint}/${model}:generateContent`;

    const body = {
      contents: this.formatMessages(messages),
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
    };

    if (tools && tools.length > 0) {
      body.tools = this.formatTools(tools);
    }

    body.generationConfig = {
      maxOutputTokens: 4096,
      temperature: 0.7,
    };

    const init = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
    };

    // See anthropic.js for why streaming bypasses retry.
    let response;
    if (stream) {
      try {
        response = await fetch(url, { ...init, signal });
      } catch (e) {
        if (e?.name === "AbortError") throw e;
        throw new NetworkError(`Network error contacting google: ${e?.message ?? e}`, {
          cause: e,
          providerId: "google",
        });
      }
      if (!response.ok) {
        const errBody = await response.text().catch(() => "");
        throw fromHttpStatus("google", response.status, errBody, response.headers);
      }
    } else {
      response = await fetchWithRetry(url, init, {
        providerId: "google",
        signal,
      });
    }

    if (!stream) {
      const data = await response.json();
      const normalized = this._normalizeResponse(data);
      normalized.usage = normalizeUsage(data.usageMetadata);
      return normalized;
    }

    return await consumeGoogleStream(response, onTextChunk);
  },

  /**
   * Normalize Gemini response to unified format.
   */
  _normalizeResponse(data) {
    const content = [];
    const candidate = data.candidates?.[0];

    if (!candidate?.content?.parts) {
      throw new Error("Gemini returned no content");
    }

    let hasToolCalls = false;

    for (const part of candidate.content.parts) {
      if (part.text) {
        content.push({ type: "text", text: part.text });
      } else if (part.functionCall) {
        hasToolCalls = true;
        content.push({
          type: "tool_use",
          id: `gemini-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
          name: part.functionCall.name,
          input: part.functionCall.args || {},
        });
      }
    }

    return {
      content,
      stop_reason: hasToolCalls ? "tool_use" : "end_turn",
    };
  },

  /**
   * Build tool result messages. Includes _toolName for Gemini's functionResponse.
   */
  buildToolResultMessage(toolResults) {
    return {
      role: "user",
      content: toolResults.map((r) => ({
        type: "tool_result",
        tool_use_id: r.tool_use_id,
        _toolName: r.toolName,
        content: typeof r.content === "string" ? r.content : JSON.stringify(r.content),
      })),
    };
  },
};

/**
 * Consume Gemini's `streamGenerateContent?alt=sse` response.
 *
 * Each SSE event's `data` is a full `GenerateContentResponse` chunk
 * containing a candidate whose parts accumulate the response. We forward
 * each text part to `onTextChunk` and rebuild the unified content array
 * (text and tool_use blocks) at end-of-stream.
 *
 * @param {Response} response
 * @param {(text: string) => void} onTextChunk
 */
async function consumeGoogleStream(response, onTextChunk) {
  let text = "";
  /** @type {Array<{type: "tool_use", id: string, name: string, input: any}>} */
  const toolUses = [];
  let usage = { promptTokens: 0, completionTokens: 0 };
  let hadFunctionCall = false;

  for await (const { data } of readSSE(response)) {
    let evt;
    try {
      evt = JSON.parse(data);
    } catch {
      continue;
    }

    if (evt.usageMetadata) usage = normalizeUsage(evt.usageMetadata);

    const parts = evt.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) continue;

    for (const part of parts) {
      if (typeof part.text === "string" && part.text.length > 0) {
        text += part.text;
        onTextChunk(part.text);
      } else if (part.functionCall) {
        hadFunctionCall = true;
        toolUses.push({
          type: "tool_use",
          id: `gemini-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: part.functionCall.name,
          input: part.functionCall.args || {},
        });
      }
    }
  }

  const content = [];
  if (text.length > 0) content.push({ type: "text", text });
  for (const tu of toolUses) content.push(tu);

  return {
    content,
    stop_reason: hadFunctionCall ? "tool_use" : "end_turn",
    usage,
  };
}
