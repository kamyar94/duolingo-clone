// Shapes shared by the math track: the MATH payload in course files, what the learner's browser
// receives of it, ink strokes, recognised lines and the step analysis of
// docs/DESIGN-coding-and-math.md (sections 5.3, 5.4, 5.7 and 5.8).
//
// Plain types and constants only, so client components, server code and the course import
// script (bundled with esbuild) can all read this file.

export const ANSWER_KINDS = ["numeric", "expression", "choice", "freeform"] as const;
export type AnswerKind = (typeof ANSWER_KINDS)[number];

/** A picture shown with the statement, served from the media folder or the public folder. */
export type MathFigure = {
  /** A site path such as /media/geometry/triangle.svg (no outside addresses). */
  src: string;
  alt: string;
  caption?: string;
  /** Display width in CSS pixels; the figure never grows wider than the column. */
  width?: number;
};

export type NumericAnswer = {
  kind: "numeric";
  /** The answer as a number, or as LaTeX that evaluates to one, such as "\\frac{1}{3}". */
  value: number | string;
  /** Allowed absolute difference, in the answer's unit. */
  tolerance?: number;
  /** Allowed relative difference (0.01 is one percent). */
  relativeTolerance?: number;
  /**
   * The unit of value, written like "m/s", "km/h", "kg*m/s^2" or "deg". A learner may answer in
   * any unit of the same kind; it is converted before comparing. Without a unit in the answer,
   * the expected unit is assumed.
   */
  unit?: string;
};

export type ExpressionAnswer = {
  kind: "expression";
  /** LaTeX of the expected expression or equation, for example "x^2-1" or "y=2x+1". */
  value: string;
};

export type ChoiceAnswer = {
  kind: "choice";
  /** The choices as text, with math between dollar signs. */
  choices: string[];
  /** Index of the correct choice, counted from 0, or several indexes when all must be picked. */
  correct: number | number[];
};

export type FreeformAnswer = {
  kind: "freeform";
  /** What a full answer contains, for the AI grader (never shown to the learner). */
  value?: string;
};

export type AnswerSpec = NumericAnswer | ExpressionAnswer | ChoiceAnswer | FreeformAnswer;

/** The payload of a MATH challenge in a course file and in challenges.payload. */
export type MathPayload = {
  /** The problem text, with math between dollar signs. Default: the challenge question. */
  statement?: string;
  figure?: MathFigure;
  answer: AnswerSpec;
  /** Reference solution as LaTeX lines, sent to the AI grader only. */
  solution?: string[] | string;
};

/** What the learner's browser receives: no stored answer, no reference solution. */
export type ClientMathPayload = {
  statement?: string;
  figure?: MathFigure;
  answer: {
    kind: AnswerKind;
    unit?: string;
    choices?: string[];
    /** True when more than one choice must be picked. */
    multiple?: boolean;
  };
};

// ---- Ink ----

export const INK_TOOLS = ["pen", "highlighter"] as const;
export type InkKind = "p" | "h";

/**
 * One stroke as stored in drafts and attempts. Compact on purpose (drafts are capped at 900 KB):
 * points are flattened as x, y, pressure, ms since the stroke started, repeated.
 */
export type StoredStroke = {
  /** Short id, unique within the drawing. */
  i: string;
  /** "p" pen or "h" highlighter. */
  k: InkKind;
  /** CSS colour, #rrggbb. */
  c: string;
  /** Nominal width in page units. */
  s: number;
  /** 1 when the device reported real pressure for this stroke. */
  pr: 0 | 1;
  /** Start time, ms since 1970. */
  t: number;
  /** x, y, pressure, dt, repeated. */
  p: number[];
};

/** Width of the writing page in page units; the canvas scales it to the screen. */
export const PAGE_WIDTH = 1000;

// ---- Recognition and grading ----

export type RecognizedLine = { latex: string; confidence: number };

export type RecognizeResult = {
  attemptId: number;
  lines: RecognizedLine[];
  /** True when the same strokes were read before and the lines were reused (no AI call). */
  reused: boolean;
  provider: string | null;
  model: string | null;
};

export const MISTAKE_TYPES = [
  "none",
  "sign error",
  "arithmetic error",
  "algebra error",
  "wrong formula",
  "unit error",
  "misread problem",
  "notation",
  "incomplete",
  "other",
] as const;
export type MistakeType = (typeof MISTAKE_TYPES)[number];

/** The AI step analysis (section 5.4). firstWrongLine is 1-based, 0 when no line is wrong. */
export type StepAnalysis = {
  finalAnswerCorrect: boolean;
  firstWrongLine: number;
  mistakeType: MistakeType;
  explanation: string;
  correctedLine: string;
  nextHint: string;
};

/** The learner's final answer as sent for grading. */
export type GivenAnswer =
  | { kind: "latex"; latex: string }
  | { kind: "choice"; choices: number[] };

/** Result of the deterministic check of the answer box. */
export type AnswerCheck = {
  /** null when the answer kind has no deterministic check (freeform). */
  correct: boolean | null;
  /** A short sentence for the learner, without revealing the stored answer. */
  detail: string;
  /** The learner's answer as it was read, for example "10 s" or "2x+3". */
  read?: string;
};

export type AnalysisSource = "stored" | "common" | "ai" | "none";

export type ConversationTurn = { role: "user" | "assistant"; text: string; at: string };

/** What the grade route returns to the browser. */
export type GradeResult = {
  attemptId: number;
  correct: boolean;
  check: AnswerCheck;
  analysis: StepAnalysis | null;
  analysisId: number | null;
  analysisSource: AnalysisSource;
  /** The AI's verdict on the final answer differs from the deterministic check. */
  disagreement: boolean;
  /** Why no analysis came back, when the AI step failed. */
  analysisError: string | null;
  commonMistake: boolean;
  canPromote: boolean;
  provider: string | null;
  model: string | null;
};
