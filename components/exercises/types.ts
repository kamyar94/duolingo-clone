// The contract between the lesson flow (app/lesson/quiz.tsx) and the coding and math exercise
// components. An exercise never touches hearts, points or progress itself: it reports a checked
// result, and the lesson flow applies it with the same server actions as a multiple-choice
// answer (upsertChallengeProgress when right, reduceHearts when wrong).
import type { ComponentType } from "react";

import type { challengeOptions, challenges } from "@/db/schema";
import type { ExerciseType } from "@/lib/exercises/types";

/** A challenge as the lesson page hands it to the browser (payload already trimmed). */
export type LessonChallenge = typeof challenges.$inferSelect & {
  completed: boolean;
  challengeOptions: (typeof challengeOptions.$inferSelect)[];
};

export type ExerciseStatus = "none" | "wrong" | "correct";

export type ExerciseResult = {
  correct: boolean;
};

/**
 * What the footer's Check button runs. Return the result, or null when nothing should be
 * graded yet (for example a math attempt that first shows the recognised lines for correction,
 * which then reports its result later with reportResult).
 */
export type ExerciseCheck = () =>
  | ExerciseResult
  | null
  | Promise<ExerciseResult | null>;

export type ExerciseProps = {
  challenge: LessonChallenge;
  /**
   * "none" while the learner works; "correct" or "wrong" once a result was applied. After
   * "wrong", Retry sets it back to "none" and the component stays mounted, so the learner's
   * work is kept.
   */
  status: ExerciseStatus;
  /** True while a result is being saved; the component should not accept a new check. */
  disabled: boolean;
  /** True when the learner already completed this challenge once (a practice round). */
  practice: boolean;
  /**
   * Registers what Check does. Pass null while the exercise is not ready to be checked; the
   * Check button is disabled then. Register again whenever the function's inputs change.
   */
  setCheck: (check: ExerciseCheck | null) => void;
  /** Reports a result without the Check button (own submit flow). Ignored unless status is "none". */
  reportResult: (result: ExerciseResult) => void;
  /**
   * Sets the lesson back to "none" after a wrong answer. Call it when the learner changes the
   * work, so the footer offers Check for the new answer instead of Retry for the old one.
   */
  retry: () => void;
};

export type ExerciseEntry = {
  component: ComponentType<ExerciseProps>;
  /**
   * "narrow" keeps the quiz column of multiple-choice questions; "wide" gives the exercise the
   * full lesson width, for editors and canvases. Default "narrow".
   */
  layout?: "narrow" | "wide";
  /**
   * Heading above the exercise. Default: the question. Return null to show no heading, when the
   * component shows the question itself.
   */
  title?: (challenge: LessonChallenge) => string | null;
};

export type ExerciseRegistry = Partial<Record<ExerciseType, ExerciseEntry>>;
