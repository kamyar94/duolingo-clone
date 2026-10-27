// What the math track asks the AI providers and how their replies are read: handwriting
// recognition into LaTeX lines (section 5.3) and the step analysis (section 5.4), plus the
// follow-up conversation. The JSON schemas follow the strictest provider rules (every object
// closed, every property required, no length or range keywords). No Next.js or database imports.
import { stripMathDelimiters } from "./latex";
import { solutionLines } from "./payload";
import {
  MISTAKE_TYPES,
  type AnswerSpec,
  type GivenAnswer,
  type MistakeType,
  type RecognizedLine,
  type StepAnalysis,
} from "./types";

export const MAX_LINES = 60;
export const MAX_LINE_LENGTH = 600;

// ---- Recognition ----

export const RECOGNITION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["lines"],
  properties: {
    lines: {
      type: "array",
      description: "The written lines, top to bottom.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["latex", "confidence"],
        properties: {
          latex: { type: "string", description: "The line as LaTeX math, without $ signs." },
          confidence: {
            type: "number",
            description: "How sure the reading is, from 0 (guess) to 1 (certain).",
          },
        },
      },
    },
  },
} as const;

export const RECOGNITION_SYSTEM = [
  "You transcribe handwritten mathematics into LaTeX.",
  "The image shows a learner's work on a math problem, written by hand on a white page.",
  "Return every written line in reading order, top to bottom, as one entry.",
  "Write exactly what is written, mistakes included. Never correct, complete or solve anything.",
  "Use LaTeX math without $ delimiters, \\text{} for words and \\mathrm{} for units.",
  "Give each line a confidence from 0 to 1 for how sure you are of the reading.",
  "Leave out crossed-out writing and stray marks. If the page holds no writing, return no lines.",
].join(" ");

export const recognitionPrompt = (statement: string) =>
  [
    "The problem the learner is working on, for context only (do not solve it):",
    statement.trim(),
    "",
    "Transcribe the handwriting in the image.",
  ].join("\n");

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const cleanLine = (value: unknown) =>
  typeof value === "string"
    ? stripMathDelimiters(value).replace(/\s+/g, " ").trim().slice(0, MAX_LINE_LENGTH)
    : "";

const clampConfidence = (value: unknown) => {
  let n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0.5;
  if (n > 1 && n <= 100) n /= 100; // a percentage
  return Math.min(1, Math.max(0, Math.round(n * 100) / 100));
};

/** The recognised lines of a provider reply, or null when the reply is not the asked shape. */
export const parseRecognition = (json: unknown): RecognizedLine[] | null => {
  const lines = asRecord(json).lines;
  if (!Array.isArray(lines)) return null;
  return lines
    .map((entry) => {
      const line = asRecord(entry);
      return { latex: cleanLine(line.latex), confidence: clampConfidence(line.confidence) };
    })
    .filter((line) => line.latex.length > 0)
    .slice(0, MAX_LINES);
};

// ---- Step analysis ----

export const ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "finalAnswerCorrect",
    "firstWrongLine",
    "mistakeType",
    "explanation",
    "correctedLine",
    "nextHint",
  ],
  properties: {
    finalAnswerCorrect: { type: "boolean" },
    firstWrongLine: {
      type: "integer",
      description: "Number of the first line with a mistake, 0 when no line is wrong.",
    },
    mistakeType: { type: "string", enum: [...MISTAKE_TYPES] },
    explanation: { type: "string" },
    correctedLine: {
      type: "string",
      description: "LaTeX of how the first wrong line should read, empty when none is wrong.",
    },
    nextHint: { type: "string" },
  },
} as const;

export const ANALYSIS_SYSTEM = [
  "You are a patient math tutor who checks a learner's handwritten solution.",
  "You get the problem, a reference solution, the expected final answer and the learner's work as numbered LaTeX lines with their final answer.",
  "Judge the learner's own work: a different correct method is fine. Read the lines as a handwriting reader produced them, so ignore obvious transcription noise.",
  "finalAnswerCorrect says whether the learner's final answer is right.",
  "firstWrongLine is the number of the first line that contains a mistake, 0 when no line is wrong.",
  `mistakeType is one of: ${MISTAKE_TYPES.join(", ")} ("none" when there is no mistake).`,
  "explanation speaks to the learner in two to four sentences, with math between $ signs; when all is right, say briefly what was done well.",
  "correctedLine is the LaTeX of how the first wrong line should read, empty when no line is wrong.",
  "nextHint is one sentence on how to go on from there without giving away the final answer, empty when the work is complete and right.",
].join(" ");

/** The stored answer in words for the grader (never sent to the learner's browser). */
export const describeExpectedAnswer = (spec: AnswerSpec) => {
  switch (spec.kind) {
    case "numeric":
      return `${spec.value}${spec.unit ? ` ${spec.unit}` : ""}${
        spec.tolerance !== undefined ? ` (within ${spec.tolerance})` : ""
      }`;
    case "expression":
      return spec.value;
    case "choice": {
      const correct = Array.isArray(spec.correct) ? spec.correct : [spec.correct];
      return correct.map((index) => spec.choices[index]).join("; ");
    }
    case "freeform":
      return spec.value ?? "a complete, correct worked solution";
  }
};

export const describeGivenAnswer = (spec: AnswerSpec, answer: GivenAnswer | null) => {
  if (!answer) return "none given (judge the last line of the work)";
  if (answer.kind === "choice")
    return spec.kind === "choice"
      ? answer.choices.map((index) => spec.choices[index] ?? `choice ${index + 1}`).join("; ")
      : "none given";
  return answer.latex.trim() || "none given";
};

const numbered = (lines: string[]) =>
  lines.length ? lines.map((line, n) => `${n + 1}. ${line}`).join("\n") : "(no lines)";

export type AnalysisContext = {
  statement: string;
  spec: AnswerSpec;
  solution: unknown;
  lines: string[];
  answer: GivenAnswer | null;
};

export const analysisPrompt = (context: AnalysisContext) =>
  [
    "Problem:",
    context.statement.trim(),
    "",
    "Reference solution:",
    numbered(solutionLines(context.solution)),
    "",
    `Expected final answer: ${describeExpectedAnswer(context.spec)}`,
    "",
    "Learner's work:",
    numbered(context.lines),
    "",
    `Learner's final answer: ${describeGivenAnswer(context.spec, context.answer)}`,
  ].join("\n");

const text = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

/** The step analysis of a provider reply, or null when the reply is not the asked shape. */
export const parseAnalysis = (json: unknown, lineCount: number): StepAnalysis | null => {
  const data = asRecord(json);
  if (typeof data.finalAnswerCorrect !== "boolean") return null;
  const explanation = text(data.explanation, 3000);
  if (!explanation) return null;

  let firstWrongLine = Number(data.firstWrongLine);
  if (!Number.isInteger(firstWrongLine) || firstWrongLine < 0) firstWrongLine = 0;
  if (firstWrongLine > lineCount) firstWrongLine = lineCount;

  const mistake = String(data.mistakeType ?? "").toLowerCase();
  const mistakeType: MistakeType = (MISTAKE_TYPES as readonly string[]).includes(mistake)
    ? (mistake as MistakeType)
    : "other";

  return {
    finalAnswerCorrect: data.finalAnswerCorrect,
    firstWrongLine,
    mistakeType,
    explanation,
    correctedLine: stripMathDelimiters(text(data.correctedLine, MAX_LINE_LENGTH)),
    nextHint: text(data.nextHint, 1000),
  };
};

// ---- Follow-up questions ----

export const MAX_QUESTION = 1000;
export const MAX_TURNS = 40;

export const followUpSystem = (context: AnalysisContext, analysis: StepAnalysis | null) =>
  [
    "You are a patient math tutor answering a learner's follow-up question about their solution.",
    "Answer in plain text in a few sentences, with math between $ signs.",
    "Help the learner understand; do not give away more of the solution than the question needs.",
    "",
    analysisPrompt(context),
    "",
    analysis
      ? `Your earlier analysis: ${JSON.stringify(analysis)}`
      : "There is no earlier analysis.",
  ].join("\n");
