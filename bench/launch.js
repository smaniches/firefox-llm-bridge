/**
 * Real-mode bench launcher.
 *
 * Status: stub. The dry runner is the canonical CI surface; the real-mode
 * launcher is gated behind a manual `npm run bench` invocation because it
 * spends real tokens and needs an interactive Firefox profile.
 *
 * When this lands fully it will:
 *   1. Boot Firefox via `web-ext run --browser-console` with the extension
 *      preinstalled and a deterministic profile.
 *   2. Use Playwright's Firefox driver to open the task fixture, then
 *      invoke the sidebar's send-message path with the task prompt.
 *   3. Watch the background port for STREAM_END / TASK_COMPLETE / ERROR.
 *   4. Evaluate the task's `predicate` in the page context to decide
 *      success, harvest tool counts and token usage, and return the
 *      structured result the runner expects.
 *
 * Until the harness ships end-to-end, calling `launch` from the CLI fails
 * fast with a clear error.
 *
 * @param {string} _dir
 * @param {{ id: string }} _meta
 * @returns {Promise<{ success: boolean, turns: number, toolCounts: object, tokens: object, error?: string, model?: string }>}
 */
export async function launch(_dir, _meta) {
  throw new Error(
    "Real-mode bench is not yet wired (bench/launch.js is a stub). Run `npm run bench:dry`.",
  );
}
