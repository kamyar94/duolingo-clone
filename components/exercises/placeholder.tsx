"use client";

import { useEffect, useState } from "react";

import { Construction } from "lucide-react";

import { cn } from "@/lib/utils";

import type { ExerciseProps } from "./types";

// Stands in for an exercise type whose real component is not built yet. The learner marks the
// answer as right or wrong, which exercises the whole result path (points, hearts, progress).
export const PlaceholderExercise = ({
  challenge,
  status,
  disabled,
  setCheck,
}: ExerciseProps) => {
  const [choice, setChoice] = useState<"right" | "wrong" | null>(null);

  useEffect(() => {
    setCheck(choice ? () => ({ correct: choice === "right" }) : null);
  }, [choice, setCheck]);

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-x-3 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-neutral-600 lg:text-base">
        <Construction className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" />
        <p>
          {challenge.type} exercises are coming soon. For now, say how it went.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {(["right", "wrong"] as const).map((value) => (
          <button
            key={value}
            type="button"
            disabled={disabled || status !== "none"}
            onClick={() => setChoice(value)}
            className={cn(
              "rounded-xl border-2 border-b-4 p-4 font-bold text-neutral-700 hover:bg-black/5 disabled:pointer-events-none",
              choice === value && "border-sky-300 bg-sky-100"
            )}
          >
            {value === "right" ? "I got it right" : "I got it wrong"}
          </button>
        ))}
      </div>
    </div>
  );
};
