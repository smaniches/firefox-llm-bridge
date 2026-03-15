/**
 * ANTHROPIC PROVIDER
 * Firefox LLM Bridge | TOPOLOGICA LLC
 *
 * Handles communication with Anthropic's Messages API.
 * Tool calls use input_schema, content blocks, tool_result messages.
 */

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
   * Anthropic messages are passed as-is (our internal format matches Anthropic's).
   * Tool results must be user messages with tool_result content blocks.
   */
  formatMessages(messages) {
    return messages;
  },

  /**
   * Call the Anthropic Messages API and return normalized response.
   */
  async call(apiKey, model, systemPrompt, messages, tools, signal) {
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
      }),
      signal,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Anthropic API ${response.status}: ${body.substring(0, 200)}`);
    }

    const data = await response.json();

    // Anthropic's native format already matches our unified format
    return {
      content: data.content,
      stop_reason: data.stop_reason === "tool_use" ? "tool_use" : "end_turn",
    };
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
