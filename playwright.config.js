/**
 * Playwright config for end-to-end tests.
 *
 * The E2E suite launches a fresh Firefox profile with the extension loaded
 * via `web-ext run`, then drives the browser through Playwright. This is
 * separate from the Vitest unit suite (`tests/`) so we can keep the unit
 * tests fast and reserve the heavier real-browser runs for an explicit
 * `npm run test:e2e` invocation.
 *
 * Real-browser execution requires a working Firefox install and is not run
 * by the default CI workflow; teams should opt-in once they have a runner
 * with Firefox preinstalled.
 */

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false, // serial: the extension owns one Firefox profile at a time
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  timeout: 60_000,
  expect: { timeout: 5_000 },
  use: {
    // The test fixture in tests/e2e/fixtures.js spawns web-ext directly; we
    // do not declare a browser config here because Playwright's standard
    // launcher cannot install a WebExtension into Firefox at runtime.
    trace: "retain-on-failure",
  },
});
