"use client";

// The ink canvas of math practice (docs/DESIGN-coding-and-math.md, section 5.2). Pointer Events
// give pen, touch and mouse through one interface; coalesced samples keep fast writing smooth;
// perfect-freehand draws the outlines, with an even width when a device has no pressure.
//
// Palm rejection: once a pen has been seen on the canvas, touches stop drawing, one finger
// scrolls and two fingers pan and zoom (unless the learner switches finger drawing back on).
// The page is PAGE_WIDTH units wide and endless downward; it is scaled to the canvas width.
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type Ref,
} from "react";

import { getStroke } from "perfect-freehand";

import { roundStroke, strokeBounds, type Bounds } from "@/lib/math/strokes";
import { PAGE_WIDTH, type StoredStroke } from "@/lib/math/types";
import { cn } from "@/lib/utils";

import {
  addStroke,
  moveStrokes,
  newStrokeId,
  removeStrokes,
  type InkDocument,
} from "./ink/document";
import {
  boundsOf,
  inBounds,
  strokesBelow,
  strokesHitAlong,
  strokesInLasso,
} from "./ink/geometry";
import { isErasingPen, pressureIsReal, samplesOf } from "./ink/pointer";
import {
  HIGHLIGHTER_ALPHA,
  inputPoints,
  outlineToPath,
  paintStroke,
  strokeOptions,
} from "./ink/render";

export type InkTool = "pen" | "highlighter" | "eraser" | "lasso" | "space";
/** auto: fingers draw until a pen shows up; draw: fingers always draw; navigate: never. */
export type TouchMode = "auto" | "draw" | "navigate";

export type InkCanvasHandle = {
  zoomBy: (factor: number) => void;
  resetView: () => void;
  deleteSelection: () => void;
  clearSelection: () => void;
};

type InkCanvasProps = {
  doc: InkDocument;
  tool: InkTool;
  /** Ink colour, #rrggbb. */
  color: string;
  /** Pen width in screen pixels (the highlighter is wider). */
  width: number;
  touchMode: TouchMode;
  readOnly?: boolean;
  onPenSeen?: () => void;
  onSelectionChange?: (count: number) => void;
  className?: string;
  ref?: Ref<InkCanvasHandle>;
};

const LINE_GAP = 64; // ruled lines, page units
const TOP_MARGIN = 24;
const ERASER_PX = 12;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
export const HIGHLIGHTER_FACTOR = 5;
export const HIGHLIGHTER_COLOR = "#facc15";

type View = { x: number; y: number; zoom: number };

type Gesture =
  | {
      kind: "draw";
      id: number;
      pointerType: string;
      stroke: Omit<StoredStroke, "p"> & { p: number[] };
      t0: number;
      pmin: number;
      pmax: number;
    }
  | { kind: "erase"; id: number; pointerType: string; x: number; y: number; hit: Set<string> }
  | { kind: "lasso"; id: number; pointerType: string; poly: number[] }
  | { kind: "move"; id: number; pointerType: string; x0: number; y0: number; dx: number; dy: number }
  | { kind: "space"; id: number; pointerType: string; y0: number; dy: number; ids: Set<string> }
  | { kind: "pan"; id: number; pointerType: string; sx: number; sy: number }
  | {
      kind: "pinch";
      ids: [number, number];
      startDistance: number;
      startZoom: number;
      world: { x: number; y: number };
    };

const boundsCache = new WeakMap<StoredStroke, Bounds>();
const cachedBounds = (stroke: StoredStroke) => {
  let b = boundsCache.get(stroke);
  if (!b) {
    b = strokeBounds(stroke);
    boundsCache.set(stroke, b);
  }
  return b;
};

export const InkCanvas = ({
  doc,
  tool,
  color,
  width,
  touchMode,
  readOnly = false,
  onPenSeen,
  onSelectionChange,
  className,
  ref,
}: InkCanvasProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);

  // Everything the event handlers read lives in refs, so handlers attach once.
  const props = useRef({ doc, tool, color, width, touchMode, readOnly, onPenSeen, onSelectionChange });
  useLayoutEffect(() => {
    props.current = { doc, tool, color, width, touchMode, readOnly, onPenSeen, onSelectionChange };
  });

  const view = useRef<View>({ x: 0, y: -TOP_MARGIN, zoom: 1 });
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const gesture = useRef<Gesture | null>(null);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const penDown = useRef(false);
  const penSeen = useRef(false);
  // Previews that last until the committed strokes come back through props, so nothing flickers.
  const hidden = useRef(new Set<string>());
  const offset = useRef<{ ids: Set<string>; dx: number; dy: number } | null>(null);
  const pending = useRef<StoredStroke[]>([]);
  const selection = useRef(new Set<string>());
  const rect = useRef({ left: 0, top: 0 });
  const dirty = useRef({ base: true, overlay: true });
  const frame = useRef(0);

  const scale = () => (size.current.w / PAGE_WIDTH) * view.current.zoom;

  const contentBottom = () => {
    let bottom = 0;
    for (const stroke of props.current.doc.strokes)
      bottom = Math.max(bottom, cachedBounds(stroke).maxY);
    return bottom;
  };

  const clampView = useCallback(() => {
    const v = view.current;
    const s = scale();
    if (!s) return;
    const visibleW = size.current.w / s;
    const visibleH = size.current.h / s;
    v.x =
      visibleW >= PAGE_WIDTH
        ? (PAGE_WIDTH - visibleW) / 2
        : Math.min(Math.max(v.x, -TOP_MARGIN), PAGE_WIDTH - visibleW + TOP_MARGIN);
    // Endless downward: one screen past the lowest writing.
    v.y = Math.min(Math.max(v.y, -TOP_MARGIN), Math.max(0, contentBottom()) + visibleH * 0.75);
  }, []);

  const drawBase = useCallback(() => {
    const canvas = baseRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { w, h, dpr } = size.current;
    const v = view.current;
    const s = scale();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#f1f5f9";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!s) return;
    ctx.setTransform(dpr * s, 0, 0, dpr * s, -v.x * dpr * s, -v.y * dpr * s);

    const top = v.y;
    const bottom = v.y + h / s;
    const pageTop = Math.max(top, -TOP_MARGIN);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, pageTop, PAGE_WIDTH, bottom - pageTop);
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 1 / s;
    ctx.beginPath();
    for (let y = Math.max(LINE_GAP, Math.ceil(top / LINE_GAP) * LINE_GAP); y < bottom; y += LINE_GAP) {
      ctx.moveTo(0, y);
      ctx.lineTo(PAGE_WIDTH, y);
    }
    ctx.stroke();

    const left = v.x;
    const right = v.x + w / s;
    const moved = offset.current;
    for (const stroke of props.current.doc.strokes) {
      if (hidden.current.has(stroke.i)) continue;
      const shift = moved?.ids.has(stroke.i) ? moved : null;
      const b = cachedBounds(stroke);
      const dx = shift?.dx ?? 0;
      const dy = shift?.dy ?? 0;
      if (b.maxX + dx < left || b.minX + dx > right || b.maxY + dy < top || b.minY + dy > bottom)
        continue;
      if (shift) {
        ctx.save();
        ctx.translate(dx, dy);
        paintStroke(ctx, stroke);
        ctx.restore();
      } else paintStroke(ctx, stroke);
    }
    if (pending.current.length) {
      const ids = new Set(props.current.doc.strokes.map((stroke) => stroke.i));
      for (const stroke of pending.current) if (!ids.has(stroke.i)) paintStroke(ctx, stroke);
    }

    // Scroll position along the page.
    const thumb = thumbRef.current;
    if (thumb) {
      const total = Math.max(contentBottom() + h / s, bottom) + TOP_MARGIN;
      const share = Math.min(1, h / s / total);
      thumb.style.height = `${Math.max(8, share * 100)}%`;
      thumb.style.top = `${Math.min(100 - share * 100, ((top + TOP_MARGIN) / total) * 100)}%`;
    }
  }, []);

  const drawOverlay = useCallback(() => {
    const canvas = overlayRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { dpr } = size.current;
    const v = view.current;
    const s = scale();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!s) return;
    ctx.setTransform(dpr * s, 0, 0, dpr * s, -v.x * dpr * s, -v.y * dpr * s);

    const g = gesture.current;
    if (g?.kind === "draw" && g.stroke.p.length) {
      const pressure = g.pointerType === "pen" && pressureIsReal(g.pmin, g.pmax);
      const outline = getStroke(
        inputPoints(g.stroke.p, pressure),
        strokeOptions(g.stroke.k, g.stroke.s, pressure, false)
      );
      ctx.save();
      ctx.fillStyle = g.stroke.c;
      if (g.stroke.k === "h") ctx.globalAlpha = HIGHLIGHTER_ALPHA;
      ctx.fill(new Path2D(outlineToPath(outline)));
      ctx.restore();
    }
    if (g?.kind === "erase") {
      ctx.strokeStyle = "#64748b";
      ctx.lineWidth = 1.5 / s;
      ctx.beginPath();
      ctx.arc(g.x, g.y, ERASER_PX / s, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (g?.kind === "lasso" && g.poly.length >= 4) {
      ctx.strokeStyle = "#0ea5e9";
      ctx.lineWidth = 1.5 / s;
      ctx.setLineDash([6 / s, 4 / s]);
      ctx.beginPath();
      ctx.moveTo(g.poly[0], g.poly[1]);
      for (let k = 2; k < g.poly.length; k += 2) ctx.lineTo(g.poly[k], g.poly[k + 1]);
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (selection.current.size) {
      const b = boundsOf(props.current.doc.strokes, selection.current);
      if (b) {
        const dx = g?.kind === "move" ? g.dx : 0;
        const dy = g?.kind === "move" ? g.dy : 0;
        const pad = 6 / s;
        ctx.fillStyle = "rgba(14, 165, 233, 0.06)";
        ctx.strokeStyle = "#0ea5e9";
        ctx.lineWidth = 1.5 / s;
        ctx.setLineDash([6 / s, 4 / s]);
        ctx.fillRect(b.minX - pad + dx, b.minY - pad + dy, b.maxX - b.minX + 2 * pad, b.maxY - b.minY + 2 * pad);
        ctx.strokeRect(b.minX - pad + dx, b.minY - pad + dy, b.maxX - b.minX + 2 * pad, b.maxY - b.minY + 2 * pad);
        ctx.setLineDash([]);
      }
    }
    if (g?.kind === "space") {
      ctx.strokeStyle = "#0ea5e9";
      ctx.lineWidth = 2 / s;
      ctx.setLineDash([8 / s, 6 / s]);
      ctx.beginPath();
      ctx.moveTo(0, g.y0);
      ctx.lineTo(PAGE_WIDTH, g.y0);
      ctx.moveTo(0, g.y0 + g.dy);
      ctx.lineTo(PAGE_WIDTH, g.y0 + g.dy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(14, 165, 233, 0.08)";
      ctx.fillRect(0, Math.min(g.y0, g.y0 + g.dy), PAGE_WIDTH, Math.abs(g.dy));
    }
  }, []);

  const requestDraw = useCallback(
    (base = false) => {
      if (base) dirty.current.base = true;
      dirty.current.overlay = true;
      if (frame.current) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        if (dirty.current.base) drawBase();
        if (dirty.current.overlay) drawOverlay();
        dirty.current = { base: false, overlay: false };
      });
    },
    [drawBase, drawOverlay]
  );

  const setSelection = useCallback(
    (ids: Set<string>) => {
      selection.current = ids;
      props.current.onSelectionChange?.(ids.size);
      requestDraw();
    },
    [requestDraw]
  );

  const zoomAt = useCallback(
    (factor: number, sx: number, sy: number) => {
      const v = view.current;
      const before = scale();
      if (!before) return;
      const wx = v.x + sx / before;
      const wy = v.y + sy / before;
      v.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor));
      const after = scale();
      v.x = wx - sx / after;
      v.y = wy - sy / after;
      clampView();
      requestDraw(true);
    },
    [clampView, requestDraw]
  );

  useImperativeHandle(
    ref,
    () => ({
      zoomBy: (factor) => zoomAt(factor, size.current.w / 2, size.current.h / 2),
      resetView: () => {
        view.current = { x: 0, y: view.current.y, zoom: 1 };
        clampView();
        requestDraw(true);
      },
      deleteSelection: () => {
        const ids = selection.current;
        if (!ids.size || props.current.readOnly) return;
        props.current.doc.commit(removeStrokes(props.current.doc.strokes, ids));
        setSelection(new Set());
      },
      clearSelection: () => setSelection(new Set()),
    }),
    [zoomAt, clampView, requestDraw, setSelection]
  );

  // Redraw when the strokes change (new stroke, undo, redo, a restored draft).
  useEffect(() => {
    pending.current = [];
    const g = gesture.current?.kind;
    if (g !== "erase") hidden.current = new Set();
    if (g !== "move" && g !== "space") offset.current = null;
    const ids = new Set(doc.strokes.map((stroke) => stroke.i));
    if ([...selection.current].some((id) => !ids.has(id)))
      setSelection(new Set([...selection.current].filter((id) => ids.has(id))));
    requestDraw(true);
  }, [doc.strokes, requestDraw, setSelection]);

  // A new tool starts without a selection.
  useEffect(() => {
    if (tool !== "lasso" && selection.current.size) setSelection(new Set());
  }, [tool, setSelection]);

  // Canvas size follows the container.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const w = container.clientWidth;
      const h = container.clientHeight;
      size.current = { w, h, dpr };
      for (const canvas of [baseRef.current, overlayRef.current]) {
        if (!canvas) continue;
        canvas.width = Math.max(1, Math.round(w * dpr));
        canvas.height = Math.max(1, Math.round(h * dpr));
      }
      clampView();
      requestDraw(true);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => {
      observer.disconnect();
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [clampView, requestDraw]);

  // Pointer, wheel and context-menu handling, attached once to the top canvas.
  useEffect(() => {
    const target = overlayRef.current;
    if (!target) return;

    const local = (e: PointerEvent | WheelEvent) => ({
      sx: e.clientX - rect.current.left,
      sy: e.clientY - rect.current.top,
    });
    const toWorld = (sx: number, sy: number) => {
      const s = scale();
      return { x: view.current.x + sx / s, y: view.current.y + sy / s };
    };

    const notePen = () => {
      if (penSeen.current) return;
      penSeen.current = true;
      props.current.onPenSeen?.();
    };

    const touchDraws = () => {
      const mode = props.current.touchMode;
      return mode === "draw" || (mode === "auto" && !penSeen.current);
    };

    const cancelGesture = () => {
      const g = gesture.current;
      gesture.current = null;
      if (g?.kind === "erase") hidden.current = new Set();
      if (g?.kind === "space" || g?.kind === "move") offset.current = null;
      requestDraw(true);
    };

    const startTool = (e: PointerEvent, forceEraser: boolean) => {
      const { sx, sy } = local(e);
      const { x, y } = toWorld(sx, sy);
      const p = props.current;
      const tool = forceEraser ? "eraser" : p.tool;
      const id = e.pointerId;
      const pointerType = e.pointerType;
      const s = scale();

      if (p.readOnly) {
        gesture.current = { kind: "pan", id, pointerType, sx, sy };
        return;
      }

      switch (tool) {
        case "pen":
        case "highlighter": {
          const highlighter = tool === "highlighter";
          const pressure = e.pressure;
          gesture.current = {
            kind: "draw",
            id,
            pointerType,
            t0: e.timeStamp,
            pmin: pressure,
            pmax: pressure,
            stroke: {
              i: newStrokeId(),
              k: highlighter ? "h" : "p",
              c: highlighter ? HIGHLIGHTER_COLOR : p.color,
              s: (p.width * (highlighter ? HIGHLIGHTER_FACTOR : 1)) / s,
              pr: 0,
              t: Date.now(),
              p: [x, y, pressure, 0],
            },
          };
          break;
        }
        case "eraser": {
          const hit = strokesHitAlong(p.doc.strokes, x, y, x, y, ERASER_PX / s);
          hidden.current = new Set(hit);
          gesture.current = { kind: "erase", id, pointerType, x, y, hit };
          requestDraw(true);
          break;
        }
        case "lasso": {
          const b = selection.current.size ? boundsOf(p.doc.strokes, selection.current) : null;
          if (b && inBounds(b, x, y, 10 / s)) {
            gesture.current = { kind: "move", id, pointerType, x0: x, y0: y, dx: 0, dy: 0 };
            offset.current = { ids: selection.current, dx: 0, dy: 0 };
          } else {
            if (selection.current.size) setSelection(new Set());
            gesture.current = { kind: "lasso", id, pointerType, poly: [x, y] };
          }
          break;
        }
        case "space": {
          const ids = strokesBelow(p.doc.strokes, y);
          gesture.current = { kind: "space", id, pointerType, y0: y, dy: 0, ids };
          offset.current = { ids, dx: 0, dy: 0 };
          break;
        }
      }
      requestDraw();
    };

    const moveTool = (e: PointerEvent) => {
      const g = gesture.current;
      if (!g || g.kind === "pinch" || g.id !== e.pointerId) return;
      const s = scale();
      if (g.kind === "pan") {
        const { sx, sy } = local(e);
        view.current.x -= (sx - g.sx) / s;
        view.current.y -= (sy - g.sy) / s;
        g.sx = sx;
        g.sy = sy;
        clampView();
        requestDraw(true);
        return;
      }
      for (const sample of samplesOf(e)) {
        const { sx, sy } = local(sample);
        const { x, y } = toWorld(sx, sy);
        if (g.kind === "draw") {
          const p = g.stroke.p;
          const lastX = p[p.length - 4];
          const lastY = p[p.length - 3];
          if (Math.hypot(x - lastX, y - lastY) * s < 0.5) continue;
          p.push(x, y, sample.pressure, Math.max(0, sample.timeStamp - g.t0));
          g.pmin = Math.min(g.pmin, sample.pressure);
          g.pmax = Math.max(g.pmax, sample.pressure);
        } else if (g.kind === "erase") {
          const hit = strokesHitAlong(
            props.current.doc.strokes.filter((stroke) => !g.hit.has(stroke.i)),
            g.x,
            g.y,
            x,
            y,
            ERASER_PX / s
          );
          g.x = x;
          g.y = y;
          if (hit.size) {
            for (const id of hit) g.hit.add(id);
            hidden.current = new Set(g.hit);
            requestDraw(true);
          }
        } else if (g.kind === "lasso") {
          g.poly.push(x, y);
        } else if (g.kind === "move") {
          g.dx = x - g.x0;
          g.dy = y - g.y0;
          offset.current = { ids: selection.current, dx: g.dx, dy: g.dy };
          dirty.current.base = true;
        } else if (g.kind === "space") {
          g.dy = Math.max(y - g.y0, -g.y0 - TOP_MARGIN);
          offset.current = { ids: g.ids, dx: 0, dy: g.dy };
          dirty.current.base = true;
        }
      }
      requestDraw(dirty.current.base);
    };

    const finishTool = (e: PointerEvent, keep: boolean) => {
      const g = gesture.current;
      if (!g || g.kind === "pinch" || g.id !== e.pointerId) return;
      gesture.current = null;
      const p = props.current;
      const strokes = p.doc.strokes;
      if (!keep) {
        cancelGesture();
        return;
      }
      // A committed change stays previewed until the new strokes arrive through props.
      switch (g.kind) {
        case "draw": {
          const stroke: StoredStroke = roundStroke({
            ...g.stroke,
            pr: g.pointerType === "pen" && pressureIsReal(g.pmin, g.pmax) ? 1 : 0,
          });
          pending.current = [...pending.current, stroke];
          p.doc.commit(addStroke(strokes, stroke));
          break;
        }
        case "erase":
          if (g.hit.size) p.doc.commit(removeStrokes(strokes, g.hit));
          else hidden.current = new Set();
          break;
        case "lasso":
          setSelection(strokesInLasso(strokes, g.poly));
          break;
        case "move":
          if (Math.abs(g.dx) + Math.abs(g.dy) > 0.5)
            p.doc.commit(moveStrokes(strokes, selection.current, g.dx, g.dy));
          else offset.current = null;
          break;
        case "space":
          if (Math.abs(g.dy) > 1 && g.ids.size)
            p.doc.commit(moveStrokes(strokes, g.ids, 0, g.dy));
          else offset.current = null;
          break;
      }
      requestDraw(true);
    };

    const startPinch = () => {
      const [a, b] = [...touches.current.entries()];
      if (!a || !b) return;
      const mid = { x: (a[1].x + b[1].x) / 2, y: (a[1].y + b[1].y) / 2 };
      gesture.current = {
        kind: "pinch",
        ids: [a[0], b[0]],
        startDistance: Math.max(1, Math.hypot(a[1].x - b[1].x, a[1].y - b[1].y)),
        startZoom: view.current.zoom,
        world: toWorld(mid.x, mid.y),
      };
    };

    const movePinch = () => {
      const g = gesture.current;
      if (g?.kind !== "pinch") return;
      const a = touches.current.get(g.ids[0]);
      const b = touches.current.get(g.ids[1]);
      if (!a || !b) return;
      const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const v = view.current;
      v.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (g.startZoom * distance) / g.startDistance));
      const s = scale();
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      v.x = g.world.x - mid.x / s;
      v.y = g.world.y - mid.y / s;
      clampView();
      requestDraw(true);
    };

    const onDown = (e: PointerEvent) => {
      const r = target.getBoundingClientRect();
      rect.current = { left: r.left, top: r.top };

      if (e.pointerType === "pen") {
        notePen();
        penDown.current = true;
        // A palm or finger that got there first is not writing.
        const g = gesture.current;
        if (g && (g.kind === "pinch" || g.pointerType === "touch")) cancelGesture();
        else if (g) return; // a second pen contact while one is writing
        target.setPointerCapture(e.pointerId);
        startTool(e, isErasingPen(e));
        e.preventDefault();
        return;
      }

      if (e.pointerType === "touch") {
        if (penDown.current) return; // palm while the pen writes
        const { sx, sy } = local(e);
        touches.current.set(e.pointerId, { x: sx, y: sy });
        target.setPointerCapture(e.pointerId);
        if (touches.current.size === 2) {
          const g = gesture.current;
          // The second finger turns a one-finger stroke into pan and zoom.
          if (g && g.kind !== "pinch") cancelGesture();
          startPinch();
        } else if (touches.current.size === 1) {
          if (touchDraws() && !props.current.readOnly) startTool(e, false);
          else gesture.current = { kind: "pan", id: e.pointerId, pointerType: "touch", sx, sy };
        }
        e.preventDefault();
        return;
      }

      // Mouse: left button uses the tool, middle button pans.
      if (gesture.current) return;
      target.setPointerCapture(e.pointerId);
      if (e.button === 1) {
        const { sx, sy } = local(e);
        gesture.current = { kind: "pan", id: e.pointerId, pointerType: "mouse", sx, sy };
      } else if (e.button === 0) startTool(e, false);
      e.preventDefault();
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "pen" && !penSeen.current) notePen(); // hovering S Pen
      if (e.pointerType === "touch" && touches.current.has(e.pointerId)) {
        const { sx, sy } = local(e);
        touches.current.set(e.pointerId, { x: sx, y: sy });
        if (gesture.current?.kind === "pinch") {
          movePinch();
          return;
        }
      }
      if (gesture.current) moveTool(e);
    };

    const onUp = (e: PointerEvent, keep: boolean) => {
      if (e.pointerType === "pen") penDown.current = false;
      if (e.pointerType === "touch") {
        touches.current.delete(e.pointerId);
        const g = gesture.current;
        if (g?.kind === "pinch") {
          if (g.ids.includes(e.pointerId)) gesture.current = null;
          return;
        }
        // A cancelled touch stroke is dropped; a lifted one is kept.
        finishTool(e, keep);
        return;
      }
      finishTool(e, keep || e.pointerType === "pen");
    };

    const onPointerUp = (e: PointerEvent) => onUp(e, true);
    const onPointerCancel = (e: PointerEvent) => onUp(e, false);

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = target.getBoundingClientRect();
      rect.current = { left: r.left, top: r.top };
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? size.current.h : 1;
      if (e.ctrlKey || e.metaKey) {
        const { sx, sy } = local(e);
        zoomAt(Math.exp(-e.deltaY * unit * 0.01), sx, sy);
        return;
      }
      const s = scale();
      view.current.x += (e.shiftKey ? e.deltaY : e.deltaX) * (unit / s);
      if (!e.shiftKey) view.current.y += e.deltaY * (unit / s);
      clampView();
      requestDraw(true);
    };

    const onContextMenu = (e: Event) => e.preventDefault();

    target.addEventListener("pointerdown", onDown);
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onPointerUp);
    target.addEventListener("pointercancel", onPointerCancel);
    target.addEventListener("lostpointercapture", onPointerUp);
    target.addEventListener("wheel", onWheel, { passive: false });
    target.addEventListener("contextmenu", onContextMenu);
    return () => {
      target.removeEventListener("pointerdown", onDown);
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onPointerUp);
      target.removeEventListener("pointercancel", onPointerCancel);
      target.removeEventListener("lostpointercapture", onPointerUp);
      target.removeEventListener("wheel", onWheel);
      target.removeEventListener("contextmenu", onContextMenu);
    };
  }, [clampView, requestDraw, setSelection, zoomAt]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative overflow-hidden rounded-xl border-2 border-slate-200 bg-slate-100",
        className
      )}
    >
      <canvas ref={baseRef} className="absolute inset-0 h-full w-full" aria-hidden />
      <canvas
        ref={overlayRef}
        className={cn(
          "absolute inset-0 h-full w-full touch-none select-none",
          readOnly ? "cursor-grab" : "cursor-crosshair"
        )}
        role="img"
        aria-label="Writing area. Write your solution with a pen, a finger or the mouse."
      />
      <div className="pointer-events-none absolute bottom-1 right-1 top-1 w-1 rounded-full bg-slate-200/70">
        <div ref={thumbRef} className="absolute left-0 w-1 rounded-full bg-slate-400/80" />
      </div>
    </div>
  );
};
