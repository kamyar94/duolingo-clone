import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { EXERCISE_TYPES } from "@/lib/exercises/types";

import { ExerciseHost } from "./exercise-host";
import { exerciseRegistry, getExercise } from "./registry";
import type { LessonChallenge } from "./types";

const challenge = (
  overrides: Partial<LessonChallenge> = {}
): LessonChallenge => ({
  id: 7,
  lessonId: 1,
  type: "MATH",
  question: "Solve 2x = 6.",
  hint: null,
  explanation: null,
  order: 1,
  payload: {},
  completed: false,
  challengeOptions: [],
  ...overrides,
});

const Editor = () => <p>editor</p>;

describe("exercise registry", () => {
  it("has a component for every coding and math type", () => {
    for (const type of EXERCISE_TYPES) {
      expect(exerciseRegistry[type]?.component, type).toBeTypeOf("function");
      expect(getExercise(type)).not.toBeNull();
    }
  });

  it("leaves multiple choice and unknown types to the option cards", () => {
    expect(getExercise("SELECT")).toBeNull();
    expect(getExercise("ASSIST")).toBeNull();
    expect(getExercise("ESSAY")).toBeNull();
  });

  it("renders an exercise with its question and hint", () => {
    const html = renderToStaticMarkup(
      <ExerciseHost
        entry={getExercise("MATH")!}
        challenge={challenge({ hint: "Divide by 2." })}
        status="none"
        disabled={false}
        setCheck={vi.fn()}
        onResult={vi.fn()}
      />
    );
    expect(html).toContain("Solve 2x = 6.");
    expect(html).toContain("Show a hint");
    expect(html).toContain("I got it right");
  });

  it("shows the explanation once the result is in", () => {
    const html = renderToStaticMarkup(
      <ExerciseHost
        entry={getExercise("CODE_WRITE")!}
        challenge={challenge({ type: "CODE_WRITE", explanation: "w * h" })}
        status="wrong"
        disabled={false}
        setCheck={vi.fn()}
        onResult={vi.fn()}
      />
    );
    expect(html).toContain("w * h");
  });

  it("lets an entry replace the heading and widen the layout", () => {
    const html = renderToStaticMarkup(
      <ExerciseHost
        entry={{ component: Editor, layout: "wide", title: () => null }}
        challenge={challenge()}
        status="none"
        disabled={false}
        setCheck={vi.fn()}
        onResult={vi.fn()}
      />
    );
    expect(html).not.toContain("<h1");
    expect(html).toContain("max-w-[1140px]");
    expect(html).toContain("editor");
  });
});
