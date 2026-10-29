"use client";

import { Eye } from "lucide-react";

import type { RevealedAnswer } from "@/actions/reveal-answer";
import { MathFormula, MathText } from "@/components/math/math-text";
import { SolutionButton } from "@/components/math/solution/solution-button";

type RevealedAnswerCardProps = {
  challengeId: number;
  answer: RevealedAnswer | null;
  /** True when this challenge already came back once for review. */
  again: boolean;
};

// The answer shown after "I don't know", with a note that the question comes back at the end
// of the lesson, and the animated solution when the problem has one.
export const RevealedAnswerCard = ({ challengeId, answer, again }: RevealedAnswerCardProps) => (
  <div className="mb-6 space-y-2 rounded-xl border-2 border-sky-300 bg-sky-50 px-4 py-3 text-sm text-neutral-700 lg:text-base">
    <p className="flex items-center gap-x-2 font-bold text-sky-600">
      <Eye className="h-4 w-4 lg:h-5 lg:w-5" />
      The answer
    </p>
    {!answer?.value ? (
      <p>There is no stored answer for this question; the explanation below shows how to solve it.</p>
    ) : answer.kind === "latex" ? (
      <MathFormula latex={answer.value} display className="text-lg" />
    ) : answer.kind === "code" ? (
      <pre className="overflow-x-auto rounded-lg bg-white px-3 py-2 font-mono text-sm">{answer.value}</pre>
    ) : (
      <MathText text={answer.value} />
    )}
    {answer?.solution && <SolutionButton challengeId={challengeId} analysis={null} lines={[]} />}
    <p className="text-xs text-neutral-500">
      {again
        ? "Marked for review: it is listed at the end of the lesson."
        : "Marked for review: this question comes back at the end of the lesson."}
    </p>
  </div>
);
