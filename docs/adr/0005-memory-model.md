# ADR 0005 — Persistent memory: bounded, FIFO-evicted, never holds secrets

**Status:** Accepted (2026-Q1) · **Last reviewed:** 2026-05-12

## Context

The agent ships a `remember` / `recall` / `forget` tool family so it can persist preferences and frequently used context across sessions. Without bounds, a chatty model can fill `browser.storage.local` (10 MB quota) with redundant entries. Without conventions, the model may store credentials.

## Decision

- **Storage:** entries live in `browser.storage.local` under the key `agentMemory`. Plain JSON, no encryption beyond what the OS provides for the Firefox profile.
- **Bounds:** `MEMORY_MAX_ENTRIES = 100` (FIFO eviction past the cap), `MEMORY_MAX_ENTRY_CHARS = 4000` (truncation past the cap). Empty content is rejected.
- **Schema:** `{ id: UUID, key: string|null, content: string, timestamp: number }`.
- **Sensitive values:** the system prompt forbids storing passwords, payment details, or session tokens; the sensor's password redaction (ADR 0006-adjacent) means password values never enter the conversation history that the model could `remember` from.
- **Loading:** memories are flushed into the system prompt at every turn so the model has cross-session context without consuming a tool call. `recall` exists for targeted lookup when the system-prompt summary is insufficient.

## Consequences

- Worst-case storage footprint is ~400 KB plus the (also-bounded) persisted conversation history. Far below the 10 MB quota.
- The user can clear all memories by removing the extension, by clearing storage in `about:debugging`, or — when v0.7.0 ships the memory-governance UI — from the Options page directly.
- Loading every memory into the system prompt costs prompt tokens; the cap keeps the cost bounded and Anthropic prompt caching makes the cost amortise to near-zero across consecutive turns.

## Related

- `background/background.js` `executeTool("remember"|"recall"|"forget")`
- `background/background.js` `MEMORY_MAX_ENTRIES`, `MEMORY_MAX_ENTRY_CHARS`
- `docs/AUDIT_2026-05.md` finding B4
