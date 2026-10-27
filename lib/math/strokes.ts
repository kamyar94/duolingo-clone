// Ink strokes as stored in drafts and math attempts (format in lib/math/types.ts), with the
// checks the server runs on strokes sent by a browser. Shared by the canvas and the server.
import type { StoredStroke } from "./types";

/** Numbers per point: x, y, pressure, ms since the stroke started. */
export const POINT_SIZE = 4;

export const STROKE_LIMITS = {
  strokes: 3000,
  pointsPerStroke: 5000,
  totalPoints: 100_000,
  coordinate: 1_000_000,
};

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

const COLOR = /^#[0-9a-f]{6}$/i;
const ID = /^[A-Za-z0-9_-]{1,24}$/;

export const pointCount = (stroke: StoredStroke) =>
  Math.floor(stroke.p.length / POINT_SIZE);

/** Checks strokes from a browser; returns them trimmed to the known fields, or an error. */
export const validateStrokes = (
  value: unknown,
  limits = STROKE_LIMITS
): { ok: true; strokes: StoredStroke[] } | { ok: false; error: string } => {
  if (!Array.isArray(value)) return { ok: false, error: "strokes must be a list." };
  if (value.length > limits.strokes)
    return { ok: false, error: `At most ${limits.strokes} strokes.` };

  let total = 0;
  const strokes: StoredStroke[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null)
      return { ok: false, error: "Each stroke must be an object." };
    const s = raw as Record<string, unknown>;
    if (typeof s.i !== "string" || !ID.test(s.i))
      return { ok: false, error: "A stroke has no valid id." };
    if (s.k !== "p" && s.k !== "h") return { ok: false, error: "Unknown stroke kind." };
    if (typeof s.c !== "string" || !COLOR.test(s.c))
      return { ok: false, error: "A stroke colour is not #rrggbb." };
    if (typeof s.s !== "number" || !(s.s > 0 && s.s <= 200))
      return { ok: false, error: "A stroke width is out of range." };
    if (s.pr !== 0 && s.pr !== 1) return { ok: false, error: "Bad pressure flag." };
    if (typeof s.t !== "number" || !Number.isFinite(s.t))
      return { ok: false, error: "A stroke has no start time." };
    if (!Array.isArray(s.p) || s.p.length === 0 || s.p.length % POINT_SIZE !== 0)
      return { ok: false, error: "Stroke points must come in groups of four." };
    const points = s.p.length / POINT_SIZE;
    if (points > limits.pointsPerStroke)
      return { ok: false, error: "A stroke has too many points." };
    total += points;
    if (total > limits.totalPoints)
      return { ok: false, error: "The drawing has too many points." };
    for (const n of s.p)
      if (typeof n !== "number" || !Number.isFinite(n) || Math.abs(n) > limits.coordinate)
        return { ok: false, error: "A stroke point is not a number." };
    strokes.push({ i: s.i, k: s.k, c: s.c, s: s.s, pr: s.pr, t: s.t, p: s.p as number[] });
  }
  return { ok: true, strokes };
};

export const strokeBounds = (stroke: StoredStroke): Bounds => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let j = 0; j < stroke.p.length; j += POINT_SIZE) {
    const x = stroke.p[j];
    const y = stroke.p[j + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const pad = stroke.s / 2;
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
};

/** Bounds of all strokes, or null when there are none. */
export const strokesBounds = (strokes: StoredStroke[]): Bounds | null => {
  if (!strokes.length) return null;
  const all = strokes.map(strokeBounds);
  return {
    minX: Math.min(...all.map((b) => b.minX)),
    minY: Math.min(...all.map((b) => b.minY)),
    maxX: Math.max(...all.map((b) => b.maxX)),
    maxY: Math.max(...all.map((b) => b.maxY)),
  };
};

/** Rounds a stroke's numbers so drafts stay small: 0.1 unit, pressure to 0.01, whole ms. */
export const roundStroke = (stroke: StoredStroke): StoredStroke => {
  const p = stroke.p.slice();
  for (let j = 0; j < p.length; j += POINT_SIZE) {
    p[j] = Math.round(p[j] * 10) / 10;
    p[j + 1] = Math.round(p[j + 1] * 10) / 10;
    p[j + 2] = Math.round(p[j + 2] * 100) / 100;
    p[j + 3] = Math.round(p[j + 3]);
  }
  return { ...stroke, p };
};

/** Keeps every second point (first and last always), for drafts that grow too large. */
export const thinStroke = (stroke: StoredStroke): StoredStroke => {
  const n = pointCount(stroke);
  if (n <= 3) return stroke;
  const p: number[] = [];
  for (let k = 0; k < n; k += 1)
    if (k % 2 === 0 || k === n - 1)
      p.push(...stroke.p.slice(k * POINT_SIZE, (k + 1) * POINT_SIZE));
  return { ...stroke, p };
};

/** Moves a stroke by dx, dy. */
export const translateStroke = (stroke: StoredStroke, dx: number, dy: number): StoredStroke => {
  const p = stroke.p.slice();
  for (let j = 0; j < p.length; j += POINT_SIZE) {
    p[j] += dx;
    p[j + 1] += dy;
  }
  return { ...stroke, p };
};

/** Same strokes in the same order (ids and points), for "was this drawing read already". */
export const sameStrokes = (a: StoredStroke[], b: StoredStroke[]) =>
  a.length === b.length &&
  a.every(
    (stroke, n) =>
      stroke.i === b[n].i &&
      stroke.p.length === b[n].p.length &&
      stroke.p.every((value, j) => value === b[n].p[j])
  );
