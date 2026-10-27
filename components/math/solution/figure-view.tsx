"use client";

// Geometry constructions and diagrams of a solution script, drawn as SVG. Each shape is drawn
// up to its progress in the frame: lines grow from their start, outlines are traced, points
// and labels fade in.
import { useId } from "react";

import type { Figure, Point2, Shape, ShapeRef } from "@/lib/math/solution/types";

import { colorOf, lerpPoint, plainLabel, resolveRef } from "./geometry";

type FigureViewProps = {
  figure: Figure;
  /** Drawing progress per shape id, 0 to 1. */
  parts: Record<string, number>;
  /** Author mode: called with the figure point that was clicked. */
  onPick?: (point: Point2) => void;
};

const unit = (from: Point2, to: Point2): Point2 => {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy) || 1;
  return [dx / length, dy / length];
};

/** Props that trace an outline up to a progress (with pathLength = 1). */
const traced = (p: number) => ({
  pathLength: 1,
  strokeDasharray: "1 1",
  strokeDashoffset: 1 - p,
});

export const FigureView = ({ figure, parts, onPick }: FigureViewProps) => {
  const uid = useId().replace(/:/g, "");
  const scale = Math.max(figure.width, figure.height) / 320;
  const font = 13 * scale;
  const stroke = 2.5 * scale;
  const at = (ref: ShapeRef) => resolveRef(figure, ref);

  const label = (shape: Shape, point: Point2, p: number, offset: Point2 = [6, -6]) =>
    shape.label && p > 0 ? (
      <text
        x={point[0] + offset[0] * scale}
        y={point[1] + offset[1] * scale}
        fontSize={font}
        fill={colorOf(shape.color, "gray")}
        opacity={Math.min(1, Math.max(0, (p - 0.6) / 0.4))}
        fontWeight={600}
        style={{ paintOrder: "stroke", stroke: "white", strokeWidth: 3 * scale }}
      >
        {plainLabel(shape.label)}
      </text>
    ) : null;

  const draw = (shape: Shape) => {
    const p = parts[shape.id] ?? 0;
    if (p <= 0) return null;
    const color = colorOf(shape.color, shape.type === "point" ? "gray" : "blue");
    switch (shape.type) {
      case "point":
        return (
          <g key={shape.id}>
            <circle cx={shape.at[0]} cy={shape.at[1]} r={4 * scale * Math.min(1, p * 1.5)} fill={colorOf(shape.color, "gray")} />
            {label(shape, shape.at, p)}
          </g>
        );
      case "segment":
      case "arrow": {
        const from = at(shape.from);
        const to = at(shape.to);
        const end = lerpPoint(from, to, p);
        const mid = lerpPoint(from, to, 0.5);
        const [ux, uy] = unit(from, to);
        return (
          <g key={shape.id}>
            <line
              x1={from[0]}
              y1={from[1]}
              x2={end[0]}
              y2={end[1]}
              stroke={color}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={shape.type === "segment" && shape.dashed ? `${6 * scale} ${5 * scale}` : undefined}
              markerEnd={shape.type === "arrow" ? `url(#${uid}-arrow-${shape.color ?? "blue"})` : undefined}
            />
            {/* The label sits beside the middle of the line. */}
            {label(shape, mid, p, [uy * 14 - 4, -ux * 14 + 4])}
          </g>
        );
      }
      case "polygon": {
        const points = shape.points.map(at);
        return (
          <g key={shape.id}>
            <polygon
              points={points.map((point) => point.join(",")).join(" ")}
              fill={shape.fill ? color : "none"}
              fillOpacity={shape.fill ? 0.15 * p : 0}
              stroke={color}
              strokeWidth={stroke}
              strokeLinejoin="round"
              {...traced(p)}
            />
            {label(shape, points[0], p)}
          </g>
        );
      }
      case "circle": {
        const c = at(shape.center);
        return (
          <g key={shape.id}>
            <circle cx={c[0]} cy={c[1]} r={shape.r} fill="none" stroke={color} strokeWidth={stroke} {...traced(p)} />
            {label(shape, [c[0] + shape.r * 0.7, c[1] - shape.r * 0.7], p)}
          </g>
        );
      }
      case "angle": {
        const vertex = at(shape.at);
        const u = unit(vertex, at(shape.from));
        const w = unit(vertex, at(shape.to));
        const r = shape.r ?? 18 * scale;
        const angleColor = colorOf(shape.color, "red");
        if (shape.right) {
          const a: Point2 = [vertex[0] + u[0] * r * 0.7, vertex[1] + u[1] * r * 0.7];
          const b: Point2 = [a[0] + w[0] * r * 0.7, a[1] + w[1] * r * 0.7];
          const c: Point2 = [vertex[0] + w[0] * r * 0.7, vertex[1] + w[1] * r * 0.7];
          return (
            <g key={shape.id}>
              <path d={`M ${a.join(" ")} L ${b.join(" ")} L ${c.join(" ")}`} fill="none" stroke={angleColor} strokeWidth={stroke * 0.8} {...traced(p)} />
              {label(shape, b, p)}
            </g>
          );
        }
        const start: Point2 = [vertex[0] + u[0] * r, vertex[1] + u[1] * r];
        const end: Point2 = [vertex[0] + w[0] * r, vertex[1] + w[1] * r];
        const sweep = u[0] * w[1] - u[1] * w[0] > 0 ? 1 : 0;
        const mid = unit([0, 0], [u[0] + w[0], u[1] + w[1]]);
        return (
          <g key={shape.id}>
            <path d={`M ${start.join(" ")} A ${r} ${r} 0 0 ${sweep} ${end.join(" ")}`} fill="none" stroke={angleColor} strokeWidth={stroke * 0.8} {...traced(p)} />
            {label(shape, [vertex[0] + mid[0] * r * 1.6, vertex[1] + mid[1] * r * 1.6], p, [-4, 4])}
          </g>
        );
      }
      case "rect":
        return (
          <g key={shape.id}>
            <rect
              x={shape.at[0]}
              y={shape.at[1]}
              width={shape.size[0]}
              height={shape.size[1]}
              fill={color}
              fillOpacity={0.12 * p}
              stroke={color}
              strokeWidth={stroke * 0.8}
              {...traced(p)}
            />
            {label(shape, [shape.at[0] + 4 * scale, shape.at[1] + font + 2 * scale], p, [0, 0])}
          </g>
        );
      case "text":
        return (
          <text key={shape.id} x={shape.at[0]} y={shape.at[1]} fontSize={font} fill={colorOf(shape.color, "gray")} opacity={p}>
            {plainLabel(shape.text)}
          </text>
        );
      case "numberLine": {
        const from = shape.from;
        const to = shape.to;
        const end = lerpPoint(from, to, p);
        const [ux, uy] = unit(from, to);
        const ticks: number[] = [];
        for (let v = shape.min; v <= shape.max + 1e-9 && ticks.length <= 100; v += shape.step) ticks.push(Number(v.toFixed(6)));
        return (
          <g key={shape.id}>
            <line x1={from[0]} y1={from[1]} x2={end[0]} y2={end[1]} stroke={color} strokeWidth={stroke * 0.8} markerEnd={p > 0.95 ? `url(#${uid}-arrow-${shape.color ?? "blue"})` : undefined} />
            {ticks.map((value) => {
              const f = (value - shape.min) / (shape.max - shape.min);
              if (f > p + 1e-6) return null;
              const point = lerpPoint(from, to, f);
              const n: Point2 = [-uy * 6 * scale, ux * 6 * scale];
              return (
                <g key={value}>
                  <line x1={point[0] - n[0]} y1={point[1] - n[1]} x2={point[0] + n[0]} y2={point[1] + n[1]} stroke={color} strokeWidth={stroke * 0.6} />
                  <text x={point[0] + n[0] * 2.6} y={point[1] + n[1] * 2.6 + font * 0.35} fontSize={font * 0.85} textAnchor="middle" fill="#525252">
                    {value}
                  </text>
                </g>
              );
            })}
            {label(shape, lerpPoint(from, to, 1), p)}
          </g>
        );
      }
    }
  };

  return (
    <svg
      data-figure-svg={figure.id}
      viewBox={`0 0 ${figure.width} ${figure.height}`}
      className="mx-auto block h-auto w-full"
      role="img"
      onClick={
        onPick
          ? (event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const scale = Math.min(rect.width / figure.width, rect.height / figure.height) || 1;
              onPick([
                Math.round((event.clientX - rect.left) / scale),
                Math.round((event.clientY - rect.top) / scale),
              ]);
            }
          : undefined
      }
      style={{ cursor: onPick ? "crosshair" : undefined, maxWidth: Math.max(240, Math.min(figure.width * 1.6, 560)), aspectRatio: `${figure.width} / ${figure.height}` }}
      aria-label={figure.shapes
        .filter((shape) => (parts[shape.id] ?? 0) > 0 && (shape.label || shape.type === "text"))
        .map((shape) => plainLabel(shape.type === "text" ? shape.text : (shape.label ?? "")))
        .join(", ") || "Figure"}
    >
      <defs>
        {(["blue", "red", "green", "orange", "purple", "gray"] as const).map((name) => (
          <marker
            key={name}
            id={`${uid}-arrow-${name}`}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={colorOf(name)} />
          </marker>
        ))}
      </defs>
      {figure.shapes.map(draw)}
    </svg>
  );
};
