# Adding a New LLM Provider

This guide walks through adding a fifth provider to Firefox LLM Bridge.

## The Provider Contract

Every provider lives in `background/providers/<id>.js` and exports a single object implementing this interface:

```js
export const myprovider = {
  // --- identity ---
  id: "myprovider",            // lowercase, unique
  name: "My Provider",         // display name
  requiresKey: true,           // false for local providers
  keyPrefix: "mp-",            // for cheap client-side validation
  endpoint: "https://api.myprovider.example/v1/chat",

  models: [
    { id: "model-large", name: "Large", default: true },
    { id: "model-small", name: "Small (fast)" },
  ],

  validateKey(key) { /* return boolean */ },
  formatTools(tools) { /* convert unified tools → native */ },
  formatMessages(messages) { /* convert unified messages → native */ },
  async call(apiKey, model, systemPrompt, messages, tools, signal) {
    // POST to API, return unified response
    return { content: [...], stop_reason: "end_turn" | "tool_use" };
  },
  buildToolResultMessage(toolResults) {
    // Build a message in unified format that the next formatMessages call
    // will convert correctly
  },
};
```

## The Unified Internal Format

The router (`background/providers/index.js`) and `background/background.js` work in an Anthropic-shaped canonical format. Each provider's job is to convert in and out.

**Unified response** (returned by `provider.call`):

```js
{
  content: [
    { type: "text", text: "Some text" },
    { type: "tool_use", id: "call_123", name: "click_element", input: { selector: "#btn" } }
  ],
  stop_reason: "tool_use" | "end_turn"
}
```

**Unified message history** (passed in to `formatMessages`):

```js
[
  { role: "user", content: "string content" },
  { role: "assistant", content: [
      { type: "text", text: "..." },
      { type: "tool_use", id: "call_123", name: "...", input: {...} }
  ]},
  { role: "user", content: [
      { type: "tool_result", tool_use_id: "call_123", content: "..." }
  ]},
]
```

## Step-by-Step

### 1. Create the provider module

`background/providers/myprovider.js` — implement the contract above. Use `background/providers/openai.js` as the closest template if the API is OpenAI-shaped.

### 2. Register the provider

`background/providers/index.js`:

```js
import { myprovider } from "./myprovider.js";

const PROVIDERS = {
  ollama,
  anthropic,
  openai,
  google,
  myprovider,   // <-- add here
};
```

### 3. Add a settings card

`options/options.html`:

```html
<div class="provider-card" data-provider="myprovider">
  <span class="card-badge badge-byok">BYOK</span>
  <div class="card-name">My Provider</div>
  <div class="card-desc">Model family description</div>
</div>

<div class="section provider-config" id="config-myprovider">
  <h2>My Provider</h2>
  <p>Get your key from <a href="..." target="_blank">...</a></p>
  <div class="field">
    <label for="myprovider-key">API Key</label>
    <input type="password" id="myprovider-key" placeholder="mp-..." autocomplete="off">
  </div>
  <div class="field">
    <label for="myprovider-model">Model</label>
    <select id="myprovider-model">
      <option value="model-large" selected>Large</option>
    </select>
  </div>
  <div class="btn-row">
    <button id="myprovider-save" class="btn btn-primary">Activate</button>
    <button id="myprovider-test" class="btn btn-secondary">Test Connection</button>
  </div>
  <div id="myprovider-status" class="status-msg"></div>
</div>
```

`options/options.js` — add save and test handlers following the existing pattern.

### 4. Add CSP entry

`manifest.json` `content_security_policy.extension_pages.connect-src` must list your provider's domain:

```
connect-src 'self' ... https://api.myprovider.example
```

### 5. Add tests

`tests/providers/myprovider.test.js` — required for coverage gate. Mirror the structure of `tests/providers/openai.test.js`. Cover every branch of `formatTools`, `formatMessages`, `call`, `_normalizeResponse`, and `buildToolResultMessage`. The 100% coverage threshold in `vitest.config.js` will fail CI otherwise.

### 6. Update documentation

- README provider table
- This file (note any provider-specific quirks)
- [CHANGELOG.md](../CHANGELOG.md) under "Unreleased / Added"

## Provider-Specific Notes

### Anthropic
- Canonical internal format — `formatMessages` is identity.
- Requires `anthropic-dangerous-direct-browser-access: true` header (BYOK from a browser).
- Tool format uses `input_schema`, not `parameters`.

### OpenAI
- Tools wrapped as `{ type: "function", function: { name, description, parameters } }`.
- Tool calls return arguments as **JSON strings** — must `JSON.parse`.
- Tool results are separate `role: "tool"` messages, not nested.

### Google Gemini
- JSON Schema types must be **UPPERCASED** (`STRING`, `OBJECT`, `ARRAY`) — see `_convertSchema`.
- Roles: `user` and `model` (not `user` / `assistant`).
- Tool calls are `functionCall` parts, tool results are `functionResponse` parts.
- API key currently passed as a header (`x-goog-api-key`) — never in the URL.

### Ollama
- OpenAI-compatible at `/v1/chat/completions`.
- CORS gotcha: user must set `OLLAMA_ORIGINS=moz-extension://*`.
- `detectModels()` queries `/api/tags` to populate the model dropdown.
- Tool support varies by model — some local models cannot reliably tool-call.

## Testing Your Provider Locally

1. Load the extension: `npm run dev`
2. Open the sidebar, click the gear, select your provider.
3. Click Test Connection.
4. Activate.
5. Try Chat mode first ("hello?"). Then Agent mode ("scroll down").
6. Use `about:debugging` → Inspect → Console to watch for errors.

## Anti-Patterns

- Do **not** import provider modules from anywhere except `background/providers/index.js`. The router is the single entry point.
- Do **not** call browser APIs (`browser.tabs`, `browser.storage`) from inside a provider module. Providers should be pure.
- Do **not** add runtime dependencies — write `formatTools` and `formatMessages` by hand.
- Do **not** put API keys in URLs or log them. Use headers; never `console.log` the key.
