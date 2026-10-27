import { describe, expect, it } from "vitest";

import { analysisFingerprint, answerKey, problemDigest } from "./fingerprint";
import { answerPart, normalizeLatexLine, splitMathText, stripMathDelimiters } from "./latex";

const base = {
  challengeId: 7,
  solutionVersion: 0,
  problem: problemDigest({ answer: { kind: "numeric", value: 10 } }, "q"),
  lines: ["2x - 4 = 6", "2x = 10", "x = 5"],
  answer: { kind: "latex" as const, latex: "5" },
};

describe("normalised LaTeX lines", () => {
  it("unifies spacing, delimiters and synonyms but keeps meaning", () => {
    expect(normalizeLatexLine("  $2x \\, -\\;4 = 6$ ")).toBe("2x-4=6");
    expect(normalizeLatexLine("\\left( a \\right) \\times b")).toBe("(a)\\cdot b");
    expect(normalizeLatexLine("\\dfrac{1}{2}")).toBe("\\frac{1}{2}");
    expect(normalizeLatexLine("\\pi r^2")).toBe("\\pi r^2");
    expect(normalizeLatexLine("\\pi  \\cdot 2")).toBe("\\pi\\cdot2");
    expect(normalizeLatexLine("2x-4")).not.toBe(normalizeLatexLine("2x+4"));
  });

  it("strips math delimiters", () => {
    expect(stripMathDelimiters("$$x$$")).toBe("x");
    expect(stripMathDelimiters("\\(x+1\\)")).toBe("x+1");
    expect(stripMathDelimiters("$")).toBe("$");
  });

  it("takes the answer part after the last equals sign", () => {
    expect(answerPart("t = \\frac{d}{v} = 10\\,\\mathrm{s}")).toBe("10\\,\\mathrm{s}");
    expect(answerPart("x \\approx 3.14")).toBe("3.14");
    expect(answerPart("f_{a=1}")).toBe("f_{a=1}");
    expect(answerPart("42")).toBe("42");
  });

  it("splits text with inline and display math", () => {
    expect(splitMathText("Speed $v=12$ and $$d = vt$$ costs \\$5")).toEqual([
      { kind: "text", value: "Speed ", display: false },
      { kind: "math", value: "v=12", display: false },
      { kind: "text", value: " and ", display: false },
      { kind: "math", value: "d = vt", display: true },
      { kind: "text", value: " costs $5", display: false },
    ]);
    expect(splitMathText("an open $ sign")).toEqual([
      { kind: "text", value: "an open $ sign", display: false },
    ]);
  });
});

describe("analysis fingerprints", () => {
  it("is a sha256 hex digest", () => {
    expect(analysisFingerprint(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is the same for the same work written with other spacing", () => {
    expect(
      analysisFingerprint({
        ...base,
        lines: ["$2x-4=6$", "2x\\,=\\,10", "", " x = 5 "],
        answer: { kind: "latex", latex: " 5 " },
      })
    ).toBe(analysisFingerprint(base));
  });

  it("changes with the problem, the version, the lines and the answer", () => {
    const fp = analysisFingerprint(base);
    expect(analysisFingerprint({ ...base, challengeId: 8 })).not.toBe(fp);
    expect(analysisFingerprint({ ...base, solutionVersion: 1 })).not.toBe(fp);
    expect(analysisFingerprint({ ...base, problem: problemDigest({}, "other") })).not.toBe(fp);
    expect(analysisFingerprint({ ...base, lines: ["2x-4=6", "2x=2", "x=1"] })).not.toBe(fp);
    expect(analysisFingerprint({ ...base, lines: [...base.lines].reverse() })).not.toBe(fp);
    expect(analysisFingerprint({ ...base, answer: { kind: "latex", latex: "6" } })).not.toBe(fp);
  });

  it("orders picked choices", () => {
    expect(answerKey({ kind: "choice", choices: [2, 0] })).toBe("choice:0,2");
    expect(answerKey(null)).toBe("");
  });
});
