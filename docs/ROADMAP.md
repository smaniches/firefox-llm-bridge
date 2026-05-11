# Roadmap

This file separates **what the extension does today** from **what is planned**. Anything not in the "Shipping today" section is **not yet implemented**.

Last updated: 2026-05-11

---

## Shipping today (v0.2.0)

| Capability                                                                                                       | Status |
| ---------------------------------------------------------------------------------------------------------------- | ------ |
| Sidebar chat with the configured LLM                                                                             | Works  |
| Agent mode (multi-step task execution)                                                                           | Works  |
| Providers: Ollama, Anthropic, OpenAI, Google                                                                     | Works  |
| BYOK API-key configuration in Options page                                                                       | Works  |
| Local-only Ollama mode (no cloud)                                                                                | Works  |
| Accessibility-tree page sensor                                                                                   | Works  |
| DOM actions: click, type, scroll, navigate, extract text, screenshot, wait, go back, get tab info, task complete | Works  |
| Turn limit + abort control                                                                                       | Works  |
| Right-click "Ask about selection" context menu                                                                   | Works  |
| Apache-2.0 license, governance docs, threat model                                                                | Works  |

---

## In progress

| Capability                                                           | Track        | Target |
| -------------------------------------------------------------------- | ------------ | ------ |
| 100% unit-test coverage with V8 provider                             | quality      | v0.3.0 |
| GitHub Actions CI (lint, typecheck, test, web-ext lint, npm audit)   | quality      | v0.3.0 |
| Reproducible signed `.xpi` release workflow                          | distribution | v0.3.0 |
| `browser.i18n.getMessage` wired through UI                           | a11y/i18n    | v0.3.0 |
| `prefers-color-scheme` light/dark adaptation                         | a11y/UX      | v0.3.0 |
| ARIA + keyboard-navigation audit on sidebar and options              | a11y         | v0.3.0 |
| Retry with exponential backoff and per-request timeouts in providers | reliability  | v0.3.0 |
| Typed error hierarchy with actionable UI messages                    | reliability  | v0.3.0 |
| 429 `Retry-After` handling                                           | reliability  | v0.3.0 |
| Vision-mode: screenshot bytes piped into provider request            | capability   | v0.3.0 |

---

## Planned (next releases)

| Capability                                                              | Notes                                                      |
| ----------------------------------------------------------------------- | ---------------------------------------------------------- |
| Hover, drag, multi-key keyboard events as new agent tools               | Stays within WebExtension capabilities                     |
| Mutation-observer-driven sensor refresh                                 | Page is dynamic; today the model re-reads when needed      |
| Multi-tab orchestration (open new tabs, switch tabs as an agent action) | Requires new `tabs.create` tool + safety review            |
| Streaming responses (SSE)                                               | All four providers support it; UI needs incremental render |
| Conversation export (JSON) + optional persistence                       | User-controlled                                            |
| Cost / token-usage estimator in sidebar                                 | Read response usage fields where available                 |
| Right-click "Send page to agent"                                        | Extends current context menu                               |
| Saved prompt presets / agent personas                                   | Local-only                                                 |
| Provider plug-in API (load a custom provider from a local file)         | Requires careful security review                           |

---

## Out of scope (and why)

| Capability                                                 | Reason                                                                                                                                        |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Moving the operating-system cursor                         | Not possible from a WebExtension sandbox. Would require a separate Native Messaging host application, distributed and reviewed independently. |
| Reading content from other extensions' UI                  | Not exposed by Firefox; would be a privacy regression.                                                                                        |
| Background "always-on" agent that acts without user prompt | Out of scope by design. Agent runs only on user invocation.                                                                                   |
| Sending data anywhere except the user-chosen provider      | Out of scope by design. The extension developer has no server.                                                                                |
| CAPTCHA solving                                            | The agent halts and asks the user; we will not ship CAPTCHA bypass.                                                                           |
| Credential autofill / password capture                     | Out of scope. Firefox's built-in password manager covers this; the agent's `type_text` is for non-credential fields.                          |

---

## How to influence the roadmap

- File an issue with the `roadmap` label and a concrete use case.
- Open a PR adding a feature behind a small, focused design doc (see [CONTRIBUTING.md](../CONTRIBUTING.md)).
- For security-impacting features, please coordinate first via [SECURITY.md](../SECURITY.md).

---

## What this roadmap is not

- **Not a promise.** Items here may be reordered, deferred, or dropped. The git history is the source of truth for what actually shipped.
- **Not a marketing list.** Items appear here when they have a clear path to implementation, not when they sound good.
- **Not a feature menu for partners.** This is a community project; priorities follow contributor capacity and user reports.
