# Browser-Agent Benchmark Harness

Local-only, deterministic-by-default measurement of agent task success, latency, turn-count, and tool-call patterns across providers.

The harness ships **no third-party tasks and no upstream task licenses**. Every fixture under `tasks/` is original to this project. Tasks are static HTML pages exercised by the same agent loop the extension runs in production — so a benchmark result reflects what the user actually experiences, not a stub.

## Quick start

```bash
# Dry mode — runs the harness against a deterministic mock LLM.
# No API keys, no external network. Output committed in baselines/.
npm run bench:dry

# Real run — boots web-ext + Firefox, drives the agent against your
# configured provider. Manual / opt-in (real tokens, real $).
npm run bench
```

`npm run bench:dry` is what CI runs to lock the **expected tool sequence** for each task. Drift between the live model and the canonical sequence appears as a diff against `bench/baselines/dry.json`.

## What the harness measures

For every task the runner records:

- `success` — boolean from the task's `predicate(page)` after the agent declares `task_complete`.
- `turns` — count of agent turns until `task_complete` or the cap.
- `wallMs` — wall-clock time end-to-end.
- `toolCounts` — how many of each tool the model used.
- `tokens` — `{ promptTokens, completionTokens, cacheReadTokens, cacheCreationTokens }` aggregated.
- `usdEstimate` — via `background/lib/pricing.js`.
- `error` — non-null when the agent threw or hit the turn cap.

Aggregate stats roll up to a single `results-<date>.json`.

## Adding a task

```
bench/tasks/<id>/
  task.html          static page the agent operates on
  task.json          { id, title, prompt, predicate, expectedTools[] }
```

`predicate` is a JS expression (string) evaluated in the page context after `task_complete`. Return `true` for success.

`expectedTools` is the canonical tool sequence used by the dry-mode mock. Real-mode runs do NOT match against `expectedTools`; that field exists only so the deterministic harness can replay a known-good sequence.

## Why no WebArena / Mind2Web

Both are excellent, both have license terms that constrain redistribution. Keeping this harness MIT-equivalent (Apache-2.0 like the rest of the project) means we can ship the tasks alongside the code, contributors can iterate freely, and a casual user can clone-and-run with no extra setup. The protocol here is intentionally compatible with porting an external suite later if the project chooses.

## Files

| File                 | Purpose                                                         |
| -------------------- | --------------------------------------------------------------- |
| `runner.js`          | Reads `tasks/`, executes each, records metrics, writes results. |
| `mock-llm.js`        | Replays `expectedTools[]` in dry mode. Deterministic.           |
| `tasks/*/`           | Self-contained task fixtures.                                   |
| `baselines/dry.json` | Locked expected output of `npm run bench:dry`.                  |
| `results-*.json`     | Per-run output. Gitignored except for `baselines/`.             |
