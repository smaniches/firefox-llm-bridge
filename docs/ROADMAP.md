# Roadmap

This file separates **what the extension does today** from **what is planned**. Anything not in the "Shipping today" section is **not yet implemented**.

Last updated: 2026-05-12

---

## Shipping today (v0.6.0)

| Capability                                                                                                                                                       | Status |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Sidebar chat with the configured LLM                                                                                                                             | Works  |
| Agent mode (multi-step task execution)                                                                                                                           | Works  |
| Providers: Ollama, Anthropic, OpenAI, Google (BYOK)                                                                                                              | Works  |
| Local-only Ollama mode (no cloud)                                                                                                                                | Works  |
| Accessibility-tree page sensor                                                                                                                                   | Works  |
| Action tools: click, type, scroll, navigate, hover, press_key, drag_drop, upload_file, download_file, set_value, focus_element, wait_for_element, execute_script | Works  |
| Sensor tools: read_page, extract_text, screenshot, find_on_page, get_selection                                                                                   | Works  |
| Tab tools: list_tabs, switch_tab, new_tab, close_tab, get_tab_info                                                                                               | Works  |
| Vision mode: screenshot bytes piped into the provider request                                                                                                    | Works  |
| Persistent memory: remember / recall / forget with quota + FIFO eviction                                                                                         | Works  |
| Streaming responses (SSE for Anthropic/OpenAI/Google, NDJSON for Ollama)                                                                                         | Works  |
| Anthropic prompt caching with cache-token accounting                                                                                                             | Works  |
| Anthropic extended thinking (opt-in)                                                                                                                             | Works  |
| Retry with exponential backoff + jitter, per-request timeouts, `Retry-After` honouring                                                                           | Works  |
| Typed error hierarchy (`AuthError` / `RateLimitError` / `NetworkError` / `ProviderError`) with retry buttons in the UI                                           | Works  |
| Turn limit + abort control + abort-on-sidebar-disconnect                                                                                                         | Works  |
| Preview gate for destructive tools (configurable: off / destructive-only / all)                                                                                  | Works  |
| Domain allowlist + blocklist                                                                                                                                     | Works  |
| Heuristic prompt-injection scanner + `[BEGIN UNTRUSTED PAGE CONTENT]` framing                                                                                    | Works  |
| Password-field redaction in the accessibility map                                                                                                                | Works  |
| Structured logger with redaction + downloadable session trace (off by default)                                                                                   | Works  |
| Right-click "Ask about selection" context menu                                                                                                                   | Works  |
| Browser-agent benchmark harness (dry mode in CI; real mode wiring next)                                                                                          | Works  |
| 100% unit-test coverage with V8 provider                                                                                                                         | Works  |
| GitHub Actions CI (lint + Prettier + typecheck + test + web-ext lint + build)                                                                                    | Works  |
| Reproducible signed `.xpi` release workflow + CycloneDX SBOM                                                                                                     | Works  |
| Apache-2.0 license, governance docs, threat model, AMO submission notes                                                                                          | Works  |

---

## In progress (target v0.7.0)

| Capability                                                         | Track     |
| ------------------------------------------------------------------ | --------- |
| `browser.i18n.getMessage` wired through every UI string            | a11y/i18n |
| `prefers-color-scheme` light/dark adaptation                       | a11y/UX   |
| ARIA + keyboard-navigation audit on sidebar and options            | a11y      |
| Real-mode bench launcher (Playwright + web-ext)                    | quality   |
| Conversation export / import as JSON (validated, never auto-execs) | UX        |
| Memory governance UI (list, search, delete) in Options             | UX        |
| Optional screenshot redaction toggle                               | privacy   |
| Prompt-injection fuzz corpus + property tests                      | security  |

---

## Planned (next releases, post-v0.7.0)

| Capability                                                      | Notes                                                         |
| --------------------------------------------------------------- | ------------------------------------------------------------- |
| Mutation-observer-driven sensor refresh                         | Today the model re-reads on demand                            |
| Right-click "Send page to agent"                                | Extends the existing context menu                             |
| Saved prompt presets / agent personas                           | Local-only, no server                                         |
| Provider plug-in API (load a custom provider from a local file) | Needs a careful security review before shipping               |
| Opt-in provider failover                                        | e.g. retry on Ollama if Anthropic returns NETWORK             |
| Cost-ceiling guardrail                                          | Hard-stop the agent when session USD exceeds a user-set limit |
| Replay tooling                                                  | Re-run a captured logger session against a stub LLM           |
| WebArena / Mind2Web bench-suite adapter                         | Optional; the harness contract is compatible                  |

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
