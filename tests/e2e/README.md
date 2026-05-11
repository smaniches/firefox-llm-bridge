# E2E Tests

Playwright + `web-ext run` integration tests that exercise the extension in a
real Firefox profile.

These are **not** run by the default `npm test` or `npm run check` — they
require a real Firefox install and are slower than the unit suite. Run them
explicitly:

```bash
npm run test:e2e
```

## Why a separate suite

The unit tests in `tests/` mock `browser.*` and `fetch`. They are fast
(< 10 s for 600+ tests) and gate every PR.

The E2E tests catch a different class of bug: anything that depends on the
actual Firefox extension runtime — manifest parsing, content-script
injection, sidebar lifecycle, port reconnection across a real service-worker
restart.

## Running

1. Install Firefox (`apt install firefox` / Mozilla's `.dmg` / etc.).
2. `npm install` to pick up `@playwright/test` and `web-ext`.
3. `npm run test:e2e`.

The Playwright runner spawns `web-ext run` per test with a throwaway
profile. No state leaks between tests.

## Authoring new tests

Use the `test` fixture exported from `fixtures.js`:

```js
import { test, expect } from "./fixtures.js";

test("my new scenario", async ({ extensionFirefox }) => {
  // extensionFirefox.proc is the running web-ext process.
  // extensionFirefox.profileDir is the throwaway profile path.
  // Attach a Playwright BiDi connection here if you need to drive the UI.
});
```

## What is intentionally NOT covered

- **Provider API calls.** Cloud-provider auth is a per-developer concern;
  the E2E suite must run without secrets.
- **Real LLM responses.** The Vitest suite covers the agent loop and
  response normalization with deterministic mocks.

The smoke test (`smoke.test.js`) validates only that the extension loads
cleanly. Add scenario-specific tests beside it when you need them.
