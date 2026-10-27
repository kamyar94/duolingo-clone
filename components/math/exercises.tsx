// The math track's entry in the exercise registry (components/exercises/registry.ts). Replace
// the placeholder with the real component; next/dynamic keeps the ink canvas and math fields
// out of the lesson bundle until a math problem opens.
import { PlaceholderExercise } from "@/components/exercises/placeholder";
import type { ExerciseRegistry } from "@/components/exercises/types";

export const mathExercises: ExerciseRegistry = {
  MATH: { component: PlaceholderExercise },
};
