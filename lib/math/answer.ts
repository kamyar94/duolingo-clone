// The deterministic layer of math grading (docs/DESIGN-coding-and-math.md, section 5.4): the
// learner's final answer is parsed with the Cortex Compute Engine and compared with the stored
// answer, numerically within a tolerance, with unit conversion for quantities, symbolically
// (by simplification and by sampling) for expressions, and by index for choices. This layer
// alone decides whether an answer is right.
//
// Server only in practice (the engine is large), but free of Next.js and database imports.
import {
  ComputeEngine,
  isFunction,
  type Expression,
  type MathJsonExpression,
} from "@cortex-js/compute-engine";

import { answerPart, stripMathDelimiters } from "./latex";
import type {
  AnswerCheck,
  AnswerSpec,
  ChoiceAnswer,
  ExpressionAnswer,
  GivenAnswer,
  NumericAnswer,
} from "./types";

type Expr = Expression;
type Json = MathJsonExpression;

let engine: ComputeEngine | null = null;
const ce = () => (engine ??= new ComputeEngine());

/** The operands of a function expression, none for numbers and symbols. */
const opsOf = (expr: Expr | null | undefined): readonly Expr[] =>
  isFunction(expr) ? expr.ops : [];

/** Default relative tolerance when a numeric answer gives none: equal up to rounding noise. */
export const DEFAULT_RELATIVE_TOLERANCE = 1e-6;

/** The result plus whether the answer could be read at all (unreadable answers are not graded). */
export type CheckOutcome = AnswerCheck & { unreadable?: boolean };

const unreadable = (detail: string): CheckOutcome => ({
  correct: false,
  detail,
  unreadable: true,
});

const parse = (latex: string): Expr | null => {
  try {
    const expr = ce().parse(latex);
    return expr.isValid ? expr : null;
  } catch {
    return null;
  }
};

const box = (json: unknown): Expr | null => {
  try {
    return ce().box(json as Json);
  } catch {
    return null;
  }
};

const realValue = (expr: Expr | null | undefined): number | null => {
  if (!expr) return null;
  try {
    const n = expr.N();
    const re = n.re;
    const im = n.im;
    if (typeof re !== "number" || !Number.isFinite(re)) return null;
    if (typeof im === "number" && Number.isFinite(im) && Math.abs(im) > 1e-12) return null;
    return re;
  } catch {
    return null;
  }
};

const complexValue = (expr: Expr): { re: number; im: number } | null => {
  try {
    const n = expr.N();
    const re = n.re;
    const im = typeof n.im === "number" && Number.isFinite(n.im) ? n.im : 0;
    if (typeof re !== "number" || !Number.isFinite(re)) return null;
    return { re, im };
  } catch {
    return null;
  }
};

/** A unit given as JSON is a unit when the engine can name its dimension. */
const isUnit = (unit: Json) => {
  const dimension = box(["UnitDimension", unit])?.evaluate();
  return dimension?.operator === "List";
};

/** The engine's form of a unit written like "m/s" or "kg*m/s^2", or null if unknown. */
export const parseUnit = (unit: string): Json | null => {
  const quantity = box(["Quantity", 1, unit]);
  if (quantity?.operator !== "Quantity") return null;
  const json = opsOf(quantity)[1]?.json;
  return json !== undefined && isUnit(json) ? json : null;
};

const ANGLE_UNITS = new Set(["deg", "rad", "grad", "arcmin", "arcsec"]);

/** Degree signs as a unit the engine reads: 45^\circ, 45° and 45\degree become 45 deg. */
const degreesAsUnit = (latex: string) =>
  latex
    .replace(/\^\s*\{\s*\\circ\s*\}/g, "\\,\\mathrm{deg}")
    .replace(/\^\s*\\circ(?![a-zA-Z])/g, "\\,\\mathrm{deg}")
    .replace(/\\degree(?![a-zA-Z])/g, "\\,\\mathrm{deg}")
    .replace(/°/g, "\\,\\mathrm{deg}");

type Quantity = { value: number; unit: Json | null; read: string };

/** Reads "10", "\frac{120}{12}", "10\,\mathrm{s}", "36 km/h" or "1.2\times10^3\,m" as a quantity. */
export const readQuantity = (latex: string): Quantity | null => {
  const source = degreesAsUnit(answerPart(latex));
  if (!source.trim()) return null;
  const expr = parse(source);
  if (!expr) return null;
  const read = expr.latex;

  if (expr.operator === "Quantity") {
    const value = realValue(opsOf(expr)[0]);
    const unit = opsOf(expr)[1]?.json;
    if (value === null || unit === undefined) return null;
    return { value, unit, read };
  }

  const plain = realValue(expr);
  if (plain !== null) return { value: plain, unit: null, read };

  // A number times unit symbols written without \mathrm, such as "10 s" or "10\frac{m}{s}":
  // the number is the value with every symbol set to 1, the rest must be a known unit.
  const unknowns = expr.unknowns ?? [];
  if (!unknowns.length) return null;
  const ones = Object.fromEntries(unknowns.map((name) => [name, 1]));
  let value: number | null = null;
  try {
    value = realValue(expr.subs(ones));
  } catch {
    value = null;
  }
  if (value === null || value === 0) return null;
  const unit = unitPart(expr);
  if (unit === null || unit === INVALID || !isUnit(unit)) return null;
  return { value, unit, read };
};

const INVALID = Symbol("invalid");

/** The symbols of a product such as 10·m/s, without its numbers: m/s. */
const unitPart = (expr: Expr): Json | null | typeof INVALID => {
  if (!(expr.unknowns ?? []).length) return null;
  const ops = opsOf(expr);
  switch (expr.operator) {
    case "Multiply": {
      const parts = ops.map(unitPart);
      if (parts.includes(INVALID)) return INVALID;
      const kept = parts.filter((part): part is Json => part !== null && part !== INVALID);
      if (!kept.length) return null;
      return kept.length === 1 ? kept[0] : (["Multiply", ...kept] as Json);
    }
    case "Divide": {
      const numerator = ops[0] ? unitPart(ops[0]) : null;
      const denominator = ops[1] ? unitPart(ops[1]) : null;
      if (numerator === INVALID || denominator === INVALID) return INVALID;
      if (denominator === null) return numerator;
      return ["Divide", numerator ?? 1, denominator] as Json;
    }
    case "Power": {
      const [base, exponent] = ops;
      if (!base || !exponent || (exponent.unknowns ?? []).length) return INVALID;
      return ["Power", base.json, exponent.json] as Json;
    }
    default:
      return typeof expr.json === "string" ? expr.json : INVALID;
  }
};

/** Converts a quantity to a unit; null when the kinds differ (metres into seconds). */
const convert = (value: number, from: Json, to: Json): number | null => {
  const result = box(["UnitConvert", ["Quantity", value, from], to])?.evaluate();
  if (result?.operator !== "Quantity") return null;
  return realValue(opsOf(result)[0]);
};

const sameUnit = (a: Json, b: Json) => JSON.stringify(a) === JSON.stringify(b);

const unitLatex = (unit: Json) => opsOf(box(["Quantity", 1, unit]))[1]?.latex ?? "";

const withinTolerance = (given: number, expected: number, spec: NumericAnswer) => {
  const absolute = spec.tolerance ?? 0;
  const relative =
    spec.relativeTolerance ??
    (spec.tolerance === undefined ? DEFAULT_RELATIVE_TOLERANCE : 0);
  const allowed = Math.max(absolute, relative * Math.abs(expected), 1e-12);
  return Math.abs(given - expected) <= allowed;
};

export const expectedNumber = (spec: NumericAnswer): number | null =>
  typeof spec.value === "number"
    ? spec.value
    : realValue(parse(stripMathDelimiters(spec.value)));

export const checkNumeric = (spec: NumericAnswer, latex: string): CheckOutcome => {
  const expected = expectedNumber(spec);
  if (expected === null)
    return { correct: null, detail: "The stored answer of this problem could not be read." };

  const given = readQuantity(latex);
  if (!given) return unreadable("Your answer could not be read as a number.");

  const expectedUnit = spec.unit ? parseUnit(spec.unit) : null;
  let value = given.value;
  let note = "";

  if (spec.unit && !expectedUnit) {
    note = " The unit of this problem is not known to the checker, so only the number was compared.";
  } else if (expectedUnit && given.unit) {
    if (!sameUnit(given.unit, expectedUnit)) {
      const converted = convert(given.value, given.unit, expectedUnit);
      if (converted === null)
        return {
          correct: false,
          detail: "Your answer has a unit of a different kind than the question asks for.",
          read: given.read,
        };
      value = converted;
      note = ` It was converted to ${unitLatex(expectedUnit) || spec.unit} before comparing.`;
    }
  } else if (expectedUnit && !given.unit) {
    // An angle written with pi and no unit is in radians.
    const angle =
      typeof expectedUnit === "string" && ANGLE_UNITS.has(expectedUnit) && /\\pi/.test(latex);
    if (angle) {
      const converted = convert(given.value, "rad", expectedUnit);
      if (converted !== null) value = converted;
      note = " With pi and no unit, it was read in radians.";
    } else {
      note = ` No unit was given, so it was read in ${spec.unit}.`;
    }
  } else if (!expectedUnit && given.unit) {
    note = " The unit was not needed here, so only the number was compared.";
  }

  const correct = withinTolerance(value, expected, spec);
  return {
    correct,
    detail: `${correct ? "Your answer matches." : "Your answer does not match the expected value."}${note}`,
    read: given.read,
  };
};

// ---- Expressions ----

/** Fixed sample points (no randomness), so the same answer always gets the same verdict. */
const SAMPLES = [0.613, 1.377, -0.842, 2.219, -1.731, 0.291, 3.067, -2.453, 1.913, -0.377];

const isEquation = (expr: Expr) => expr.operator === "Equal";

const sides = (expr: Expr) => [opsOf(expr)[0], opsOf(expr)[1]] as const;

/** lhs - rhs of an equation. */
const difference = (expr: Expr): Expr | null => {
  const [lhs, rhs] = sides(expr);
  if (!lhs || !rhs) return null;
  return box(["Subtract", lhs.json, rhs.json]);
};

const valueAt = (expr: Expr, point: Record<string, number>) => {
  try {
    return complexValue(Object.keys(point).length ? expr.subs(point) : expr);
  } catch {
    return null;
  }
};

const close = (a: { re: number; im: number }, b: { re: number; im: number }) => {
  const scale = Math.max(1, Math.hypot(a.re, a.im), Math.hypot(b.re, b.im));
  return Math.hypot(a.re - b.re, a.im - b.im) <= 1e-7 * scale;
};

const variablesOf = (...exprs: Expr[]) =>
  [...new Set(exprs.flatMap((expr) => expr.unknowns ?? []))].sort();

const points = (variables: string[]) =>
  SAMPLES.map((_, n) =>
    Object.fromEntries(
      variables.map((name, k) => [name, SAMPLES[(n + 3 * k) % SAMPLES.length]])
    )
  );

/** Same value at every sample point where both are defined (at least four points). */
export const sameValue = (a: Expr, b: Expr): boolean | null => {
  if (a.isSame(b)) return true;
  const diff = box(["Subtract", a.json, b.json]);
  try {
    if (diff && diff.simplify().isSame(0)) return true;
  } catch {
    // fall through to sampling
  }
  let compared = 0;
  for (const point of points(variablesOf(a, b))) {
    const va = valueAt(a, point);
    const vb = valueAt(b, point);
    if (!va || !vb) continue;
    if (!close(va, vb)) return false;
    compared += 1;
  }
  return compared >= 4 ? true : null;
};

/** f = 0 and g = 0 describe the same set when f / g is the same non-zero constant everywhere. */
const proportional = (f: Expr, g: Expr): boolean | null => {
  let ratio: { re: number; im: number } | null = null;
  let compared = 0;
  for (const point of points(variablesOf(f, g))) {
    const vf = valueAt(f, point);
    const vg = valueAt(g, point);
    if (!vf || !vg) continue;
    const fz = Math.hypot(vf.re, vf.im) < 1e-12;
    const gz = Math.hypot(vg.re, vg.im) < 1e-12;
    if (fz || gz) {
      if (fz !== gz) return false;
      continue;
    }
    const d = vg.re * vg.re + vg.im * vg.im;
    const r = {
      re: (vf.re * vg.re + vf.im * vg.im) / d,
      im: (vf.im * vg.re - vf.re * vg.im) / d,
    };
    if (ratio && !close(ratio, r)) return false;
    ratio = r;
    compared += 1;
  }
  return compared >= 4 ? true : null;
};

const isSymbol = (expr: Expr | undefined) =>
  !!expr && typeof expr.json === "string" && (expr.unknowns ?? []).length === 1;

export const checkExpression = (spec: ExpressionAnswer, latex: string): CheckOutcome => {
  const expected = parse(stripMathDelimiters(spec.value));
  if (!expected)
    return { correct: null, detail: "The stored answer of this problem could not be read." };
  const source = stripMathDelimiters(latex);
  if (!source) return unreadable("Write an answer first.");
  let given = parse(source);
  if (!given) return unreadable("Your answer could not be read as a formula.");
  const read = given.latex;

  let target = expected;
  if (isEquation(expected) && isEquation(given)) {
    const f = difference(expected);
    const g = difference(given);
    const same = f && g ? proportional(f, g) : null;
    return same === null
      ? { correct: false, detail: "Your equation could not be compared with the expected one.", read }
      : {
          correct: same,
          detail: same ? "Your equation is equivalent to the expected one." : "Your equation is not equivalent to the expected one.",
          read,
        };
  }
  // "y = 2x + 1" answers "2x + 1", and "2x + 1" answers "y = 2x + 1".
  if (!isEquation(expected) && isEquation(given)) given = sides(given)[1] ?? given;
  if (isEquation(expected) && !isEquation(given) && isSymbol(sides(expected)[0]))
    target = sides(expected)[1] ?? expected;

  const same = sameValue(target, given);
  if (same === null)
    return { correct: false, detail: "Your answer could not be compared with the expected expression.", read };
  return {
    correct: same,
    detail: same ? "Your expression is equivalent to the expected one." : "Your expression is not equivalent to the expected one.",
    read,
  };
};

export const checkChoice = (spec: ChoiceAnswer, picked: number[]): CheckOutcome => {
  if (!picked.length) return unreadable("Pick an answer first.");
  const correct = new Set(Array.isArray(spec.correct) ? spec.correct : [spec.correct]);
  const given = new Set(picked);
  const same = correct.size === given.size && [...correct].every((index) => given.has(index));
  return {
    correct: same,
    detail: same ? "You picked the right answer." : "That is not the right choice.",
  };
};

/** Checks the learner's final answer against the stored answer specification. */
export const checkAnswer = (spec: AnswerSpec, given: GivenAnswer | null): CheckOutcome => {
  switch (spec.kind) {
    case "choice":
      return checkChoice(spec, given?.kind === "choice" ? given.choices : []);
    case "freeform":
      return { correct: null, detail: "Your worked solution is graded as a whole." };
    case "numeric":
      if (given?.kind !== "latex" || !given.latex.trim())
        return unreadable("Write an answer first.");
      return checkNumeric(spec, given.latex);
    case "expression":
      if (given?.kind !== "latex" || !given.latex.trim())
        return unreadable("Write an answer first.");
      return checkExpression(spec, given.latex);
  }
};
