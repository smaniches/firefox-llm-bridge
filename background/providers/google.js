/**
 * GOOGLE GEMINI PROVIDER
 * Firefox LLM Bridge | TOPOLOGICA LLC
 *
 * Handles communication with Google's Gemini generateContent API.
 * Tool calls use functionDeclarations with UPPERCASED types,
 * functionCall parts, and functionResponse for results.
 */

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
   * Call Gemini generateContent and return normalized response.
   */
  async call(apiKey, model, systemPrompt, messages, tools, signal) {
    const url = `${this.endpoint}/${model}:generateContent?key=${apiKey}`;

    const body = {
      contents: this.formatMessages(messages),
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
    };

    if (tools && tools.length > 0) {
      body.tools = this.formatTools(tools);
    }

    // Gemini config
    body.generationConfig = {
      maxOutputTokens: 4096,
      temperature: 0.7,
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Gemini API ${response.status}: ${errorBody.substring(0, 200)}`);
    }

    const data = await response.json();
    return this._normalizeResponse(data);
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
