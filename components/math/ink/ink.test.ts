import { describe, expect, it } from "vitest";

import type { StoredStroke } from "@/lib/math/types";

import { addStroke, inkReducer, moveStrokes, newStrokeId, removeStrokes } from "./document";
import {
  pointInPolygon,
  strokeHitsCircle,
  strokesBelow,
  strokesHitAlong,
  strokesInLasso,
} from "./geometry";
import { isErasingPen, pressureIsReal, samplesOf } from "./pointer";
import { outlineToPath, strokeOutline } from "./render";

const line = (i: string, x0: number, y0: number, x1: number, y1: number): StoredStroke => ({
  i,
  k: "p",
  c: "#000000",
  s: 4,
  pr: 0,
  t: 0,
  p: [x0, y0, 0.5, 0, (x0 + x1) / 2, (y0 + y1) / 2, 0.5, 8, x1, y1, 0.5, 16],
});

describe("ink document", () => {
  const a = line("a", 0, 0, 100, 0);
  const b = line("b", 0, 100, 100, 100);

  it("undoes and redoes one commit at a time", () => {
    let state = inkReducer({ strokes: [], past: [], future: [] }, { type: "commit", strokes: [a] });
    state = inkReducer(state, { type: "commit", strokes: addStroke(state.strokes, b) });
    expect(state.strokes).toEqual([a, b]);
    state = inkReducer(state, { type: "undo" });
    expect(state.strokes).toEqual([a]);
    state = inkReducer(state, { type: "undo" });
    expect(state.strokes).toEqual([]);
    expect(inkReducer(state, { type: "undo" })).toBe(state);
    state = inkReducer(state, { type: "redo" });
    expect(state.strokes).toEqual([a]);
    state = inkReducer(state, { type: "commit", strokes: [] });
    expect(state.future).toEqual([]);
    state = inkReducer(state, { type: "load", strokes: [b] });
    expect(state).toEqual({ strokes: [b], past: [], future: [] });
  });

  it("removes and moves strokes by id", () => {
    expect(removeStrokes([a, b], new Set(["a"]))).toEqual([b]);
    const moved = moveStrokes([a, b], new Set(["b"]), 0, 50);
    expect(moved[0]).toBe(a);
    expect(moved[1].p[1]).toBe(150);
  });

  it("makes ids that the server accepts", () => {
    const ids = new Set(Array.from({ length: 50 }, newStrokeId));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{1,24}$/);
  });
});

describe("ink geometry", () => {
  const a = line("a", 0, 0, 100, 0);
  const b = line("b", 0, 100, 100, 100);

  it("erases whole strokes the eraser touches", () => {
    expect(strokeHitsCircle(a, 50, 5, 4)).toBe(true);
    expect(strokeHitsCircle(a, 50, 20, 4)).toBe(false);
    expect([...strokesHitAlong([a, b], 50, -40, 50, 140, 5)].sort()).toEqual(["a", "b"]);
    expect([...strokesHitAlong([a, b], 200, 0, 200, 100, 5)]).toEqual([]);
  });

  it("selects strokes inside a lasso loop", () => {
    const loop = [-10, -10, 110, -10, 110, 10, -10, 10];
    expect(pointInPolygon(50, 0, loop)).toBe(true);
    expect(pointInPolygon(50, 50, loop)).toBe(false);
    expect([...strokesInLasso([a, b], loop)]).toEqual(["a"]);
  });

  it("finds the strokes below an inserted space", () => {
    expect([...strokesBelow([a, b], 50)]).toEqual(["b"]);
  });
});

describe("pointer readings", () => {
  const event = (init: Partial<PointerEvent>) => init as PointerEvent;

  it("treats the eraser end and the barrel button as erasing", () => {
    expect(isErasingPen(event({ pointerType: "pen", buttons: 32, button: 0 }))).toBe(true);
    expect(isErasingPen(event({ pointerType: "pen", buttons: 1, button: 5 }))).toBe(true);
    expect(isErasingPen(event({ pointerType: "pen", buttons: 3, button: 0 }))).toBe(true);
    expect(isErasingPen(event({ pointerType: "pen", buttons: 1, button: 0 }))).toBe(false);
    expect(isErasingPen(event({ pointerType: "mouse", buttons: 32, button: 0 }))).toBe(false);
  });

  it("tells real pressure from the defaults of devices without it", () => {
    expect(pressureIsReal(0.5, 0.5)).toBe(false);
    expect(pressureIsReal(0, 0)).toBe(false);
    expect(pressureIsReal(1, 1)).toBe(false);
    expect(pressureIsReal(0.21, 0.74)).toBe(true);
    expect(pressureIsReal(0.37, 0.37)).toBe(true);
  });

  it("falls back to the event itself without coalesced events", () => {
    const plain = event({ pointerType: "pen" });
    expect(samplesOf(plain)).toEqual([plain]);
    const empty = event({ getCoalescedEvents: () => [] });
    expect(samplesOf(empty)).toEqual([empty]);
    const sample = event({ pointerType: "pen" });
    expect(samplesOf(event({ getCoalescedEvents: () => [sample, sample] }))).toHaveLength(2);
  });
});

describe("stroke outlines", () => {
  it("draws an even line without pressure and a varying one with it", () => {
    const even = strokeOutline(line("e", 0, 0, 100, 0));
    expect(even.length).toBeGreaterThan(4);
    expect(outlineToPath(even)).toMatch(/^M .* Z$/);
    const pressed: StoredStroke = {
      ...line("p", 0, 0, 100, 0),
      pr: 1,
      p: [0, 0, 0.1, 0, 50, 0, 0.9, 8, 100, 0, 0.1, 16],
    };
    const widths = (outline: number[][]) =>
      Math.max(...outline.map(([, y]) => y)) - Math.min(...outline.map(([, y]) => y));
    expect(widths(strokeOutline(pressed))).not.toBeCloseTo(widths(even), 1);
  });
});
