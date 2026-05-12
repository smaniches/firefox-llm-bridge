# ADR 0006 — Provider contract is small, pure, and isolated

**Status:** Accepted (2025-Q4) · **Last reviewed:** 2026-05-12

## Context

Adding a new LLM provider should be a self-contained change. The agent loop, the sensor, and the UI must not need to know which provider is active. Conversely, providers must not reach into browser APIs or shared state — that reverses the dependency direction and makes them untestable in isolation.

## Decision

Each provider exports a single object implementing this contract (see `docs/PROVIDERS.md`):

```js
export const myprovider = {
  id, name, requiresKey, keyPrefix, endpoint, models,
  validateKey(key),
  formatTools(tools),                                          // → native tool format
  formatMessages(messages),                                    // → native message format
  call(apiKey, model, systemPrompt, messages, tools, signal,
       endpoint?, onTextChunk?),                               // → unified response
  buildToolResultMessage(toolResults),                         // → unified message
};
```

Hard rules:

1. Providers may only depend on shared utilities under `background/lib/` (`http.js`, `errors.js`, `stream.js`, `pricing.js`, `vision.js`). They must not import `browser.*` or `background.js`.
2. Providers must throw typed errors from `lib/errors.js` so the UI can render them uniformly.
3. Non-streaming calls must go through `lib/http.js#fetchWithRetry`. Streaming bypasses retry but still uses `lib/stream.js` parsers.
4. Tool definitions in `background/background.js#BROWSER_TOOLS` are provider-agnostic — providers convert in their `formatTools`.

## Consequences

- Adding a fifth provider is ~250 lines + a test file mirroring `tests/providers/openai.test.js`.
- The router in `background/providers/index.js` stays trivial: registry + dispatch.
- Coverage of provider modules can be exhaustive without booting a browser, because nothing depends on `browser.*`.
- Future plug-in providers (loaded from a local file at runtime) are gated by a security review because they would punch through the "no remote code" hard constraint.

## Related

- `docs/PROVIDERS.md` (step-by-step contract)
- ADR 0002 (the canonical message format providers translate to/from)
