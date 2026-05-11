/**
 * VISION UTILITIES — shared helpers for image content blocks.
 *
 * Used by every provider that ships a vision-capable model. The unified
 * internal format carries images as `{ type: "image", dataUrl }` blocks in a
 * user message; each provider translates that to its native shape via these
 * helpers.
 */

/**
 * Parse a `data:` URL into its media type and base64 payload.
 *
 * @param {string} dataUrl - e.g. "data:image/png;base64,iVBORw0KGgo…"
 * @returns {{ mediaType: string, data: string }}
 */
export function parseDataUrl(dataUrl) {
  if (typeof dataUrl !== "string") {
    return { mediaType: "application/octet-stream", data: "" };
  }
  const match = /^data:([^;,]+)(?:;[^,]*)?,(.*)$/i.exec(dataUrl);
  if (!match) {
    return { mediaType: "application/octet-stream", data: "" };
  }
  return { mediaType: match[1].toLowerCase(), data: match[2] };
}

/**
 * Identify the canonical image content blocks in a message's `content` array.
 * Returns the array unchanged when no images are present.
 */
export function hasImageBlock(content) {
  return Array.isArray(content) && content.some((b) => b && b.type === "image" && b.dataUrl);
}
