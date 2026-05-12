/**
 * Bench harness contract tests.
 *
 * These do not exercise the real-mode runner (which spawns Firefox and
 * costs real money); they verify the dry runner stays deterministic and
 * the task schema is valid. CI can run this safely on every PR.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BENCH_ROOT = join(HERE, "..", "bench");
const TASKS_ROOT = join(BENCH_ROOT, "tasks");
const BASELINE = join(BENCH_ROOT, "baselines", "dry.json");

describe("bench: task schema", () => {
  const taskDirs = existsSync(TASKS_ROOT)
    ? readdirSync(TASKS_ROOT)
        .map((n) => join(TASKS_ROOT, n))
        .filter((p) => statSync(p).isDirectory())
    : [];

  it.each(taskDirs)("each task has well-formed task.json and task.html (%s)", (dir) => {
    expect(existsSync(join(dir, "task.html"))).toBe(true);
    const meta = JSON.parse(readFileSync(join(dir, "task.json"), "utf8"));
    expect(typeof meta.id).toBe("string");
    expect(typeof meta.title).toBe("string");
    expect(typeof meta.prompt).toBe("string");
    expect(typeof meta.predicate).toBe("string");
    expect(Array.isArray(meta.expectedTools)).toBe(true);
    expect(meta.expectedTools.length).toBeGreaterThan(0);
    // The terminal action must always be task_complete so the bench loop
    // exits cleanly even when a future model invents extra steps.
    expect(meta.expectedTools[meta.expectedTools.length - 1]).toBe("task_complete");
  });
});

describe("bench: dry-mode runner", () => {
  it("emits a deterministic baseline (ignoring timestamp)", async () => {
    const { bench } = await import("../bench/runner.js");
    const a = await bench({ dry: true });
    const b = await bench({ dry: true });
    expect(stripTimestamps(a.results)).toEqual(stripTimestamps(b.results));
  });

  it("baseline file matches the live dry run (drift guard)", async () => {
    const { bench } = await import("../bench/runner.js");
    const live = await bench({ dry: true });
    const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
    expect(stripTimestamps(live.results)).toEqual(stripTimestamps(baseline.results));
  });

  function stripTimestamps(results) {
    return results.map((r) => ({ ...r, wallMs: 0 }));
  }
});
