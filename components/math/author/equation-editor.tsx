"use client";

// Equations in author mode. Each state is typed in a MathLive field; its terms are tagged
// automatically by matching identical subexpressions of the state before. Between two states,
// the matching is shown in colour, and a click on a term of the upper state, then one of the
// lower state, links or unlinks them by hand.
import { useLayoutEffect, useMemo, useRef, useState } from "react";

import { Plus, Trash2 } from "lucide-react";

import {
  elementIds,
  retagStates,
  stepInto,
  toggleLink,
  uniqueId,
} from "@/lib/math/solution/authoring";
import { parseTerms, stripTerms, termPairs } from "@/lib/math/solution/terms";
import type { Equation, SolutionScript, SubstituteStep, TransformStep } from "@/lib/math/solution/types";

import { MathField } from "../math-field";
import styles from "../solution/player.module.css";
import { renderScriptLatex, termIdOf } from "../solution/script-katex";

import { Panel, SmallButton, type Edit } from "./fields";

const hue = (n: number) => `hsl(${(n * 67 + 190) % 360} 80% 84%)`;

const TermMatcher = ({
  script,
  equation,
  index,
  edit,
}: {
  script: SolutionScript;
  equation: Equation;
  index: number;
  edit: Edit;
}) => {
  const a = equation.states[index - 1];
  const b = equation.states[index];
  const stepIndex = stepInto(script, equation.id, b.id);
  const step = stepIndex >= 0 ? (script.steps[stepIndex] as TransformStep | SubstituteStep) : null;
  const exclude = step?.kind === "Substitute" ? step.pairs.map((pair) => pair.term) : [];
  const pairs = useMemo(
    () =>
      termPairs(a.latex, b.latex, {
        links: step?.links,
        unlinks: step?.unlinks,
        exclude: step?.kind === "Substitute" ? step.pairs.map((pair) => pair.term) : [],
      }),
    [a.latex, b.latex, step]
  );
  const [picked, setPicked] = useState<string | null>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const paint = (box: HTMLDivElement | null, side: 0 | 1) => {
      for (const element of box?.querySelectorAll<HTMLElement>(".lt-term") ?? []) {
        const id = termIdOf(element) ?? "";
        const pair = pairs.findIndex((p) => p[side] === id);
        element.style.cursor = "pointer";
        element.style.borderRadius = "4px";
        element.style.background = pair >= 0 ? hue(pair) : "";
        element.style.outline =
          side === 0 && picked === id
            ? "2px solid #0284c7"
            : pair >= 0
              ? ""
              : side === 1 && exclude.includes(id)
                ? "1px dashed #d97706"
                : `1px dashed ${side === 0 ? "#e11d48" : "#16a34a"}`;
        element.title = `${id}${pair >= 0 ? ` (moves ${side === 0 ? "down" : "here"})` : side === 0 ? " (fades out)" : exclude.includes(id) ? " (filled by a given)" : " (fades in)"}`;
      }
    };
    paint(topRef.current, 0);
    paint(bottomRef.current, 1);
  });

  const termAt = (target: EventTarget) => {
    const element = (target as Element).closest?.(".lt-term");
    return element ? termIdOf(element) : null;
  };

  return (
    <div className="space-y-1 rounded-lg bg-slate-50 p-2">
      <div className="flex items-center justify-between text-[11px] text-neutral-500">
        <span>
          {a.id} to {b.id}: {pairs.length} terms move. Click a term above, then one below, to link or unlink them.
        </span>
        {!step && (
          <SmallButton
            onClick={() =>
              edit((draft) => {
                draft.steps.push({ kind: "Transform", equation: equation.id, to: b.id, duration: 3 });
              })
            }
          >
            Add a Transform step
          </SmallButton>
        )}
      </div>
      <div
        ref={topRef}
        className={styles.stage}
        onClick={(event) => {
          const id = termAt(event.target);
          setPicked(id && id !== picked ? id : null);
        }}
        dangerouslySetInnerHTML={{ __html: renderScriptLatex(a.latex) }}
      />
      <div
        ref={bottomRef}
        className={styles.stage}
        onClick={(event) => {
          const id = termAt(event.target);
          if (!id || !picked || !step) return;
          edit((draft) => {
            const target = draft.steps[stepIndex] as TransformStep | SubstituteStep;
            const filled = target.kind === "Substitute" ? target.pairs.map((pair) => pair.term) : [];
            const next = toggleLink(target, picked, id, a.latex, b.latex, filled);
            if (next.links) target.links = next.links;
            else delete target.links;
            if (next.unlinks) target.unlinks = next.unlinks;
            else delete target.unlinks;
          });
          setPicked(null);
        }}
        dangerouslySetInnerHTML={{ __html: renderScriptLatex(b.latex) }}
      />
    </div>
  );
};

export const EquationEditor = ({ script, edit }: { script: SolutionScript; edit: Edit }) => {
  const addEquation = () =>
    edit((draft) => {
      const id = uniqueId("eq", elementIds(draft));
      draft.equations.push({ id, states: [{ id: "s1", latex: "" }] });
      draft.steps.push({ kind: "Relate", equation: id, state: "s1", duration: 3 });
    });

  const addState = (n: number) =>
    edit((draft) => {
      const equation = draft.equations[n];
      const taken = new Set(equation.states.map((state) => state.id));
      const id = uniqueId(`s${equation.states.length + 1}`, taken);
      const last = equation.states[equation.states.length - 1];
      equation.states.push({ id, latex: last?.latex ?? "" });
      draft.steps.push({ kind: "Transform", equation: equation.id, to: id, duration: 3 });
    });

  return (
    <div className="space-y-3">
      {script.equations.map((equation, n) => (
        <Panel
          key={equation.id}
          title={`Equation ${equation.id}`}
          actions={
            <>
              <SmallButton onClick={() => addState(n)}>
                <Plus className="h-3 w-3" /> State
              </SmallButton>
              <SmallButton
                tone="danger"
                onClick={() =>
                  edit((draft) => {
                    draft.equations.splice(n, 1);
                    draft.steps = draft.steps.filter((step) => !("equation" in step && step.equation === equation.id));
                  })
                }
              >
                <Trash2 className="h-3 w-3" /> Equation
              </SmallButton>
            </>
          }
        >
          {equation.states.map((state, k) => (
            <div key={state.id} className="space-y-1">
              {k > 0 && <TermMatcher script={script} equation={equation} index={k} edit={edit} />}
              <div className="flex items-center gap-2">
                <span className="w-10 shrink-0 font-mono text-xs text-neutral-500">{state.id}</span>
                <MathField
                  label={`State ${state.id} of ${equation.id}`}
                  value={stripTerms(state.latex)}
                  onChange={(typed) =>
                    edit((draft) => {
                      const states = draft.equations[n].states;
                      const latex = retagStates(
                        states.map((s) => s.latex),
                        k,
                        typed
                      );
                      states.forEach((s, j) => (s.latex = latex[j]));
                    })
                  }
                  className="min-h-[40px] flex-1 text-lg"
                />
                <span className="hidden w-24 shrink-0 truncate text-[10px] text-neutral-400 sm:block" title={parseTerms(state.latex).terms.map((t) => t.id).join(", ")}>
                  {parseTerms(state.latex).terms.length} terms
                </span>
                {equation.states.length > 1 && (
                  <button
                    type="button"
                    aria-label={`Delete state ${state.id}`}
                    className="text-rose-500"
                    onClick={() =>
                      edit((draft) => {
                        draft.equations[n].states.splice(k, 1);
                        draft.steps = draft.steps.filter(
                          (step) =>
                            !(
                              "equation" in step &&
                              step.equation === equation.id &&
                              ((("to" in step) && step.to === state.id) || (step.kind === "Relate" && step.state === state.id))
                            )
                        );
                      })
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </Panel>
      ))}
      <SmallButton tone="primary" onClick={addEquation}>
        <Plus className="h-3 w-3" /> Equation
      </SmallButton>
    </div>
  );
};
