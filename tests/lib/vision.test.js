import { describe, it, expect } from "vitest";
import { parseDataUrl, hasImageBlock } from "../../background/lib/vision.js";

describe("vision", () => {
  describe("parseDataUrl", () => {
    it("parses image/png base64", () => {
      const r = parseDataUrl("data:image/png;base64,iVBORw0KGgo");
      expect(r.mediaType).toBe("image/png");
      expect(r.data).toBe("iVBORw0KGgo");
    });

    it("lowercases the media type", () => {
      const r = parseDataUrl("data:IMAGE/JPEG;base64,XYZ");
      expect(r.mediaType).toBe("image/jpeg");
    });

    it("handles data URLs without an explicit ;base64 flag (still parsed)", () => {
      const r = parseDataUrl("data:image/png,abc");
      expect(r.mediaType).toBe("image/png");
      expect(r.data).toBe("abc");
    });

    it("returns a safe default for non-string input", () => {
      const r = parseDataUrl(null);
      expect(r.mediaType).toBe("application/octet-stream");
      expect(r.data).toBe("");
    });

    it("returns a safe default for malformed input", () => {
      const r = parseDataUrl("not a data url");
      expect(r.mediaType).toBe("application/octet-stream");
      expect(r.data).toBe("");
    });
  });

  describe("hasImageBlock", () => {
    it("returns true when an image block is present", () => {
      expect(
        hasImageBlock([
          { type: "text", text: "hi" },
          { type: "image", dataUrl: "data:image/png;base64,x" },
        ]),
      ).toBe(true);
    });

    it("returns false for an array with no image", () => {
      expect(hasImageBlock([{ type: "text", text: "hi" }])).toBe(false);
    });

    it("returns false for non-array input", () => {
      expect(hasImageBlock("string")).toBe(false);
      expect(hasImageBlock(null)).toBe(false);
      expect(hasImageBlock(undefined)).toBe(false);
    });

    it("returns false when image block lacks a dataUrl", () => {
      expect(hasImageBlock([{ type: "image" }])).toBe(false);
    });

    it("ignores null/undefined entries", () => {
      expect(hasImageBlock([null, undefined, { type: "text", text: "x" }])).toBe(false);
    });
  });
});
