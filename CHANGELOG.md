# Changelog

All notable changes to Firefox LLM Bridge will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/smaniches/firefox-llm-bridge/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/smaniches/firefox-llm-bridge/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/smaniches/firefox-llm-bridge/releases/tag/v0.2.0
