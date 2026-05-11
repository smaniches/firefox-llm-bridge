import { describe, it, expect } from "vitest";
import {
  BridgeError,
  ProviderError,
  AuthError,
  RateLimitError,
  NetworkError,
  TimeoutError,
  ConfigError,
  fromHttpStatus,
  parseRetryAfter,
} from "../../background/lib/errors.js";

describe("error hierarchy", () => {
  it("BridgeError default code is BRIDGE_ERROR, not retryable", () => {
    const e = new BridgeError("x");
    expect(e.code).toBe("BRIDGE_ERROR");
    expect(e.retryable).toBe(false);
    expect(e.name).toBe("BridgeError");
  });

  it("BridgeError respects code, retryable, cause", () => {
    const cause = new Error("inner");
    const e = new BridgeError("x", { code: "C", retryable: true, cause });
    expect(e.code).toBe("C");
    expect(e.retryable).toBe(true);
    expect(e.cause).toBe(cause);
  });

  it("ProviderError carries provider context", () => {
    const e = new ProviderError("x", {
      providerId: "openai",
      status: 503,
      body: "down",
      retryable: true,
    });
    expect(e instanceof BridgeError).toBe(true);
    expect(e.providerId).toBe("openai");
    expect(e.status).toBe(503);
    expect(e.body).toBe("down");
    expect(e.retryable).toBe(true);
    expect(e.code).toBe("PROVIDER_503");
  });

  it("ProviderError defaults body to empty string", () => {
    const e = new ProviderError("x", { providerId: "p", status: 500 });
    expect(e.body).toBe("");
  });

  it("AuthError is a ProviderError with AUTH_REJECTED code", () => {
    const e = new AuthError("anthropic", 401, "bad key");
    expect(e instanceof ProviderError).toBe(true);
    expect(e.code).toBe("AUTH_REJECTED");
    expect(e.retryable).toBe(false);
    expect(e.providerId).toBe("anthropic");
  });

  it("RateLimitError is retryable and carries retryAfterSeconds", () => {
    const e = new RateLimitError("openai", 17);
    expect(e.code).toBe("RATE_LIMITED");
    expect(e.retryable).toBe(true);
    expect(e.retryAfterSeconds).toBe(17);
  });

  it("RateLimitError without retryAfter defaults to null", () => {
    const e = new RateLimitError("p");
    expect(e.retryAfterSeconds).toBeNull();
  });

  it("NetworkError is retryable", () => {
    const cause = new Error("dns");
    const e = new NetworkError("net down", { cause, providerId: "p" });
    expect(e.code).toBe("NETWORK");
    expect(e.retryable).toBe(true);
    expect(e.cause).toBe(cause);
    expect(e.providerId).toBe("p");
  });

  it("NetworkError providerId defaults to null when omitted", () => {
    const e = new NetworkError("x");
    expect(e.providerId).toBeNull();
  });

  it("TimeoutError default message + code", () => {
    const e = new TimeoutError();
    expect(e.message).toBe("Request timed out");
    expect(e.code).toBe("TIMEOUT");
    expect(e.retryable).toBe(true);
  });

  it("TimeoutError custom message", () => {
    expect(new TimeoutError("custom").message).toBe("custom");
  });

  it("ConfigError is non-retryable with CONFIG code", () => {
    const e = new ConfigError("no key");
    expect(e.code).toBe("CONFIG");
    expect(e.retryable).toBe(false);
  });
});

describe("fromHttpStatus", () => {
  it("returns AuthError for 401", () => {
    const e = fromHttpStatus("p", 401, "bad");
    expect(e).toBeInstanceOf(AuthError);
  });

  it("returns AuthError for 403", () => {
    const e = fromHttpStatus("p", 403, "no");
    expect(e).toBeInstanceOf(AuthError);
  });

  it("returns RateLimitError with retry-after seconds", () => {
    const headers = new Map([["retry-after", "30"]]);
    headers.get = (k) => headers.get(k); // ensure shape
    const e = fromHttpStatus("p", 429, "slow down", {
      get: (k) => (k === "retry-after" ? "30" : null),
    });
    expect(e).toBeInstanceOf(RateLimitError);
    expect(e.retryAfterSeconds).toBe(30);
  });

  it("returns RateLimitError without retry-after header", () => {
    const e = fromHttpStatus("p", 429, "");
    expect(e).toBeInstanceOf(RateLimitError);
    expect(e.retryAfterSeconds).toBeNull();
  });

  it("returns retryable ProviderError for 5xx", () => {
    const e = fromHttpStatus("p", 503, "down");
    expect(e).toBeInstanceOf(ProviderError);
    expect(e.retryable).toBe(true);
  });

  it("returns non-retryable ProviderError for other 4xx", () => {
    const e = fromHttpStatus("p", 400, "bad request");
    expect(e).toBeInstanceOf(ProviderError);
    expect(e.retryable).toBe(false);
  });

  it("truncates body to 200 chars in message", () => {
    const long = "x".repeat(500);
    const e = fromHttpStatus("p", 500, long);
    expect(e.message.length).toBeLessThan(260);
  });
});

describe("parseRetryAfter", () => {
  it("parses integer seconds", () => {
    expect(parseRetryAfter("17")).toBe(17);
  });

  it("clamps negative to 0", () => {
    expect(parseRetryAfter("-5")).toBe(0);
  });

  it("returns null for empty input", () => {
    expect(parseRetryAfter("")).toBeNull();
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter(undefined)).toBeNull();
  });

  it("parses HTTP-date in the future to seconds remaining", () => {
    const futureDate = new Date(Date.now() + 60_000).toUTCString();
    const v = parseRetryAfter(futureDate);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThanOrEqual(60);
  });

  it("returns 0 for HTTP-date in the past", () => {
    const pastDate = new Date(Date.now() - 60_000).toUTCString();
    expect(parseRetryAfter(pastDate)).toBe(0);
  });

  it("returns null for garbage strings", () => {
    expect(parseRetryAfter("not-a-date")).toBeNull();
  });
});
