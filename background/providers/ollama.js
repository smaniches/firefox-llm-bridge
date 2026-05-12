/**
 * OLLAMA PROVIDER (Local Models)
 * Firefox LLM Bridge | TOPOLOGICA LLC
 *
 * Connects to Ollama running locally via its OpenAI-compatible endpoint.
 * No API key required. Models auto-detected from /api/tags.
 * User must have Ollama installed and running.
 *
 * The sovereignty path: when this provider is active, no data leaves the
 * user's device — every request hits loopback. Streaming uses Ollama's
 * NDJSON line protocol (one parsed JSON value per line).
 */

import { readNDJSON } from "../lib/stream.js";
import { normalizeUsage } from "../lib/pricing.js";
import { fetchWithRetry } from "../lib/http.js";
import { fromHttpStatus, NetworkError } from "../lib/errors.js";

export const ollama = {
  id: "ollama",
  name: "Ollama (Local)",
  requiresKey: false,
  keyPrefix: null,
  defaultEndpoint: "http://localhost:11434",

  // Populated dynamically via detectModels()
  models: [
    { id: "llama3.1:8b", name: "Llama 3.1 8B", default: true },
    { id: "qwen2.5:7b", name: "Qwen 2.5 7B" },
    { id: "mistral-nemo", name: "Mistral Nemo" },
  ],

  validateKey() {
    return true; // No key needed
  },

  /**
   * Detect installed models from Ollama.
   * Returns array of { id, name } or empty array if Ollama unreachable.
   */
  async detectModels(endpoint) {
    const base = endpoint || this.defaultEndpoint;
    try {
      const response = await fetch(`${base}/api/tags`, {
        method: "GET",
        signal: AbortSignal.timeout(3000),
      });

      if (!response.ok) return [];

      const data = await response.json();
      if (!data.models || data.models.length === 0) return [];

      return data.models.map((m) => ({
        id: m.name,
        name: `${m.name} (${formatSize(m.size)})`,
        default: false,
      }));
    } catch {
      return [];
    }
  },

  /**
   * Check if Ollama is running and reachable.
   */
  async checkConnection(endpoint) {
    const base = endpoint || this.defaultEndpoint;
    try {
      const response = await fetch(`${base}/api/tags`, {
        method: "GET",
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    } catch {
      return false;
    }
  },

  /**
   * Convert unified tool definitions to OpenAI format (Ollama is OpenAI-compatible).
   */
  formatTools(tools) {
    return tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));
  },

  /**
   * Convert messages to OpenAI format (Ollama uses OpenAI-compatible endpoint).
   */
  formatMessages(messages) {
    const formatted = [];

    for (const msg of messages) {
      if (msg.role === "user") {
        if (Array.isArray(msg.content) && msg.content[0]?.type === "tool_result") {
          for (const result of msg.content) {
            formatted.push({
              role: "tool",
              tool_call_id: result.tool_use_id,
              content:
                typeof result.content === "string"
                  ? result.content
                  : JSON.stringify(result.content),
            });
          }
        } else if (Array.isArray(msg.content)) {
          // OpenAI-compatible multi-part message. Ollama models that support
          // vision (llava, llama3.2-vision, etc.) accept the same image_url
          // shape; text-only models silently drop the image part.
          const parts = msg.content
            .map((b) => {
              if (b.type === "image" && b.dataUrl) {
                return { type: "image_url", image_url: { url: b.dataUrl } };
              }
              if (b.type === "text" && typeof b.text === "string") {
                return { type: "text", text: b.text };
              }
              return null;
            })
            .filter(Boolean);
          formatted.push({ role: "user", content: parts });
        } else {
          formatted.push({
            role: "user",
            content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
          });
        }
      } else if (msg.role === "assistant") {
        if (Array.isArray(msg.content)) {
          const textParts = msg.content
            .filter((b) => b.type === "text")
            .map((b) => b.text)
            .join("");
          const toolUses = msg.content.filter((b) => b.type === "tool_use");

          const assistantMsg = { role: "assistant", content: textParts || null };

          if (toolUses.length > 0) {
            assistantMsg.tool_calls = toolUses.map((t) => ({
              id: t.id,
              type: "function",
              function: {
                name: t.name,
                arguments: JSON.stringify(t.input),
              },
            }));
          }

          formatted.push(assistantMsg);
        } else {
          formatted.push({ role: "assistant", content: msg.content });
        }
      }
    }

    return formatted;
  },

  /**
   * Call Ollama's OpenAI-compatible endpoint and return a normalized response.
   *
   * When `onTextChunk` is provided, the request is made with `stream: true`
   * and consumed as NDJSON (Ollama's native streaming format). The return
   * shape matches the non-streaming path.
   */
  async call(apiKey, model, systemPrompt, messages, tools, signal, endpoint, onTextChunk) {
    const base = endpoint || this.defaultEndpoint;
    const url = `${base}/v1/chat/completions`;
    const stream = typeof onTextChunk === "function";

    const formattedMessages = [
      { role: "system", content: systemPrompt },
      ...this.formatMessages(messages),
    ];

    const body = {
      model: model,
      messages: formattedMessages,
      stream,
    };

    if (tools && tools.length > 0) {
      body.tools = this.formatTools(tools);
    }

    const init = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    };

    // Ollama is local; retries are still useful when the daemon is mid-restart
    // or a model is still loading. Streaming bypasses retry for the same
    // reason as the cloud providers.
    // Both the streaming and non-streaming paths surface the same
    // operator-friendly "Cannot connect to Ollama" hint for the most common
    // local-setup mistake (daemon down, missing CORS), but they wrap it in a
    // typed `NetworkError` so the UI receives `code: "NETWORK"`,
    // `retryable: true`, and `providerId: "ollama"` — letting the sidebar
    // render the same error-code badge and Retry button as the cloud providers.
    const helpfulMessage =
      "Cannot connect to Ollama. Make sure Ollama is running (ollama serve) " +
      "and CORS is configured: OLLAMA_ORIGINS=moz-extension://* " +
      `Tried: ${url}`;

    let response;
    if (stream) {
      try {
        response = await fetch(url, { ...init, signal });
      } catch (e) {
        if (e.name === "AbortError") throw e;
        throw new NetworkError(helpfulMessage, { cause: e, providerId: "ollama" });
      }
      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        throw fromHttpStatus("ollama", response.status, errorBody, response.headers);
      }
    } else {
      try {
        response = await fetchWithRetry(url, init, { providerId: "ollama", signal });
      } catch (e) {
        if (e?.name === "AbortError" || e?.code === "AUTH_REJECTED" || e?.code === "RATE_LIMITED") {
          throw e;
        }
        if (e?.code === "NETWORK") {
          // Re-wrap the underlying NetworkError so the UI sees the
          // user-friendly CORS hint as the message while keeping the typed
          // metadata (`code`, `retryable`, `providerId`) intact for the
          // sidebar's error-code badge and Retry button. The original error
          // is preserved as `.cause` for the structured logger.
          throw new NetworkError(helpfulMessage, { cause: e, providerId: "ollama" });
        }
        throw e;
      }
    }

    if (!stream) {
      const data = await response.json();
      const choice = data.choices?.[0];
      if (!choice) throw new Error("Ollama returned no choices");
      const normalized = this._normalizeResponse(choice);
      normalized.usage = normalizeUsage(data.usage);
      return normalized;
    }

    return await consumeOllamaStream(response, onTextChunk);
  },

  /**
   * Normalize OpenAI-format response to unified format.
   */
  _normalizeResponse(choice) {
    const content = [];
    const msg = choice.message;

    if (msg.content) {
      content.push({ type: "text", text: msg.content });
    }

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      for (const tc of msg.tool_calls) {
        let parsedArgs = {};
        try {
          parsedArgs =
            typeof tc.function.arguments === "string"
              ? JSON.parse(tc.function.arguments)
              : tc.function.arguments;
        } catch {
          console.warn("[Ollama] Failed to parse tool arguments:", tc.function.arguments);
        }

        content.push({
          type: "tool_use",
          id: tc.id || `ollama-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
          name: tc.function.name,
          input: parsedArgs,
        });
      }
    }

    return {
      content,
      stop_reason: choice.finish_reason === "tool_calls" ? "tool_use" : "end_turn",
    };
  },

  /**
   * Build tool result messages (same format as OpenAI).
   */
  buildToolResultMessage(toolResults) {
    return {
      role: "user",
      content: toolResults.map((r) => ({
        type: "tool_result",
        tool_use_id: r.tool_use_id,
        content: typeof r.content === "string" ? r.content : JSON.stringify(r.content),
      })),
    };
  },
};

/** Format bytes to human-readable size. */
function formatSize(bytes) {
  if (!bytes) return "?";
  const gb = bytes / (1024 * 1024 * 1024);
  return gb >= 1 ? `${gb.toFixed(1)}GB` : `${(bytes / (1024 * 1024)).toFixed(0)}MB`;
}

/**
 * Consume Ollama's NDJSON streaming response. Ollama's `/v1/chat/completions`
 * endpoint with `stream: true` returns one OpenAI-style chunk per line.
 *
 * @param {Response} response
 * @param {(text: string) => void} onTextChunk
 */
async function consumeOllamaStream(response, onTextChunk) {
  let text = "";
  /** @type {Map<number, { id: string, name: string, args: string }>} */
  const toolCallsByIndex = new Map();
  let stopReason = "end_turn";
  let usage = { promptTokens: 0, completionTokens: 0 };

  for await (const evt of readNDJSON(response)) {
    if (evt.usage) usage = normalizeUsage(evt.usage);
    const choice = evt.choices?.[0];
    if (!choice) continue;

    if (choice.finish_reason === "tool_calls") stopReason = "tool_use";
    else if (choice.finish_reason === "stop" || choice.finish_reason === "length")
      stopReason = "end_turn";

    const delta = choice.delta || {};
    if (typeof delta.content === "string" && delta.content.length > 0) {
      text += delta.content;
      onTextChunk(delta.content);
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        const existing = toolCallsByIndex.get(idx) || { id: "", name: "", args: "" };
        if (tc.id) existing.id = tc.id;
        if (tc.function?.name) existing.name = tc.function.name;
        if (typeof tc.function?.arguments === "string") {
          existing.args += tc.function.arguments;
        }
        toolCallsByIndex.set(idx, existing);
      }
    }
  }

  const content = [];
  if (text.length > 0) content.push({ type: "text", text });
  for (const [, tc] of toolCallsByIndex) {
    let parsed = {};
    try {
      parsed = tc.args ? JSON.parse(tc.args) : {};
    } catch {
      parsed = {};
    }
    content.push({ type: "tool_use", id: tc.id, name: tc.name, input: parsed });
  }

  return { content, stop_reason: stopReason, usage };
}
