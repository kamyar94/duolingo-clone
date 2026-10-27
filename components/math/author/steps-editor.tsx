"use client";

// The steps of a solution in author mode: kind, duration, narration and what each step works
// on, in order. A step can be moved, removed, or used as the start of the preview.
import { useState } from "react";

import { ArrowDown, ArrowUp, Play, Plus, Trash2 } from "lucide-react";

import { newStep, stateBefore } from "@/lib/math/solution/authoring";
import { termForValue, termIds } from "@/lib/math/solution/terms";
import { STEP_KINDS, type SolutionScript, type Step, type StepKind } from "@/lib/math/solution/types";

import { Checklist, Field, NumberInput, Select, SmallButton, TextInput, type Edit } from "./fields";

const KIND_HELP: Record<StepKind, string> = {
  Extract: "A span of the question lights up and becomes a given.",
  Relate: "Givens move into an equation that connects them.",
  Substitute: "Givens fly into the matching terms of a new state.",
  Transform: "One state of an equation becomes the next.",
  Plot: "Graph items are drawn.",
  Construct: "A figure gains shapes, or a table gains rows.",
  Annotate: "Notes appear, with arrows to what they explain.",
  Answer: "The result is boxed and checked against the question.",
};

export const StepsEditor = ({
  script,
  edit,
  onPreview,
}: {
  script: SolutionScript;
  edit: Edit;
  onPreview: (step: number) => void;
}) => {
  const [kind, setKind] = useState<StepKind>("Transform");
  const ids = (list: { id: string }[]) => list.map((entry) => ({ value: entry.id }));
  const statesOf = (equation: string) =>
    script.equations.find((e) => e.id === equation)?.states.map((state) => ({ value: state.id })) ?? [];
  const stateLatex = (equation: string, state: string | null | undefined) =>
    script.equations.find((e) => e.id === equation)?.states.find((s) => s.id === state)?.latex ?? "";

  const change = (n: number, patch: Record<string, unknown>) =>
    edit((draft) => {
      const step = draft.steps[n] as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined || (Array.isArray(value) && value.length === 0 && key === "hide")) delete step[key];
        else step[key] = value;
      }
    });

  const fields = (step: Step, n: number) => {
    switch (step.kind) {
      case "Extract":
        return (
          <Field label="Given">
            <Select value={step.given} options={ids(script.givens)} onChange={(given) => change(n, { given })} />
          </Field>
        );
      case "Relate":
        return (
          <>
            <Field label="Equation">
              <Select value={step.equation} options={ids(script.equations)} onChange={(equation) => change(n, { equation, state: undefined })} />
            </Field>
            <Field label="State">
              <Select value={step.state} options={statesOf(step.equation)} empty="first" onChange={(state) => change(n, { state: state || undefined })} />
            </Field>
            <Field label="Givens that fly into their terms" className="col-span-2">
              <Checklist value={step.givens ?? []} options={ids(script.givens)} onChange={(givens) => change(n, { givens: givens.length ? givens : undefined })} />
            </Field>
          </>
        );
      case "Transform":
      case "Substitute":
        return (
          <>
            <Field label="Equation">
              <Select value={step.equation} options={ids(script.equations)} onChange={(equation) => change(n, { equation })} />
            </Field>
            <Field label="To state">
              <Select value={step.to} options={statesOf(step.equation)} onChange={(to) => change(n, { to })} />
            </Field>
            {step.kind === "Substitute" && (
              <Field label="Given into term" className="col-span-2">
                <div className="space-y-1">
                  {step.pairs.map((pair, k) => (
                    <div key={k} className="flex gap-1">
                      <Select
                        value={pair.given}
                        options={ids(script.givens)}
                        onChange={(given) => change(n, { pairs: step.pairs.map((p, j) => (j === k ? { ...p, given } : p)) })}
                      />
                      <Select
                        value={pair.term}
                        options={termIds(stateLatex(step.equation, step.to)).map((id) => ({ value: id }))}
                        onChange={(term) => change(n, { pairs: step.pairs.map((p, j) => (j === k ? { ...p, term } : p)) })}
                      />
                      <button type="button" aria-label="Remove the pair" className="text-rose-500" onClick={() => change(n, { pairs: step.pairs.filter((_, j) => j !== k) })}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                  <div className="flex gap-1">
                    <SmallButton onClick={() => change(n, { pairs: [...step.pairs, { given: script.givens[0]?.id ?? "", term: "" }] })}>
                      <Plus className="h-3 w-3" /> Pair
                    </SmallButton>
                    <SmallButton
                      onClick={() => {
                        const latex = stateLatex(step.equation, step.to);
                        const pairs = script.givens
                          .map((given) => ({ given: given.id, term: termForValue(latex, given.value, given.unit) ?? "" }))
                          .filter((pair) => pair.term);
                        change(n, { pairs });
                      }}
                      title="Pair each given with the term that shows its value"
                    >
                      Find pairs
                    </SmallButton>
                  </div>
                </div>
              </Field>
            )}
            {(step.links?.length || step.unlinks?.length) && (
              <p className="col-span-2 text-[11px] text-neutral-500">
                {step.links?.length ?? 0} terms linked and {step.unlinks?.length ?? 0} unlinked by hand (see Equations).
              </p>
            )}
          </>
        );
      case "Plot": {
        const graph = script.graphs.find((g) => g.id === step.graph);
        return (
          <>
            <Field label="Graph">
              <Select value={step.graph} options={ids(script.graphs)} onChange={(graphId) => change(n, { graph: graphId, items: [] })} />
            </Field>
            <Field label="Items, one after another" className="col-span-2">
              <Checklist value={step.items} options={ids(graph?.items ?? [])} onChange={(items) => change(n, { items })} />
            </Field>
          </>
        );
      }
      case "Construct": {
        if (step.table !== undefined) {
          const table = script.tables.find((t) => t.id === step.table);
          return (
            <>
              <Field label="Table">
                <Select value={step.table} options={ids(script.tables)} onChange={(tableId) => change(n, { table: tableId, rows: [] })} />
              </Field>
              <Field label="Rows" className="col-span-2">
                <Checklist
                  value={(step.rows ?? []).map(String)}
                  options={(table?.rows ?? []).map((_, r) => ({ value: String(r), label: `row ${r + 1}` }))}
                  onChange={(rows) => change(n, { rows: rows.map(Number) })}
                />
              </Field>
            </>
          );
        }
        const figure = script.figures.find((f) => f.id === step.figure);
        return (
          <>
            <Field label="Figure">
              <Select value={step.figure} options={ids(script.figures)} onChange={(figureId) => change(n, { figure: figureId, shapes: [] })} />
            </Field>
            <Field label="Shapes, one after another" className="col-span-2">
              <Checklist value={step.shapes ?? []} options={ids(figure?.shapes ?? [])} onChange={(shapes) => change(n, { shapes })} />
            </Field>
          </>
        );
      }
      case "Annotate":
        return (
          <Field label="Notes" className="col-span-2">
            <Checklist value={step.notes} options={ids(script.notes)} onChange={(notes) => change(n, { notes })} />
          </Field>
        );
      case "Answer": {
        const equation = step.equation ?? script.equations[script.equations.length - 1]?.id ?? "";
        const state = stateBefore(script, n, equation);
        return (
          <>
            <Field label="Equation">
              <Select value={step.equation} options={ids(script.equations)} empty="last shown" onChange={(value) => change(n, { equation: value || undefined, term: undefined })} />
            </Field>
            <Field label="Boxed term">
              <Select
                value={step.term}
                options={termIds(stateLatex(equation, state)).map((id) => ({ value: id }))}
                empty="whole equation"
                onChange={(term) => change(n, { term: term || undefined })}
              />
            </Field>
            <Field label="Check against the question">
              <TextInput value={step.text ?? ""} onChange={(text) => change(n, { text: text || undefined })} />
            </Field>
            <Field label="Asked part">
              <Select
                value={step.span}
                options={script.question.filter((span) => span.id).map((span) => ({ value: span.id! }))}
                empty="none"
                onChange={(span) => change(n, { span: span || undefined })}
              />
            </Field>
          </>
        );
      }
    }
  };

  return (
    <div className="space-y-2">
      {script.steps.length === 0 && <p className="text-sm text-neutral-400">No steps yet.</p>}
      {script.steps.map((step, n) => (
        <div key={n} className="rounded-xl border-2 border-slate-200 bg-white p-2">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-bold">{n + 1}</span>
            <select
              value={step.kind}
              onChange={(event) =>
                edit((draft) => {
                  const next = newStep(draft, event.target.value as StepKind);
                  draft.steps[n] = { ...next, duration: step.duration, ...(step.narration ? { narration: step.narration } : {}) };
                })
              }
              className="rounded-lg border-2 border-slate-200 px-1 py-0.5 text-sm font-bold"
            >
              {STEP_KINDS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            <span className="hidden text-xs text-neutral-400 md:inline">{KIND_HELP[step.kind]}</span>
            <div className="ml-auto flex gap-1">
              <SmallButton onClick={() => onPreview(n)} title="Play the preview from this step">
                <Play className="h-3 w-3" />
              </SmallButton>
              <SmallButton
                disabled={n === 0}
                onClick={() => edit((draft) => void draft.steps.splice(n - 1, 2, draft.steps[n], draft.steps[n - 1]))}
                title="Move up"
              >
                <ArrowUp className="h-3 w-3" />
              </SmallButton>
              <SmallButton
                disabled={n === script.steps.length - 1}
                onClick={() => edit((draft) => void draft.steps.splice(n, 2, draft.steps[n + 1], draft.steps[n]))}
                title="Move down"
              >
                <ArrowDown className="h-3 w-3" />
              </SmallButton>
              <SmallButton tone="danger" onClick={() => edit((draft) => void draft.steps.splice(n, 1))} title="Delete">
                <Trash2 className="h-3 w-3" />
              </SmallButton>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {fields(step, n)}
            <Field label="Seconds">
              <NumberInput value={step.duration} onChange={(duration) => change(n, { duration })} />
            </Field>
            <Field label="Fade out (ids)">
              <TextInput
                value={(step.hide ?? []).join(", ")}
                placeholder="none"
                onChange={(text) =>
                  change(n, {
                    hide: text
                      .split(",")
                      .map((id) => id.trim())
                      .filter(Boolean),
                  })
                }
              />
            </Field>
            <Field label="Narration" className="col-span-2 sm:col-span-4">
              <textarea
                value={step.narration ?? ""}
                rows={2}
                maxLength={1000}
                onChange={(event) => change(n, { narration: event.target.value || undefined })}
                className="w-full resize-y rounded-lg border-2 border-slate-200 px-2 py-1 text-sm"
              />
            </Field>
          </div>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <select value={kind} onChange={(event) => setKind(event.target.value as StepKind)} className="rounded-lg border-2 border-slate-200 px-1 py-1 text-sm">
          {STEP_KINDS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <SmallButton tone="primary" onClick={() => edit((draft) => void draft.steps.push(newStep(draft, kind)))}>
          <Plus className="h-3 w-3" /> Step
        </SmallButton>
      </div>
    </div>
  );
};
