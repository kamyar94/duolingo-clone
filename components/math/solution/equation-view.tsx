"use client";

// One equation of a solution script. Every state is rendered once with KaTeX into the same
// grid cell; the frame decides which one shows. During a transform, terms that persist move
// from their place in the old state to their place in the new one (measured from the KaTeX
// output), new terms fade in and removed terms fade out. The moving copies are full renders of
// the old and new state with only the moving terms visible, so each keeps its exact size and
// font from its own context.
import { useLayoutEffect, useMemo, useRef } from "react";

import { normalizeLatex, parseTerms } from "@/lib/math/solution/terms";
import type { EquationFrame } from "@/lib/math/solution/timeline";
import type { Equation } from "@/lib/math/solution/types";
import { cn } from "@/lib/utils";

import { lerp, type Rect } from "./geometry";
import styles from "./player.module.css";
import { renderScriptLatex, termIdOf } from "./script-katex";

type EquationViewProps = {
  equation: Equation;
  frame: EquationFrame;
  opacity: number;
  /** Term rectangles per state, measured by the stage (any common origin). */
  terms: Record<string, Record<string, Rect>> | undefined;
  /** Rectangles of the slot and of each state, same origin as terms. */
  slot: Rect | undefined;
  layers: Record<string, Rect> | undefined;
};

const ancestorTerm = (element: Element, stop: Element, ids: Set<string>) => {
  for (let node = element.parentElement; node && node !== stop; node = node.parentElement) {
    if (node.classList.contains("lt-term")) {
      const id = termIdOf(node);
      if (id && ids.has(id)) return true;
    }
  }
  return false;
};

const setStyle = (element: HTMLElement, visibility: string, transform = "", opacity = "") => {
  if (element.style.visibility !== visibility) element.style.visibility = visibility;
  if (element.style.transform !== transform) element.style.transform = transform;
  if (element.style.opacity !== opacity) element.style.opacity = opacity;
};

export const EquationView = ({ equation, frame, opacity, terms, slot, layers }: EquationViewProps) => {
  const slotRef = useRef<HTMLDivElement>(null);
  const html = useMemo(
    () => Object.fromEntries(equation.states.map((state) => [state.id, renderScriptLatex(state.latex)])),
    [equation]
  );
  // Normalised content of each term, to tell a pure move from a move with a change.
  const bodies = useMemo(
    () =>
      Object.fromEntries(
        equation.states.map((state) => [
          state.id,
          Object.fromEntries(parseTerms(state.latex).terms.map((term) => [term.id, normalizeLatex(term.body)])),
        ])
      ),
    [equation]
  );

  const { transition } = frame;

  useLayoutEffect(() => {
    const root = slotRef.current;
    if (!root) return;
    const p = transition?.progress ?? 0;
    const pairs = transition?.pairs ?? [];
    const fromIds = new Set(pairs.map((pair) => pair[0]));
    const toIds = new Set(pairs.map((pair) => pair[1]));
    const target = transition ? transition.to : frame.state;
    const hidden = new Set(frame.hidden);

    // Plain layers: one per state.
    for (const layer of root.querySelectorAll<HTMLElement>('[data-layer="rest"]')) {
      const state = layer.dataset.state ?? "";
      const layerOpacity = transition
        ? state === transition.from
          ? 1 - p
          : state === transition.to
            ? p
            : 0
        : state === frame.state
          ? 1
          : 0;
      layer.style.opacity = String(layerOpacity);
      layer.setAttribute("aria-hidden", layerOpacity > 0.5 ? "false" : "true");
      for (const element of layer.querySelectorAll<HTMLElement>(".lt-term")) {
        const id = termIdOf(element) ?? "";
        const moving =
          !!transition &&
          ((state === transition.from && fromIds.has(id)) || (state === transition.to && toIds.has(id)));
        const waiting = state === target && hidden.has(id);
        setStyle(element, moving || waiting ? "hidden" : "");
      }
    }

    // Moving copies.
    const fromLayer = root.querySelector<HTMLElement>('[data-layer="from"]');
    const toLayer = root.querySelector<HTMLElement>('[data-layer="to"]');
    for (const layer of [fromLayer, toLayer])
      for (const element of layer?.querySelectorAll<HTMLElement>(".lt-term") ?? []) setStyle(element, "");
    if (!transition || !fromLayer || !toLayer || !terms) return;
    const rectsA = terms[transition.from] ?? {};
    const rectsB = terms[transition.to] ?? {};
    const usedA = new Set<string>();
    for (const [a, b] of pairs) {
      const ra = rectsA[a];
      const rb = rectsB[b];
      const elementA = fromLayer.querySelector<HTMLElement>(`.lt-term-${a}`);
      const elementB = toLayer.querySelector<HTMLElement>(`.lt-term-${b}`);
      if (!ra || !rb || !elementA || !elementB) continue;
      // Terms inside a moving term ride along with it.
      const carriedA = ancestorTerm(elementA, fromLayer, fromIds);
      const carriedB = ancestorTerm(elementB, toLayer, toIds);
      if (carriedA && carriedB) continue;
      const same = bodies[transition.from]?.[a] === bodies[transition.to]?.[b];
      const sx = ra.w ? rb.w / ra.w : 1;
      const sy = ra.h ? rb.h / ra.h : 1;
      if (!carriedA && !usedA.has(a)) {
        usedA.add(a);
        setStyle(
          elementA,
          "visible",
          `translate(${(rb.x - ra.x) * p}px, ${(rb.y - ra.y) * p}px) scale(${lerp(1, sx, p)}, ${lerp(1, sy, p)})`,
          same ? "1" : String(1 - p)
        );
        if (same || carriedB) continue;
      }
      if (carriedB) continue;
      setStyle(
        elementB,
        "visible",
        `translate(${(ra.x - rb.x) * (1 - p)}px, ${(ra.y - rb.y) * (1 - p)}px) scale(${lerp(1 / sx, 1, p)}, ${lerp(1 / sy, 1, p)})`,
        String(p)
      );
    }
  });

  // The answer box around a term, or around the whole state.
  const box = frame.box;
  const boxRect = (() => {
    if (!box || !slot) return null;
    const rect = box.term ? terms?.[frame.state]?.[box.term] : layers?.[frame.state];
    if (!rect) return null;
    return { left: rect.x - slot.x - 6, top: rect.y - slot.y - 4, width: rect.w + 12, height: rect.h + 8 };
  })();

  return (
    <div
      ref={slotRef}
      data-eq-slot={equation.id}
      className={cn(styles.slot, "relative px-2 py-3 text-xl text-neutral-800 lg:text-2xl")}
      style={{ opacity }}
    >
      {equation.states.map((state) => (
        <div
          key={state.id}
          data-layer="rest"
          data-state={state.id}
          className="opacity-0"
          dangerouslySetInnerHTML={{ __html: html[state.id] }}
        />
      ))}
      {transition && (
        <>
          <div
            key={`from-${transition.from}`}
            data-layer="from"
            aria-hidden
            className={styles.movers}
            dangerouslySetInnerHTML={{ __html: html[transition.from] }}
          />
          <div
            key={`to-${transition.to}`}
            data-layer="to"
            aria-hidden
            className={styles.movers}
            dangerouslySetInnerHTML={{ __html: html[transition.to] }}
          />
        </>
      )}
      {box && boxRect && (
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-lg border-[3px] border-green-500 bg-green-100/40"
          style={{
            ...boxRect,
            opacity: box.progress,
            transform: `scale(${lerp(1.25, 1, box.progress)})`,
            gridArea: "auto",
          }}
        />
      )}
    </div>
  );
};
