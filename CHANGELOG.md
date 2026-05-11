# Changelog

All notable changes to Firefox LLM Bridge will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/smaniches/firefox-llm-bridge/compare/v0.4.1...HEAD
[0.4.1]: https://github.com/smaniches/firefox-llm-bridge/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/smaniches/firefox-llm-bridge/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/smaniches/firefox-llm-bridge/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/smaniches/firefox-llm-bridge/releases/tag/v0.2.0
