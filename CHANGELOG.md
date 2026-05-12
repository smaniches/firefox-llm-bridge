# Changelog

All notable changes to Firefox LLM Bridge will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.6.0] - 2026-05-12

### Added — security & privacy hardening

- **Password redaction in the sensor.** `input[type="password"]`,
  `autocomplete="current-password" | "new-password" | "one-time-code"`,
  and any input opting in via `data-sensitive` are emitted with
  `value: "<redacted>"` instead of their literal contents. The label
  fallback path that previously surfaced `[value: …]` is redacted in
  the same way, so partial leaks via label inference are closed too.
  System prompt was updated with an explicit SENSITIVE-INPUT POLICY so
  the model knows not to ask the user for passwords or OTPs.
- **`execute_script` and `set_value` are now in `DESTRUCTIVE_TOOLS`.**
  The default `previewMode: "destructive"` now surfaces a user
  confirmation overlay before the model can evaluate arbitrary JS in
  the page or bypass keyboard simulation on framework-controlled
  inputs.
- **CSP hardened with defense-in-depth directives.**
  `default-src 'none'`, `style-src 'self'`, `img-src 'self' data: blob:`,
  `frame-ancestors 'none'`, `base-uri 'none'`, `form-action 'none'`.
  The privacy-regression suite asserts these directives stay set.
- **Memory governance.** `remember` enforces a 100-entry cap and a
  4 KB per-entry size limit; empty content is rejected; oldest entries
  evict FIFO when the cap is exceeded. Eviction and truncation surface
  in the tool-result payload so the model knows what happened.

### Added — reliability & observability

- **Retries, timeouts, and typed errors wired into every provider.**
  Non-streaming calls go through `lib/http.js#fetchWithRetry`, which
  honours `Retry-After`, retries 5xx and transient network failures
  with exponential backoff + jitter, and surfaces typed
  `AuthError` / `RateLimitError` / `NetworkError` / `ProviderError`
  to the UI. Streaming calls bypass retry (cannot safely resume
  mid-stream) but still emit typed errors. The sidebar renders a code
  badge and a Retry button for retryable failures; Ollama keeps its
  operator-friendly "Cannot connect" hint with the typed error
  preserved as `.cause`.
- **Cache-token accounting.** Anthropic prompt-cache reads and
  creations now persist in `state.cost` alongside prompt and
  completion tokens; survive session restores; survive `CLEAR_HISTORY`.
- **Sidebar disconnect aborts the in-flight agent.** Service-worker
  restarts and user-closes-the-sidebar no longer leave the model
  spending tokens against a UI that nobody can see.
- **Structured logger** in `background/lib/log.js` — namespaced,
  ring-buffered (500-event cap), credential-redacting,
  off-by-default. New "Debug logging" toggle in Options enables it
  and the sidebar exposes a `GET_SESSION_LOG` port message that
  returns a redacted JSON dump for bug reports. Nothing leaves the
  device.

### Added — testing & benchmarking

- **Browser-agent task harness under `bench/`.** Three reference
  tasks (`click-the-link`, `fill-form`, `find-text`), deterministic
  dry runner with a CI-gated baseline at `bench/baselines/dry.json`,
  real-mode launcher stub for a forthcoming Playwright + web-ext
  driver. See [docs/BENCHMARKING.md](docs/BENCHMARKING.md).
- **Pricing-drift guard.** Two new assertions in
  `tests/lib/pricing.test.js` make `PRICING` and every provider's
  `models[]` list converge: orphan rates fail, missing rates fail.
- **Manifest / package / README version-consistency test.**
  `tests/manifest-consistency.test.js` ensures the three never
  diverge again (the v0.2.0 / v0.5.2 split that this release fixes
  was caught by precisely this kind of test).
- **Logger tests, error-payload tests, abort-on-disconnect tests,
  privacy-CSP tests** added throughout; 100% coverage gate still in
  force on every shipped file.

### Added — documentation

- **`docs/AUDIT_2026-05.md`** — professional audit report with
  findings, severity ratings, and fixes-per-finding mapped to this
  release.
- **`docs/BENCHMARKING.md`** — harness usage, protocol, and how to
  contribute new tasks.
- **`docs/adr/0001-no-bundler.md` … `0006-provider-contract.md`** —
  Architecture Decision Records for the six durable choices the
  project commits to.
- **`docs/ROADMAP.md` aligned with shipped reality** — items that
  shipped in 0.3.0–0.5.x moved from "In progress" to "Shipping
  today".
- **`docs/AMO_REVIEW.md`** — source-layout table refreshed against
  current line counts and library structure.
- **README.md** version banner, Safety section, Benchmarking
  section, Documentation table updated.

### Changed

- Repository version bumped from 0.5.2 → 0.6.0.
- All provider error messages now carry `{ code, retryable, providerId }`
  metadata; UI consumers can branch on the code instead of grep-matching
  the message.

## [0.5.2] - 2026-05-11

### Fixed — caught by second-pass audit

- **CRITICAL: assistant messages were rendering twice.** Background
  emits `STREAM_END` then a trailing `ASSISTANT_TEXT` carrying the
  same final text. The sidebar's suppression logic only filtered
  ASSISTANT*TEXT \_during* the stream; once `state.streaming` cleared
  on STREAM_END, the trailing message produced a second bubble.
  Fixed by tracking `state.lastStreamedText` on finalize and
  suppressing the first matching ASSISTANT_TEXT only. New tests cover
  the duplicate-suppression, only-first-match, and empty-stream-then-fallback cases.
- **Sidebar port disconnect leaked streaming state.** A
  service-worker restart mid-stream left `state.streaming` non-null
  forever; reconnect kept painting into a stale element. The
  `onDisconnect` handler now cancels the rAF, drops the streaming
  class, and clears `state.streaming` / `state.pendingPreviewId` /
  `state.lastStreamedText`.
- **`contextMenus.create` was non-idempotent.** On every background
  service-worker restart, the second call threw "duplicate id". Now
  wrapped in `try/catch` plus a callback that touches
  `runtime.lastError` so the runtime stops logging the duplicate.
  New test re-imports the module with the API rigged to throw and
  asserts the rest of the init still runs.
- **Pricing math used `| 0` (32-bit truncation).** A multi-billion
  token session would wrap into negatives. Replaced with
  `Math.trunc(Number(...))` plus `Number.isFinite` so values past
  2³¹ are preserved and `NaN`/`Infinity`/`"garbage"` clamp to zero.
  New tests cover Infinity, NaN, strings, fractions, and 3 billion
  tokens.
- **Persisted session blew through storage quota with vision turns.**
  Each `screenshot_for_vision` push added a multi-MB base64 image to
  `conversationHistory`, then `persistSession` wrote the whole
  thing to `browser.storage.local` (10 MB quota). Now
  `persistableHistory()` projects to a slim text-only form before
  write. Live in-memory history still has images for vision-aware
  turns.

### Added — privacy-posture guardrails

- **`tests/privacy-regression.test.js`** — automated assertions for
  every promise the README makes:
  - No `sendBeacon`, no `new Image()` tracking pixel, no analytics
    SDK references (gtag, dataLayer, amplitude, mixpanel, sentry,
    datadog, google-analytics.com, segment.io) anywhere in shipped
    code.
  - Every literal `fetch("…")` URL is either a known provider host or
    a relative path under a `${…}` runtime variable (which the CSP
    further constrains at runtime).
  - No `eval`, `new Function`, or remote `import()` in shipped code.
  - Manifest CSP `connect-src` rejects wildcards and lists exactly
    the allowed provider hosts.
  - Manifest does **not** request `webRequest`, `nativeMessaging`,
    `cookies`, `clipboardRead`, `clipboardWrite`, `history`,
    `bookmarks`, `management`, `proxy`, `unlimitedStorage`, or
    `tabHide`.
    These tests gate every PR — drift toward telemetry is impossible
    without breaking them.

### Quality

- 600+ tests, **100% coverage** still on lines / branches / functions /
  statements across every file.
- `npm run lint:webext` continues to report 0 errors / 0 warnings.

## [0.5.1] - 2026-05-11

### Fixed — bugs surfaced by self-audit of v0.5.0

- **STREAM_END leak on error.** `runAgentLoop` and `runChatOnly` now
  wrap the `callLLM` await in a `try { … } finally { send(STREAM_END) }`.
  Previously, a network error mid-stream left the sidebar's
  `state.streaming` non-null forever and silently suppressed every
  subsequent `ASSISTANT_TEXT`. Confirmed by a new test that throws
  inside `callLLM` and asserts `STREAM_END` is still emitted.
- **`download_file` was not policy-gated.** The agent could
  download from any URL even when the user's blocklist denied
  navigation to the same host. New `URL_BEARING_TOOLS` set in
  `policy.js` is now consulted for both `navigate` and
  `download_file`. Test verifies `browser.downloads.download` is
  never called when the host is blocked.
- **`download_file` missing from `DESTRUCTIVE_TOOLS`.** Preview
  mode "destructive" did not surface downloads. Added it.
- **Chat mode was missing streaming, persistence, and cost.**
  `runChatOnly` now streams responses (`STREAM_START`/`DELTA`/`END`),
  persists the conversation, and records token usage — matching agent
  mode behavior.
- **Two `UNSAFE_VAR_ASSIGNMENT` warnings from web-ext lint.** Replaced
  `innerHTML = renderMd(...)` with a new `renderMdInto(parent, text)`
  helper that builds DOM nodes via `document.createElement` /
  `createTextNode`. Mozilla's web-ext lint now reports **0 warnings**
  (was 2). The old `renderMd` is kept for API stability but no longer
  used by `sidebar.js`.

### Improved

- **Streaming renders coalesced via `requestAnimationFrame`.** A 10k-token
  reply previously re-tokenised the entire growing string on every
  delta (O(n²)). The new path schedules a single paint per frame
  regardless of delta count. Multiple back-to-back deltas in the same
  frame are exercised by a new test.
- **Conversation history is now bounded.** New `state.maxHistory`
  (default 50, configurable via `browser.storage.local.maxHistory`)
  trims oldest user/assistant pairs between turns. Prevents unbounded
  memory growth on long sessions with vision payloads.
- **Cost counter is labelled as an estimate** in its `title` tooltip
  ("Estimated session cost (approximate; rates may lag provider
  pricing pages)"). Sets the user's expectation correctly.
- **Keyboard shortcut: `Ctrl+Shift+L` (`Cmd+Shift+L` on macOS)** opens
  the sidebar. Configured via the new `commands._execute_sidebar_action`
  manifest entry.

### Tooling

- `background/lib/policy.js` exports a new `URL_BEARING_TOOLS` set so
  any future tool that takes a URL automatically picks up domain-policy
  enforcement.
- `sidebar/utils.js` gains `tokenizeMd` (pure) and `renderMdInto`
  (DOM-construction) helpers, both at 100% coverage.

### Quality

- 600+ tests, **100% coverage** still on lines / branches / functions /
  statements across every file in `background/`, `content/`, `sidebar/`,
  `options/`.
- New test groups: chat-mode streaming/persistence/cost parity (5 tests),
  download_file policy gate (2 tests), trimHistory (2 tests),
  `loadSettings` for maxHistory (1 test), rAF coalescing + late-paint
  guard (2 tests), tokenizeMd (5 tests), renderMdInto safety (4 tests).
- `npm run lint:webext` is now clean (was 2 warnings).

## [0.5.0] - 2026-05-11

### Added — capability

- **Streaming responses** end-to-end across all four providers:
  - Anthropic: native Messages-API SSE (content_block_start /
    content_block_delta with text_delta + input_json_delta).
  - OpenAI: Chat Completions SSE with `stream_options.include_usage`.
  - Google Gemini: `streamGenerateContent?alt=sse`.
  - Ollama: native NDJSON over `/v1/chat/completions`.
    Each provider's `call(...)` accepts an optional `onTextChunk(text)`
    callback. The agent loop emits `STREAM_START`, `STREAM_DELTA`, and
    `STREAM_END` events so the sidebar can render the assistant message
    progressively with a blinking caret.
- **`download_file` tool** — symmetric counterpart to `upload_file`.
  Initiates a real `browser.downloads.download({ url, filename })`.
- **Conversation persistence.** Conversation history, cost totals, and
  turn counter are saved to `browser.storage.local.conversationState`
  after every agent loop and restored on extension load. `CLEAR_HISTORY`
  wipes both memory and storage.
- **Per-session cost tracker.**
  - New `background/lib/pricing.js` with USD-per-million-token rates for
    all 10 cloud models (Ollama is always $0).
  - Each provider's response now carries a canonical
    `{ promptTokens, completionTokens }` usage object.
  - Background accumulates a running `sessionUsd` total; the sidebar
    header shows a cost chip (auto-hidden at $0).
  - Cost surfaces in `STATUS` and `STREAM_END` events.
- **E2E test skeleton.** Playwright + `web-ext run` smoke test under
  `tests/e2e/` with a shared fixture that launches Firefox in a
  throwaway profile per test. Runs via `npm run test:e2e`. Unit suite
  remains the default `npm test`.
- **AMO listing assets** scaffold under `assets/store/`:
  `AMO_LISTING.md` (canonical copy), `screenshots/README.md` (shot list +
  capture process), `promotional/README.md` (hero / social-preview
  specs).

### Added — shared infrastructure

- `background/lib/stream.js` — SSE + NDJSON parsers with a `makeStreamResponse`
  helper for deterministic tests.
- `background/lib/pricing.js` — pricing table, cost computation, cost
  formatting, and usage normalization across the four providers' usage
  field conventions.

### Changed

- All four provider modules' `call()` signature now takes optional
  `endpoint` (position 7, ignored by cloud providers) and `onTextChunk`
  (position 8). Existing 6-arg call sites continue to work unchanged.
- `manifest.json` adds the `downloads` permission and bumps version.
- The non-streaming response path now carries a normalized `usage`
  object alongside `content` / `stop_reason`.

### Quality

- 600+ tests, **100% coverage** on lines / branches / functions /
  statements across every file in `background/`, `content/`, `sidebar/`,
  `options/`.
- New test modules: `tests/lib/stream.test.js`, `tests/lib/pricing.test.js`.
- Provider streaming paths fully covered for all four backends including
  every edge case (malformed JSON in SSE, missing usage, missing delta,
  tool_call arguments rebuilt from partial fragments, etc.).

## [0.4.1] - 2026-05-11

### Added

- **Sidebar Tool-preview overlay.** `TOOL_PREVIEW` messages from the agent
  now render a modal in the sidebar with the tool name, formatted input
  JSON, and Approve / Cancel buttons. The user's decision is sent back as
  `PREVIEW_RESPONSE`. Without this UI in v0.4.0 the agent appeared to hang
  whenever a destructive tool fired with `previewMode != "off"`.
- **Sidebar Policy-warning banner.** `POLICY_WARNING` events render a
  dismissable amber banner at the top of the message list listing the
  heuristic patterns matched. Auto-removes after 12 s or on click.
- **Options Safety-Policy section.** Allowlist and blocklist text areas
  (one pattern per line, `*.domain` wildcards supported), preview-mode
  select (`off` / `destructive` / `all`), and an injection-warning toggle
  — persisted to `browser.storage.local.safetyPolicy`.
- **New tool icons** in the sidebar for the v0.4.0 tools: `hover_element`,
  `press_key`, `drag_drop`, `upload_file`, `list_tabs`, `switch_tab`,
  `screenshot_for_vision`. Their `summarize()` cases now render readable
  one-liners (e.g. `Ctrl+Shift+a` for `press_key`).

### Changed

- `tests/setup.js` unchanged; the existing `browser` mock plus jsdom
  polyfills already cover the new code.

### Quality

- 510 tests (488 → 510). 100% coverage on lines / branches / functions /
  statements across every file.
- New test groups: sidebar TOOL_PREVIEW overlay (5), POLICY_WARNING banner
  (5), options safety-policy panel (4), plus 9 new sidebar `summarize`
  cases for the v0.4.0 tools.

## [0.4.0] - 2026-05-11

### Added — capability

- **Shadow DOM traversal** in `content/sensor.js`: open shadow roots are walked
  and their interactive elements appear in the semantic map with `shadow: true`.
- **Same-origin iframe traversal**: same-origin frames are descended into;
  cross-origin frames emit an `iframe` entry without breaching the boundary.
- **`all_frames: true`** content-script registration so the sensor is reachable
  in nested same-origin frames.
- **New actor tools**:
  - `hover_element` — dispatches mouseover/mouseenter/mousemove with optional
    dwell (capped at 5000 ms).
  - `press_key` — named keys (Enter, Escape, Tab, Arrow\*, …) and single
    characters; supports ctrl/alt/shift/meta modifiers; targets the focused
    element when no selector is given.
  - `drag_drop` — full HTML5 drag sequence (dragstart, drag, dragenter,
    dragover, drop, dragend) with a real `DataTransfer` payload.
  - `upload_file` — drops a base64-encoded file into a real
    `<input type="file">` via `DataTransfer`, firing change/input events.
- **Multi-tab**: `list_tabs` and `switch_tab` tools so the agent can operate
  across the current window.
- **Vision**: `screenshot_for_vision` tool attaches the captured image to the
  next model turn as a real image content block. Each provider translates to
  its native format:
  - Anthropic: `{ type: "image", source: { base64, media_type } }`
  - OpenAI / Ollama: `{ type: "image_url", image_url: { url: dataUrl } }`
  - Google Gemini: `{ inlineData: { mimeType, data } }`
- Shared `background/lib/vision.js` helper module.

### Added — safety

- New `background/lib/policy.js` module: domain allow/blocklist,
  preview-before-action mode (`off` / `destructive` / `all`), and heuristic
  prompt-injection patterns (ignore-previous, system-override, credential
  exfiltration, role impersonation, hidden markers).
- Domain-level navigation control: `navigate` calls are denied when the host
  matches the user's blocklist or falls outside a non-empty allowlist. The
  denial is reported as a `TOOL_RESULT` so the model can recover.
- Preview gate: destructive tool calls surface a `TOOL_PREVIEW` message and
  wait for the user's `PREVIEW_RESPONSE` (approve / cancel). Default mode is
  "destructive", with read-only tools auto-approved.
- Page content is wrapped with explicit `[BEGIN UNTRUSTED PAGE CONTENT … END]`
  framing before it reaches the LLM, and a `POLICY_WARNING` message is emitted
  on heuristic injection-pattern matches.

### Added — quality

- `background/lib/policy.js`, `background/lib/vision.js` — both at 100% test
  coverage.
- New test files: `tests/lib/policy.test.js` (42 tests),
  `tests/lib/vision.test.js` (10 tests).
- Extended sensor tests for shadow DOM, iframes, hover, press_key, drag/drop,
  file upload, and cached-ref vs. selector-fallback resolution.
- Extended background tests for every new tool, every new policy path, the
  preview round-trip, and vision image attachment.
- jsdom polyfills for `DataTransfer`, `DragEvent`, and a permissive
  `HTMLInputElement.files` setter so the new actor tools are testable.
- Total tests: 488. Coverage: 100% on lines, branches, functions, statements.

### Changed

- `content/sensor.js` was modified for the new capability. The previous
  CLAUDE.md prohibition is lifted by explicit instruction in the v0.4.0 work.
- `resolveElement` now uses cached `Element` references first (works through
  shadow roots and iframes), falling back to `document.querySelector` for
  light-DOM selectors.

## [0.3.0] - 2026-05-11

### Added

- Apache-2.0 LICENSE and NOTICE file
- SECURITY.md vulnerability disclosure policy
- CONTRIBUTING.md developer workflow guide
- CODE_OF_CONDUCT.md (Contributor Covenant v2.1)
- PRIVACY.md
- CITATION.cff (academic citation metadata)
- `_locales/en/messages.json` for i18n scaffolding
- README badges, table of contents, documentation links
- `docs/ARCHITECTURE.md`, `docs/PROVIDERS.md`, `docs/THREAT_MODEL.md`, `docs/AMO_REVIEW.md`, `docs/ROADMAP.md`
- IPv6 loopback `http://[::1]:*` allowed in CSP and host permissions for local Ollama connectivity over IPv6
- Full test infrastructure: Vitest, jsdom, 382 unit + integration tests, **100% coverage on lines/branches/functions/statements**
- ESLint v9 flat config, Prettier, EditorConfig, JSDoc strict type-check via `tsconfig.json`
- GitHub Actions CI workflow (`ci.yml`) running lint, format, typecheck, test:coverage, web-ext lint, and build
- GitHub Actions release workflow (`release.yml`) attaching signed `.xpi` to tagged releases
- Issue templates (bug report, feature request), pull request template, FUNDING.yml, dependabot config
- Extracted `background/lib/{errors,http}.js` utilities and `sidebar/utils.js` for testability

### Changed

- README license section updated from "All rights reserved" to Apache-2.0
- `manifest.json` CSP `connect-src` tightened from `https://*` to an explicit allowlist of provider domains
- `background/providers/google.js`: API key moved from URL query string to `x-goog-api-key` header (avoids logging in server access logs)
- `sidebar/sidebar.js`: tool-info and screenshot rendering converted from `innerHTML` to DOM construction (defense-in-depth against LLM-controlled content)

### Removed

- `manifest.json` `web_accessible_resources` entry referencing a non-existent `content/actor.js`
- `manifest.json` unused `optional_permissions` (`webRequest`, `nativeMessaging`)

### Security

- Tightened Content Security Policy to limit outbound connections to the four supported providers and local Ollama only
- API key transmission for Google Gemini moved to a request header to avoid query-string logging

## [0.2.0] - 2026-05-11

### Added

- Multi-provider support: Ollama (local), Anthropic Claude, OpenAI, Google Gemini
- Provider abstraction in `background/providers/` normalizing tool-calling across APIs
- Agent loop with configurable turn limit, abort control, and kill switch
- Chat mode and Agent mode in the sidebar
- Accessibility-tree sensor for semantic page understanding
- Action executor for click, type, scroll, navigate
- Options page with per-provider configuration and connection testing
- Auto-detection of installed Ollama models via `/api/tags`
- Right-click context menu: "Ask LLM Bridge about selection"

### Security

- API keys stored only in `browser.storage.local`, never transmitted except to the user-chosen provider
- `data_collection_permissions` declared in manifest per Firefox November 2025 requirement
- Explicit `content_security_policy` to permit `http://localhost` for Ollama (works around the MV3 default that upgrades HTTP to HTTPS)

[Unreleased]: https://github.com/smaniches/firefox-llm-bridge/compare/v0.5.2...HEAD
[0.5.2]: https://github.com/smaniches/firefox-llm-bridge/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/smaniches/firefox-llm-bridge/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/smaniches/firefox-llm-bridge/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/smaniches/firefox-llm-bridge/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/smaniches/firefox-llm-bridge/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/smaniches/firefox-llm-bridge/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/smaniches/firefox-llm-bridge/releases/tag/v0.2.0
