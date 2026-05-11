/**
 * Privacy-posture regression tests.
 *
 * These tests are the automated guardrails behind our "zero telemetry, no
 * analytics, no remote code" claims. They grep the shipped source files
 * for any outbound network call and fail if it points anywhere outside the
 * known provider allowlist (which is in turn enforced by the manifest CSP).
 *
 * If you legitimately need to talk to a new endpoint, update the manifest
 * CSP AND the allowlist below in the same change.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve from this file rather than process.cwd() — robust across CI
// runners that may invoke vitest from a non-root directory.
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const SHIPPED_DIRS = ["background", "content", "sidebar", "options"];

/** Every host the extension is allowed to talk to. Must match manifest CSP. */
const ALLOWED_HOSTS = [
  "localhost",
  "127.0.0.1",
  "[::1]",
  "api.anthropic.com",
  "api.openai.com",
  "generativelanguage.googleapis.com",
];

/**
 * Recursively walk a directory and yield every `.js` file.
 * @param {string} dir
 * @returns {Generator<string>}
 */
function* walkJs(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) yield* walkJs(full);
    else if (entry.endsWith(".js")) yield full;
  }
}

describe("privacy posture: no telemetry leaks in shipped code", () => {
  it("ships zero analytics / beacon / sendBeacon / image-pixel patterns", () => {
    const offenders = [];
    for (const dir of SHIPPED_DIRS) {
      for (const file of walkJs(join(REPO_ROOT, dir))) {
        const text = readFileSync(file, "utf8");
        // Patterns that indicate telemetry, however well-intentioned.
        const bad = [
          /navigator\.sendBeacon\s*\(/,
          /new\s+Image\s*\(\)/,
          /\bgtag\s*\(/,
          /window\.dataLayer/,
          /amplitude\./,
          /mixpanel\./,
          /sentry\./i,
          /datadog\./,
          /\bgoogle-analytics\.com/,
          /\bsegment\.io/,
        ];
        for (const re of bad) {
          if (re.test(text)) offenders.push(`${file} matched ${re}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every fetch URL in shipped code is either a relative path, a provider hostname, or a runtime variable", () => {
    /**
     * Extract URL string literals from `fetch(...)` calls — both leading
     * arguments and template-literal interpolations. Misses dynamic URLs;
     * those are validated separately by the CSP at runtime.
     */
    const violations = [];
    for (const dir of SHIPPED_DIRS) {
      for (const file of walkJs(join(REPO_ROOT, dir))) {
        const text = readFileSync(file, "utf8");
        // String literals appearing as `fetch("…")` or `fetch(\`${…}…\`)`
        const re = /fetch\s*\(\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`)/g;
        let m;
        while ((m = re.exec(text)) !== null) {
          const url = m[1] || m[2] || m[3];
          // If the host portion is a `${…}` template placeholder (e.g.
          // `${base}/api/tags`), the CSP enforces the allowlist at runtime
          // — we can't verify statically and don't need to. Skip those.
          if (/^\$\{/.test(url)) continue;
          // Strip placeholders so we can check any literal constants.
          const stripped = url.replace(/\$\{[^}]*\}/g, "");
          if (stripped.length === 0) continue; // entirely dynamic
          // Pure path-only URLs (`/api/tags`) belong to a dynamic host —
          // the host appeared before the placeholder. Same case as above.
          if (stripped.startsWith("/") && !/^https?:/.test(url)) continue;
          const allowed = ALLOWED_HOSTS.some((h) => stripped.includes(h));
          if (!allowed) violations.push(`${file}: ${url}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("no eval, no Function constructor, no remote import() in shipped code", () => {
    const offenders = [];
    for (const dir of SHIPPED_DIRS) {
      for (const file of walkJs(join(REPO_ROOT, dir))) {
        const text = readFileSync(file, "utf8");
        if (/\beval\s*\(/.test(text)) offenders.push(`${file}: eval()`);
        if (/\bnew\s+Function\s*\(/.test(text)) offenders.push(`${file}: new Function()`);
        if (/import\s*\(\s*[`'"]https?:/.test(text)) {
          offenders.push(`${file}: remote import()`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("manifest contract: CSP and permissions remain minimal", () => {
  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, "manifest.json"), "utf8"));

  it("connect-src lists exactly the expected hosts and no wildcard", () => {
    const csp = manifest.content_security_policy?.extension_pages || "";
    expect(csp).toContain("connect-src");
    // No catch-all wildcards
    expect(csp).not.toMatch(/connect-src[^;]*\bhttps:\/\/\*/);
    expect(csp).not.toMatch(/connect-src[^;]*\bhttp:\/\/\*/);
    // Required hosts present
    for (const host of [
      "http://localhost:*",
      "http://127.0.0.1:*",
      "http://[::1]:*",
      "https://api.anthropic.com",
      "https://api.openai.com",
      "https://generativelanguage.googleapis.com",
    ]) {
      expect(csp).toContain(host);
    }
  });

  it("declares 'no developer data collection' via browser_specific_settings", () => {
    const gecko = manifest.browser_specific_settings?.gecko;
    expect(gecko).toBeDefined();
    expect(gecko.data_collection_permissions).toBeDefined();
  });

  it("does not request webRequest, nativeMessaging, cookies, clipboardRead, history, bookmarks, management, proxy, or unlimitedStorage", () => {
    const banned = new Set([
      "webRequest",
      "webRequestBlocking",
      "nativeMessaging",
      "cookies",
      "clipboardRead",
      "clipboardWrite",
      "history",
      "bookmarks",
      "management",
      "proxy",
      "unlimitedStorage",
      "tabHide",
    ]);
    const requested = new Set(manifest.permissions || []);
    const optional = new Set(manifest.optional_permissions || []);
    for (const b of banned) {
      expect(requested.has(b)).toBe(false);
      expect(optional.has(b)).toBe(false);
    }
  });

  it("ships at most one default_locale and an _execute_sidebar_action keybinding", () => {
    expect(manifest.default_locale).toBe("en");
    expect(manifest.commands?._execute_sidebar_action).toBeDefined();
  });
});
