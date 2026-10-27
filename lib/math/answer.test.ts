import { describe, expect, it } from "vitest";

import { checkAnswer, checkChoice, checkExpression, checkNumeric, readQuantity } from "./answer";

describe("numeric answers", () => {
  const time = { kind: "numeric" as const, value: 10, unit: "s", tolerance: 0.01 };

  it("reads plain numbers and LaTeX numbers", () => {
    expect(readQuantity("10")?.value).toBe(10);
    expect(readQuantity("\\frac{120}{12}")?.value).toBe(10);
    expect(readQuantity("1.2\\times10^{3}")?.value).toBe(1200);
    expect(readQuantity("t = \\frac{d}{v} = 10\\,\\mathrm{s}")?.value).toBe(10);
  });

  it("accepts the answer within the tolerance", () => {
    expect(checkNumeric(time, "10").correct).toBe(true);
    expect(checkNumeric(time, "10.005").correct).toBe(true);
    expect(checkNumeric(time, "10.02").correct).toBe(false);
    expect(checkNumeric(time, "9").correct).toBe(false);
  });

  it("uses a relative tolerance", () => {
    const spec = { kind: "numeric" as const, value: 200, relativeTolerance: 0.01 };
    expect(checkNumeric(spec, "201.9").correct).toBe(true);
    expect(checkNumeric(spec, "202.1").correct).toBe(false);
  });

  it("compares exactly up to rounding noise without a tolerance", () => {
    const spec = { kind: "numeric" as const, value: "\\frac{1}{3}" };
    expect(checkNumeric(spec, "\\frac{2}{6}").correct).toBe(true);
    expect(checkNumeric(spec, "0.333").correct).toBe(false);
    expect(checkNumeric({ ...spec, tolerance: 0.001 }, "0.333").correct).toBe(true);
  });

  it("converts compatible units", () => {
    expect(checkNumeric(time, "10\\,\\mathrm{s}").correct).toBe(true);
    expect(checkNumeric(time, "\\frac{1}{6}\\,\\mathrm{min}").correct).toBe(true);
    expect(checkNumeric(time, "10000\\,\\mathrm{ms}").correct).toBe(true);
    const speed = { kind: "numeric" as const, value: 10, unit: "m/s", tolerance: 0.001 };
    expect(checkNumeric(speed, "36\\,\\mathrm{km/h}").correct).toBe(true);
    expect(checkNumeric(speed, "10\\,\\frac{m}{s}").correct).toBe(true);
    expect(checkNumeric(speed, "10\\ \\text{m/s}").correct).toBe(true);
  });

  it("refuses a unit of another kind", () => {
    const result = checkNumeric(time, "10\\,\\mathrm{m}");
    expect(result.correct).toBe(false);
    expect(result.detail).toMatch(/different kind/);
  });

  it("assumes the expected unit when none is given", () => {
    const result = checkNumeric(time, "10");
    expect(result.correct).toBe(true);
    expect(result.detail).toMatch(/read in s/);
  });

  it("reads degree signs and radians for angles", () => {
    const angle = { kind: "numeric" as const, value: 45, unit: "deg", tolerance: 0.01 };
    expect(checkNumeric(angle, "45^\\circ").correct).toBe(true);
    expect(checkNumeric(angle, "45^{\\circ}").correct).toBe(true);
    expect(checkNumeric(angle, "\\frac{\\pi}{4}").correct).toBe(true);
    expect(checkNumeric(angle, "30^\\circ").correct).toBe(false);
  });

  it("marks unreadable answers instead of grading them", () => {
    expect(checkNumeric(time, "\\frac{1}{").unreadable).toBe(true);
    expect(checkNumeric(time, "x+1").unreadable).toBe(true);
    expect(checkAnswer(time, { kind: "latex", latex: "  " }).unreadable).toBe(true);
  });
});

describe("expression answers", () => {
  const spec = (value: string) => ({ kind: "expression" as const, value });

  it("accepts equivalent forms", () => {
    expect(checkExpression(spec("2x+3"), "3+2x").correct).toBe(true);
    expect(checkExpression(spec("x^2+2x+1"), "(x+1)^2").correct).toBe(true);
    expect(checkExpression(spec("x^2-1"), "(x-1)(x+1)").correct).toBe(true);
    expect(checkExpression(spec("x+1"), "\\frac{x^2-1}{x-1}").correct).toBe(true);
    expect(checkExpression(spec("1"), "\\sin^2x+\\cos^2x").correct).toBe(true);
    expect(checkExpression(spec("\\pi r^2"), "r^2\\pi").correct).toBe(true);
  });

  it("refuses different expressions", () => {
    expect(checkExpression(spec("2x+3"), "2x-3").correct).toBe(false);
    expect(checkExpression(spec("x^2"), "2x").correct).toBe(false);
    expect(checkExpression(spec("a+b"), "a-b").correct).toBe(false);
  });

  it("compares equations and solved forms", () => {
    expect(checkExpression(spec("y=2x+1"), "2x+1=y").correct).toBe(true);
    expect(checkExpression(spec("y=2x+1"), "2y=4x+2").correct).toBe(true);
    expect(checkExpression(spec("y=2x+1"), "y=2x-1").correct).toBe(false);
    expect(checkExpression(spec("y=2x+1"), "2x+1").correct).toBe(true);
    expect(checkExpression(spec("2x+1"), "y=1+2x").correct).toBe(true);
  });

  it("marks unreadable answers", () => {
    expect(checkExpression(spec("x"), "2+").unreadable).toBe(true);
  });
});

describe("choices and free-form answers", () => {
  it("compares picked choices", () => {
    const single = { kind: "choice" as const, choices: ["a", "b", "c"], correct: 1 };
    expect(checkChoice(single, [1]).correct).toBe(true);
    expect(checkChoice(single, [2]).correct).toBe(false);
    expect(checkChoice(single, []).unreadable).toBe(true);
    const multiple = { ...single, correct: [0, 2] };
    expect(checkChoice(multiple, [2, 0]).correct).toBe(true);
    expect(checkChoice(multiple, [0]).correct).toBe(false);
  });

  it("leaves free-form answers to the AI layer", () => {
    expect(checkAnswer({ kind: "freeform" }, null).correct).toBeNull();
  });
});
