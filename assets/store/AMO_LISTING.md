# AMO Store Listing Copy

Canonical copy for the `addons.mozilla.org` listing. Update this file when
the listing changes; the AMO web form is the source of truth at upload time
but this file gives reviewers and contributors a versioned reference.

---

## Name (max 50 chars)

```
Firefox LLM Bridge
```

## Summary (max 132 chars — shown in search results and store cards)

```
The first AI browser agent for Firefox. Navigate, extract, automate — with local Ollama or your own Claude / GPT / Gemini key.
```

## Categories

- Primary: **Productivity**
- Secondary: **Web Development**

## Tags

`ai`, `assistant`, `automation`, `claude`, `gpt`, `ollama`, `gemini`,
`accessibility`, `productivity`, `local-first`

## Full description

Firefox LLM Bridge is a Mozilla-native AI browser agent. It reads the
semantic accessibility tree of any page you visit and lets the model you
choose drive the browser on your behalf: click, type, scroll, navigate,
hover, drag-and-drop, upload, download.

**Bring your own model.**

Pick the one you trust:

- **Ollama** — runs locally. Nothing leaves your machine. Free.
- **Anthropic Claude** — Sonnet 4, Opus 4, Haiku 4.5.
- **OpenAI** — GPT-4o, GPT-4o Mini, o1, o3-mini.
- **Google Gemini** — Gemini 2.5 Flash, Gemini 2.5 Pro, Gemini 2.0 Flash.

Cloud providers use **your** API key. Usage is billed to your account.
The extension developer never sees or stores it.

**Safety, by default.**

- Domain allow/blocklist for navigation.
- "Preview before action" mode — confirm every destructive tool call.
- Untrusted-content framing wraps page text before it reaches the LLM.
- Heuristic prompt-injection warnings on suspicious page content.
- Per-session cost tracker so you always know what BYOK is spending.

**Open source. Audit-friendly.**

- Source matches the shipped `.xpi` — no bundler, no minifier.
- Apache-2.0 licensed.
- 600+ unit tests at 100% line / branch / function / statement coverage.
- Threat model, architecture, and provider-extension docs all in-repo.

**Two modes:**

- **Chat** — ask questions about the page you're on.
- **Agent** — give the AI a goal and watch it work. Step through every
  action in the sidebar; hit Stop at any time.

## Privacy

- API keys live in `browser.storage.local`. They are never sent to
  TOPOLOGICA LLC or any third party — only to the provider matching the
  key prefix.
- Page content is sent **only** when you invoke the agent, and **only**
  to your configured provider. With Ollama selected, nothing leaves the
  device.
- No telemetry. No analytics. No phone-home.
- Full privacy policy: see `PRIVACY.md` in the repo.

## Permissions (justified)

Every permission requested is used and minimized. See
`docs/AMO_REVIEW.md` for the full justification table.

## Support

- Source + issues: https://github.com/smaniches/firefox-llm-bridge
- Security: security@topologica.app (see SECURITY.md)
- Privacy questions: privacy@topologica.app
- General: hello@topologica.app

## Homepage URL

```
https://topologica.app
```

## Support URL

```
https://github.com/smaniches/firefox-llm-bridge/issues
```

## License

Apache License 2.0 — see `LICENSE` in the source repository.
