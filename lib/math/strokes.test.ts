import { describe, expect, it } from "vitest";

import { checkPngImage, readPngSize } from "./image";
import {
  roundStroke,
  sameStrokes,
  strokesBounds,
  thinStroke,
  translateStroke,
  validateStrokes,
} from "./strokes";
import type { StoredStroke } from "./types";

const stroke = (i: string, p: number[]): StoredStroke => ({
  i,
  k: "p",
  c: "#1f2937",
  s: 4,
  pr: 1,
  t: 1_700_000_000_000,
  p,
});

describe("strokes", () => {
  const a = stroke("a", [10, 20, 0.5, 0, 30, 40, 0.7, 16]);

  it("accepts well-formed strokes and drops unknown fields", () => {
    const result = validateStrokes([{ ...a, extra: "x" }]);
    expect(result).toEqual({ ok: true, strokes: [a] });
  });

  it("refuses malformed strokes", () => {
    expect(validateStrokes("x").ok).toBe(false);
    expect(validateStrokes([{ ...a, p: [1, 2, 3] }]).ok).toBe(false);
    expect(validateStrokes([{ ...a, c: "red" }]).ok).toBe(false);
    expect(validateStrokes([{ ...a, k: "x" }]).ok).toBe(false);
    expect(validateStrokes([{ ...a, i: "<script>" }]).ok).toBe(false);
    expect(validateStrokes([{ ...a, p: [1, 2, 3, Number.NaN] }]).ok).toBe(false);
  });

  it("enforces the limits", () => {
    const limits = { strokes: 2, pointsPerStroke: 3, totalPoints: 4, coordinate: 100 };
    expect(validateStrokes([a, a, a], limits).ok).toBe(false);
    expect(validateStrokes([stroke("b", new Array(16).fill(1))], limits).ok).toBe(false);
    expect(validateStrokes([a, a, stroke("c", [1, 1, 1, 1])].slice(1), limits).ok).toBe(true);
    expect(validateStrokes([stroke("d", [1000, 1, 1, 1])], limits).ok).toBe(false);
  });

  it("measures, moves, rounds and thins strokes", () => {
    expect(strokesBounds([a])).toEqual({ minX: 8, minY: 18, maxX: 32, maxY: 42 });
    expect(strokesBounds([])).toBeNull();
    expect(translateStroke(a, 5, -5).p).toEqual([15, 15, 0.5, 0, 35, 35, 0.7, 16]);
    expect(roundStroke(stroke("r", [1.234, 5.678, 0.4567, 3.4])).p).toEqual([1.2, 5.7, 0.46, 3]);
    const long = stroke("l", Array.from({ length: 5 * 4 }, (_, n) => n));
    expect(thinStroke(long).p.length).toBe(3 * 4);
    expect(sameStrokes([a], [stroke("a", [...a.p])])).toBe(true);
    expect(sameStrokes([a], [translateStroke(a, 1, 0)])).toBe(false);
  });
});

describe("handwriting pictures", () => {
  // A 1x1 white PNG.
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC";

  it("reads the size of a PNG", () => {
    expect(readPngSize(Uint8Array.from(Buffer.from(png, "base64")))).toEqual({
      width: 1,
      height: 1,
    });
    expect(readPngSize(new Uint8Array(30))).toBeNull();
  });

  it("accepts a PNG with or without a data URL prefix", () => {
    expect(checkPngImage(png)).toMatchObject({ ok: true, width: 1, height: 1 });
    expect(checkPngImage(`data:image/png;base64,${png}`)).toMatchObject({ ok: true });
  });

  it("refuses other files and oversized pictures", () => {
    expect(checkPngImage("not base64!")).toMatchObject({ ok: false, status: 400 });
    expect(checkPngImage(Buffer.from("GIF89a-----------------------").toString("base64"))).toMatchObject({
      ok: false,
    });
    expect(checkPngImage(png, { maxBytes: 10, maxWidth: 10, maxHeight: 10 })).toMatchObject({
      ok: false,
      status: 413,
    });
    expect(checkPngImage(png, { maxBytes: 1000, maxWidth: 0, maxHeight: 10 })).toMatchObject({
      ok: false,
      status: 413,
    });
  });
});
