/**
 * STRUCTURED LOGGER
 *
 * A minimal namespaced logger with a debug toggle, an in-memory ring buffer,
 * and an export function that produces a JSON session trace for bug reports.
 *
 * Goals:
 *   - Console output stays quiet by default (matches CLAUDE.md: warn for
 *     recoverable, error for genuine failures).
 *   - Users can flip a Debug switch in Options to surface info/debug lines
 *     without redeploying the extension.
 *   - The ring buffer captures the last N events even when console output
 *     is off, so an exported trace contains enough context to triage a bug.
 *   - Nothing about the logger ever leaves the device. The user is the only
 *     one who can read or export the buffer.
 *
 * The buffer never stores raw API keys, request bodies, or response bodies —
 * callers are expected to redact sensitive fields before logging. We enforce
 * this in tests via a redaction sweep on `dumpSession()`.
 */

/** Levels in increasing severity. */
const LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40 });

/** Maximum events held in the ring buffer. Bounded so memory stays sane. */
export const BUFFER_MAX = 500;

/** Module-internal state. */
const internal = {
  /** @type {"debug"|"info"|"warn"|"error"} */
  level: "info",
  /** Whether to also `console.*` log to the devtools console. */
  consoleEnabled: false,
  /** @type {Array<{ts:number, level:string, ns:string, msg:string, data?:any}>} */
  buffer: [],
};

/**
 * Configure the logger. Both parameters are optional; pass only what you want
 * to change. Repeat calls overwrite previous settings.
 *
 * @param {{ level?: "debug"|"info"|"warn"|"error", consoleEnabled?: boolean }} opts
 */
export function configureLogger(opts = {}) {
  if (opts.level && LEVELS[opts.level] !== undefined) {
    internal.level = opts.level;
  }
  if (typeof opts.consoleEnabled === "boolean") {
    internal.consoleEnabled = opts.consoleEnabled;
  }
}

/**
 * Read configured logger options. Mostly for tests; production code calls
 * configureLogger and trusts the writer.
 */
export function getLoggerConfig() {
  return { level: internal.level, consoleEnabled: internal.consoleEnabled };
}

/**
 * Build a namespaced logger. Callers do:
 *   const log = createLogger("agent");
 *   log.info("turn started", { turn: 3 });
 *
 * @param {string} ns - e.g. "agent", "provider:anthropic", "sensor"
 */
export function createLogger(ns) {
  /**
   * @param {"debug"|"info"|"warn"|"error"} level
   * @param {string} msg
   * @param {any} [data]
   */
  const emit = (level, msg, data) => {
    if (LEVELS[level] < LEVELS[internal.level]) return;
    const event = { ts: Date.now(), level, ns, msg };
    if (data !== undefined) event.data = sanitize(data);
    pushEvent(event);
    if (internal.consoleEnabled) {
      const fn =
        level === "error"
          ? console.error
          : level === "warn"
            ? console.warn
            : /* v8 ignore next */ console.info;
      fn(`[${ns}] ${msg}`, data === undefined ? "" : data);
    }
  };
  return {
    debug: (msg, data) => emit("debug", msg, data),
    info: (msg, data) => emit("info", msg, data),
    warn: (msg, data) => emit("warn", msg, data),
    error: (msg, data) => emit("error", msg, data),
  };
}

function pushEvent(event) {
  internal.buffer.push(event);
  if (internal.buffer.length > BUFFER_MAX) internal.buffer.shift();
}

/**
 * Deep-clone-and-redact `data`. The model can pass arbitrary objects through
 * the log; we strip keys that look like credentials before storing.
 */
function sanitize(data) {
  try {
    return walkRedact(data, 0);
  } catch {
    return "<unserialisable>";
  }
}

/** Keys whose values are always redacted. Lowercase comparison. */
const REDACT_KEYS = new Set([
  "apikey",
  "api_key",
  "authorization",
  "x-api-key",
  "x-goog-api-key",
  "anthropic-api-key",
  "password",
  "secret",
  "token",
  "session",
  "cookie",
]);

function walkRedact(value, depth) {
  if (depth > 6) return "<too deep>";
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => walkRedact(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (REDACT_KEYS.has(k.toLowerCase())) out[k] = "<redacted>";
    else out[k] = walkRedact(v, depth + 1);
  }
  return out;
}

/**
 * Return a snapshot of the ring buffer. Returns a defensive copy; mutating
 * the returned array does not affect the live buffer.
 */
export function getSessionLog() {
  return internal.buffer.slice();
}

/**
 * Produce an exportable JSON blob describing the captured session. Suitable
 * for attaching to a bug report. Contains no raw secrets (sanitize() strips
 * them at write time).
 *
 * @returns {string} pretty-printed JSON
 */
export function dumpSession() {
  return JSON.stringify({ exportedAt: new Date().toISOString(), events: getSessionLog() }, null, 2);
}

/** Reset state. Used in tests; production code does not call this. */
export function _resetLoggerForTests() {
  internal.level = "info";
  internal.consoleEnabled = false;
  internal.buffer.length = 0;
}
