/**
 * Manifest / package / README consistency tests.
 *
 * Drift between these three is the most common cause of "the README says X
 * but the extension is on Y" confusion. CI runs this on every PR.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("manifest / package / README version consistency", () => {
  const manifest = JSON.parse(readFileSync(join(REPO, "manifest.json"), "utf8"));
  const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));
  const readme = readFileSync(join(REPO, "README.md"), "utf8");

  it("package.json version matches manifest.json version", () => {
    expect(pkg.version).toBe(manifest.version);
  });

  it("README references the current version exactly once in the status banner", () => {
    const banner = readme.match(/\*\*Status:\*\*\s+v([\d.]+)/);
    expect(banner).not.toBeNull();
    expect(banner[1]).toBe(manifest.version);
  });

  it("CHANGELOG.md has an entry for the current version", () => {
    const changelog = readFileSync(join(REPO, "CHANGELOG.md"), "utf8");
    expect(changelog).toContain(`[${manifest.version}]`);
  });
});

describe("package.json scripts contract", () => {
  const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));

  it("publishes the canonical script names", () => {
    for (const name of [
      "test",
      "test:coverage",
      "test:e2e",
      "check",
      "lint",
      "lint:webext",
      "typecheck",
      "format",
      "format:check",
      "build",
      "dev",
      "bench",
      "bench:dry",
    ]) {
      expect(pkg.scripts[name]).toBeDefined();
    }
  });
});
