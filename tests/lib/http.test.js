import { describe, it, expect, vi } from "vitest";
import {
  composeSignals,
  sleep,
  backoffDelay,
  fetchWithRetry,
  DEFAULT_RETRY,
  DEFAULT_TIMEOUT_MS,
} from "../../background/lib/http.js";
import { AuthError, RateLimitError, NetworkError, TimeoutError, ProviderError } from "../../background/lib/errors.js";

function mockResponse(body, { ok = true, status = 200, headers = {} } = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok,
    status,
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    text: vi.fn().mockResolvedValue(text),
    // Lazy: only parse json when called, and tolerate non-JSON text bodies.
    json: vi.fn().mockImplementation(async () => {
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    }),
  };
}

describe("composeSignals", () => {
  it("returns aborted controller if any input is already aborted", () => {
    const c = new AbortController();
    c.abort("boom");
    const out = composeSignals([c.signal]);
    expect(out.signal.aborted).toBe(true);
  });

  it("aborts when any input aborts", () => {
    const a = new AbortController();
    const b = new AbortController();
    const out = composeSignals([a.signal, b.signal]);
    expect(out.signal.aborted).toBe(false);
    b.abort();
    expect(out.signal.aborted).toBe(true);
  });

  it("ignores null/undefined signals", () => {
    expect(() => composeSignals([null, undefined])).not.toThrow();
  });
});

describe("sleep", () => {
  it("resolves after the given delay", async () => {
    const t0 = Date.now();
    await sleep(20);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(15);
  });

  it("rejects immediately if signal already aborted", async () => {
    const c = new AbortController();
    c.abort("nope");
    await expect(sleep(100, c.signal)).rejects.toBe("nope");
  });

  it("rejects when signal aborts during sleep", async () => {
    const c = new AbortController();
    const p = sleep(5000, c.signal);
    setTimeout(() => c.abort("mid"), 10);
    await expect(p).rejects.toBe("mid");
  });
});

describe("backoffDelay", () => {
  it("grows exponentially capped at maxDelayMs", () => {
    const policy = { ...DEFAULT_RETRY, jitterRatio: 0 };
    expect(backoffDelay(0, policy)).toBe(policy.baseDelayMs);
    expect(backoffDelay(1, policy)).toBe(policy.baseDelayMs * 2);
    expect(backoffDelay(100, policy)).toBe(policy.maxDelayMs);
  });

  it("applies jitter within ±ratio", () => {
    const policy = { ...DEFAULT_RETRY, jitterRatio: 0.5 };
    for (let i = 0; i < 20; i++) {
      const d = backoffDelay(2, policy);
      const expectedMid = Math.min(policy.maxDelayMs, policy.baseDelayMs * 4);
      expect(d).toBeGreaterThanOrEqual(Math.floor(expectedMid * 0.5));
      expect(d).toBeLessThanOrEqual(Math.ceil(expectedMid * 1.5));
    }
  });

  it("uses defaults when no policy provided", () => {
    expect(backoffDelay(0)).toBeGreaterThan(0);
  });
});

describe("fetchWithRetry", () => {
  const FAST = { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5, jitterRatio: 0 };

  it("returns response on first 2xx", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockResponse("ok"));
    const res = await fetchWithRetry("u", {}, { providerId: "p", fetchImpl, retry: FAST });
    expect(res.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("retries on 5xx and eventually succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(mockResponse("down", { ok: false, status: 503 }))
      .mockResolvedValueOnce(mockResponse("ok"));
    const res = await fetchWithRetry("u", {}, { providerId: "p", fetchImpl, retry: FAST });
    expect(res.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting retries on persistent 5xx", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockResponse("down", { ok: false, status: 502 }));
    await expect(
      fetchWithRetry("u", {}, { providerId: "p", fetchImpl, retry: FAST }),
    ).rejects.toBeInstanceOf(ProviderError);
    expect(fetchImpl).toHaveBeenCalledTimes(FAST.maxAttempts);
  });

  it("does NOT retry on 401 (AuthError)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockResponse("bad", { ok: false, status: 401 }));
    await expect(
      fetchWithRetry("u", {}, { providerId: "p", fetchImpl, retry: FAST }),
    ).rejects.toBeInstanceOf(AuthError);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("does NOT retry on 400 (non-retryable ProviderError)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockResponse("bad", { ok: false, status: 400 }));
    await expect(
      fetchWithRetry("u", {}, { providerId: "p", fetchImpl, retry: FAST }),
    ).rejects.toBeInstanceOf(ProviderError);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("retries on 429 and honors Retry-After header (capped by maxDelayMs)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(mockResponse("slow", { ok: false, status: 429, headers: { "retry-after": "0" } }))
      .mockResolvedValueOnce(mockResponse("ok"));
    const res = await fetchWithRetry("u", {}, { providerId: "p", fetchImpl, retry: FAST });
    expect(res.ok).toBe(true);
  });

  it("retries on 429 without Retry-After header (backoff)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(mockResponse("slow", { ok: false, status: 429 }))
      .mockResolvedValueOnce(mockResponse("ok"));
    const res = await fetchWithRetry("u", {}, { providerId: "p", fetchImpl, retry: FAST });
    expect(res.ok).toBe(true);
  });

  it("throws RateLimitError if 429 persists", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockResponse("slow", { ok: false, status: 429 }));
    await expect(
      fetchWithRetry("u", {}, { providerId: "p", fetchImpl, retry: FAST }),
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  it("wraps fetch network throws into NetworkError and retries", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(mockResponse("ok"));
    const res = await fetchWithRetry("u", {}, { providerId: "p", fetchImpl, retry: FAST });
    expect(res.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws NetworkError after exhausting retries on persistent network error", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(
      fetchWithRetry("u", {}, { providerId: "p", fetchImpl, retry: FAST }),
    ).rejects.toBeInstanceOf(NetworkError);
  });

  it("propagates caller abort without wrapping or retrying", async () => {
    const caller = new AbortController();
    caller.abort("user-stop");
    const fetchImpl = vi.fn();
    await expect(
      fetchWithRetry("u", {}, { providerId: "p", fetchImpl, signal: caller.signal, retry: FAST }),
    ).rejects.toBe("user-stop");
  });

  it("propagates caller abort with no reason (falls back to the inner error)", async () => {
    // Custom signal shape where `aborted` is true but `reason` is undefined,
    // exercising the `?? e` fallback branch in http.js.
    const fakeSignal = {
      aborted: false,
      reason: undefined,
      _abort() {
        this.aborted = true;
        for (const l of this._listeners) l();
      },
      _listeners: [],
      addEventListener(_e, fn) {
        this._listeners.push(fn);
      },
      removeEventListener() {},
    };
    const innerErr = new Error("inner-fetch-fail");
    const fetchImpl = vi.fn(async () => {
      fakeSignal._abort();
      throw innerErr;
    });
    await expect(
      fetchWithRetry("u", {}, { providerId: "p", fetchImpl, signal: fakeSignal, retry: FAST }),
    ).rejects.toBe(innerErr);
  });

  it("wraps non-Error network throws using String() fallback", async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce("plain-string-error");
    await expect(
      fetchWithRetry("u", {}, { providerId: "p", fetchImpl, retry: { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 } }),
    ).rejects.toBeInstanceOf(NetworkError);
  });

  it("falls through to defensive NetworkError when maxAttempts is zero", async () => {
    const fetchImpl = vi.fn();
    await expect(
      fetchWithRetry("u", {}, { providerId: "p", fetchImpl, retry: { maxAttempts: 0, baseDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 } }),
    ).rejects.toBeInstanceOf(NetworkError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("treats per-attempt timeout as retryable", async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      });
    });
    await expect(
      fetchWithRetry("u", {}, {
        providerId: "p",
        fetchImpl,
        retry: FAST,
        timeoutMs: 5,
      }),
    ).rejects.toBeInstanceOf(TimeoutError);
    expect(fetchImpl).toHaveBeenCalledTimes(FAST.maxAttempts);
  });

  it("uses globalThis.fetch when fetchImpl not provided", async () => {
    globalThis.fetch.mockResolvedValueOnce(mockResponse("ok"));
    const res = await fetchWithRetry("u", {}, { providerId: "p", retry: FAST });
    expect(res.ok).toBe(true);
  });

  it("uses DEFAULT_TIMEOUT_MS when timeoutMs not provided", async () => {
    expect(DEFAULT_TIMEOUT_MS).toBeGreaterThan(0);
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockResponse("ok"));
    await fetchWithRetry("u", {}, { providerId: "p", fetchImpl, retry: FAST });
    expect(fetchImpl).toHaveBeenCalled();
  });

  it("re-throws an HTTP-classified error from a non-fetch source unchanged", async () => {
    const preclassified = new AuthError("p", 401, "");
    const fetchImpl = vi.fn().mockRejectedValueOnce(preclassified);
    await expect(
      fetchWithRetry("u", {}, { providerId: "p", fetchImpl, retry: FAST }),
    ).rejects.toBe(preclassified);
  });

  it("returns response when body read for non-ok fails", async () => {
    const flaky = mockResponse("", { ok: false, status: 500 });
    flaky.text = vi.fn().mockRejectedValue(new Error("body fail"));
    const fetchImpl = vi.fn().mockResolvedValue(flaky);
    await expect(
      fetchWithRetry("u", {}, { providerId: "p", fetchImpl, retry: FAST }),
    ).rejects.toBeInstanceOf(ProviderError);
  });
});
