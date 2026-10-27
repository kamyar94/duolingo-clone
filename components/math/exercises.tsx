"use client";

// The math track's entry in the exercise registry (components/exercises/registry.ts).
// next/dynamic keeps the ink canvas, KaTeX and MathLive out of the lesson bundle until a math
// problem opens; the canvas needs the browser, so it is not rendered on the server.
import dynamic from "next/dynamic";

import type { ExerciseRegistry } from "@/components/exercises/types";

const MathExercise = dynamic(
  () => import("./math-exercise").then((module) => module.MathExercise),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[52dvh] min-h-[280px] items-center justify-center rounded-xl border-2 border-slate-200 bg-slate-50 text-sm text-neutral-400">
        Opening the writing page...
      </div>
    ),
  }
);

export const mathExercises: ExerciseRegistry = {
  // The exercise shows the statement itself, beside or above the canvas.
  MATH: { component: MathExercise, layout: "wide", title: () => null },
};
