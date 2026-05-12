# ADR 0002 — Canonical message format is Anthropic-shaped

**Status:** Accepted (2025-Q4) · **Last reviewed:** 2026-05-12

## Context

The extension supports four LLM providers with materially different message formats: Anthropic's content-block array, OpenAI's `tool_calls` + `role:"tool"` messages, Google's `parts` with UPPERCASE schema types, Ollama's OpenAI-compatible variant. The router and agent loop need a single shape to reason about; pick one wisely or each provider becomes a leaky abstraction.

## Decision

The internal canonical format mirrors Anthropic's: messages are `{ role, content }` where `content` may be a string or an array of typed blocks (`text`, `tool_use`, `tool_result`, `image`). Each provider module's `formatMessages` translates from this canonical form to its native shape on the way out, and `_normalizeResponse` translates the native response back on the way in.

Anthropic was chosen because:

1. Its content-block model is the most expressive — every other provider's shape can be derived from it.
2. Tool-use semantics (`tool_use` block + `tool_result` echo) round-trip cleanly through history.
3. We already need an Anthropic provider module; making its `formatMessages` an identity function is honest about the choice.

## Consequences

- New providers convert in/out via `formatMessages` + `_normalizeResponse`. The contract is documented in `docs/PROVIDERS.md`.
- Tool-result handling for OpenAI-style providers requires unrolling the canonical `[{type:"tool_result", …}, …]` list into separate `role:"tool"` messages — a known cost.
- The image block (`{type:"image", dataUrl}`) is internally provider-agnostic; each provider translates to its own shape (`source.base64`, `image_url`, `inlineData`).

## Related

- `background/providers/index.js` (router)
- `docs/PROVIDERS.md` (the unified-format contract)
