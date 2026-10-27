import { describe, expect, it } from "vitest";

import {
  ANALYSIS_SCHEMA,
  analysisPrompt,
  describeExpectedAnswer,
  parseAnalysis,
  parseRecognition,
  RECOGNITION_SCHEMA,
} from "./ai";

/** Every object closed, every property required, no length or range keywords. */
const checkStrict = (schema: unknown, path = "$"): string[] => {
  if (typeof schema !== "object" || schema === null) return [];
  const node = schema as Record<string, unknown>;
  const problems: string[] = [];
  for (const banned of ["minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems"])
    if (banned in node) problems.push(`${path} uses ${banned}`);
  if (node.type === "object") {
    if (node.additionalProperties !== false) problems.push(`${path} is open`);
    const properties = Object.keys((node.properties as object) ?? {});
    const required = (node.required as string[]) ?? [];
    if (properties.some((key) => !required.includes(key))) problems.push(`${path} optional key`);
  }
  for (const [key, value] of Object.entries(node))
    if (typeof value === "object") problems.push(...checkStrict(value, `${path}.${key}`));
  return problems;
};

describe("schemas", () => {
  it("follow the strictest provider rules", () => {
    expect(checkStrict(RECOGNITION_SCHEMA)).toEqual([]);
    expect(checkStrict(ANALYSIS_SCHEMA)).toEqual([]);
  });
});

describe("recognition replies", () => {
  it("reads lines with confidences", () => {
    expect(
      parseRecognition({
        lines: [
          { latex: "$2x - 4 = 6$", confidence: 0.92 },
          { latex: "  2x   = 10 ", confidence: 87 },
          { latex: "", confidence: 1 },
          { latex: "x=5", confidence: "high" },
          { latex: "y", confidence: -3 },
        ],
      })
    ).toEqual([
      { latex: "2x - 4 = 6", confidence: 0.92 },
      { latex: "2x = 10", confidence: 0.87 },
      { latex: "x=5", confidence: 0.5 },
      { latex: "y", confidence: 0 },
    ]);
  });

  it("refuses replies of another shape", () => {
    expect(parseRecognition(null)).toBeNull();
    expect(parseRecognition({ text: "x" })).toBeNull();
    expect(parseRecognition({ lines: [] })).toEqual([]);
  });

  it("caps the number and length of lines", () => {
    const many = parseRecognition({
      lines: Array.from({ length: 100 }, () => ({ latex: "x".repeat(2000), confidence: 1 })),
    });
    expect(many).toHaveLength(60);
    expect(many?.[0].latex).toHaveLength(600);
  });
});

describe("analysis replies", () => {
  const reply = {
    finalAnswerCorrect: false,
    firstWrongLine: 3,
    mistakeType: "sign error",
    explanation: "Moving $4x$ to the right side changes its sign.",
    correctedLine: "$-2x = 6$",
    nextHint: "Divide both sides by -2.",
  };

  it("reads the verdict of section 5.4", () => {
    expect(parseAnalysis(reply, 4)).toEqual({ ...reply, correctedLine: "-2x = 6" });
  });

  it("clamps the line number and maps unknown mistake types", () => {
    expect(parseAnalysis({ ...reply, firstWrongLine: 9 }, 2)?.firstWrongLine).toBe(2);
    expect(parseAnalysis({ ...reply, firstWrongLine: -1 }, 2)?.firstWrongLine).toBe(0);
    expect(parseAnalysis({ ...reply, mistakeType: "Sign Error" }, 4)?.mistakeType).toBe(
      "sign error"
    );
    expect(parseAnalysis({ ...reply, mistakeType: "cosmic rays" }, 4)?.mistakeType).toBe("other");
  });

  it("refuses replies without a verdict or explanation", () => {
    expect(parseAnalysis({ ...reply, finalAnswerCorrect: "no" }, 4)).toBeNull();
    expect(parseAnalysis({ ...reply, explanation: " " }, 4)).toBeNull();
    expect(parseAnalysis("text", 4)).toBeNull();
  });
});

describe("prompts", () => {
  it("number the learner's lines and name the expected answer", () => {
    const prompt = analysisPrompt({
      statement: "Solve 2x - 4 = 6.",
      spec: { kind: "numeric", value: 5 },
      solution: ["2x = 10", "x = 5"],
      lines: ["2x - 4 = 6", "2x = 2"],
      answer: { kind: "latex", latex: "1" },
    });
    expect(prompt).toContain("1. 2x - 4 = 6\n2. 2x = 2");
    expect(prompt).toContain("Expected final answer: 5");
    expect(prompt).toContain("Learner's final answer: 1");
    expect(
      describeExpectedAnswer({ kind: "choice", choices: ["a", "b", "c"], correct: [0, 2] })
    ).toBe("a; c");
  });
});
