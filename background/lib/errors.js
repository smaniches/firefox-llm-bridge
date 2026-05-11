/**
 * Typed error hierarchy for provider, network, and agent failures.
 *
 * The UI uses `err.code` to render an actionable message and `err.retryable`
 * to decide whether a retry button should be shown.
 */

/** Base class for all extension-thrown errors. */
export class BridgeError extends Error {
  /**
   * @param {string} message
   * @param {object} [opts]
   * @param {string} [opts.code]     Stable machine-readable code
   * @param {boolean} [opts.retryable]
   * @param {Error}   [opts.cause]
   */
  constructor(message, { code = "BRIDGE_ERROR", retryable = false, cause } = {}) {
    super(message);
    this.name = "BridgeError";
    this.code = code;
    this.retryable = retryable;
    if (cause !== undefined) this.cause = cause;
  }
}

/** The remote provider returned a non-2xx response. */
export class ProviderError extends BridgeError {
  /**
   * @param {string} message
   * @param {object} opts
   * @param {string} opts.providerId   "anthropic" | "openai" | "google" | "ollama"
   * @param {number} opts.status       HTTP status code
   * @param {string} [opts.body]       Response body excerpt
   * @param {boolean} [opts.retryable]
   */
  constructor(message, { providerId, status, body = "", retryable = false }) {
    super(message, { code: `PROVIDER_${status}`, retryable });
    this.name = "ProviderError";
    this.providerId = providerId;
    this.status = status;
    this.body = body;
  }
}

/** The remote authentication was rejected (401/403). */
export class AuthError extends ProviderError {
  constructor(providerId, status, body = "") {
    super(
      `${providerId} rejected the API key (HTTP ${status}). Check the key in Settings.`,
      { providerId, status, body, retryable: false },
    );
    this.name = "AuthError";
    this.code = "AUTH_REJECTED";
  }
}

/** The remote provider rate-limited the request (429). */
export class RateLimitError extends ProviderError {
  /**
   * @param {string} providerId
   * @param {number} [retryAfterSeconds]  Honored from Retry-After header when present
   */
  constructor(providerId, retryAfterSeconds) {
    super(`${providerId} rate-limited the request (HTTP 429).`, {
      providerId,
      status: 429,
      body: "",
      retryable: true,
    });
    this.name = "RateLimitError";
    this.code = "RATE_LIMITED";
    this.retryAfterSeconds = retryAfterSeconds ?? null;
  }
}

/** A transient network failure (fetch threw, DNS, reset, etc.). */
export class NetworkError extends BridgeError {
  constructor(message, { cause, providerId } = {}) {
    super(message, { code: "NETWORK", retryable: true, cause });
    this.name = "NetworkError";
    this.providerId = providerId ?? null;
  }
}

/** The request was cancelled by the user (abort) or by a timeout. */
export class TimeoutError extends BridgeError {
  constructor(message = "Request timed out") {
    super(message, { code: "TIMEOUT", retryable: true });
    this.name = "TimeoutError";
  }
}

/** Configuration is missing or invalid. */
export class ConfigError extends BridgeError {
  constructor(message) {
    super(message, { code: "CONFIG", retryable: false });
    this.name = "ConfigError";
  }
}

/**
 * Classify an HTTP status into the right error subclass.
 * @param {string} providerId
 * @param {number} status
 * @param {string} body
 * @param {Headers} [headers]
 */
export function fromHttpStatus(providerId, status, body, headers) {
  if (status === 401 || status === 403) return new AuthError(providerId, status, body);
  if (status === 429) {
    const retryAfter = headers?.get?.("retry-after");
    const retryAfterSeconds = retryAfter ? parseRetryAfter(retryAfter) : null;
    return new RateLimitError(providerId, retryAfterSeconds);
  }
  const retryable = status >= 500 && status < 600;
  return new ProviderError(
    `${providerId} API ${status}: ${body.substring(0, 200)}`,
    { providerId, status, body, retryable },
  );
}

/**
 * Parse an HTTP Retry-After header value (seconds or HTTP-date) to seconds.
 * @param {string} v
 * @returns {number|null}
 */
export function parseRetryAfter(v) {
  if (!v) return null;
  const asInt = Number(v);
  if (Number.isFinite(asInt)) return Math.max(0, asInt);
  const ts = Date.parse(v);
  if (Number.isFinite(ts)) {
    const seconds = Math.ceil((ts - Date.now()) / 1000);
    return seconds > 0 ? seconds : 0;
  }
  return null;
}
