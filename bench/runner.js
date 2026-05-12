/**
 * Browser-agent benchmark runner.
 *
 * Two modes:
 *   --dry   : replay the per-task `expectedTools` sequence through a stub LLM
 *             (no extension launch, no real model). Deterministic. CI-safe.
 *             Output lands in `bench/baselines/dry.json` for diffing.
 *
 *   default : real-LLM run. Spawns Firefox via web-ext with the extension
 *             loaded; drives each task against the user's currently active
 *             provider. Requires the extension to be configured. Output
 *             lands in `bench/results-<iso>.json`.
 *
 * The runner is intentionally small. Anything fancy (Playwright fixtures,
 * web-ext orchestration) goes inside conditional `--dry === false` paths so
 * the dry runner has zero non-stdlib dependencies and works in any Node 20+
 * environment.
 */

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { computeCost } from "../background/lib/pricing.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");

/** All task fixtures under bench/tasks/. */
function loadTasks() {
  const root = join(HERE, "tasks");
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .map((name) => join(root, name))
    .filter((p) => statSync(p).isDirectory())
    .map((dir) => ({
      dir,
      meta: JSON.parse(readFileSync(join(dir, "task.json"), "utf8")),
    }))
    .sort((a, b) => a.meta.id.localeCompare(b.meta.id));
}

/**
 * Dry-mode execution: walk the task's `expectedTools` and pretend the agent
 * called them. No model, no network, no DOM. Used in CI to lock the
 * canonical tool sequences.
 */
async function runDry(tasks) {
  const out = [];
  for (const { meta } of tasks) {
    const tools = meta.expectedTools || [];
    out.push({
      id: meta.id,
      title: meta.title,
      mode: "dry",
      success: true,
      turns: tools.length,
      wallMs: 0,
      toolCounts: countTools(tools),
      tokens: zeroTokens(),
      usdEstimate: 0,
    });
  }
  return out;
}

/**
 * Real-mode execution: defers to the bench/launch.js helper (split out so
 * the dry runner does not pull in web-ext + jsdom + Playwright at import
 * time). When that file is missing or the harness is invoked without a
 * provider configured the runner emits a clear hint and exits non-zero.
 */
async function runReal(tasks) {
  let launch;
  try {
    ({ launch } = await import("./launch.js"));
  } catch {
    console.error(
      "Real-mode bench needs bench/launch.js (web-ext + Playwright fixture).\n" +
        "It ships separately so the dry runner has no Node-side deps.\n" +
        "Track its arrival in docs/BENCHMARKING.md.",
    );
    process.exit(2);
  }
  const out = [];
  for (const { dir, meta } of tasks) {
    const start = Date.now();
    let result;
    try {
      result = await launch(dir, meta);
    } catch (e) {
      result = { success: false, turns: 0, toolCounts: {}, tokens: zeroTokens(), error: e.message };
    }
    out.push({
      id: meta.id,
      title: meta.title,
      mode: "real",
      success: !!result.success,
      turns: result.turns ?? 0,
      wallMs: Date.now() - start,
      toolCounts: result.toolCounts ?? {},
      tokens: result.tokens ?? zeroTokens(),
      usdEstimate: result.model ? computeCost(result.model, result.tokens || zeroTokens()) : 0,
      error: result.error ?? null,
    });
  }
  return out;
}

function countTools(tools) {
  const out = {};
  for (const t of tools) out[t] = (out[t] || 0) + 1;
  return out;
}

function zeroTokens() {
  return { promptTokens: 0, completionTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
}

/**
 * Write a results file under bench/. In dry mode we always overwrite the
 * baseline so a dry run doubles as a baseline refresh; CI will then diff
 * against the committed baseline and fail if drift appears.
 *
 * @param {boolean} dry
 * @param {Array<object>} results
 */
function writeResults(dry, results) {
  const summary = {
    generatedAt: new Date().toISOString(),
    mode: dry ? "dry" : "real",
    taskCount: results.length,
    successCount: results.filter((r) => r.success).length,
    totalTurns: results.reduce((s, r) => s + r.turns, 0),
    totalUsd: Number(results.reduce((s, r) => s + r.usdEstimate, 0).toFixed(4)),
    results,
  };
  if (dry) {
    const baselineDir = join(HERE, "baselines");
    if (!existsSync(baselineDir)) mkdirSync(baselineDir);
    writeFileSync(join(baselineDir, "dry.json"), JSON.stringify(summary, null, 2) + "\n");
    return join(baselineDir, "dry.json");
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = join(HERE, `results-${stamp}.json`);
  writeFileSync(file, JSON.stringify(summary, null, 2) + "\n");
  return file;
}

/** Programmatic entry point. Kept exported so the test suite can drive it. */
export async function bench({ dry = false } = {}) {
  const tasks = loadTasks();
  if (tasks.length === 0) {
    console.warn("[bench] No tasks under bench/tasks/. Add fixtures to measure anything useful.");
    return { dry, results: [], file: null };
  }
  const results = dry ? await runDry(tasks) : await runReal(tasks);
  const file = writeResults(dry, results);
  return { dry, results, file };
}

// CLI entry point. Skipped when the runner is import-only (e.g. tests).
const invokedDirectly = process.argv[1] && process.argv[1].endsWith("/runner.js");
if (invokedDirectly) {
  const dry = process.argv.includes("--dry");
  bench({ dry })
    .then(({ file, results }) => {
      const passed = results.filter((r) => r.success).length;
      console.log(`[bench] ${passed}/${results.length} tasks passed → ${file}`);
    })
    .catch((e) => {
      console.error("[bench] runner failed:", e);
      process.exit(1);
    });
}

// Expose REPO for tests that want to assert against the repo root.
export const BENCH_REPO = REPO;
