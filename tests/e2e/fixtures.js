/**
 * Shared Playwright test fixtures for the Firefox LLM Bridge E2E suite.
 *
 * Spawns Firefox via web-ext run with the extension auto-installed in a
 * fresh profile, then attaches Playwright via the WebDriver BiDi protocol.
 * Each test gets its own browser instance so a hung agent in one test
 * doesn't poison the next.
 */

import { test as base, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = new URL("../..", import.meta.url).pathname;

/**
 * Launch `web-ext run` against the current repo and resolve the path to
 * the temporary profile + the spawned process handle.
 *
 * @returns {Promise<{ profileDir: string, proc: import("node:child_process").ChildProcess }>}
 */
async function launchExtensionFirefox() {
  const profileDir = mkdtempSync(join(tmpdir(), "ffllm-bridge-e2e-"));
  const proc = spawn(
    "npx",
    [
      "web-ext",
      "run",
      "--source-dir",
      REPO_ROOT,
      "--firefox-profile",
      profileDir,
      "--keep-profile-changes",
      "--no-reload",
      "--browser-console",
    ],
    { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] },
  );

  // Wait for the "started" line in stdout, with a 30 s safety timeout.
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("web-ext did not signal readiness within 30 s")),
      30_000,
    );
    proc.stdout?.on("data", (chunk) => {
      const s = chunk.toString();
      if (s.includes("Firefox process") || s.includes("Reloaded")) {
        clearTimeout(timer);
        resolve();
      }
    });
    proc.once("exit", (code) => reject(new Error(`web-ext exited early (${code})`)));
  });

  return { profileDir, proc };
}

/**
 * The `extensionFirefox` fixture starts web-ext, runs the test, then tears
 * down the spawned Firefox and removes the throwaway profile.
 */
export const test = base.extend({
  // Playwright's fixture signature requires a destructured first arg even
  // when no other fixtures are used.
  // eslint-disable-next-line no-empty-pattern
  extensionFirefox: async ({}, use) => {
    const { profileDir, proc } = await launchExtensionFirefox();
    try {
      await use({ profileDir, proc });
    } finally {
      proc.kill("SIGTERM");
      try {
        rmSync(profileDir, { recursive: true, force: true });
      } catch {
        /* best-effort cleanup */
      }
    }
  },
});

export { expect };
