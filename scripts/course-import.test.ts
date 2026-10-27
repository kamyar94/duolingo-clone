import { afterEach, describe, expect, it } from "vitest";

import { registerPayloadRules } from "@/lib/exercises/payload";

import { checkCourse } from "./course-import.mjs";

const course = (challenges: unknown[]) => ({
  title: "Example",
  imageSrc: "/mascot.svg",
  units: [
    {
      title: "Unit 1",
      description: "Basics",
      lessons: [{ title: "Lesson 1", challenges }],
    },
  ],
});

const choice = {
  type: "SELECT",
  question: "Pick one",
  options: [
    { text: "A", correct: true },
    { text: "B", correct: false },
  ],
};

describe("checkCourse with coding and math types", () => {
  afterEach(() => registerPayloadRules("CODE_WRITE", null));

  it("still accepts multiple-choice challenges as before", () => {
    expect(checkCourse(course([choice]))).toEqual([]);
  });

  it("still requires options for SELECT and ASSIST", () => {
    expect(
      checkCourse(course([{ type: "ASSIST", question: "Q", options: [] }]))
    ).toEqual([
      "Unit 1 > lesson 1 > challenge 1 > needs at least two options.",
      "Unit 1 > lesson 1 > challenge 1 > needs exactly one option with correct: true.",
    ]);
  });

  it("accepts the new types with a payload and no options", () => {
    const challenges = [
      {
        type: "CODE_WRITE",
        question: "Write area(w, h).",
        payload: { language: "python", starter: "def area(w, h):\n    pass\n" },
      },
      {
        type: "MATH",
        question: "Solve 2x = 6.",
        payload: { answer: { kind: "numeric", value: 3 } },
      },
      {
        type: "CODE_OUTPUT",
        question: "What does it print?",
        payload: { language: "js", code: "console.log(1 + 1)" },
        options: [
          { text: "2", correct: true },
          { text: "11", correct: false },
        ],
      },
    ];
    expect(checkCourse(course(challenges))).toEqual([]);
  });

  it("refuses unknown types and missing payloads", () => {
    const errors: string[] = checkCourse(
      course([
        { type: "ESSAY", question: "Q" },
        { type: "WEB_LIVE", question: "Build a page" },
      ])
    );
    expect(errors[0]).toMatch(
      /challenge 1 > type must be one of SELECT, ASSIST, CODE_READ/
    );
    expect(errors).toContain(
      "Unit 1 > lesson 1 > challenge 2 > WEB_LIVE needs a payload object."
    );
    expect(errors.filter((e) => e.includes("challenge 2"))).toHaveLength(1);
  });

  it("reports the problems found by a track's payload rules", () => {
    registerPayloadRules("CODE_WRITE", {
      validate: (payload) =>
        Array.isArray(payload.tests) ? [] : ["tests must be a list."],
    });
    expect(
      checkCourse(
        course([
          { type: "CODE_WRITE", question: "Q", payload: { tests: "no" } },
        ])
      )
    ).toEqual(["Unit 1 > lesson 1 > challenge 1 > tests must be a list."]);
  });
});
