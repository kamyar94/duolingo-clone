import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CODE_LANGUAGES } from "@/lib/coding/languages";
import { validateSolutionScript } from "@/lib/math/solution/validate";

import { checkCourse } from "./course-import.mjs";

// The example courses in courses/examples are documented in docs/COURSE-FILES.md. These tests
// keep the claims of that document true: every file passes the same check as the import, the
// math course has animated solutions in every unit, and each coding course uses the exercise
// types that the document says it uses.
const folder = path.resolve(__dirname, "../courses/examples");
const files = readdirSync(folder).filter((name) => name.endsWith(".json")).sort();
const load = (name: string) => JSON.parse(readFileSync(path.join(folder, name), "utf8"));

type Challenge = { type: string; question: string; hint?: string; explanation?: string; payload: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
type Course = { title: string; units: { title: string; lessons: { title: string; challenges: Challenge[] }[] }[] };

const PROGRAM_TYPES = ["CODE_READ", "CODE_OUTPUT", "CODE_FILL", "CODE_ORDER", "CODE_WRITE", "CODE_FIX"];
const SERVER_LANGUAGES = Object.entries(CODE_LANGUAGES)
  .filter(([, info]) => info.runtime === "server")
  .map(([id]) => id);

describe("the example courses", () => {
  it("are there", () => {
    expect(files.length).toBeGreaterThanOrEqual(17);
  });

  it.each(files)("%s passes the course check", (name) => {
    expect(checkCourse(load(name))).toEqual([]);
  });

  it("have unique titles that end in (example)", () => {
    const titles = files.map((name) => (load(name) as Course).title);
    expect(new Set(titles.map((title) => title.toLowerCase())).size).toBe(titles.length);
    for (const title of titles) expect(title).toMatch(/\(example\)$/);
  });

  it("give every exercise a hint (except reading) and an explanation", () => {
    for (const name of files)
      for (const unit of (load(name) as Course).units)
        for (const lesson of unit.lessons)
          for (const challenge of lesson.challenges) {
            expect(challenge.explanation, `${name} ${challenge.question}`).toBeTruthy();
            if (challenge.type !== "CODE_READ") expect(challenge.hint, `${name} ${challenge.question}`).toBeTruthy();
          }
  });

  it("give every writing and repairing exercise a reference solution and hidden tests", () => {
    for (const name of files)
      for (const unit of (load(name) as Course).units)
        for (const lesson of unit.lessons)
          for (const challenge of lesson.challenges) {
            if (challenge.type !== "CODE_WRITE" && challenge.type !== "CODE_FIX") continue;
            const where = `${name} ${challenge.question}`;
            expect(challenge.payload.solution, where).toBeTruthy();
            expect(challenge.payload.tests.length, where).toBeGreaterThanOrEqual(2);
            expect(challenge.payload.tests.some((test: { visible?: boolean }) => test.visible === false), where).toBe(true);
          }
  });
});

describe("the math course", () => {
  const course = load("math-problem-sets.json") as Course;

  it("has the five units of the brief with about five problems each", () => {
    expect(course.units.map((unit) => unit.title)).toEqual([
      "Algebra",
      "Geometry",
      "Calculus",
      "Probability and statistics",
      "Physics word problems",
    ]);
    for (const unit of course.units) {
      const problems = unit.lessons.flatMap((lesson) => lesson.challenges);
      expect(problems.length).toBeGreaterThanOrEqual(5);
      expect(problems.length).toBeLessThanOrEqual(6);
    }
  });

  it("uses every answer kind and gives every problem a reference solution", () => {
    const kinds = new Set<string>();
    for (const unit of course.units)
      for (const lesson of unit.lessons)
        for (const challenge of lesson.challenges) {
          expect(challenge.type).toBe("MATH");
          expect(challenge.payload.solution?.length, challenge.question).toBeGreaterThan(0);
          kinds.add(challenge.payload.answer.kind);
        }
    expect([...kinds].sort()).toEqual(["choice", "expression", "freeform", "numeric"]);
  });

  it("has at least two valid animated solutions in every unit", () => {
    for (const unit of course.units) {
      const scripts = unit.lessons
        .flatMap((lesson) => lesson.challenges)
        .filter((challenge) => challenge.payload.solutionScript);
      expect(scripts.length, unit.title).toBeGreaterThanOrEqual(2);
      for (const challenge of scripts) {
        const checked = validateSolutionScript(challenge.payload.solutionScript);
        expect(checked.problems, challenge.question).toEqual([]);
        // The statement repeats the question of the script, so the two cannot drift apart.
        const spoken = checked.script!.question.map((span) => span.text).join("");
        expect(challenge.payload.statement).toBe(spoken);
      }
    }
  });
});

describe("the coding courses", () => {
  it.each(["python-basics.json", "javascript-basics.json", "sql-basics.json"])(
    "%s uses all six program exercise types in both lessons",
    (name) => {
      const course = load(name) as Course;
      const lessons = course.units.flatMap((unit) => unit.lessons);
      expect(lessons).toHaveLength(2);
      for (const lesson of lessons)
        expect([...new Set(lesson.challenges.map((challenge) => challenge.type))].sort()).toEqual([...PROGRAM_TYPES].sort());
    }
  );

  it("has a web course of page exercises with checks of every kind", () => {
    const course = load("web-basics.json") as Course;
    const lessons = course.units.flatMap((unit) => unit.lessons);
    expect(lessons).toHaveLength(2);
    const checks = lessons.flatMap((lesson) => lesson.challenges).flatMap((challenge) => {
      expect(challenge.type).toBe("WEB_LIVE");
      return challenge.payload.checks as Record<string, unknown>[];
    });
    for (const field of ["count", "text", "textMatch", "attr", "style"])
      expect(checks.some((check) => field in check), field).toBe(true);
    expect(checks.some((check) => check.visible === false)).toBe(true);
  });

  it("has one short course for every server language, with all six program types", () => {
    const seen = new Set<string>();
    for (const name of files) {
      const course = load(name) as Course;
      const languages = new Set(course.units.flatMap((u) => u.lessons.flatMap((l) => l.challenges.map((c) => c.payload.language))));
      const only = [...languages][0] as string;
      if (languages.size !== 1 || !SERVER_LANGUAGES.includes(only)) continue;
      seen.add(only);
      const types = course.units[0].lessons[0].challenges.map((challenge) => challenge.type);
      expect(types.sort(), name).toEqual([...PROGRAM_TYPES].sort());
      // Server languages support input and output tests only.
      for (const challenge of course.units[0].lessons[0].challenges)
        for (const test of challenge.payload.tests ?? []) expect(test.call, name).toBeUndefined();
    }
    expect([...seen].sort()).toEqual([...SERVER_LANGUAGES].sort());
  });
});
