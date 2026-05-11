/**
 * STREAM UTILITIES — shared parsers for Server-Sent Events (SSE) and
 * newline-delimited JSON (NDJSON), used by every provider that supports
 * incremental responses.
 *
 * Each parser is a small generator-shaped helper that yields complete
 * records as bytes arrive. They never accumulate the whole response in
 * memory; the provider's caller is responsible for assembling the
 * normalized result from streamed fragments.
 */

/**
 * Read a fetch response body as Server-Sent Events.
 *
 * Yields `{ event, data }` objects for each complete event block in the
 * stream. `event` is the event type (defaults to `"message"`); `data` is
 * the concatenated data lines. A blank line terminates one event.
 *
 * @param {Response} response
 * @returns {AsyncGenerator<{event: string, data: string}>}
 */
export async function* readSSE(response) {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const parsed = parseEventBlock(block);
      if (parsed.data) yield parsed;
    }
  }

  // Flush any trailing partial event (no terminator).
  if (buffer.trim().length > 0) {
    const parsed = parseEventBlock(buffer);
    if (parsed.data) yield parsed;
  }
}

/**
 * Parse a single SSE event block (lines separated by \n, no trailing \n\n).
 *
 * @param {string} block
 * @returns {{event: string, data: string}}
 */
function parseEventBlock(block) {
  let event = "message";
  const dataLines = [];
  for (const line of block.split("\n")) {
    if (line.startsWith(":")) continue; // comment line
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") dataLines.push(value);
  }
  return { event, data: dataLines.join("\n") };
}

/**
 * Read a fetch response body as newline-delimited JSON (NDJSON).
 *
 * Yields parsed JSON values for each complete line. Malformed lines are
 * skipped silently so a transient network glitch can't poison the stream.
 *
 * @param {Response} response
 * @returns {AsyncGenerator<any>}
 */
export async function* readNDJSON(response) {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let nl;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line.length === 0) continue;
      const parsed = tryParseJson(line);
      if (parsed !== undefined) yield parsed;
    }
  }

  // Flush trailing partial line (no final newline).
  const tail = buffer.trim();
  if (tail.length > 0) {
    const parsed = tryParseJson(tail);
    if (parsed !== undefined) yield parsed;
  }
}

function tryParseJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

/**
 * Build a `Response` object whose body streams the given string chunks.
 *
 * Used in tests to feed deterministic SSE / NDJSON payloads into the
 * parsers above without involving the network or a real fetch impl.
 *
 * @param {string[]} chunks
 * @returns {Response}
 */
export function makeStreamResponse(chunks) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}
