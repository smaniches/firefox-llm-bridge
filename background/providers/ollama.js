/**
 * OLLAMA PROVIDER (Local Models)
 * Firefox LLM Bridge | TOPOLOGICA LLC
 *
 * Connects to Ollama running locally via its OpenAI-compatible endpoint.
 * No API key required. Models auto-detected from /api/tags.
 * User must have Ollama installed and running.
 */

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
   * Call Ollama's OpenAI-compatible endpoint and return normalized response.
   */
  async call(apiKey, model, systemPrompt, messages, tools, signal, endpoint) {
    const base = endpoint || this.defaultEndpoint;
    const url = `${base}/v1/chat/completions`;

    const formattedMessages = [
      { role: "system", content: systemPrompt },
      ...this.formatMessages(messages),
    ];

    const body = {
      model: model,
      messages: formattedMessages,
      stream: false,
    };

    if (tools && tools.length > 0) {
      body.tools = this.formatTools(tools);
    }

    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
    } catch (e) {
      if (e.name === "AbortError") throw e;
      throw new Error(
        "Cannot connect to Ollama. Make sure Ollama is running (ollama serve) " +
          "and CORS is configured: OLLAMA_ORIGINS=moz-extension://* " +
          `Tried: ${url}`,
      );
    }

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Ollama ${response.status}: ${errorBody.substring(0, 200)}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];

    if (!choice) {
      throw new Error("Ollama returned no choices");
    }

    return this._normalizeResponse(choice);
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
