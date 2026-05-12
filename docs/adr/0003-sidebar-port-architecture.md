# ADR 0003 — Sidebar ↔ Background uses a long-lived port, not request/response

**Status:** Accepted (2025-Q4) · **Last reviewed:** 2026-05-12

## Context

The agent loop streams text deltas, tool-use events, screenshots, and policy warnings to the sidebar over time. A `runtime.sendMessage` request/response model would require either a stream of one-shot messages (loses ordering and ack guarantees) or polling (laggy, wasteful).

## Decision

The sidebar opens a long-lived port: `browser.runtime.connect({ name: "topologica-sidebar" })`. The background subscribes via `runtime.onConnect`. All UI updates are unidirectional `port.postMessage(event)` calls; user actions flow back the same way.

Sender validation in the background's `onConnect` rejects ports whose `port.sender.tab` is set (content-script origin) and ports from other extensions, so only the sidebar / options pages can reach the privileged side.

When the port disconnects (sidebar closed, service-worker restart, browser update mid-session), the background `port.onDisconnect` aborts any in-flight `state.abortController` so the agent stops spending tokens against a UI that nobody can see.

## Consequences

- Streaming and tool-call events arrive in order without ack ceremony.
- The sidebar reconnects on disconnect after a short delay so a service-worker restart looks like a brief blink, not a broken UI.
- Disconnect-as-abort closes a class of "agent ran for 25 turns after I closed the tab" bug.
- Ports cannot carry binary; image payloads are passed as base64 data URLs.

## Related

- `background/background.js` `runtime.onConnect` handler
- `sidebar/sidebar.js` `connectPort`
- ADR 0004 (preview gate uses the same port)
