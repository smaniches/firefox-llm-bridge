# Notes for AMO Reviewers

This document is addressed to Mozilla Add-ons reviewers. It explains permission requests, network endpoints, build reproducibility, and where to find anything you might need.

Thank you for your time.

## Build Reproducibility

This extension uses **no bundlers, transpilers, or minifiers**. What you see in the repository is exactly what runs in the browser. Source files map 1:1 to the files in the `.xpi` ZIP.

To verify a release artifact:

```bash
git clone https://github.com/smaniches/firefox-llm-bridge.git
cd firefox-llm-bridge
git checkout v0.2.0
npm install
npm run build       # produces dist/firefox_llm_bridge-0.2.0.zip
unzip -l dist/firefox_llm_bridge-0.2.0.zip
```

The contents should match the repository at that tag, excluding only `node_modules/`, `dist/`, `tests/`, `docs/`, `.github/`, and other dev-only paths.

## Runtime Dependencies

**Zero.**

The `package.json` contains development dependencies only (Vitest, web-ext, ESLint, Prettier, jsdom). None ship in the `.xpi`. The `manifest.json` `background.type: module` loads `background/background.js`, which uses only the `browser.*` WebExtension API and the platform `fetch` global.

## Permissions Justification

| Permission                                                   | Why it is required                                                                                                                             |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `activeTab`                                                  | Read the currently active page when the user invokes the agent (the sole entry point for any page interaction).                                |
| `tabs`                                                       | Read tab URL/title (`get_tab_info` tool), navigate (`navigate` tool, `go_back` tool), and message the content script.                          |
| `scripting`                                                  | Inject the content script declaratively at document_idle. Required for the accessibility-tree sensor.                                          |
| `storage`                                                    | Persist the user's chosen provider, model selection, API key (encrypted at the OS level by Firefox's profile storage), and `maxTurns` setting. |
| `contextMenus`                                               | Add the right-click "Ask LLM Bridge about selection" entry to invoke the chat mode on highlighted text.                                        |
| `notifications`                                              | Reserved for future use (e.g., agent completion when the user is on another tab). Currently no `browser.notifications.*` calls in code.        |
| `webNavigation`                                              | Used in `executeTool("navigate")` to await `onCompleted` and avoid racing the next agent action against the page load.                         |
| `<all_urls>` host permission                                 | The agent is general-purpose; it must be able to operate on any page the user invokes it on.                                                   |
| `http://localhost/*`, `http://127.0.0.1/*`, `http://[::1]/*` | Talk to the user's local Ollama server on either IPv4 or IPv6 loopback.                                                                        |

`webRequest`, `nativeMessaging`, `cookies`, `clipboardRead`, `clipboardWrite`, `downloads`, `history`, `bookmarks`, `proxy`, `management`, `tabHide`, `unlimitedStorage` are **not** requested.

## Network Endpoints

The CSP `connect-src` directive enumerates every domain the extension can contact:

```
connect-src 'self'
            http://localhost:*
            http://127.0.0.1:*
            http://[::1]:*
            https://api.anthropic.com
            https://api.openai.com
            https://generativelanguage.googleapis.com
```

No other endpoints. No analytics. No CDN. No phone-home. No telemetry beacons.

To verify, grep the source:

```bash
grep -rE "fetch\(|XMLHttpRequest|navigator.sendBeacon" --include='*.js' .
```

You will find `fetch` calls only inside `background/providers/*.js` and `options/options.js` (for the "Test Connection" buttons), all pointing at the four endpoints above.

## Remote Code

**None loaded at runtime.**

- No `eval`, no `new Function`.
- No `<script src="https://...">` in any HTML.
- No `import('https://...')` in any JS.

To verify:

```bash
grep -rE "\beval\(|new Function\(|src=\"http" --include='*.js' --include='*.html' .
```

(The single hit on `eval` will be inside license boilerplate text in `LICENSE`.)

## Data Collection by the Developer

**None.**

The developer (TOPOLOGICA LLC, Santiago Maniches) does not collect, receive, store, or process any data from users. There is no developer-controlled server.

The manifest's `data_collection_permissions` declares `hostnames: []` and `purposes: ["functionality"]`, with the explanatory note:

> Page content is sent only to the user-configured LLM provider (Ollama local, Anthropic, OpenAI, or Google). No data is collected by the extension developer. API keys are stored locally.

See [PRIVACY.md](../PRIVACY.md) for the full privacy posture.

## API Keys

- Stored only in `browser.storage.local`.
- Never logged to console.
- Never sent over the network except as the appropriate auth header to the matching provider domain.

To verify:

```bash
grep -rE "console\.(log|debug|info).*\b(key|apiKey|api_key)\b" --include='*.js' .
```

No matches outside of test fixtures.

## Content Script Behavior

`content/sensor.js` (470 lines, single file, IIFE):

1. Sets `window.__topologicaBridgeInjected` to prevent double-injection.
2. Registers `browser.runtime.onMessage` listener.
3. On message: builds a semantic accessibility map (read), or dispatches DOM events for click/type/scroll (act).

The script **does not**:

- Run on its own — it only acts when the background sends a message
- Modify page content unless executing a user-authorized agent action
- Read or write cookies
- Make network requests
- Use `eval` or `Function`

When setting input values for the `type_text` action, the script uses the native `HTMLInputElement.prototype` value setter to ensure React/Vue/framework listeners receive the change event. This is a standard well-documented technique, not exploitation.

## Sidebar and Options

Both are local HTML files loaded under `moz-extension://` origin. They:

- Use the strict default MV3 CSP (no inline scripts, no inline event handlers)
- Communicate with the background via `browser.runtime.connect` (sidebar) or `browser.storage` (options)
- Do not load any remote resources

## Code Quality

The repository ships scripts for the following local checks (each defined in `package.json`):

- `npm run lint` — ESLint with `eslint:recommended` configuration
- `npm run format:check` — Prettier
- `npm run typecheck` — JSDoc-based type checking via `tsc --noEmit`
- `npm run test:coverage` — Vitest with a 100% coverage threshold configured in `vitest.config.js`
- `npm run lint:webext` — Mozilla's `web-ext lint`

A GitHub Actions workflow (`.github/workflows/ci.yml`) runs these on every push and pull request once the repository moves to public/CI-enabled mode. Until then, these can be reproduced locally with the commands above.

## Source Layout

Approximate line counts as of v0.6.0 (run `wc -l` in the repo to verify):

```
manifest.json
LICENSE            Apache-2.0
NOTICE
README.md          Public-facing overview
CHANGELOG.md
PRIVACY.md
SECURITY.md
CONTRIBUTING.md
CODE_OF_CONDUCT.md
CITATION.cff

background/
  background.js          ~1500 lines — agent loop, sidebar port, tool dispatcher
  providers/
    index.js              ~180 lines — provider router
    anthropic.js          ~330 lines — Messages API + SSE stream + caching
    openai.js             ~330 lines — Chat Completions + SSE stream
    google.js             ~340 lines — Gemini generateContent + streamGenerateContent
    ollama.js             ~370 lines — local OpenAI-compatible + NDJSON stream
  lib/
    http.js               ~190 lines — fetchWithRetry, timeouts, signal composition
    errors.js             ~140 lines — typed error hierarchy + HTTP-status classifier
    stream.js             ~140 lines — SSE + NDJSON parsers used by providers
    pricing.js            ~110 lines — model pricing table + cost computation
    policy.js             ~220 lines — domain allow/blocklist, preview gate, injection scan
    vision.js              ~35 lines — image data-URL parsing for vision payloads
    log.js                ~160 lines — namespaced ring-buffered logger (off by default)

content/
  sensor.js              ~750 lines — accessibility map + DOM actions

sidebar/
  sidebar.html, .css, .js — chat/agent UI; sidebar.js wires the port + render loop
  utils.js               — pure render helpers (markdown, summarize, tool icons)

options/
  options.html, .css, .js — provider configuration + safety policy + debug toggle

_locales/
  en/messages.json       i18n strings (full UI wiring tracked in ROADMAP)

icons/
  icon-{16,32,48,128}.png

docs/
  ARCHITECTURE.md
  PROVIDERS.md
  THREAT_MODEL.md
  AMO_REVIEW.md          (this file)
  ROADMAP.md
  BENCHMARKING.md
  AUDIT_2026-05.md
  adr/                   Architecture Decision Records

tests/
  setup.js               browser + fetch mocks
  background/            agent loop, tool dispatcher
  content/               sensor + actor
  sidebar/               UI controller + utils
  options/               provider configuration
  providers/             one file per provider
  lib/                   http, errors, stream, pricing, policy, vision, log
  privacy-regression.test.js   greps shipped source for telemetry / remote code
  manifest-consistency.test.js version + script contract
  bench.test.js          bench-harness schema + baseline drift guard
  e2e/                   Playwright + web-ext (opt-in)

bench/
  runner.js, launch.js   benchmark harness (Apache-2.0 fixtures only)
  tasks/<id>/            self-contained task fixture (HTML + JSON)
  baselines/dry.json     locked dry-run output for CI drift detection
```

## Contact for Reviewer Questions

- General: hello@topologica.ai
- Security: security@topologica.ai
- Privacy: privacy@topologica.ai
- Author: Santiago Maniches, ORCID 0009-0005-6480-1987

## Acknowledgment

We have read and follow the [Mozilla Add-on Policies](https://extensionworkshop.com/documentation/publish/add-on-policies/) and the [Manifest V3 migration guide](https://extensionworkshop.com/documentation/develop/manifest-v3-migration-guide/).

If you find anything in this submission that does not align with policy or that needs clarification, please tell us; we will fix it within five business days.
