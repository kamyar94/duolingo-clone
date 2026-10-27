// Payload rules for the MATH exercise type. See lib/exercises/payload-types.ts for the contract
// and lib/exercises/payload.ts for the checks every type already gets. Keep this file free of
// Next.js and database imports: the course import script bundles it. Relative imports only,
// for the same reason.
//
// A MATH payload holds the statement, an optional figure, the answer specification and a
// reference solution for the AI grader (format in lib/math/types.ts and SELF-HOSTED.md).
import type { PayloadRuleSet } from "../exercises/payload-types";

import { SCRIPT_KEY } from "./solution/course";
import { validateSolutionScript } from "./solution/validate";

import {
  ANSWER_KINDS,
  type AnswerKind,
  type ClientMathPayload,
  type MathFigure,
} from "./types";

const MAX_STATEMENT = 5000;
const MAX_LATEX = 1000;
const MAX_CHOICES = 12;
const MAX_SOLUTION_LINES = 100;

const TOP_KEYS = new Set(["statement", "figure", "answer", "solution", SCRIPT_KEY]);
const FIGURE_KEYS = new Set(["src", "alt", "caption", "width"]);
const ANSWER_KEYS: Record<AnswerKind, Set<string>> = {
  numeric: new Set(["kind", "value", "tolerance", "relativeTolerance", "unit"]),
  expression: new Set(["kind", "value"]),
  choice: new Set(["kind", "choices", "correct"]),
  freeform: new Set(["kind", "value"]),
};

/** Units are written in the compute engine's unit syntax: m/s, km/h, kg*m/s^2, deg, degC. */
const UNIT_SYNTAX = /^[A-Za-z][A-Za-z0-9_*/^()\-. ]{0,49}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isText = (value: unknown, max: number) =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;

const isIndex = (value: unknown, length: number) =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value < length;

/** A site path such as /media/x.svg: no protocol, no other host, no way out of the folder. */
export const isSafeFigurePath = (src: unknown): src is string =>
  typeof src === "string" &&
  src.length <= 500 &&
  src.startsWith("/") &&
  !src.startsWith("//") &&
  !src.includes("\\") &&
  !src.includes("..") &&
  !/[\s"'<>`]/.test(src) &&
  !src.includes(":");

const unknownKeys = (value: Record<string, unknown>, known: Set<string>, prefix: string) =>
  Object.keys(value)
    .filter((key) => !known.has(key))
    .map((key) => `${prefix}${key} is not a known field.`);

const checkFigure = (figure: unknown): string[] => {
  if (!isRecord(figure)) return ["figure must be an object with src and alt."];
  const problems = unknownKeys(figure, FIGURE_KEYS, "figure.");
  if (!isSafeFigurePath(figure.src))
    problems.push("figure.src must be a path on this site, such as /media/figure.svg.");
  if (!isText(figure.alt, 500)) problems.push("figure.alt must describe the figure in words.");
  if (figure.caption !== undefined && !isText(figure.caption, 1000))
    problems.push("figure.caption must be text.");
  if (
    figure.width !== undefined &&
    !(typeof figure.width === "number" && figure.width > 0 && figure.width <= 2000)
  )
    problems.push("figure.width must be a number of pixels up to 2000.");
  return problems;
};

const checkAnswer = (answer: unknown): string[] => {
  if (!isRecord(answer)) return ["answer must be an object with a kind."];
  const kind = answer.kind;
  if (typeof kind !== "string" || !(ANSWER_KINDS as readonly string[]).includes(kind))
    return [`answer.kind must be one of ${ANSWER_KINDS.join(", ")}.`];

  const problems = unknownKeys(answer, ANSWER_KEYS[kind as AnswerKind], "answer.");
  switch (kind as AnswerKind) {
    case "numeric": {
      const value = answer.value;
      const okValue =
        (typeof value === "number" && Number.isFinite(value)) || isText(value, MAX_LATEX);
      if (!okValue)
        problems.push("answer.value must be a number, or LaTeX that evaluates to one.");
      if (
        answer.tolerance !== undefined &&
        !(typeof answer.tolerance === "number" && answer.tolerance >= 0)
      )
        problems.push("answer.tolerance must be a number of 0 or more.");
      if (
        answer.relativeTolerance !== undefined &&
        !(
          typeof answer.relativeTolerance === "number" &&
          answer.relativeTolerance >= 0 &&
          answer.relativeTolerance < 1
        )
      )
        problems.push("answer.relativeTolerance must be a number from 0 to below 1.");
      if (
        answer.unit !== undefined &&
        !(typeof answer.unit === "string" && UNIT_SYNTAX.test(answer.unit))
      )
        problems.push('answer.unit must be a unit such as "m/s", "km/h" or "kg*m/s^2".');
      break;
    }
    case "expression":
      if (!isText(answer.value, MAX_LATEX))
        problems.push("answer.value must be the expected expression in LaTeX.");
      break;
    case "choice": {
      const choices = answer.choices;
      if (
        !Array.isArray(choices) ||
        choices.length < 2 ||
        choices.length > MAX_CHOICES ||
        !choices.every((choice) => isText(choice, MAX_LATEX))
      ) {
        problems.push(`answer.choices must be a list of 2 to ${MAX_CHOICES} texts.`);
        break;
      }
      const correct = answer.correct;
      const list = Array.isArray(correct) ? correct : [correct];
      if (
        list.length === 0 ||
        !list.every((index) => isIndex(index, choices.length)) ||
        new Set(list).size !== list.length
      )
        problems.push(
          "answer.correct must be the index of the right choice (counted from 0), or a list of indexes."
        );
      break;
    }
    case "freeform":
      if (answer.value !== undefined && !isText(answer.value, 2000))
        problems.push("answer.value must be text describing a full answer.");
      break;
  }
  return problems;
};

const checkSolution = (solution: unknown): string[] => {
  if (solution === undefined) return [];
  const lines = typeof solution === "string" ? [solution] : solution;
  if (
    !Array.isArray(lines) ||
    lines.length === 0 ||
    lines.length > MAX_SOLUTION_LINES ||
    !lines.every((line) => isText(line, 2000))
  )
    return [
      `solution must be LaTeX text or a list of up to ${MAX_SOLUTION_LINES} LaTeX lines.`,
    ];
  return [];
};

export const validateMathPayload = (
  payload: Record<string, unknown>,
  options: { text: string }[] = []
): string[] => {
  const problems = unknownKeys(payload, TOP_KEYS, "");
  if (payload.statement !== undefined && !isText(payload.statement, MAX_STATEMENT))
    problems.push(`statement must be text of up to ${MAX_STATEMENT} characters.`);
  if (payload.figure !== undefined) problems.push(...checkFigure(payload.figure));
  if (payload.answer === undefined) problems.push("answer is required.");
  else problems.push(...checkAnswer(payload.answer));
  problems.push(...checkSolution(payload.solution));
  if (payload[SCRIPT_KEY] !== undefined)
    problems.push(
      ...validateSolutionScript(payload[SCRIPT_KEY]).problems.map(
        (problem) => `${SCRIPT_KEY}: ${problem}`
      )
    );
  if (options.length)
    problems.push("MATH takes its choices in payload.answer.choices, not in options.");
  return problems;
};

/** The reference solution as a list of lines. */
export const solutionLines = (solution: unknown): string[] => {
  if (typeof solution === "string")
    return solution.split(/\r?\n/).filter((line) => line.trim());
  if (Array.isArray(solution))
    return solution.filter((line): line is string => typeof line === "string");
  return [];
};

/** Trims a stored payload to what the learner's browser may see. */
export const toClientMathPayload = (payload: unknown): ClientMathPayload => {
  const source = isRecord(payload) ? payload : {};
  const answer = isRecord(source.answer) ? source.answer : {};
  const kind = (ANSWER_KINDS as readonly string[]).includes(String(answer.kind))
    ? (answer.kind as AnswerKind)
    : "freeform";

  const client: ClientMathPayload = { answer: { kind } };
  if (typeof source.statement === "string") client.statement = source.statement;
  if (isRecord(source.figure) && isSafeFigurePath(source.figure.src)) {
    const figure: MathFigure = {
      src: source.figure.src,
      alt: typeof source.figure.alt === "string" ? source.figure.alt : "",
    };
    if (typeof source.figure.caption === "string") figure.caption = source.figure.caption;
    if (typeof source.figure.width === "number") figure.width = source.figure.width;
    client.figure = figure;
  }
  if (kind === "numeric" && typeof answer.unit === "string")
    client.answer.unit = answer.unit;
  if (kind === "choice" && Array.isArray(answer.choices)) {
    client.answer.choices = answer.choices.filter(
      (choice): choice is string => typeof choice === "string"
    );
    client.answer.multiple = Array.isArray(answer.correct) && answer.correct.length > 1;
  }
  return client;
};

export const mathPayloadRules: PayloadRuleSet = {
  MATH: {
    validate: (payload, context) => validateMathPayload(payload, context.options),
    toClient: toClientMathPayload,
  },
};
