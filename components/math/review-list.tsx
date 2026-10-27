"use client";

// Stored step analyses for authors: how often each was used, how often the automatic answer
// check disagreed with it, and a switch to mark it as a common mistake of its problem.
import { useState } from "react";

import { Star, TriangleAlert } from "lucide-react";

import type { StepAnalysis } from "@/lib/math/types";
import { cn } from "@/lib/utils";

import { markCommonMistake } from "./api";
import { MathFormula, MathText } from "./math-text";

export type ReviewRow = {
  id: number;
  question: string;
  commonMistake: boolean;
  verdict: StepAnalysis | null;
  lines: string[];
  attempts: number;
  disagreements: number;
  model: string | null;
  updatedAt: string;
};

export const ReviewList = ({ rows }: { rows: ReviewRow[] }) => {
  const [marks, setMarks] = useState<Record<number, boolean>>(() =>
    Object.fromEntries(rows.map((row) => [row.id, row.commonMistake]))
  );
  const [busy, setBusy] = useState<number | null>(null);

  const toggle = async (id: number) => {
    setBusy(id);
    try {
      const row = await markCommonMistake(id, !marks[id]);
      setMarks((current) => ({ ...current, [id]: row.commonMistake }));
    } finally {
      setBusy(null);
    }
  };

  if (!rows.length)
    return <p className="text-muted-foreground">No analyses are stored yet.</p>;

  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.id} className="space-y-2 rounded-xl border-2 border-slate-200 bg-white p-4 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <MathText text={row.question} className="font-bold text-neutral-700" />
            <button
              type="button"
              disabled={busy === row.id}
              onClick={() => void toggle(row.id)}
              className={cn(
                "flex items-center gap-1 rounded-lg border-2 px-2 py-1 text-xs font-bold",
                marks[row.id]
                  ? "border-amber-300 bg-amber-50 text-amber-700"
                  : "border-slate-200 text-neutral-500"
              )}
            >
              <Star className={cn("h-3.5 w-3.5", marks[row.id] && "fill-amber-400")} />
              {marks[row.id] ? "Common mistake" : "Mark as common mistake"}
            </button>
          </div>
          <ol className="list-inside list-decimal text-neutral-600">
            {row.lines.map((line, n) => (
              <li
                key={n}
                className={cn(row.verdict?.firstWrongLine === n + 1 && "font-bold text-rose-600")}
              >
                <MathFormula latex={line} />
              </li>
            ))}
          </ol>
          {row.verdict && (
            <div className="text-neutral-700">
              <p className="text-xs font-bold uppercase text-neutral-400">
                {row.verdict.mistakeType} · final answer{" "}
                {row.verdict.finalAnswerCorrect ? "right" : "wrong"}
              </p>
              <MathText text={row.verdict.explanation} />
            </div>
          )}
          <p className="flex flex-wrap items-center gap-3 text-xs text-neutral-500">
            <span>
              Used {row.attempts} {row.attempts === 1 ? "time" : "times"}
            </span>
            {row.disagreements > 0 && (
              <span className="flex items-center gap-1 text-amber-700">
                <TriangleAlert className="h-3.5 w-3.5" />
                The answer check disagreed {row.disagreements}{" "}
                {row.disagreements === 1 ? "time" : "times"}
              </span>
            )}
            {row.model && <span>{row.model}</span>}
            <span>{new Date(row.updatedAt).toLocaleString()}</span>
          </p>
        </li>
      ))}
    </ul>
  );
};
