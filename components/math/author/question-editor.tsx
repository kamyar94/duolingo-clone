"use client";

// The question and its givens in author mode. Selecting text in the question creates a given:
// the selection becomes a span of its own, the value and unit are read from it, a symbol is
// suggested, and an Extract step is added. Spans can also be marked as the asked part, for the
// Answer step.
import { useEffect, useRef, useState } from "react";

import { Plus, Trash2, X } from "lucide-react";

import {
  elementIds,
  mergePlainSpans,
  parseQuantity,
  splitSpan,
  suggestSymbol,
  uniqueId,
} from "@/lib/math/solution/authoring";
import type { SolutionScript } from "@/lib/math/solution/types";

import { MathField } from "../math-field";
import { MathFormula } from "../math-text";

import { Field, Panel, Select, SmallButton, TextInput, type Edit } from "./fields";

type Selected = { index: number; start: number; end: number; text: string };

export const QuestionEditor = ({
  script,
  edit,
  statement,
}: {
  script: SolutionScript;
  edit: Edit;
  statement: string;
}) => {
  const boxRef = useRef<HTMLParagraphElement>(null);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Follows the text selection (mouse, pen, touch handles or keyboard).
  useEffect(() => {
    const onChange = () => {
      const box = boxRef.current;
      const selection = window.getSelection();
      if (!box || !selection || selection.rangeCount === 0 || selection.isCollapsed) return setSelected(null);
      const range = selection.getRangeAt(0);
      const spanOf = (node: Node) =>
        (node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element))?.closest<HTMLElement>(
          "[data-span-index]"
        );
      const first = spanOf(range.startContainer);
      const last = spanOf(range.endContainer);
      if (!first || !last || !box.contains(first)) return setSelected(null);
      if (first !== last) {
        setNotice("Select within one piece of the question (the marked parts are separate pieces).");
        return setSelected(null);
      }
      const index = Number(first.dataset.spanIndex);
      const text = script.question[index]?.text ?? "";
      const start = range.startContainer === first.firstChild ? range.startOffset : 0;
      const end = range.endContainer === first.firstChild ? range.endOffset : text.length;
      setNotice(null);
      setSelected({ index, start, end, text: text.slice(Math.min(start, end), Math.max(start, end)) });
    };
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, [script.question]);

  const takeSelection = (asGiven: boolean) => {
    if (!selected) return;
    edit((draft) => {
      const taken = elementIds(draft);
      const quantity = parseQuantity(selected.text);
      const symbol = suggestSymbol(quantity?.unit);
      const split = splitSpan(draft.question, selected.index, selected.start, selected.end, taken, asGiven ? `q-${symbol}` : "q-ask");
      if (!split) return;
      draft.question = split.spans;
      if (!asGiven) return;
      const id = uniqueId(symbol, elementIds(draft));
      draft.givens.push({
        id,
        symbol,
        value: quantity?.value ?? 0,
        ...(quantity?.unit ? { unit: quantity.unit } : {}),
        span: split.id,
      });
      // Extract it after the last Extract step, or first.
      const lastExtract = draft.steps.map((step) => step.kind).lastIndexOf("Extract");
      draft.steps.splice(lastExtract + 1, 0, { kind: "Extract", given: id, duration: 3 });
    });
    window.getSelection()?.removeAllRanges();
    setSelected(null);
  };

  const unmark = (index: number) =>
    edit((draft) => {
      const id = draft.question[index]?.id;
      if (!id) return;
      draft.question[index] = { text: draft.question[index].text };
      draft.question = mergePlainSpans(draft.question);
      for (const given of draft.givens) if (given.span === id) delete given.span;
    });

  const spanOptions = script.question.filter((span) => span.id).map((span) => ({ value: span.id!, label: `${span.id}: ${span.text.slice(0, 30)}` }));

  return (
    <div className="space-y-3">
      <Panel
        title="Question"
        actions={
          <SmallButton
            onClick={() =>
              edit((draft) => {
                draft.question = [{ text: statement }];
                for (const given of draft.givens) delete given.span;
              })
            }
            title="Take the text from the problem again; marks are removed"
          >
            Reset text
          </SmallButton>
        }
      >
        <p className="text-xs text-neutral-500">
          Select a number or a phrase in the text, then make it a given or mark it as the part
          the answer responds to.
        </p>
        <p ref={boxRef} className="select-text whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-mono text-sm leading-relaxed text-neutral-800">
          {script.question.map((span, index) => (
            <span
              key={index}
              data-span-index={index}
              className={span.id ? "rounded bg-amber-100 px-0.5 ring-1 ring-amber-300" : undefined}
              title={span.id}
            >
              {span.text}
            </span>
          ))}
        </p>
        {selected && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-sky-50 px-2 py-1.5 text-xs">
            <span className="font-mono">&ldquo;{selected.text}&rdquo;</span>
            <SmallButton tone="primary" onClick={() => takeSelection(true)}>
              <Plus className="h-3 w-3" /> Make a given
            </SmallButton>
            <SmallButton onClick={() => takeSelection(false)}>Mark as the asked part</SmallButton>
          </div>
        )}
        {notice && <p className="text-xs text-amber-700">{notice}</p>}
        {script.question.some((span) => span.id) && (
          <div className="flex flex-wrap gap-1">
            {script.question.map((span, index) =>
              span.id ? (
                <span key={index} className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800">
                  {span.id}
                  <button type="button" aria-label={`Remove the mark ${span.id}`} onClick={() => unmark(index)}>
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ) : null
            )}
          </div>
        )}
      </Panel>

      <Panel
        title="Givens"
        actions={
          <SmallButton
            onClick={() =>
              edit((draft) => {
                draft.givens.push({ id: uniqueId("x", elementIds(draft)), symbol: "x", value: 0 });
              })
            }
          >
            <Plus className="h-3 w-3" /> Given without a span
          </SmallButton>
        }
      >
        {script.givens.length === 0 && <p className="text-xs text-neutral-400">No givens yet.</p>}
        {script.givens.map((given, n) => (
          <div key={`${given.id}-${n}`} className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-2 sm:grid-cols-[5rem_1fr_6rem_5rem_1fr_auto]">
            <Field label="Id">
              <div className="py-1 font-mono text-xs">{given.id}</div>
            </Field>
            <Field label="Symbol">
              <MathField
                label={`Symbol of ${given.id}`}
                value={given.symbol}
                onChange={(latex) => edit((draft) => void (draft.givens[n].symbol = latex))}
                className="min-h-[36px] text-base"
              />
            </Field>
            <Field label="Value">
              <TextInput
                value={String(given.value)}
                onChange={(value) =>
                  edit((draft) => {
                    const number = Number(value);
                    draft.givens[n].value = value.trim() !== "" && Number.isFinite(number) ? number : value;
                  })
                }
              />
            </Field>
            <Field label="Unit">
              <TextInput
                value={given.unit ?? ""}
                placeholder="m/s"
                onChange={(unit) =>
                  edit((draft) => {
                    if (unit.trim()) draft.givens[n].unit = unit.trim();
                    else delete draft.givens[n].unit;
                  })
                }
              />
            </Field>
            <Field label="Label and span">
              <div className="flex gap-1">
                <TextInput
                  value={given.label ?? ""}
                  placeholder="speed"
                  onChange={(label) =>
                    edit((draft) => {
                      if (label) draft.givens[n].label = label;
                      else delete draft.givens[n].label;
                    })
                  }
                />
                <Select
                  value={given.span}
                  options={spanOptions}
                  empty="no span"
                  onChange={(span) =>
                    edit((draft) => {
                      if (span) draft.givens[n].span = span;
                      else delete draft.givens[n].span;
                    })
                  }
                />
              </div>
            </Field>
            <div className="flex items-end gap-1 pb-1">
              <MathFormula latex={`${given.symbol}=${given.value}`} className="text-sm" />
              <button
                type="button"
                aria-label={`Delete the given ${given.id}`}
                className="text-rose-500"
                onClick={() =>
                  edit((draft) => {
                    draft.givens.splice(n, 1);
                    draft.steps = draft.steps.filter((step) => !(step.kind === "Extract" && step.given === given.id));
                  })
                }
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </Panel>
    </div>
  );
};
