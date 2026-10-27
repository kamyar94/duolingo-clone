"use client";

// "Watch the solution" under a checked math problem. The animated solution opens in a dialog;
// when the check found a wrong line, it opens at the matching step with the learner's line
// beside the correct one. The player is loaded on first use.
import { useState } from "react";

import dynamic from "next/dynamic";
import { Clapperboard, LoaderCircle } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { compileTimeline, stepForWrongLine } from "@/lib/math/solution/timeline";
import type { SolutionScript } from "@/lib/math/solution/types";
import type { StepAnalysis } from "@/lib/math/types";

import { fetchSolution, SolutionApiError } from "./api";
import type { PlayerStart } from "./player";

const SolutionPlayer = dynamic(() => import("./player").then((module) => module.SolutionPlayer), {
  ssr: false,
  loading: () => <p className="py-10 text-center text-sm text-neutral-400">Opening the solution...</p>,
});

type SolutionButtonProps = {
  challengeId: number;
  analysis: StepAnalysis | null;
  /** The learner's lines as graded. */
  lines: string[];
};

export const SolutionButton = ({ challengeId, analysis, lines }: SolutionButtonProps) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{ script: SolutionScript; version: number; start: PlayerStart } | null>(null);

  const openPlayer = async () => {
    if (loaded) return setOpen(true);
    setLoading(true);
    setError(null);
    try {
      const solution = await fetchSolution(challengeId);
      const timeline = compileTimeline(solution.script);
      const wrong = analysis?.firstWrongLine ?? 0;
      const start: PlayerStart =
        wrong > 0
          ? {
              step: stepForWrongLine(timeline, wrong, analysis?.correctedLine),
              learnerLine: lines[wrong - 1] ?? null,
              lineNumber: wrong,
            }
          : { step: 0 };
      setLoaded({ script: solution.script, version: solution.version, start });
      setOpen(true);
    } catch (caught) {
      setError(caught instanceof SolutionApiError ? caught.message : "The solution could not be opened.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={openPlayer}
        disabled={loading}
        className="flex items-center gap-1.5 text-sm font-bold text-sky-600 hover:underline disabled:opacity-60"
      >
        {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Clapperboard className="h-4 w-4" />}
        {analysis && analysis.firstWrongLine > 0 ? "Watch the solution from your mistake" : "Watch the solution"}
      </button>
      {error && <p className="text-xs text-neutral-500">{error}</p>}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[94dvh] max-w-4xl overflow-y-auto p-4 sm:p-6">
          <DialogTitle>{loaded?.script.title ?? "Solution"}</DialogTitle>
          <DialogDescription className="sr-only">
            An animated solution of the problem, step by step.
          </DialogDescription>
          {loaded && (
            <SolutionPlayer
              script={loaded.script}
              start={loaded.start}
              narration={{ kind: "saved", challengeId, version: loaded.version }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};
