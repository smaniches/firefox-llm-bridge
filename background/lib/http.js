/**
 * HTTP utilities for provider calls.
 *
 * Responsibilities:
 *  - Add per-request timeout via composed AbortSignal
 *  - Classify failures into typed errors (see ./errors.js)
 *  - Retry transient failures (5xx, network, 429) with capped exponential backoff
 *  - Honor 429 Retry-After
 *
 * Non-goals:
 *  - Streaming (SSE) — handled per-provider when implemented
 *  - Request body shaping — caller passes a fully-formed init
 */

import {
  NetworkError,
  TimeoutError,
  RateLimitError,
  fromHttpStatus,
} from "./errors.js";

/** Default per-request timeout, in ms. */
export const DEFAULT_TIMEOUT_MS = 60_000;

/** Default retry policy. */
export const DEFAULT_RETRY = Object.freeze({
  maxAttempts: 3,            // total attempts including the first
  baseDelayMs: 500,
  maxDelayMs: 8_000,
  jitterRatio: 0.25,         // ±25% jitter on each delay
});

/**
 * Compose two AbortSignals into one. The returned controller aborts when
 * either input signal aborts, or when its own .abort() is called.
 *
 * (We avoid `AbortSignal.any` for broader engine compatibility.)
 *
 * @param {AbortSignal[]} signals
 * @returns {AbortController}
 */
export function composeSignals(signals) {
  const controller = new AbortController();
  for (const s of signals) {
    if (!s) continue;
    if (s.aborted) {
      controller.abort(s.reason);
      break;
    }
    s.addEventListener("abort", () => controller.abort(s.reason), { once: true });
  }
  return controller;
}

/**
 * Sleep for `ms` milliseconds, but cancel early if the signal aborts.
 * @param {number} ms
 * @param {AbortSignal} [signal]
 */
export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

/**
 * Compute a backoff delay with jitter for the given attempt index (0-based).
 * @param {number} attempt
 * @param {typeof DEFAULT_RETRY} policy
 */
export function backoffDelay(attempt, policy = DEFAULT_RETRY) {
  const exp = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** attempt);
  const jitter = exp * policy.jitterRatio * (Math.random() * 2 - 1);
  return Math.max(0, Math.floor(exp + jitter));
}

/**
 * Perform a fetch with timeout, retry on transient failure, and typed errors.
 *
 * @param {string} url
 * @param {RequestInit} init
 * @param {object} opts
 * @param {string}        opts.providerId  For error classification
 * @param {AbortSignal}   [opts.signal]    Caller's abort signal
 * @param {number}        [opts.timeoutMs] Per-request timeout
 * @param {typeof DEFAULT_RETRY} [opts.retry]
 * @param {Function}      [opts.fetchImpl] For testing (default: globalThis.fetch)
 * @returns {Promise<Response>}
 */
export async function fetchWithRetry(url, init, opts) {
  const {
    providerId,
    signal: callerSignal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retry = DEFAULT_RETRY,
    fetchImpl = globalThis.fetch,
  } = opts;

  let lastErr = null;
  for (let attempt = 0; attempt < retry.maxAttempts; attempt++) {
    // Each attempt gets a fresh composed signal so its timeout does not bleed
    // into the next attempt.
    const timeoutCtl = new AbortController();
    const timeoutId = setTimeout(() => timeoutCtl.abort(new TimeoutError()), timeoutMs);
    const composed = composeSignals([callerSignal, timeoutCtl.signal]);

    try {
      const response = await fetchImpl(url, { ...init, signal: composed.signal });
      clearTimeout(timeoutId);

      if (response.ok) return response;

      // 4xx (other than 429) is not retryable
      const body = await safeReadBody(response);
      const err = fromHttpStatus(providerId, response.status, body, response.headers);

      if (!err.retryable || attempt === retry.maxAttempts - 1) {
        throw err;
      }

      const delayMs =
        err instanceof RateLimitError && err.retryAfterSeconds != null
          ? Math.min(retry.maxDelayMs, err.retryAfterSeconds * 1000)
          : backoffDelay(attempt, retry);

      lastErr = err;
      await sleep(delayMs, callerSignal);
      continue;
    } catch (e) {
      clearTimeout(timeoutId);

      // Caller aborted — propagate AbortError without wrapping or retrying
      if (callerSignal?.aborted) throw callerSignal.reason ?? e;

      // Per-attempt timeout fired
      if (e instanceof TimeoutError || e?.name === "TimeoutError") {
        if (attempt === retry.maxAttempts - 1) throw e;
        lastErr = e;
        await sleep(backoffDelay(attempt, retry), callerSignal);
        continue;
      }

      // Network failure (fetch threw)
      if (!isHttpError(e)) {
        const wrapped = new NetworkError(
          `Network error contacting ${providerId}: ${e.message ?? String(e)}`,
          { cause: e, providerId },
        );
        if (attempt === retry.maxAttempts - 1) throw wrapped;
        lastErr = wrapped;
        await sleep(backoffDelay(attempt, retry), callerSignal);
        continue;
      }

      // Already-classified HTTP error — re-throw
      throw e;
    }
  }
  // Should not reach here
  throw lastErr ?? new NetworkError(`Exhausted retries for ${providerId}`, { providerId });
}

/** True if `e` is one of our HTTP-classified errors. */
function isHttpError(e) {
  return (
    e &&
    typeof e === "object" &&
    typeof e.code === "string" &&
    (e.code.startsWith("PROVIDER_") ||
      e.code === "AUTH_REJECTED" ||
      e.code === "RATE_LIMITED")
  );
}

/** Read a Response body as text, suppressing errors. */
async function safeReadBody(response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
