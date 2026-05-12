# ADR 0001 — No bundler, no transpiler, no minifier for shipped code

**Status:** Accepted (2025-Q4) · **Last reviewed:** 2026-05-12

## Context

Mozilla AMO reviewers read submitted source directly. A bundler that produces a single minified blob makes review intractable: the reviewer must trust an opaque artifact and the project loses its main credibility argument ("you can read what runs"). We also want the extension to be auditable by users at any time without a build environment.

## Decision

The shipped extension contains only hand-written ES modules. No webpack, no Rollup, no Vite, no Babel, no esbuild. No minification. No remote `import()`. Every file in the `.xpi` exists in the repository at the same path.

## Consequences

- Reviewers can `git checkout v0.6.0 && unzip dist/firefox_llm_bridge-0.6.0.zip -d /tmp/installed && diff -r . /tmp/installed/` and see exact correspondence (modulo dev-only paths).
- Provider format conversions (`formatTools`, `formatMessages`) are written by hand in each provider file. This is more verbose than a generated abstraction but keeps the critical path readable.
- Dev tooling (Vitest, Prettier, ESLint, web-ext, Playwright) is allowed because none of it ships in the artifact. `package.json#devDependencies` is the bright line.
- Adding a build step in the future requires reopening this ADR. The default answer is "no."

## Related

- `CLAUDE.md` Hard Constraints
- `CONTRIBUTING.md` Hard Architectural Constraints
- `docs/AMO_REVIEW.md` Build Reproducibility
