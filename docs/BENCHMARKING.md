# Benchmarking

Firefox LLM Bridge ships a small, deterministic, MIT-equivalent task harness so the agent's behaviour is measurable end-to-end across providers.

## Why this exists

The README claims multi-step task execution. Without measurement, that's marketing. The harness makes the claim falsifiable:

- **Success rate** per provider per task
- **Turn count** until `task_complete`
- **Wall-clock latency** end-to-end
- **Tool-call distribution** per task
- **Token usage** (prompt / completion / cache-read / cache-creation) and USD estimate via `lib/pricing.js`

## Two modes

### Dry mode — `npm run bench:dry`

- Walks each task's `expectedTools[]` sequence against a stub LLM.
- No web-ext launch, no real tokens, no DOM evaluation.
- Output overwrites `bench/baselines/dry.json`.
- Used in CI as a regression gate via `tests/bench.test.js`.

### Real mode — `npm run bench`

- Boots Firefox via `web-ext run --browser-console`, drives the configured provider against each task fixture.
- Status: launcher is a **stub** (`bench/launch.js`) until the Playwright + web-ext driver lands.
- Output writes to `bench/results-<iso>.json` (gitignored).

## Layout

```
bench/
  README.md
  runner.js               # both modes' entry point
  launch.js               # real-mode launcher (stub today)
  tasks/<id>/task.html    # static fixture the agent operates on
  tasks/<id>/task.json    # { id, title, prompt, predicate, expectedTools }
  baselines/dry.json      # locked dry-run output
  results-<iso>.json      # per-real-run output (gitignored)
```

## Task contract

```json
{
  "id": "click-the-link",
  "title": "Click the documentation link",
  "prompt": "Click the link that takes me to documentation.",
  "predicate": "document.getElementById('status').textContent === 'clicked:docs'",
  "expectedTools": ["read_page", "click_element", "task_complete"]
}
```

Rules:

- `id` is the directory name and must be unique.
- `predicate` is a JS expression evaluated in the page after `task_complete`. Truthy → success.
- `expectedTools` must end in `task_complete` so the dry runner exits cleanly.
- Tasks must be self-contained — no third-party scripts, no network. All assets local.

## Adding a task

```bash
mkdir bench/tasks/my-task
$EDITOR bench/tasks/my-task/task.html
$EDITOR bench/tasks/my-task/task.json
npm run bench:dry          # rewrites the baseline; commit the diff
npm test                   # tests/bench.test.js verifies the schema and baseline
```

## Why no WebArena / Mind2Web

Both have license terms that constrain redistribution. Keeping the harness Apache-2.0-compatible means contributors can iterate without legal review. The runner's protocol is intentionally easy to point at an external suite later without redesign.

## Roadmap

- Real-mode launcher (`bench/launch.js`) wired to Playwright's Firefox driver + `web-ext run`
- Per-provider matrix in CI (manual / opt-in)
- Cross-provider comparison report (markdown table generator)
- Larger task pack (Wikipedia navigate, GitHub search-and-open, multi-tab compare)
