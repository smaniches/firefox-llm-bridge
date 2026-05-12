# ADR 0004 — Preview gate is default-on for destructive tools

**Status:** Accepted (2026-Q1) · **Last reviewed:** 2026-05-12

## Context

The agent can click, type, navigate, evaluate JS, drag-and-drop, upload, download, and switch tabs on the user's behalf. Any of these can be hijacked by a prompt-injection attack from page text, or simply mis-fired by a model that misread the accessibility tree. We want a defense that doesn't require power-user configuration to take effect.

## Decision

`previewMode` defaults to `"destructive"`. Every tool in `DESTRUCTIVE_TOOLS` (`background/lib/policy.js`) surfaces a one-click preview overlay before execution. The user sees the tool name, its inputs, and Approve / Cancel buttons. Approval resolves a promise inside the agent loop; cancellation feeds an explicit `{ error: "Tool call cancelled by user." }` result back to the model so the model can replan.

The set was widened in v0.6.0 to include `execute_script` and `set_value` after the audit found those two could be used to read DOM cookies / sessionStorage and bypass keyboard simulation respectively.

Power users can opt down to `"off"` (no prompts) or up to `"all"` (every tool prompts) in Options.

## Consequences

- A first-time user on default settings is protected without reading any docs.
- The model is forced to respect human-in-the-loop for irreversible actions; the agent's CONFIRM-BEFORE-IRREVERSIBLE policy in the system prompt is enforced regardless of model alignment.
- Destructive-tool batches that touch many elements at once incur many prompts; this is a deliberate trade-off and the user can flip to `"off"` for a focused unattended task.

## Related

- `background/lib/policy.js` (`DESTRUCTIVE_TOOLS`, `shouldPreview`)
- `sidebar/sidebar.js` (`showPreview`, `respondToPreview`)
- `docs/THREAT_MODEL.md` Adversary A1 mitigations
