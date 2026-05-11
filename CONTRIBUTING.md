# Contributing to Firefox LLM Bridge

Thank you for considering a contribution. This document covers the workflow, coding standards, and how to extend the extension.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating you agree to uphold it.

## Getting Started

### Prerequisites

- **Node.js** 20.x or newer (for tooling only — the extension itself ships zero npm runtime dependencies)
- **Firefox** 128.0 or newer
- **Ollama** (optional, for local-model testing): https://ollama.com

### Setup

```bash
git clone https://github.com/smaniches/firefox-llm-bridge.git
cd firefox-llm-bridge
npm install
```

### Run the extension

```bash
npm run dev
```

This launches a fresh Firefox profile with the extension installed and live-reload enabled.

### Run tests

```bash
npm test                # unit tests once
npm run test:watch      # watch mode
npm run test:coverage   # with coverage report
```

### Run linters

```bash
npm run lint            # ESLint
npm run lint:webext     # Mozilla web-ext lint (AMO compliance)
npm run typecheck       # JSDoc/TypeScript type check (no emit)
npm run format          # Prettier (write)
npm run format:check    # Prettier (check only)
```

### All checks (what CI runs)

```bash
npm run check
```

## Project Layout

```
firefox-llm-bridge/
├── manifest.json            Manifest V3 declaration
├── background/
│   ├── background.js        Agent loop, sidebar port, tool dispatcher
│   └── providers/           One file per LLM provider
├── content/
│   └── sensor.js            Accessibility-tree extractor + action executor
├── sidebar/                 Chat / agent UI
├── options/                 Settings page
├── _locales/                i18n (en is default)
├── icons/                   Brand assets
├── tests/                   Vitest unit + integration tests
├── docs/                    Architecture, threat model, AMO notes
└── .github/                 CI, issue/PR templates
```

## Hard Architectural Constraints

These constraints are **not negotiable**. They exist for Mozilla AMO compliance and security:

1. **No bundlers, transpilers, or build steps for shipped code.** What you write is what ships. AMO reviewers read source directly.
2. **No runtime dependencies.** Nothing fetched at runtime, no CDN imports, no remote code execution.
3. **No minification or obfuscation.**
4. **`browser.*` namespace only.** Never `chrome.*`. We target Firefox MV3.
5. **API keys stored only in `browser.storage.local`.** Never transmitted anywhere except the user-chosen LLM provider.
6. **The content script is provider-agnostic.** Provider differences live in `background/providers/`.
7. **The tool definitions are provider-agnostic.** Each provider normalizes to a unified internal format.

## Coding Standards

- **JSDoc on every exported function.** Types are enforced via `npm run typecheck`.
- **ESM modules** (`import` / `export`), not CommonJS.
- **Async/await** throughout, no callback chains.
- **`console.warn` for recoverable issues**, `console.error` only for genuine failures.
- **Graceful degradation**: if one provider fails, others still work.
- **CSS variables for theming.** Dark theme is the default.
- **No emojis in code** unless functionally required (UI icons are an exception).

## Commit Messages

Conventional Commits format:

```
type(scope): short imperative description

Longer body if needed.

Refs: #123
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `build`, `ci`, `perf`, `security`.

## Pull Request Workflow

1. Fork and create a feature branch off `main`.
2. Make focused commits (one logical change per commit).
3. Add or update tests. **PRs that touch logic without tests will not be merged.**
4. Run `npm run check` locally and ensure it passes.
5. Open a PR using the template. Link the issue it resolves.
6. A maintainer will review. CI must be green to merge.
7. Squash-merge is the default.

## Adding a New LLM Provider

See [docs/PROVIDERS.md](docs/PROVIDERS.md) for the step-by-step guide.

Summary:

1. Create `background/providers/<name>.js` exporting an object with the provider contract (`id`, `name`, `models`, `formatTools`, `formatMessages`, `call`, `buildToolResultMessage`).
2. Register it in `background/providers/index.js`.
3. Add a settings card in `options/options.html` and a handler in `options/options.js`.
4. Add a `tests/providers/<name>.test.js` covering format conversion and response normalization.
5. Update [docs/PROVIDERS.md](docs/PROVIDERS.md) with provider-specific notes.

## Reporting Bugs

Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.yml). Include:

- Firefox version
- Extension version (from `about:addons`)
- Provider + model
- Reproduction steps
- Console errors (`about:debugging` → Inspect)

## Security Issues

**Do not** file security issues publicly. See [SECURITY.md](SECURITY.md).

## Releases

Releases are tagged `vX.Y.Z` and published to GitHub Releases automatically by the `release.yml` workflow. The signed `.xpi` artifact is attached to each release.

## License

By contributing you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE).
