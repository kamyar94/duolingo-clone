"use client";

// The final answer of a math problem (section 5.1): tap a choice, type in a math field, or
// mark the last line of the writing as the answer.
import { cn } from "@/lib/utils";
import type { ClientMathPayload } from "@/lib/math/types";

import { MathField } from "./math-field";
import { MathFormula, MathText } from "./math-text";
import type { AnswerState } from "./use-math-draft";

type AnswerBoxProps = {
  spec: ClientMathPayload["answer"];
  answer: AnswerState;
  onChange: (answer: AnswerState) => void;
  /** The last recognised line, when there is one. */
  lastLine: string | null;
  readOnly: boolean;
};

export const AnswerBox = ({ spec, answer, onChange, lastLine, readOnly }: AnswerBoxProps) => {
  if (spec.kind === "choice") {
    const choices = spec.choices ?? [];
    const toggle = (index: number) => {
      if (readOnly) return;
      const picked = answer.choices.includes(index);
      const next = spec.multiple
        ? picked
          ? answer.choices.filter((n) => n !== index)
          : [...answer.choices, index].sort((a, b) => a - b)
        : [index];
      onChange({ ...answer, choices: next });
    };
    return (
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-bold text-neutral-600">
          {spec.multiple ? "Pick every right answer" : "Pick the answer"}
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {choices.map((choice, index) => {
            const picked = answer.choices.includes(index);
            return (
              <button
                key={index}
                type="button"
                role={spec.multiple ? "checkbox" : "radio"}
                aria-checked={picked}
                disabled={readOnly}
                onClick={() => toggle(index)}
                className={cn(
                  "flex items-center gap-3 rounded-xl border-2 border-b-4 px-4 py-3 text-left text-neutral-700 hover:bg-black/5 disabled:pointer-events-none",
                  picked && "border-sky-300 bg-sky-100 hover:bg-sky-100"
                )}
              >
                <span
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 text-sm font-bold text-neutral-400",
                    picked && "border-sky-300 text-sky-500"
                  )}
                >
                  {index + 1}
                </span>
                <MathText text={choice} className="text-sm lg:text-base" />
              </button>
            );
          })}
        </div>
      </fieldset>
    );
  }

  const freeform = spec.kind === "freeform";
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-bold text-neutral-600">
          {freeform ? "Your answer (optional)" : "Your final answer"}
          {spec.unit && (
            <span className="ml-2 font-normal text-neutral-500">
              in <code className="rounded bg-slate-100 px-1">{spec.unit}</code> or any unit of
              the same kind
            </span>
          )}
        </p>
        <div className="flex rounded-lg border-2 border-slate-200 p-0.5 text-xs font-bold">
          {(
            [
              ["type", "Type it"],
              ["last-line", "Last line is my answer"],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              disabled={readOnly}
              aria-pressed={answer.mode === mode}
              onClick={() => onChange({ ...answer, mode })}
              className={cn(
                "rounded-md px-2 py-1 text-neutral-500",
                answer.mode === mode && "bg-sky-100 text-sky-600"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {answer.mode === "type" ? (
        <MathField
          label="Your final answer"
          value={answer.latex}
          readOnly={readOnly}
          // MathLive reads the placeholder as LaTeX, so words go in \text.
          placeholder={freeform ? "\\text{optional}" : "\\text{your answer}"}
          onChange={(latex) => onChange({ ...answer, latex })}
        />
      ) : (
        <div className="min-h-[44px] rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-neutral-600">
          {lastLine ? (
            <MathFormula latex={lastLine} />
          ) : (
            <span className="text-sm">
              The last line you write is taken as your answer once the writing is read.
            </span>
          )}
        </div>
      )}
    </div>
  );
};
