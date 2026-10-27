// Small geometry helpers of the solution player: colours, points of figure shapes, the point a
// note arrow aims at in a graph or a figure, and rectangles. Pure functions.
import { safeFunction } from "@/lib/math/solution/expr";
import type {
  Figure,
  Graph,
  GraphItem,
  Point2,
  ScriptColor,
  Shape,
  ShapeRef,
} from "@/lib/math/solution/types";

export const COLORS: Record<ScriptColor, string> = {
  blue: "#1899d6",
  red: "#e5484d",
  green: "#3fa40a",
  orange: "#f08c00",
  purple: "#8e4ec6",
  gray: "#6b7280",
};

export const colorOf = (color: ScriptColor | undefined, fallback: ScriptColor = "blue") =>
  COLORS[color ?? fallback] ?? COLORS[fallback];

export type Rect = { x: number; y: number; w: number; h: number };

export const center = (rect: Rect): Point2 => [rect.x + rect.w / 2, rect.y + rect.h / 2];

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const lerpPoint = (a: Point2, b: Point2, t: number): Point2 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];

/** Resolves a shape point: coordinates, or the id of a point shape of the figure. */
export const resolveRef = (figure: Figure, ref: ShapeRef): Point2 => {
  if (Array.isArray(ref)) return ref;
  const shape = figure.shapes.find((s) => s.id === ref);
  return shape?.type === "point" ? shape.at : [0, 0];
};

/** Where a note about a figure shape points, in figure units. */
export const shapeAnchor = (figure: Figure, shape: Shape): Point2 => {
  const at = (ref: ShapeRef) => resolveRef(figure, ref);
  switch (shape.type) {
    case "point":
    case "text":
      return shape.at;
    case "segment":
    case "arrow":
    case "numberLine": {
      const from = "from" in shape ? at(shape.from) : [0, 0];
      const to = "to" in shape ? at(shape.to) : [0, 0];
      return lerpPoint(from as Point2, to as Point2, 0.5);
    }
    case "polygon": {
      const points = shape.points.map(at);
      return [
        points.reduce((sum, p) => sum + p[0], 0) / points.length,
        points.reduce((sum, p) => sum + p[1], 0) / points.length,
      ];
    }
    case "circle": {
      const c = at(shape.center);
      return [c[0] + shape.r * Math.SQRT1_2, c[1] - shape.r * Math.SQRT1_2];
    }
    case "angle":
      return at(shape.at);
    case "rect":
      return [shape.at[0] + shape.size[0] / 2, shape.at[1] + shape.size[1] / 2];
  }
};

const fnOf = (graph: Graph, id: string | undefined) => {
  const item = graph.items.find((i) => i.id === id);
  return item?.type === "function" ? safeFunction(item.fn) : () => 0;
};

/** Where a note about a graph item points, in graph coordinates. */
export const itemAnchor = (graph: Graph, item: GraphItem): Point2 => {
  switch (item.type) {
    case "function": {
      const [a, b] = item.domain ?? graph.view.x;
      const x = lerp(a, b, 0.6);
      return [x, safeFunction(item.fn)(x)];
    }
    case "point":
      if (item.along) {
        const x = item.to ?? 0;
        return [x, fnOf(graph, item.along)(x)];
      }
      return item.at ?? [0, 0];
    case "area": {
      const x = (item.from + item.to) / 2;
      return [x, fnOf(graph, item.of)(x) / 2];
    }
    case "vector":
      return item.to;
    case "segment":
      return lerpPoint(item.from, item.to, 0.5);
  }
};

/** A graph point in pixels of the plot area (y up in the graph, down on screen). */
export const graphToRect = (graph: Graph, rect: Rect, point: Point2): Point2 => {
  const [x0, x1] = graph.view.x;
  const [y0, y1] = graph.view.y;
  return [rect.x + ((point[0] - x0) / (x1 - x0)) * rect.w, rect.y + ((y1 - point[1]) / (y1 - y0)) * rect.h];
};

/** A figure point in pixels of the drawn SVG (uniform scale, as the SVG keeps its aspect). */
export const figureToRect = (figure: Figure, rect: Rect, point: Point2): Point2 => {
  const scale = Math.min(rect.w / figure.width, rect.h / figure.height);
  const offsetX = rect.x + (rect.w - figure.width * scale) / 2;
  const offsetY = rect.y + (rect.h - figure.height * scale) / 2;
  return [offsetX + point[0] * scale, offsetY + point[1] * scale];
};

/** The point where a line from the rectangle's centre towards `to` leaves the rectangle. */
export const exitPoint = (rect: Rect, to: Point2): Point2 => {
  const [cx, cy] = center(rect);
  const dx = to[0] - cx;
  const dy = to[1] - cy;
  if (!dx && !dy) return [cx, cy];
  const sx = dx ? rect.w / 2 / Math.abs(dx) : Infinity;
  const sy = dy ? rect.h / 2 / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy, 1);
  return [cx + dx * s, cy + dy * s];
};

/** Plain text for SVG labels: math dollar signs and backslash commands removed. */
export const plainLabel = (text: string) =>
  text
    .replace(/\\\$/g, "\u0000")
    .replace(/\$/g, "")
    .replace(/\\(mathrm|text)\{([^}]*)\}/g, "$2")
    .replace(/\\[,;:! ]/g, " ")
    .replace(/\u0000/g, "$")
    .trim();
