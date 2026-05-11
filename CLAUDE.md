# CLAUDE.md — firefox-llm-bridge

## Project

An open-source AI browser agent for Mozilla Firefox, distributed as a Manifest V3 WebExtension. Built to be auditable: no bundler, no runtime dependencies, no minification, source matches what ships.

Goal: a Firefox-native option for users who want an agentic browser experience without leaving Mozilla.

## Owner

Santiago Maniches (ORCID: 0009-0005-6480-1987) / TOPOLOGICA LLC

## Architecture

Firefox Manifest V3 extension with three layers:

**Sensor** (content/sensor.js): Content script injected into pages. Walks the DOM extracting a semantic accessibility map of every interactive element (role, label, bounding box, CSS selector). Also executes actions: click, type, scroll. Provider-agnostic. Does not change.

**Brain** (background/background.js + providers/): Background service worker. Receives page state from content scripts. Sends to LLM provider with tool definitions. Receives action plans. Dispatches actions back to content script. Manages conversation history, turn limits, abort control.

**UI** (sidebar/ + options/): Sidebar panel for chat and agent interaction. Options page for provider configuration.

## Provider System

Multi-model support via provider abstraction. Each provider normalizes to a unified response format:

```
{ content: [{ type: "text", text }, { type: "tool_use", id, name, input }], stop_reason: "end_turn" | "tool_use" }
```

Supported providers:

- **Ollama** (local, free): http://localhost:11434/v1/chat/completions (OpenAI-compatible)
- **Anthropic** (cloud, BYOK): https://api.anthropic.com/v1/messages
- **OpenAI** (cloud, BYOK): https://api.openai.com/v1/chat/completions
- **Google Gemini** (cloud, BYOK): https://generativelanguage.googleapis.com/v1beta/

BYOK = Bring Your Own Key. User provides their own API key. Usage billed to their account.

## Hard Constraints

- NO bundlers, transpilers, or build steps. Plain JavaScript. AMO reviewers read source directly.
- NO external dependencies loaded at runtime. No CDN imports. Everything ships with the extension.
- NO remote code execution. All logic is local.
- NO minification or obfuscation.
- API keys stored ONLY in browser.storage.local. Never sent anywhere except the user's chosen LLM provider.
- Firefox Manifest V3 only. No Chrome APIs. Use `browser.*` namespace (not `chrome.*`).
- Content script is provider-agnostic. Tool definitions are provider-agnostic. Only the provider modules handle API format differences.

## MV3 / AMO Compliance

- `data_collection_permissions` in manifest.json under `browser_specific_settings.gecko` (mandatory since Nov 2025).
- Explicit `content_security_policy` to allow http://localhost (Ollama). Default MV3 CSP upgrades http to https, breaking localhost connections.
- `host_permissions` includes `http://localhost/*` and `http://127.0.0.1/*` for Ollama.
- All permissions justified: activeTab (page interaction), tabs (navigation), scripting (content script injection), storage (settings), webNavigation (page load detection).

## Code Standards

- Well-commented. Every function has a JSDoc-style comment.
- Error handling on every API call. Network failures, invalid keys, Ollama not running, rate limits, model not found.
- Graceful degradation. If one provider fails, others still work.
- No console.error spam in normal operation. Use console.warn for recoverable issues, console.error only for genuine failures.
- Async/await throughout. No callback chains.
- CSS variables for theming. Dark theme default.

## File Structure

```
firefox-llm-bridge/
  manifest.json
  CLAUDE.md                   (this file)
  README.md
  background/
    background.js             (agent loop, provider dispatch)
    providers/
      index.js                (provider registry, active provider, routing)
      anthropic.js
      openai.js
      google.js
      ollama.js
  sidebar/
    sidebar.html
    sidebar.css
    sidebar.js
  content/
    sensor.js                 (DO NOT MODIFY without explicit instruction)
  options/
    options.html
    options.css
    options.js
  icons/
    icon-16.png
    icon-32.png
    icon-48.png
    icon-128.png
```

## Git Conventions

- Commit messages: `type: description` (feat:, fix:, refactor:, docs:)
- No force pushes to main.
- Tag releases: v0.1.0, v0.2.0, etc.

## What NOT to Include in This Repo

- No competitive analysis documents
- No business strategy documents
- No pricing models
- No API keys or secrets (even in .gitignore — just don't create them)
- No PDF reports
