// The coding track's entries in the exercise registry (components/exercises/registry.ts).
// Replace each placeholder with the real component; next/dynamic keeps heavy editors out of
// the lesson bundle until a coding exercise opens.
import { PlaceholderExercise } from "@/components/exercises/placeholder";
import type { ExerciseRegistry } from "@/components/exercises/types";

export const codingExercises: ExerciseRegistry = {
  CODE_READ: { component: PlaceholderExercise },
  CODE_OUTPUT: { component: PlaceholderExercise },
  CODE_FILL: { component: PlaceholderExercise },
  CODE_ORDER: { component: PlaceholderExercise },
  CODE_WRITE: { component: PlaceholderExercise },
  CODE_FIX: { component: PlaceholderExercise },
  WEB_LIVE: { component: PlaceholderExercise },
};
