# Privacy Policy

**Effective date:** 2026-05-11
**Maintainer:** Santiago Maniches / TOPOLOGICA LLC
**Contact:** privacy@topologica.app

---

## TL;DR

- The extension developer (TOPOLOGICA LLC) collects **nothing**.
- Your API keys stay on your device. We never see them.
- The pages you visit are sent **only** to the LLM provider you configure, **only** when you invoke the agent.
- If you use Ollama, nothing leaves your device.

---

## What Data Does the Extension Handle?

### API Keys (cloud providers only)

When you configure Anthropic, OpenAI, or Google as your provider, you paste your own API key into the Options page. That key is stored in `browser.storage.local`, which is a sandboxed area on your device.

- The key is read only by this extension.
- The key is sent only to the corresponding provider's API endpoint (`api.anthropic.com`, `api.openai.com`, `generativelanguage.googleapis.com`).
- The key is never sent to TOPOLOGICA, never logged, never transmitted anywhere else.
- You can delete the key at any time by clearing it in the Options page or removing the extension.

### Page Content

When you invoke the agent or ask a question about a page, the extension:

1. Reads the page's accessibility tree (interactive elements, labels, structure) and/or visible text.
2. Sends that content to the LLM provider you configured, along with your prompt.
3. Receives a response and renders it in the sidebar.

This happens **only** when you actively invoke the agent. The extension does not silently exfiltrate page data in the background.

If your provider is Ollama (local), all of this happens on your machine — nothing leaves it.

### Conversation History

Conversation history is held in memory inside the background service worker for the duration of a session. Clearing the conversation (the "+" button) or restarting Firefox discards it. The history is never persisted to disk and never transmitted except as part of the next API request to your chosen provider.

### Settings

Your provider choice, model selection, and maximum-turn setting are stored in `browser.storage.local`. None of these are transmitted anywhere.

---

## What Data the Extension Does NOT Collect

- No telemetry.
- No analytics.
- No crash reports sent to the developer.
- No usage metrics.
- No "phone home" pings.
- No advertising identifiers.

---

## Third Parties

When you choose a cloud provider, **your** request goes to **their** API. Their privacy policy governs what they do with the request:

- [Anthropic Privacy Policy](https://www.anthropic.com/legal/privacy)
- [OpenAI Privacy Policy](https://openai.com/policies/privacy-policy/)
- [Google AI Privacy Notice](https://policies.google.com/privacy)
- Ollama runs locally — no third party involved

The extension developer is not a data processor for these flows. You contract directly with the provider when you use their API key.

---

## Permissions Explained

| Permission                           | Why                                                                    |
| ------------------------------------ | ---------------------------------------------------------------------- |
| `activeTab`                          | Read the page you're currently viewing when you invoke the agent       |
| `tabs`                               | Navigate the active tab (back, forward, URL changes) for agent actions |
| `scripting`                          | Inject the content script that builds the accessibility map            |
| `storage`                            | Save your API key and settings locally                                 |
| `contextMenus`                       | Add the right-click "Ask about selection" entry                        |
| `notifications`                      | Reserved for future use; currently inactive                            |
| `webNavigation`                      | Detect when navigation finishes after a `navigate` action              |
| `<all_urls>` host permission         | The agent can be invoked on any page you visit                         |
| `http://localhost/*` host permission | Talk to your local Ollama server                                       |

The extension does **not** request `webRequest` or `nativeMessaging`.

---

## Data Subject Rights

You have full control:

- **Access** — your data lives on your device; open `about:debugging` → inspect the extension → Storage tab to see what is stored
- **Deletion** — remove the extension or clear its storage in `about:addons`
- **Portability** — your data does not need exporting; it never left your device

---

## Children

The extension is not directed at children under 13 (or 16 in the EU). It does not collect any personal information that would fall under COPPA or the GDPR's special-category rules.

---

## Changes to This Policy

Material changes will be documented in [CHANGELOG.md](CHANGELOG.md) and reflected here with a new effective date. The previous version will remain in the git history.

---

## Contact

Questions, requests, complaints: **privacy@topologica.app**.

For security vulnerabilities, see [SECURITY.md](SECURITY.md).
