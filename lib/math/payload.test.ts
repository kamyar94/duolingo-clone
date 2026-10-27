import { describe, expect, it } from "vitest";

import { checkChallengePayload, toClientPayload } from "@/lib/exercises/payload";

import { solutionLines, toClientMathPayload, validateMathPayload } from "./payload";

const valid = {
  statement: "A cyclist rides $120\\,\\mathrm{m}$ at $12\\,\\mathrm{m/s}$. How long does it take?",
  figure: { src: "/media/math/cyclist.svg", alt: "A cyclist on a road", width: 320 },
  answer: { kind: "numeric", value: 10, unit: "s", tolerance: 0.01 },
  solution: ["t = \\frac{d}{v}", "t = \\frac{120}{12} = 10\\,\\mathrm{s}"],
};

describe("MATH payload validation", () => {
  it("accepts every answer kind", () => {
    expect(validateMathPayload(valid)).toEqual([]);
    expect(validateMathPayload({ answer: { kind: "expression", value: "x^2-1" } })).toEqual([]);
    expect(
      validateMathPayload({
        answer: { kind: "choice", choices: ["$1$", "$2$", "$3$"], correct: [0, 2] },
      })
    ).toEqual([]);
    expect(validateMathPayload({ answer: { kind: "freeform" }, solution: "x = 1" })).toEqual([]);
  });

  it("is registered for course check, import and update", () => {
    expect(checkChallengePayload("MATH", valid, { question: "q" })).toEqual([]);
    expect(checkChallengePayload("MATH", null, { question: "q" })).toEqual([
      "MATH needs a payload object.",
    ]);
    expect(checkChallengePayload("MATH", { answer: {} }, { question: "q" })[0]).toMatch(
      /answer.kind/
    );
  });

  it("names the problems of a broken payload", () => {
    const problems = validateMathPayload({
      statment: "typo",
      figure: { src: "https://example.com/x.png", alt: "" },
      answer: { kind: "numeric", value: "", tolerance: -1, unit: "m/s; drop" },
    });
    expect(problems).toEqual(
      expect.arrayContaining([
        "statment is not a known field.",
        "figure.src must be a path on this site, such as /media/figure.svg.",
        "figure.alt must describe the figure in words.",
        "answer.value must be a number, or LaTeX that evaluates to one.",
        "answer.tolerance must be a number of 0 or more.",
        'answer.unit must be a unit such as "m/s", "km/h" or "kg*m/s^2".',
      ])
    );
  });

  it("checks choices and their indexes", () => {
    expect(
      validateMathPayload({ answer: { kind: "choice", choices: ["a"], correct: 0 } })[0]
    ).toMatch(/2 to 12/);
    expect(
      validateMathPayload({ answer: { kind: "choice", choices: ["a", "b"], correct: 2 } })[0]
    ).toMatch(/index/);
    expect(
      validateMathPayload({ answer: { kind: "choice", choices: ["a", "b"], correct: [1, 1] } })[0]
    ).toMatch(/index/);
  });

  it("refuses figure paths that leave the site", () => {
    for (const src of ["//evil.example.com/x.png", "/media/../secret", "javascript:alert(1)", "/a b.png"])
      expect(validateMathPayload({ figure: { src, alt: "x" }, answer: { kind: "freeform" } })).toContain(
        "figure.src must be a path on this site, such as /media/figure.svg."
      );
  });

  it("refuses options on MATH challenges", () => {
    expect(validateMathPayload(valid, [{ text: "1" }])).toContain(
      "MATH takes its choices in payload.answer.choices, not in options."
    );
  });

  it("reads the reference solution as lines", () => {
    expect(solutionLines("a\nb\n\n")).toEqual(["a", "b"]);
    expect(solutionLines(["a", 2, "b"])).toEqual(["a", "b"]);
  });
});

describe("MATH payload for the browser", () => {
  it("strips the stored answer and the reference solution", () => {
    const client = toClientMathPayload(valid);
    expect(client).toEqual({
      statement: valid.statement,
      figure: valid.figure,
      answer: { kind: "numeric", unit: "s" },
    });
    expect(JSON.stringify(toClientPayload("MATH", valid))).not.toMatch(/tolerance|solution|"value"/);
  });

  it("keeps choices but not which one is right", () => {
    const client = toClientMathPayload({
      answer: { kind: "choice", choices: ["a", "b", "c"], correct: [0, 1] },
    });
    expect(client.answer).toEqual({ kind: "choice", choices: ["a", "b", "c"], multiple: true });
  });

  it("survives a malformed payload", () => {
    expect(toClientMathPayload(null)).toEqual({ answer: { kind: "freeform" } });
    expect(toClientMathPayload({ figure: { src: "http://x" }, answer: { kind: "?" } })).toEqual({
      answer: { kind: "freeform" },
    });
  });
});
