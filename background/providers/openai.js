/**
 * OPENAI PROVIDER
 * Firefox LLM Bridge | TOPOLOGICA LLC
 *
 * Handles communication with OpenAI's Chat Completions API.
 * Tool calls use `parameters` under `function`, arguments are JSON strings,
 * tool results are role:"tool" messages.
 */

export const openai = {
  id: "openai",
  name: "OpenAI",
  requiresKey: true,
  keyPrefix: "sk-",
  endpoint: "https://api.openai.com/v1/chat/completions",

  models: [
    { id: "gpt-4o", name: "GPT-4o", default: true },
    { id: "gpt-4o-mini", name: "GPT-4o Mini (fast)" },
    { id: "o1", name: "o1 (reasoning)" },
    { id: "o3-mini", name: "o3-mini" },
  ],

  validateKey(key) {
    return typeof key === "string" && key.startsWith("sk-") && key.length > 20;
  },

  /**
   * Convert unified tool definitions to OpenAI format.
   * OpenAI wraps tools in { type: "function", function: { name, description, parameters } }
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
   * Convert our internal message format to OpenAI format.
   * Key differences:
   * - System prompt is a separate message (handled in call())
   * - Tool use content blocks become assistant messages with tool_calls
   * - Tool results become role:"tool" messages
   */
  formatMessages(messages) {
    const formatted = [];

    for (const msg of messages) {
      if (msg.role === "user") {
        // Check if this is a tool result message (array of tool_result blocks)
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
          // Multi-part user message (text + image). OpenAI represents this as
          // an array of parts: { type: "text" } / { type: "image_url" }.
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
          // Regular user message
          formatted.push({
            role: "user",
            content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
          });
        }
      } else if (msg.role === "assistant") {
        // Convert assistant messages with tool_use blocks
        if (Array.isArray(msg.content)) {
          const textParts = msg.content
            .filter((b) => b.type === "text")
            .map((b) => b.text)
            .join("");
          const toolUses = msg.content.filter((b) => b.type === "tool_use");

          const assistantMsg = {
            role: "assistant",
            content: textParts || null,
          };

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
          formatted.push({
            role: "assistant",
            content: msg.content,
          });
        }
      }
    }

    return formatted;
  },

  /**
   * Call OpenAI Chat Completions and return normalized response.
   */
  async call(apiKey, model, systemPrompt, messages, tools, signal) {
    const formattedMessages = [
      { role: "system", content: systemPrompt },
      ...this.formatMessages(messages),
    ];

    const body = {
      model: model,
      messages: formattedMessages,
      max_tokens: 4096,
    };

    // Only include tools if we have them
    if (tools && tools.length > 0) {
      body.tools = this.formatTools(tools);
    }

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`OpenAI API ${response.status}: ${errorBody.substring(0, 200)}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];

    if (!choice) {
      throw new Error("OpenAI returned no choices");
    }

    // Normalize to our unified format
    return this._normalizeResponse(choice);
  },

  /**
   * Normalize OpenAI response to unified format.
   */
  _normalizeResponse(choice) {
    const content = [];
    const msg = choice.message;

    // Add text content if present
    if (msg.content) {
      content.push({ type: "text", text: msg.content });
    }

    // Convert tool_calls to our format
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      for (const tc of msg.tool_calls) {
        let parsedArgs = {};
        try {
          parsedArgs = JSON.parse(tc.function.arguments);
        } catch {
          console.warn("[OpenAI] Failed to parse tool arguments:", tc.function.arguments);
        }

        content.push({
          type: "tool_use",
          id: tc.id,
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
   * Build tool result messages in OpenAI format.
   */
  buildToolResultMessage(toolResults) {
    // OpenAI expects each tool result as a separate role:"tool" message
    // But we return in our unified format; conversion happens in formatMessages
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
