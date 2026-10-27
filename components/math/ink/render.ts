// Drawing strokes: pressure-sensitive outlines from perfect-freehand, cached as Path2D per
// stroke, painted on a 2D canvas; plus the cropped PNG on white that recognition reads.
import { getStroke, type StrokeOptions } from "perfect-freehand";

import { POINT_SIZE, strokesBounds } from "@/lib/math/strokes";
import type { StoredStroke } from "@/lib/math/types";

export const HIGHLIGHTER_ALPHA = 0.35;

/** perfect-freehand settings per stroke: real pressure thins the line, otherwise it stays even. */
export const strokeOptions = (
  kind: StoredStroke["k"],
  size: number,
  pressure: boolean,
  last: boolean
): StrokeOptions => {
  if (kind === "h")
    return {
      size,
      thinning: 0,
      smoothing: 0.5,
      streamline: 0.5,
      simulatePressure: false,
      start: { cap: false },
      end: { cap: false },
      last,
    };
  return {
    size,
    thinning: pressure ? 0.6 : 0,
    smoothing: 0.5,
    streamline: 0.35,
    simulatePressure: false,
    last,
  };
};

/** Points in the form perfect-freehand reads: [x, y, pressure]. */
export const inputPoints = (p: number[], pressure: boolean) => {
  const points: [number, number, number][] = [];
  for (let j = 0; j < p.length; j += POINT_SIZE)
    points.push([p[j], p[j + 1], pressure ? p[j + 2] : 0.5]);
  return points;
};

/** An SVG path from an outline polygon (quadratic curves through the midpoints). */
export const outlineToPath = (outline: number[][]) => {
  if (!outline.length) return "";
  const parts = [`M ${outline[0][0].toFixed(2)} ${outline[0][1].toFixed(2)} Q`];
  for (let n = 0; n < outline.length; n += 1) {
    const [x0, y0] = outline[n];
    const [x1, y1] = outline[(n + 1) % outline.length];
    parts.push(
      `${x0.toFixed(2)} ${y0.toFixed(2)} ${((x0 + x1) / 2).toFixed(2)} ${((y0 + y1) / 2).toFixed(2)}`
    );
  }
  parts.push("Z");
  return parts.join(" ");
};

export const strokeOutline = (stroke: StoredStroke, last = true) =>
  getStroke(
    inputPoints(stroke.p, stroke.pr === 1),
    strokeOptions(stroke.k, stroke.s, stroke.pr === 1, last)
  );

const paths = new WeakMap<StoredStroke, Path2D>();

/** The filled outline of a finished stroke, computed once per stroke object. */
export const strokePath = (stroke: StoredStroke) => {
  let path = paths.get(stroke);
  if (!path) {
    path = new Path2D(outlineToPath(strokeOutline(stroke)));
    paths.set(stroke, path);
  }
  return path;
};

export const paintStroke = (
  ctx: CanvasRenderingContext2D,
  stroke: StoredStroke,
  path: Path2D = strokePath(stroke)
) => {
  ctx.save();
  ctx.fillStyle = stroke.c;
  if (stroke.k === "h") {
    ctx.globalAlpha = HIGHLIGHTER_ALPHA;
    ctx.globalCompositeOperation = "multiply";
  }
  ctx.fill(path);
  ctx.restore();
};

export type PngResult = { base64: string; width: number; height: number };

/**
 * The pen strokes (highlights left out) on a white background, cropped to the writing with a
 * margin and scaled to a fixed width, as recognition expects (section 5.3).
 */
export const renderStrokesToPng = (
  strokes: StoredStroke[],
  options: { width?: number; maxHeight?: number; padding?: number; maxScale?: number } = {}
): PngResult | null => {
  const ink = strokes.filter((stroke) => stroke.k === "p");
  const bounds = strokesBounds(ink);
  if (!bounds) return null;

  const width = options.width ?? 1024;
  const maxHeight = options.maxHeight ?? 4096;
  const padding = options.padding ?? 32;
  const maxScale = options.maxScale ?? 3;
  const contentW = Math.max(1, bounds.maxX - bounds.minX);
  const contentH = Math.max(1, bounds.maxY - bounds.minY);
  const scale = Math.min(
    (width - 2 * padding) / contentW,
    (maxHeight - 2 * padding) / contentH,
    maxScale
  );
  const height = Math.max(64, Math.ceil(contentH * scale + 2 * padding));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  const offsetX = (width - contentW * scale) / 2;
  ctx.setTransform(scale, 0, 0, scale, offsetX - bounds.minX * scale, padding - bounds.minY * scale);
  for (const stroke of ink) paintStroke(ctx, stroke);

  const base64 = canvas.toDataURL("image/png").split(",")[1] ?? "";
  return base64 ? { base64, width, height } : null;
};
