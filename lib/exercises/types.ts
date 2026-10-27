// Challenge types. The first two are upstream's multiple-choice questions; the rest are the
// coding and math exercises of docs/DESIGN-coding-and-math.md. db/schema.ts builds its Postgres
// enum from this list, so a new type is added here and then needs a new migration.
//
// Plain data on purpose: client components, server code and the course import script all read it.

export const CHOICE_TYPES = ["SELECT", "ASSIST"] as const;

export const CODING_TYPES = [
  "CODE_READ",
  "CODE_OUTPUT",
  "CODE_FILL",
  "CODE_ORDER",
  "CODE_WRITE",
  "CODE_FIX",
  "WEB_LIVE",
] as const;

export const MATH_TYPES = ["MATH"] as const;

export const CHALLENGE_TYPES = [
  ...CHOICE_TYPES,
  ...CODING_TYPES,
  ...MATH_TYPES,
] as const;

export type ChallengeType = (typeof CHALLENGE_TYPES)[number];
export type ChoiceType = (typeof CHOICE_TYPES)[number];
export type CodingType = (typeof CODING_TYPES)[number];
export type MathType = (typeof MATH_TYPES)[number];

/** Types rendered through the exercise registry (components/exercises) instead of option cards. */
export type ExerciseType = CodingType | MathType;
export const EXERCISE_TYPES: readonly ExerciseType[] = [
  ...CODING_TYPES,
  ...MATH_TYPES,
];

export const isChallengeType = (value: unknown): value is ChallengeType =>
  typeof value === "string" &&
  (CHALLENGE_TYPES as readonly string[]).includes(value);

export const isExerciseType = (value: unknown): value is ExerciseType =>
  typeof value === "string" &&
  (EXERCISE_TYPES as readonly string[]).includes(value);
