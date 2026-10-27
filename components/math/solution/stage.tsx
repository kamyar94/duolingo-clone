"use client";

// The scene of the solution player: the question with its spans, the given cards, the board
// with equations, graphs, figures, tables and notes, and an overlay with the flights (a span
// lifted into a card, a given flying into a term) and the arrows of notes. Positions come from
// one measurement of the laid-out scene (repeated when its size changes); the frame decides
// what is visible and where things are in their motion.
import { Fragment, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import { CircleCheck } from "lucide-react";

import { splitMathText } from "@/lib/math/latex";
import type { Frame, Timeline } from "@/lib/math/solution/timeline";
import type { Given, SolutionScript } from "@/lib/math/solution/types";
import { cn } from "@/lib/utils";

import { MathFormula, MathText } from "../math-text";

import { EquationView } from "./equation-view";
import { FigureView } from "./figure-view";
import {
  center,
  exitPoint,
  figureToRect,
  graphToRect,
  itemAnchor,
  lerp,
  shapeAnchor,
  type Rect,
} from "./geometry";
import { GraphView } from "./graph-view";
import styles from "./player.module.css";
import { termIdOf } from "./script-katex";

type Layout = {
  width: number;
  spans: Record<string, Rect>;
  givens: Record<string, Rect>;
  slots: Record<string, Rect>;
  layers: Record<string, Record<string, Rect>>;
  terms: Record<string, Record<string, Record<string, Rect>>>;
  plots: Record<string, Rect>;
  figures: Record<string, Rect>;
  rows: Record<string, Rect>;
  elements: Record<string, Rect>;
  notes: Record<string, Rect>;
};

const measure = (root: HTMLElement): Layout => {
  const base = root.getBoundingClientRect();
  const rel = (element: Element): Rect => {
    const r = element.getBoundingClientRect();
    return { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height };
  };
  const byData = (attribute: string) => {
    const out: Record<string, Rect> = {};
    for (const element of root.querySelectorAll(`[data-${attribute}]`))
      out[element.getAttribute(`data-${attribute}`) ?? ""] = rel(element);
    return out;
  };
  const layout: Layout = {
    width: base.width,
    spans: byData("span"),
    givens: byData("given"),
    slots: byData("eq-slot"),
    layers: {},
    terms: {},
    plots: byData("plot"),
    figures: byData("figure-svg"),
    rows: byData("row"),
    elements: byData("element"),
    notes: byData("note"),
  };
  for (const slot of root.querySelectorAll<HTMLElement>("[data-eq-slot]")) {
    const id = slot.dataset.eqSlot ?? "";
    layout.layers[id] = {};
    layout.terms[id] = {};
    for (const layer of slot.querySelectorAll<HTMLElement>('[data-layer="rest"]')) {
      const state = layer.dataset.state ?? "";
      const katexBox = layer.querySelector(".katex") ?? layer;
      layout.layers[id][state] = rel(katexBox);
      const terms: Record<string, Rect> = {};
      for (const term of layer.querySelectorAll(".lt-term")) {
        const termId = termIdOf(term);
        if (termId) terms[termId] = rel(term);
      }
      layout.terms[id][state] = terms;
    }
  }
  return layout;
};

/** Board elements in the order they first appear. */
const boardOrder = (timeline: Timeline) => {
  const order: string[] = [];
  const add = (id: string | undefined) => {
    if (id && !order.includes(id)) order.push(id);
  };
  for (const { step } of timeline.steps) {
    if (step.kind === "Relate" || step.kind === "Transform" || step.kind === "Substitute") add(step.equation);
    else if (step.kind === "Plot") add(step.graph);
    else if (step.kind === "Construct") add(step.figure ?? step.table);
    else if (step.kind === "Annotate") step.notes.forEach(add);
  }
  return order;
};

const unitLatex = (unit: string) =>
  `\\mathrm{${unit.replace(/%/g, "\\%").replace(/°/g, "^\\circ").replace(/\*/g, "\\cdot ")}}`;

export const givenValueLatex = (given: Given) =>
  `${given.value}${given.unit ? `\\,${unitLatex(given.unit)}` : ""}`;

type StageProps = {
  timeline: Timeline;
  frame: Frame;
};

export const Stage = ({ timeline, frame }: StageProps) => {
  const script: SolutionScript = timeline.script;
  const rootRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<Layout | null>(null);

  const remeasure = useCallback(() => {
    if (rootRef.current) setLayout(measure(rootRef.current));
  }, []);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    remeasure();
    let active = true;
    // KaTeX fonts change the size of formulas once they load.
    document.fonts?.ready.then(() => active && remeasure()).catch(() => undefined);
    const observer = new ResizeObserver(() => remeasure());
    observer.observe(root);
    // Mafs draws after it has measured its own width.
    const late = window.setTimeout(remeasure, 300);
    return () => {
      active = false;
      observer.disconnect();
      window.clearTimeout(late);
    };
  }, [remeasure, script]);

  const order = useMemo(() => boardOrder(timeline), [timeline]);
  const wide = (layout?.width ?? 0) >= 640;
  const visuals = order.filter(
    (id) => script.graphs.some((g) => g.id === id) || script.figures.some((f) => f.id === id)
  );
  const texts = order.filter((id) => !visuals.includes(id));
  const columns = wide && visuals.length && texts.length ? [visuals, texts] : [order];
  // The answer bar keeps its space from the start, so nothing moves when it appears.
  const answerText = useMemo(() => {
    const answers = script.steps.filter((step) => step.kind === "Answer");
    if (!answers.length) return null;
    const last = answers[answers.length - 1];
    return (last.kind === "Answer" && last.text) || "That answers the question.";
  }, [script]);

  const element = (id: string) => {
    const opacity = frame.opacity[id] ?? 0;
    const equation = script.equations.find((e) => e.id === id);
    if (equation)
      return (
        <div key={id} data-element={id} className="max-w-full overflow-x-auto">
          <EquationView
            equation={equation}
            frame={frame.equations[id]}
            opacity={opacity}
            terms={layout?.terms[id]}
            slot={layout?.slots[id]}
            layers={layout?.layers[id]}
          />
        </div>
      );
    const graph = script.graphs.find((g) => g.id === id);
    if (graph)
      return (
        <div key={id} data-element={id} style={{ opacity }} className="rounded-xl border-2 border-slate-100 bg-white p-2">
          <GraphView graph={graph} parts={frame.parts[id] ?? {}} />
        </div>
      );
    const figure = script.figures.find((f) => f.id === id);
    if (figure)
      return (
        <div key={id} data-element={id} style={{ opacity }} className="rounded-xl border-2 border-slate-100 bg-white p-2">
          <FigureView figure={figure} parts={frame.parts[id] ?? {}} />
        </div>
      );
    const table = script.tables.find((t) => t.id === id);
    if (table)
      return (
        <div key={id} data-element={id} style={{ opacity }} className="overflow-x-auto">
          <table className="mx-auto border-collapse text-sm text-neutral-700 lg:text-base">
            {table.header && (
              <thead>
                <tr>
                  {table.header.map((cell, c) => (
                    <th key={c} className="border-b-2 border-slate-200 px-3 py-1 text-left font-bold">
                      <MathText text={cell} />
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {table.rows.map((row, r) => (
                <tr key={r} data-row={`${id}:${r}`} style={{ opacity: frame.parts[id]?.[String(r)] ?? 0 }}>
                  {row.map((cell, c) => (
                    <td key={c} className="border-b border-slate-100 px-3 py-1">
                      <MathText text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    const note = script.notes.find((n) => n.id === id);
    if (note)
      return (
        <div
          key={id}
          data-note={id}
          style={{ opacity, transform: `translateY(${lerp(8, 0, opacity)}px)` }}
          className="self-start rounded-xl border-2 border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          <MathText text={note.text} />
        </div>
      );
    return null;
  };

  // Where a note's arrow points.
  const noteTarget = (id: string): [number, number] | null => {
    const note = script.notes.find((n) => n.id === id);
    const target = note?.target;
    if (!target || !layout) return null;
    const { element: el, part } = target;
    if (layout.givens[el]) return center(layout.givens[el]);
    if (layout.spans[el]) return center(layout.spans[el]);
    const equation = frame.equations[el];
    if (equation) {
      if ((frame.opacity[el] ?? 0) < 0.5) return null;
      const state = equation.transition?.to ?? equation.state;
      const rect = part ? layout.terms[el]?.[state]?.[part] : layout.layers[el]?.[state];
      return rect ? [rect.x + rect.w / 2, rect.y] : null;
    }
    const graph = script.graphs.find((g) => g.id === el);
    if (graph && layout.plots[el]) {
      const item = graph.items.find((i) => i.id === part);
      if (item && (frame.parts[el]?.[item.id] ?? 0) < 0.5) return null;
      return item ? graphToRect(graph, layout.plots[el], itemAnchor(graph, item)) : center(layout.plots[el]);
    }
    const figure = script.figures.find((f) => f.id === el);
    if (figure && layout.figures[el]) {
      const shape = figure.shapes.find((s) => s.id === part);
      if (shape && (frame.parts[el]?.[shape.id] ?? 0) < 0.5) return null;
      return shape ? figureToRect(figure, layout.figures[el], shapeAnchor(figure, shape)) : center(layout.figures[el]);
    }
    if (part !== undefined && layout.rows[`${el}:${part}`]) return center(layout.rows[`${el}:${part}`]);
    return layout.elements[el] ? center(layout.elements[el]) : null;
  };

  const flightContent = (flight: Frame["flights"][number]) => {
    const given = script.givens.find((g) => g.id === flight.given);
    if (!given) return null;
    if (flight.kind === "span") {
      const span = script.question.find((s) => s.id === (flight.from as { span: string }).span);
      return <MathText text={span?.text ?? ""} className="[&_p]:whitespace-nowrap" />;
    }
    return <MathFormula latex={flight.kind === "symbol" ? given.symbol : givenValueLatex(given)} />;
  };

  const flightRect = (end: Frame["flights"][number]["from"] | Frame["flights"][number]["to"]) => {
    if (!layout) return null;
    if ("span" in end) return layout.spans[end.span] ?? null;
    if ("term" in end) return layout.terms[end.equation]?.[end.state]?.[end.term] ?? null;
    return layout.givens[end.given] ?? null;
  };

  return (
    <div ref={rootRef} className={cn(styles.stage, "relative space-y-4")}>
      {/* The question, with spans that light up when a given is taken from them. */}
      <p className="rounded-xl bg-slate-50 px-4 py-3 text-base leading-relaxed text-neutral-700 lg:text-lg">
        {script.question.map((span, n) => {
          const state = span.id ? frame.spans[span.id] : undefined;
          const parts = splitMathText(span.text);
          const content = parts.map((part, k) => (
            <Fragment key={k}>
              {part.kind === "text" ? part.value : <MathFormula latex={part.value} />}
            </Fragment>
          ));
          if (!span.id) return <Fragment key={n}>{content}</Fragment>;
          return (
            <span
              key={n}
              data-span={span.id}
              className={cn(
                "rounded px-0.5 transition-none",
                state?.extracted && "underline decoration-sky-400 decoration-2 underline-offset-4"
              )}
              style={{ backgroundColor: `rgba(255, 200, 0, ${0.45 * (state?.active ?? 0)})` }}
            >
              {content}
            </span>
          );
        })}
      </p>

      {/* Given cards: space is kept for every card, so nothing jumps when one appears. */}
      {script.givens.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {script.givens.map((given) => (
            <div
              key={given.id}
              data-given={given.id}
              style={{ opacity: frame.opacity[given.id] ?? 0 }}
              className="rounded-xl border-2 border-sky-200 bg-sky-50 px-3 py-1.5 text-neutral-800"
            >
              {given.label && <div className="text-[11px] font-bold uppercase tracking-wide text-sky-600">{given.label}</div>}
              <MathFormula latex={`${given.symbol} = ${givenValueLatex(given)}`} className="text-lg" />
            </div>
          ))}
        </div>
      )}

      {/* The board. */}
      <div className={cn("grid gap-4", columns.length === 2 && "grid-cols-2 items-start")}>
        {columns.map((column, c) => (
          <div key={c} className="flex min-w-0 flex-col gap-4">
            {column.map(element)}
          </div>
        ))}
      </div>

      {answerText !== null && (
        <p
          className="flex items-center gap-2 rounded-xl border-2 border-green-200 bg-green-50 px-4 py-2 font-bold text-green-700"
          style={{ opacity: frame.answer?.progress ?? 0 }}
          aria-hidden={!frame.answer}
        >
          <CircleCheck className="h-5 w-5 shrink-0" />
          <MathText text={frame.answer?.text ?? answerText} />
        </p>
      )}

      {/* Overlay: note arrows and flights. */}
      {layout && (
        <svg className="pointer-events-none absolute left-0 top-0 h-full w-full overflow-visible" aria-hidden>
          <defs>
            <marker id="lt-note-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#d97706" />
            </marker>
          </defs>
          {script.notes.map((note) => {
            const opacity = frame.opacity[note.id] ?? 0;
            const card = layout.notes[note.id];
            const to = opacity > 0 && card ? noteTarget(note.id) : null;
            if (!to || !card) return null;
            const from = exitPoint(card, to);
            const end: [number, number] = [lerp(from[0], to[0], opacity), lerp(from[1], to[1], opacity)];
            return (
              <line
                key={note.id}
                x1={from[0]}
                y1={from[1]}
                x2={end[0]}
                y2={end[1]}
                stroke="#d97706"
                strokeWidth={2}
                strokeDasharray="5 4"
                opacity={opacity}
                markerEnd="url(#lt-note-arrow)"
              />
            );
          })}
        </svg>
      )}
      {layout &&
        frame.flights.map((flight) => {
          const from = flightRect(flight.from);
          const to = flightRect(flight.to);
          if (!from || !to) return null;
          const p = flight.progress;
          const [fx, fy] = center(from);
          const [tx, ty] = center(to);
          // A gentle arc instead of a straight line.
          const lift = Math.min(60, Math.hypot(tx - fx, ty - fy) * 0.2) * Math.sin(Math.PI * p);
          const size = lerp(from.h, to.h, p);
          return (
            <div
              key={flight.key}
              aria-hidden
              className="pointer-events-none absolute left-0 top-0 whitespace-nowrap rounded-lg bg-amber-100/90 px-1 text-neutral-900 shadow-sm"
              style={{
                transform: `translate(${lerp(fx, tx, p)}px, ${lerp(fy, ty, p) - lift}px) translate(-50%, -50%)`,
                fontSize: `${Math.max(12, size * 0.72)}px`,
              }}
            >
              {flightContent(flight)}
            </div>
          );
        })}
    </div>
  );
};
