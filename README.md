# Firefox LLM Bridge

**The first AI browser agent for Mozilla Firefox.**

Chrome has Claude in Chrome. Firefox had nothing. Until now.

Navigate, extract, and automate with any LLM: local (Ollama) or cloud (Claude, GPT-4o, Gemini).

## What It Does

**Chat mode:** Ask questions about the page you are viewing. Summarize, extract, explain.

**Agent mode:** Give the AI control to navigate, click, type, scroll, and complete multi-step tasks on your behalf. It reads the page's accessibility tree, plans actions, and executes them step by step.

## Supported Providers

| Provider | Type | Cost | Models |
|----------|------|------|--------|
| **Ollama** | Local | Free | Llama 3.1, Qwen 2.5, Mistral, any installed model |
| **Anthropic** | Cloud (BYOK) | Your API costs | Claude Sonnet 4, Opus 4, Haiku 4.5 |
| **OpenAI** | Cloud (BYOK) | Your API costs | GPT-4o, GPT-4o Mini, o1, o3-mini |
| **Google** | Cloud (BYOK) | Your API costs | Gemini 2.5 Flash, 2.5 Pro, 2.0 Flash |

BYOK = Bring Your Own Key. You provide your API key. Usage is billed to your account. The extension never sees or stores your usage data.

## Installation

### Developer Mode (current)

1. Clone this repo
2. Open Firefox, navigate to `about:debugging#/runtime/this-firefox`
3. Click **Load Temporary Add-on**
4. Select `manifest.json` from the repo root
5. Click the sidebar icon to open LLM Bridge
6. Open Settings (gear icon) and configure a provider

### Firefox Add-ons Store

Coming soon.

## Setup

### Ollama (Free, Local)

1. Install Ollama: https://ollama.com
2. Pull a model: `ollama pull llama3.1`
3. Start Ollama: `ollama serve`
4. Set CORS: `OLLAMA_ORIGINS=moz-extension://*` (see Ollama docs for your OS)
5. In extension settings, click Ollama, test connection, select model, activate

### Cloud Providers (BYOK)

1. Get an API key from your provider's dashboard
2. In extension settings, click the provider card
3. Paste your key, select a model, test connection, activate

## Architecture

```
[Sidebar UI] <--port--> [Background Worker] <--router--> [Provider Module] <--API--> [LLM]
                              |
                         [Content Script]
                         (Sensor + Actor)
                              |
                         [Web Page DOM]
```

The **Sensor** extracts a semantic accessibility map of every interactive element on the page. The **Provider Router** normalizes tool-calling across Anthropic, OpenAI, Google, and Ollama formats. The **Agent Loop** executes multi-step tasks by calling the LLM, dispatching actions to the content script, and feeding results back.

No CDP. No patched browsers. Standard WebExtension APIs on branded Firefox.

## Safety

- Turn limit: agent stops after 25 turns (configurable)
- Kill switch: visible stop button during execution
- No financial transactions without explicit user confirmation
- API keys stored locally only, never transmitted to any server except the chosen LLM provider
- No data collected by the extension developer

## License

(c) 2026 TOPOLOGICA LLC. All rights reserved.
Santiago Maniches (ORCID: 0009-0005-6480-1987)
