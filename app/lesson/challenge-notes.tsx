"use client";

import { useEffect, useRef, useState } from "react";

import { Lightbulb } from "lucide-react";

import { cn } from "@/lib/utils";

type ChallengeHintProps = {
  hint: string;
  answered: boolean;
};

// Closed until asked for. The button goes away once the answer is checked; an open hint stays.
export const ChallengeHint = ({ hint, answered }: ChallengeHintProps) => {
  const [open, setOpen] = useState(false);

  if (open)
    return (
      <div className="mb-6 flex items-start gap-x-3 rounded-xl border-2 border-amber-200 bg-amber-50 px-4 py-3 text-sm text-neutral-700 lg:text-base">
        <Lightbulb className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
        <p>{hint}</p>
      </div>
    );

  if (answered) return null;

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      // Enter here opens the hint only, it does not also check the answer (footer shortcut).
      onKeyDown={(e) => e.stopPropagation()}
      className="mb-6 flex items-center gap-x-2 text-sm font-bold text-sky-500 hover:underline lg:text-base"
    >
      <Lightbulb className="h-4 w-4 lg:h-5 lg:w-5" />
      Show a hint
    </button>
  );
};

type ChallengeExplanationProps = {
  explanation: string;
  status: "correct" | "wrong";
};

// Shown under the options once the answer is checked, scrolled into view on small screens.
export const ChallengeExplanation = ({
  explanation,
  status,
}: ChallengeExplanationProps) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, []);

  return (
    <div
      ref={ref}
      className={cn(
        "mt-6 rounded-xl border-2 px-4 py-3 text-sm text-neutral-700 lg:text-base",
        status === "correct"
          ? "border-green-300 bg-green-50"
          : "border-rose-300 bg-rose-50"
      )}
    >
      <p
        className={cn(
          "mb-1 font-bold",
          status === "correct" ? "text-green-600" : "text-rose-600"
        )}
      >
        Explanation
      </p>
      <p>{explanation}</p>
    </div>
  );
};
