"use client";

// The recognised lines as editable math fields (section 5.3). The learner fixes a misread
// symbol here; corrections cost no AI call. After grading, the first wrong line is marked.
import { Plus, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";

import { MathField } from "./math-field";

type RecognizedLinesProps = {
  lines: string[];
  confidences: number[];
  onChange: (lines: string[]) => void;
  readOnly: boolean;
  /** 1-based line the analysis found first wrong, 0 for none. */
  wrongLine: number;
};

export const LOW_CONFIDENCE = 0.6;

export const RecognizedLines = ({
  lines,
  confidences,
  onChange,
  readOnly,
  wrongLine,
}: RecognizedLinesProps) => (
  <ol className="space-y-2">
    {lines.map((line, n) => {
      const unsure = (confidences[n] ?? 1) < LOW_CONFIDENCE;
      const wrong = wrongLine === n + 1;
      return (
        <li key={n} className="flex items-center gap-2">
          <span
            className={cn(
              "w-6 shrink-0 text-right text-sm font-bold text-neutral-400",
              wrong && "text-rose-500"
            )}
          >
            {n + 1}
          </span>
          <MathField
            label={`Line ${n + 1}`}
            value={line}
            readOnly={readOnly}
            className={cn(
              unsure && "border-amber-300 bg-amber-50",
              wrong && "border-rose-300 bg-rose-50"
            )}
            onChange={(latex) => onChange(lines.map((old, k) => (k === n ? latex : old)))}
          />
          {unsure && !wrong && (
            <span className="shrink-0 text-xs font-bold text-amber-600" title="The reader was unsure">
              check
            </span>
          )}
          {!readOnly && (
            <button
              type="button"
              aria-label={`Remove line ${n + 1}`}
              title="Remove this line"
              onClick={() => onChange(lines.filter((_, k) => k !== n))}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-rose-500"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </li>
      );
    })}
    {!readOnly && (
      <li>
        <button
          type="button"
          onClick={() => onChange([...lines, ""])}
          className="ml-8 flex items-center gap-1 text-sm font-bold text-sky-500 hover:underline"
        >
          <Plus className="h-4 w-4" />
          Add a line
        </button>
      </li>
    )}
  </ol>
);
