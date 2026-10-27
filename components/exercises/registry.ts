// Challenge type to exercise component. SELECT and ASSIST are not here: the lesson flow keeps
// rendering them with upstream's option cards. Each track owns its own map, so the coding and
// math work never edit the same file.
import { codingExercises } from "@/components/coding/exercises";
import { mathExercises } from "@/components/math/exercises";
import { isExerciseType } from "@/lib/exercises/types";

import { PlaceholderExercise } from "./placeholder";
import type { ExerciseEntry, ExerciseRegistry } from "./types";

export const exerciseRegistry: ExerciseRegistry = {
  ...codingExercises,
  ...mathExercises,
};

const fallback: ExerciseEntry = { component: PlaceholderExercise };

/** The entry for an exercise type, or null for SELECT, ASSIST and unknown types. */
export const getExercise = (type: string): ExerciseEntry | null => {
  if (!isExerciseType(type)) return null;
  return exerciseRegistry[type] ?? fallback;
};
