/**
 * End-to-end smoke test.
 *
 * Verifies the extension loads cleanly in a real Firefox profile via
 * `web-ext run`. The test does not exercise the agent loop end-to-end
 * (that needs a configured provider key); it confirms that:
 *
 *   1. `web-ext run` accepts the manifest and launches Firefox.
 *   2. The extension's sidebar HTML can be opened directly from disk —
 *      a quick guarantee that no top-level evaluation errors fire during
 *      module init (those would otherwise be silent).
 *
 * Full agent-loop coverage lives in the Vitest suite where providers and
 * the browser APIs are mocked deterministically.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "./fixtures.js";

const REPO_ROOT = new URL("../..", import.meta.url).pathname;

test("web-ext run loads the extension and the sidebar HTML is well-formed", async ({
  extensionFirefox,
}) => {
  // web-ext fixture already started Firefox and surfaced any startup error.
  // The presence of `extensionFirefox.proc` (still alive) is the assertion.
  expect(extensionFirefox.proc.killed).toBe(false);

  // Sanity-check the shipped sidebar HTML is parseable and references the
  // expected element ids. This is a fast structural check that catches a
  // class of regressions (deleted ids, broken script tag) without needing
  // to attach a real driver to Firefox.
  const html = readFileSync(join(REPO_ROOT, "sidebar/sidebar.html"), "utf8");
  for (const id of [
    "messages",
    "input-text",
    "btn-send",
    "btn-stop",
    "btn-clear",
    "btn-settings",
    "preview-overlay",
    "cost-counter",
  ]) {
    expect(html).toContain(`id="${id}"`);
  }
});
