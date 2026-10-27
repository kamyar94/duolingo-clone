// The coding track's entries in the exercise registry (components/exercises/registry.ts).
// next/dynamic keeps the exercise components out of the lesson bundle until a coding exercise
// opens; the CodeMirror editor itself loads later still, when an editor mounts.
import dynamic from "next/dynamic";

import type { ExerciseProps, ExerciseRegistry } from "@/components/exercises/types";

const Loading = () => (
  <div className="h-48 w-full animate-pulse rounded-xl bg-slate-100" aria-label="Loading exercise" />
);

const CodeProgram = dynamic<ExerciseProps>(
  () => import("./code-program").then((m) => m.CodeProgramExercise),
  { loading: Loading }
);
const CodeOutput = dynamic<ExerciseProps>(
  () => import("./code-output").then((m) => m.CodeOutputExercise),
  { loading: Loading }
);
const CodeFill = dynamic<ExerciseProps>(
  () => import("./code-fill").then((m) => m.CodeFillExercise),
  { loading: Loading }
);
const CodeOrder = dynamic<ExerciseProps>(
  () => import("./code-order").then((m) => m.CodeOrderExercise),
  { loading: Loading }
);
const WebLive = dynamic<ExerciseProps>(
  () => import("./web-live").then((m) => m.WebLiveExercise),
  { loading: Loading }
);

// The editor exercises show the question in their own task panel, so the host shows no heading.
const ownHeading = () => null;

export const codingExercises: ExerciseRegistry = {
  CODE_READ: { component: CodeProgram, layout: "wide", title: ownHeading },
  CODE_OUTPUT: { component: CodeOutput },
  CODE_FILL: { component: CodeFill },
  CODE_ORDER: { component: CodeOrder },
  CODE_WRITE: { component: CodeProgram, layout: "wide", title: ownHeading },
  CODE_FIX: { component: CodeProgram, layout: "wide", title: ownHeading },
  WEB_LIVE: { component: WebLive, layout: "wide", title: ownHeading },
};
