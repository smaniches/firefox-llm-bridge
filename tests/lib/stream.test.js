import { describe, it, expect } from "vitest";
import { readSSE, readNDJSON, makeStreamResponse } from "../../background/lib/stream.js";

async function collect(gen) {
  const out = [];
  for await (const v of gen) out.push(v);
  return out;
}

describe("readSSE", () => {
  it("yields one event per double-newline-terminated block", async () => {
    const res = makeStreamResponse(["event: a\n", "data: hello\n", "\n", "data: world\n", "\n"]);
    const events = await collect(readSSE(res));
    expect(events).toEqual([
      { event: "a", data: "hello" },
      { event: "message", data: "world" },
    ]);
  });

  it("concatenates multiple data lines in one event", async () => {
    const res = makeStreamResponse(["data: a\ndata: b\n\n"]);
    const events = await collect(readSSE(res));
    expect(events[0].data).toBe("a\nb");
  });

  it("ignores comment lines starting with ':'", async () => {
    const res = makeStreamResponse([": keep-alive\ndata: x\n\n"]);
    const events = await collect(readSSE(res));
    expect(events).toEqual([{ event: "message", data: "x" }]);
  });

  it("strips a leading space after the field colon", async () => {
    const res = makeStreamResponse(["data:nospace\n\ndata: withspace\n\n"]);
    const events = await collect(readSSE(res));
    expect(events.map((e) => e.data)).toEqual(["nospace", "withspace"]);
  });

  it("handles a field with no colon (entire line is the field name)", async () => {
    const res = makeStreamResponse(["nofield\ndata: payload\n\n"]);
    const events = await collect(readSSE(res));
    expect(events[0].data).toBe("payload");
  });

  it("flushes a trailing partial event without a final blank line", async () => {
    const res = makeStreamResponse(["data: last\n"]);
    const events = await collect(readSSE(res));
    expect(events).toEqual([{ event: "message", data: "last" }]);
  });

  it("skips a trailing event-block that has no data field", async () => {
    const res = makeStreamResponse(["event: ping\n\n"]);
    const events = await collect(readSSE(res));
    expect(events).toEqual([]);
  });

  it("handles a Response with no body (yields nothing)", async () => {
    const r = new Response(null, { status: 204 });
    const events = await collect(readSSE(r));
    expect(events).toEqual([]);
  });

  it("survives a chunk that splits an event in the middle", async () => {
    const res = makeStreamResponse(["data: hel", "lo\n\ndata: ", "world\n\n"]);
    const events = await collect(readSSE(res));
    expect(events.map((e) => e.data)).toEqual(["hello", "world"]);
  });
});

describe("readNDJSON", () => {
  it("yields one parsed JSON value per newline", async () => {
    const res = makeStreamResponse(['{"a":1}\n', '{"b":2}\n']);
    const values = await collect(readNDJSON(res));
    expect(values).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("skips malformed lines silently", async () => {
    const res = makeStreamResponse(['{"a":1}\n', "not json\n", '{"b":2}\n']);
    const values = await collect(readNDJSON(res));
    expect(values).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("skips blank lines", async () => {
    const res = makeStreamResponse(['{"a":1}\n', "\n", '{"b":2}\n']);
    const values = await collect(readNDJSON(res));
    expect(values).toHaveLength(2);
  });

  it("handles a trailing line without a final newline", async () => {
    const res = makeStreamResponse(['{"a":1}\n', '{"b":2}']);
    const values = await collect(readNDJSON(res));
    expect(values).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("skips a trailing malformed partial line", async () => {
    const res = makeStreamResponse(['{"a":1}\n', "bad partial"]);
    const values = await collect(readNDJSON(res));
    expect(values).toEqual([{ a: 1 }]);
  });

  it("survives a chunk split inside a value", async () => {
    const res = makeStreamResponse(['{"a":1', "23}\n"]);
    const values = await collect(readNDJSON(res));
    expect(values).toEqual([{ a: 123 }]);
  });

  it("handles a Response with no body", async () => {
    const r = new Response(null, { status: 204 });
    const values = await collect(readNDJSON(r));
    expect(values).toEqual([]);
  });
});

describe("makeStreamResponse", () => {
  it("produces a Response with a readable body", () => {
    const r = makeStreamResponse(["hi"]);
    expect(r.status).toBe(200);
    expect(r.body).toBeDefined();
  });
});
