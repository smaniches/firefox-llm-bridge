/**
 * Tests for the structured logger.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createLogger,
  configureLogger,
  getLoggerConfig,
  getSessionLog,
  dumpSession,
  _resetLoggerForTests,
  BUFFER_MAX,
} from "../../background/lib/log.js";

beforeEach(() => {
  _resetLoggerForTests();
});

describe("logger: levels", () => {
  it("filters events below the configured level", () => {
    configureLogger({ level: "warn" });
    const log = createLogger("test");
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    const buf = getSessionLog();
    expect(buf.map((e) => e.level)).toEqual(["warn", "error"]);
  });

  it("captures everything at debug level", () => {
    configureLogger({ level: "debug" });
    const log = createLogger("test");
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    expect(getSessionLog().map((e) => e.level)).toEqual(["debug", "info", "warn", "error"]);
  });

  it("ignores an unknown level in configureLogger", () => {
    configureLogger({ level: "info" });
    // @ts-expect-error — intentional bad input
    configureLogger({ level: "nonsense" });
    expect(getLoggerConfig().level).toBe("info");
  });

  it("defaults to info, console off", () => {
    expect(getLoggerConfig()).toEqual({ level: "info", consoleEnabled: false });
  });
});

describe("logger: namespacing + buffer", () => {
  it("tags events with the namespace", () => {
    const log = createLogger("agent");
    log.info("hello", { turn: 1 });
    const [event] = getSessionLog();
    expect(event.ns).toBe("agent");
    expect(event.msg).toBe("hello");
    expect(event.data).toEqual({ turn: 1 });
    expect(typeof event.ts).toBe("number");
  });

  it("respects BUFFER_MAX (FIFO)", () => {
    configureLogger({ level: "debug" });
    const log = createLogger("burst");
    for (let i = 0; i < BUFFER_MAX + 50; i++) log.info(`m${i}`);
    const buf = getSessionLog();
    expect(buf).toHaveLength(BUFFER_MAX);
    expect(buf[0].msg).toBe(`m50`);
    expect(buf[BUFFER_MAX - 1].msg).toBe(`m${BUFFER_MAX + 49}`);
  });

  it("returns a defensive copy from getSessionLog", () => {
    createLogger("ns").info("hi");
    const a = getSessionLog();
    a.push({ ts: 0, level: "info", ns: "x", msg: "tampered" });
    expect(getSessionLog()).toHaveLength(1);
  });
});

describe("logger: console mirroring", () => {
  it("forwards to console when consoleEnabled", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    configureLogger({ level: "debug", consoleEnabled: true });
    const log = createLogger("ns");
    log.warn("warning here", { code: 1 });
    log.error("boom");
    expect(warnSpy).toHaveBeenCalledWith("[ns] warning here", { code: 1 });
    expect(errSpy).toHaveBeenCalledWith("[ns] boom", "");
    errSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("does NOT touch console when disabled", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    configureLogger({ level: "debug", consoleEnabled: false });
    createLogger("ns").warn("silent");
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("logger: redaction", () => {
  it("redacts credential-shaped keys at any depth", () => {
    const log = createLogger("provider");
    log.info("called", {
      apiKey: "sk-ant-secret",
      headers: { Authorization: "Bearer abc", "x-goog-api-key": "AIzaXXX" },
      nested: { password: "hunter2", sessionToken: "ok-not-matched" },
    });
    const [event] = getSessionLog();
    const flat = JSON.stringify(event);
    expect(flat).not.toContain("sk-ant-secret");
    expect(flat).not.toContain("Bearer abc");
    expect(flat).not.toContain("AIzaXXX");
    expect(flat).not.toContain("hunter2");
  });

  it("walks into arrays and redacts shaped keys inside them", () => {
    const log = createLogger("ns");
    log.info("array", [{ authorization: "Bearer XYZ", ok: 1 }, ["nested", { password: "p" }]]);
    const flat = JSON.stringify(getSessionLog());
    expect(flat).not.toContain("Bearer XYZ");
    expect(flat).not.toContain('"password":"p"');
  });

  it("handles deeply nested objects without throwing", () => {
    const log = createLogger("ns");
    let deep = { v: 1 };
    for (let i = 0; i < 10; i++) deep = { next: deep };
    log.info("deep", deep);
    expect(getSessionLog()).toHaveLength(1);
  });

  it("survives unserialisable input gracefully", () => {
    const log = createLogger("ns");
    const circ = {};
    circ.self = circ;
    // walkRedact handles circular refs because it stops at depth 6; but to
    // be safe, force a throw with a getter:
    const bomb = {};
    Object.defineProperty(bomb, "explode", {
      enumerable: true,
      get() {
        throw new Error("nope");
      },
    });
    log.info("circular", circ);
    log.info("bomb", bomb);
    const buf = getSessionLog();
    expect(buf).toHaveLength(2);
    expect(buf[1].data).toBe("<unserialisable>");
  });
});

describe("logger: dumpSession", () => {
  it("returns a pretty-printed JSON payload with events", () => {
    const log = createLogger("agent");
    log.info("first");
    log.warn("second", { x: 1 });
    const out = dumpSession();
    const parsed = JSON.parse(out);
    expect(parsed.events).toHaveLength(2);
    expect(typeof parsed.exportedAt).toBe("string");
    expect(parsed.events[1].data).toEqual({ x: 1 });
    expect(out).toContain("\n  "); // pretty-printed
  });

  it("excludes credential strings from the dump", () => {
    const log = createLogger("provider");
    log.info("k", { authorization: "Bearer XYZ" });
    expect(dumpSession()).not.toContain("Bearer XYZ");
  });
});
