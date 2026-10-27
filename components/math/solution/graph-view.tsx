"use client";

// Graphs of a solution script, drawn with Mafs (MIT, https://mafs.dev). Each item is drawn up
// to its progress in the frame: a curve grows from left to right, a point moves along its
// function, an area fills and a vector or segment grows from its start. Panning and zooming
// are off, so the view always matches the script.
import "mafs/core.css";

import { useMemo } from "react";

import { Coordinates, Line, Mafs, Plot, Point, Polygon, Text, Vector } from "mafs";

import { safeFunction } from "@/lib/math/solution/expr";
import type { Graph, GraphItem, Point2 } from "@/lib/math/solution/types";
import { cn } from "@/lib/utils";

import { colorOf, lerp, lerpPoint, plainLabel } from "./geometry";
import styles from "./player.module.css";

type GraphViewProps = {
  graph: Graph;
  parts: Record<string, number>;
  /** Author mode: called with the graph point that was clicked. */
  onPick?: (point: Point2) => void;
};

const AREA_SAMPLES = 48;

export const GraphView = ({ graph, parts, onPick }: GraphViewProps) => {
  const functions = useMemo(
    () =>
      Object.fromEntries(
        graph.items
          .filter((item): item is Extract<GraphItem, { type: "function" }> => item.type === "function")
          .map((item) => [item.id, safeFunction(item.fn)])
      ),
    [graph]
  );
  const fn = (id: string | undefined) => (id && functions[id]) || (() => Number.NaN);

  const label = (item: GraphItem, at: Point2, p: number) =>
    item.label && p > 0.6 ? (
      <Text x={at[0]} y={at[1]} attach="ne" attachDistance={10} color={colorOf(item.color, "gray")}>
        {plainLabel(item.label)}
      </Text>
    ) : null;

  const draw = (item: GraphItem) => {
    const p = parts[item.id] ?? 0;
    if (p <= 0) return null;
    const color = colorOf(item.color);
    switch (item.type) {
      case "function": {
        const [a, b] = item.domain ?? graph.view.x;
        const end = lerp(a, b, p);
        const f = fn(item.id);
        return (
          <g key={item.id}>
            {end > a && <Plot.OfX y={f} domain={[a, end]} color={color} weight={3} />}
            {label(item, [end, f(end)], p)}
          </g>
        );
      }
      case "point": {
        const at: Point2 = item.along
          ? (() => {
              const x = lerp(item.from ?? 0, item.to ?? 0, p);
              return [x, fn(item.along)(x)];
            })()
          : (item.at ?? [0, 0]);
        if (!Number.isFinite(at[1])) return null;
        return (
          <g key={item.id}>
            <Point x={at[0]} y={at[1]} color={color} opacity={Math.min(1, p * 4)} />
            {label(item, at, p)}
          </g>
        );
      }
      case "area": {
        const f = fn(item.of);
        const end = lerp(item.from, item.to, p);
        if (end <= item.from) return null;
        const points: Point2[] = [[item.from, 0]];
        for (let k = 0; k <= AREA_SAMPLES; k++) {
          const x = lerp(item.from, end, k / AREA_SAMPLES);
          const y = f(x);
          points.push([x, Number.isFinite(y) ? y : 0]);
        }
        points.push([end, 0]);
        return (
          <g key={item.id}>
            <Polygon points={points} color={color} fillOpacity={0.3} weight={0} />
            {label(item, [(item.from + item.to) / 2, f((item.from + item.to) / 2) / 2], p)}
          </g>
        );
      }
      case "vector": {
        const tip = lerpPoint(item.from, item.to, p);
        return (
          <g key={item.id}>
            <Vector tail={item.from} tip={tip} color={color} weight={3} />
            {label(item, tip, p)}
          </g>
        );
      }
      case "segment": {
        const end = lerpPoint(item.from, item.to, p);
        return (
          <g key={item.id}>
            <Line.Segment point1={item.from} point2={end} color={color} weight={2.5} style={item.dashed ? "dashed" : "solid"} />
            {label(item, end, p)}
          </g>
        );
      }
    }
  };

  return (
    <div className={cn(styles.graph, "w-full")} data-plot={graph.id} role="img" aria-label={graph.items.map((item) => item.label).filter(Boolean).join(", ") || "Graph"}>
      <Mafs
        height={graph.height ?? 260}
        pan={false}
        zoom={false}
        viewBox={{ x: graph.view.x, y: graph.view.y, padding: 0 }}
        preserveAspectRatio={false}
        onClick={onPick ? (point) => onPick([point[0], point[1]]) : undefined}
      >
        <Coordinates.Cartesian subdivisions={false} />
        {graph.items.map(draw)}
      </Mafs>
    </div>
  );
};
