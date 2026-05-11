# Security Policy

We take the security of Firefox LLM Bridge seriously. This document describes how to report vulnerabilities and what to expect in response.

## Supported Versions

Only the latest minor release receives security updates.

| Version | Supported |
|---------|-----------|
| 0.2.x   | Yes       |
| < 0.2   | No        |

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

### Preferred channel — GitHub Security Advisories

Open a private advisory at:
https://github.com/smaniches/firefox-llm-bridge/security/advisories/new

### Alternative channel — email

Email: **security@topologica.app**

Encrypt sensitive details with PGP if possible (key available on request).

Please include:

1. A clear description of the vulnerability.
2. Steps to reproduce, or a minimal proof-of-concept.
3. The affected version (commit SHA preferred).
4. Your assessment of impact and severity.
5. Any suggested mitigation.

## Response Timeline

These are best-effort targets, not contractual SLAs. This is a small open-source project; please plan accordingly.

| Stage | Target (best effort) |
|-------|---------------------|
| Initial acknowledgement | within 5 business days |
| Triage and severity rating | within 10 business days of acknowledgement |
| Status updates | as material progress is made |
| Coordinated disclosure window | 90 days, extendable by mutual agreement |

We will tell you up front if we expect to need more time. We will not silently miss a window.

## Scope

### In scope

- Code in this repository (`background/`, `content/`, `sidebar/`, `options/`, `manifest.json`).
- Privilege-escalation paths through the WebExtension API surface.
- Exfiltration of API keys, conversation history, or page content beyond the user-configured provider.
- Prompt-injection paths that cause the agent to perform unauthorized actions.
- Supply-chain risks in our build/release pipeline.

### Out of scope

- Vulnerabilities in third-party LLM providers (report to them directly).
- Vulnerabilities in Firefox itself (report to Mozilla).
- Vulnerabilities in Ollama (report to ollama/ollama).
- Issues that require an already-compromised local machine.
- Social-engineering attacks against users.
- Denial-of-service against the user's own browser via crafted instructions (the user is the operator).

## Threat Model

Read [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) for the full threat model, trust boundaries, and known limitations.

## Hall of Fame

We credit security researchers who follow this policy in our [CHANGELOG.md](CHANGELOG.md) and, with permission, in a HALL_OF_FAME section once we have reports to acknowledge.

## Safe Harbor

We will not pursue legal action against researchers who:

- Make a good-faith effort to avoid privacy violations, destruction of data, and degradation of service.
- Report the vulnerability promptly via the channels above.
- Do not exploit the vulnerability beyond what is necessary to demonstrate it.
- Do not disclose the vulnerability publicly until we have had a reasonable opportunity to address it.
