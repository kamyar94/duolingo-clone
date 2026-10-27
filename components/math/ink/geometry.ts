// Hit tests for the ink tools: the stroke eraser, the lasso and the insert-space tool.
// Plain functions over page coordinates, unit tested in geometry.test.ts.
import { POINT_SIZE, strokeBounds, type Bounds } from "@/lib/math/strokes";
import type { StoredStroke } from "@/lib/math/types";

const distanceToSegment = (
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
) => {
  const dx = bx - ax;
  const dy = by - ay;
  const length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

/** True when a circle of radius r at (x, y) touches the stroke's line. */
export const strokeHitsCircle = (stroke: StoredStroke, x: number, y: number, r: number) => {
  const b = strokeBounds(stroke);
  if (x < b.minX - r || x > b.maxX + r || y < b.minY - r || y > b.maxY + r) return false;
  const reach = r + stroke.s / 2;
  const p = stroke.p;
  if (p.length === POINT_SIZE) return Math.hypot(p[0] - x, p[1] - y) <= reach;
  for (let j = POINT_SIZE; j < p.length; j += POINT_SIZE)
    if (distanceToSegment(x, y, p[j - POINT_SIZE], p[j - POINT_SIZE + 1], p[j], p[j + 1]) <= reach)
      return true;
  return false;
};

/** Strokes touched by an eraser moving from (x0, y0) to (x1, y1), checked along the way. */
export const strokesHitAlong = (
  strokes: StoredStroke[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  r: number
) => {
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / Math.max(r, 1)));
  const hit = new Set<string>();
  for (let k = 0; k <= steps; k += 1) {
    const x = x0 + ((x1 - x0) * k) / steps;
    const y = y0 + ((y1 - y0) * k) / steps;
    for (const stroke of strokes)
      if (!hit.has(stroke.i) && strokeHitsCircle(stroke, x, y, r)) hit.add(stroke.i);
  }
  return hit;
};

/** Even-odd test of a point against a polygon given as flat x, y pairs. */
export const pointInPolygon = (x: number, y: number, polygon: number[]) => {
  let inside = false;
  const n = polygon.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const xi = polygon[2 * i];
    const yi = polygon[2 * i + 1];
    const xj = polygon[2 * j];
    const yj = polygon[2 * j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

/** Strokes with most of their points inside the lasso loop. */
export const strokesInLasso = (strokes: StoredStroke[], polygon: number[], share = 0.5) => {
  if (polygon.length < 6) return new Set<string>();
  const selected = new Set<string>();
  for (const stroke of strokes) {
    const n = stroke.p.length / POINT_SIZE;
    const step = Math.max(1, Math.floor(n / 40));
    let inside = 0;
    let total = 0;
    for (let k = 0; k < n; k += step) {
      total += 1;
      if (pointInPolygon(stroke.p[k * POINT_SIZE], stroke.p[k * POINT_SIZE + 1], polygon))
        inside += 1;
    }
    if (total && inside / total >= share) selected.add(stroke.i);
  }
  return selected;
};

/** Strokes that start at or below a line, which insert-space moves. */
export const strokesBelow = (strokes: StoredStroke[], y: number) =>
  new Set(strokes.filter((stroke) => strokeBounds(stroke).minY >= y).map((stroke) => stroke.i));

export const boundsOf = (strokes: StoredStroke[], ids: Set<string>): Bounds | null => {
  let result: Bounds | null = null;
  for (const stroke of strokes) {
    if (!ids.has(stroke.i)) continue;
    const b = strokeBounds(stroke);
    result = result
      ? {
          minX: Math.min(result.minX, b.minX),
          minY: Math.min(result.minY, b.minY),
          maxX: Math.max(result.maxX, b.maxX),
          maxY: Math.max(result.maxY, b.maxY),
        }
      : b;
  }
  return result;
};

export const inBounds = (b: Bounds, x: number, y: number, margin = 0) =>
  x >= b.minX - margin && x <= b.maxX + margin && y >= b.minY - margin && y <= b.maxY + margin;
