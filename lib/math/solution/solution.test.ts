import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { checkCourse } from "@/scripts/course-import.mjs";

import { canonicalJson, splitSolutionScript } from "./course";
import { compileExpression, expressionProblem } from "./expr";
import {
  compileTimeline,
  equationSteps,
  frameAt,
  lineShownAt,
  stepAt,
  stepForWrongLine,
} from "./timeline";
import type { SolutionScript } from "./types";
import { validateSolutionScript } from "./validate";

const course = JSON.parse(
  readFileSync(path.resolve(__dirname, "../../../courses/math-demo.json"), "utf8")
);
const challenges = course.units.flatMap((unit: { lessons: { challenges: unknown[] }[] }) =>
  unit.lessons.flatMap((lesson) => lesson.challenges)
) as { question: string; payload: { solutionScript?: unknown } }[];
const scripts = challenges
  .map((challenge) => challenge.payload.solutionScript)
  .filter(Boolean) as SolutionScript[];
const [kinematics, graph, geometry] = scripts;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

describe("solution script schema", () => {
  it("accepts the three example scripts of the demo course", () => {
    expect(scripts).toHaveLength(3);
    for (const script of scripts) expect(validateSolutionScript(script).problems).toEqual([]);
    expect(checkCourse(course)).toEqual([]);
    expect(graph.graphs).toHaveLength(1);
    expect(geometry.figures).toHaveLength(1);
  });

  it("fills in missing lists", () => {
    const minimal = {
      format: 1,
      question: [{ text: "What is 1 + 1?" }],
      equations: [{ id: "e", states: [{ id: "s", latex: "1+1=2" }] }],
      steps: [{ kind: "Relate", equation: "e", duration: 2 }],
    };
    const { script, problems } = validateSolutionScript(minimal);
    expect(problems).toEqual([]);
    expect(script?.givens).toEqual([]);
    expect(script?.graphs).toEqual([]);
    expect(script?.notes).toEqual([]);
  });

  it("reports unknown fields, bad ids and the wrong format", () => {
    const script = clone(kinematics) as unknown as Record<string, unknown>;
    script.format = 2;
    script.colour = "red";
    (script.givens as Record<string, unknown>[])[0].id = "1d";
    const { problems, script: result } = validateSolutionScript(script);
    expect(result).toBeNull();
    expect(problems).toContain("format: must be 1.");
    expect(problems).toContain("colour is not a known field.");
    expect(problems.some((problem) => problem.startsWith("givens[0].id"))).toBe(true);
  });

  it("refuses LaTeX that could add classes or links to the page", () => {
    const script = clone(kinematics);
    script.equations[0].states[0].latex = "\\htmlClass{fixed inset-0}{d} = vt";
    script.givens[0].symbol = "\\href{https://example.com}{d}";
    const { problems } = validateSolutionScript(script);
    expect(problems.filter((problem) => problem.includes("\\htmlClass"))).toHaveLength(2);
  });

  it("checks references between steps and elements", () => {
    const script = clone(kinematics);
    // Transform before the equation is shown, a missing state, a missing term and given.
    script.steps.splice(2, 1);
    (script.steps[4] as { to: string }).to = "nowhere";
    (script.steps[3] as { pairs: { given: string; term: string }[] }).pairs = [{ given: "x", term: "zz" }];
    const { problems } = validateSolutionScript(script);
    expect(problems).toEqual(
      expect.arrayContaining([
        'steps[2].equation: equation "motion" must be shown by a Relate step first.',
        "steps[3].pairs[0].given: must be the id of a given.",
        'steps[3].pairs[0].term: no term "zz" in state "numbers".',
        'steps[4].to: no state "nowhere" in equation "motion".',
      ])
    );
  });

  it("checks graph functions, figure references, note targets and durations", () => {
    const g = clone(graph);
    (g.graphs[0].items[0] as { fn: string }).fn = "2x + require(1)";
    g.notes[0].target = { element: "speed", part: "nothing" };
    g.steps[0].duration = 0;
    const geo = clone(geometry);
    (geo.figures[0].shapes[5] as { from: string }).from = "Z";
    const problems = [...validateSolutionScript(g).problems, ...validateSolutionScript(geo).problems];
    expect(problems).toEqual(
      expect.arrayContaining([
        'graphs[0].items[0].fn: Unknown name "require" in the function; use x.',
        'notes[0].target.part: "nothing" is not a part of "speed".',
        "steps[0].duration: must be seconds from 0.2 to 60.",
        "figures[0].shapes[5].from: must be [x, y] or the id of a point shape of this figure.",
      ])
    );
  });

  it("reports problems inside a course file's payload with the field name", () => {
    const broken = clone(course);
    broken.units[0].lessons[0].challenges[0].payload.solutionScript.steps[0].given = "nobody";
    expect(checkCourse(broken)).toEqual([
      "Unit 1 > lesson 1 > challenge 1 > solutionScript: steps[0].given: must be the id of a given.",
    ]);
  });

  it("keeps scripts out of the stored payload", () => {
    const { payload, script } = splitSolutionScript("MATH", challenges[0].payload);
    expect(script).toEqual(kinematics);
    expect(payload).not.toHaveProperty("solutionScript");
    expect(splitSolutionScript("SELECT", { solutionScript: 1 }).script).toBeNull();
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
  });
});

describe("graph functions", () => {
  it("parses implicit multiplication, powers and functions", () => {
    expect(compileExpression("2x")(3)).toBe(6);
    expect(compileExpression("0.5*x^2 - 3")(2)).toBe(-1);
    expect(compileExpression("-x^2")(3)).toBe(-9);
    expect(compileExpression("3(x+1)")(1)).toBe(6);
    expect(compileExpression("sqrt(9 - x^2)")(0)).toBe(3);
    expect(compileExpression("2^-1")(0)).toBe(0.5);
    expect(compileExpression("sin(pi x)")(0.5)).toBeCloseTo(1);
    expect(compileExpression("e^x")(0)).toBe(1);
  });

  it("refuses everything else", () => {
    expect(expressionProblem("x; alert(1)")).toMatch(/Unexpected/);
    expect(expressionProblem("constructor(x)")).toMatch(/Unknown name/);
    expect(expressionProblem("(x+1")).toMatch(/not closed/);
    expect(expressionProblem("sin x")).toMatch(/brackets/);
    expect(expressionProblem("")).toMatch(/empty/);
  });
});

describe("timeline", () => {
  const timeline = compileTimeline(validateSolutionScript(kinematics).script!);
  const starts = timeline.steps.map((step) => step.start);

  it("lays the steps out one after another", () => {
    expect(starts).toEqual([0, 3, 6, 9.5, 13, 16.5, 20.5]);
    expect(timeline.total).toBe(23.5);
    expect(timeline.steps[3].pairs?.sort()).toEqual(
      [
        ["d", "d"],
        ["eq", "eq"],
        ["t", "t"],
        ["v", "v"],
      ].sort()
    );
    // The substituted terms never pair with the symbols they replace.
    expect(timeline.steps[4].pairs?.sort()).toEqual([
      ["eq", "eq"],
      ["t", "t"],
    ]);
  });

  it("shows nothing but the question at the start", () => {
    const frame = frameAt(timeline, 0);
    expect(frame.step).toBe(0);
    expect(frame.opacity).toEqual({ d: 0, v: 0, motion: 0 });
    expect(frame.flights).toEqual([]);
    expect(frame.narration).toMatch(/120 metres/);
  });

  it("lifts a span into its given card", () => {
    const flying = frameAt(timeline, 0.84);
    expect(flying.spans["q-d"].active).toBe(1);
    expect(flying.flights).toHaveLength(1);
    expect(flying.flights[0]).toMatchObject({ kind: "span", from: { span: "q-d" }, to: { given: "d" } });
    expect(flying.opacity.d).toBe(0);
    const landed = frameAt(timeline, 2);
    expect(landed.flights).toEqual([]);
    expect(landed.opacity.d).toBe(1);
    expect(landed.spans["q-d"]).toEqual({ active: 0, extracted: true });
  });

  it("moves givens into the equation and morphs one state into the next", () => {
    const relate = frameAt(timeline, 6.6);
    expect(relate.equations.motion.state).toBe("rule");
    expect(relate.equations.motion.hidden.sort()).toEqual(["d", "v"]);
    expect(relate.flights.map((flight) => flight.kind)).toEqual(["symbol", "symbol"]);

    const morph = frameAt(timeline, 10.1);
    expect(morph.equations.motion.transition).toMatchObject({ from: "rule", to: "solved" });
    expect(morph.equations.motion.transition!.progress).toBeCloseTo(0.5, 5);

    const after = frameAt(timeline, 12);
    expect(after.equations.motion).toMatchObject({ state: "solved", transition: null, hidden: [] });

    const substitute = frameAt(timeline, 13.7);
    expect(substitute.equations.motion.hidden.sort()).toEqual(["dv", "vv"]);
    expect(substitute.flights.map((flight) => flight.kind)).toEqual(["value", "value"]);
  });

  it("gives the same frame for a time however the handle got there", () => {
    const times = [22, 3.1, 15.2, 0.5, 10.1, 23.5, 9.6, 13.7, 6.6, 0];
    const fresh = times.map((time) => frameAt(timeline, time));
    // Scrub forwards to the end, then backwards, then jump around.
    const scrubbed = [...times].reverse().map((time) => frameAt(timeline, time)).reverse();
    for (let k = 0; k < times.length; k++) expect(scrubbed[k]).toEqual(fresh[k]);
    // Going back before a Transform shows the earlier state again.
    expect(frameAt(timeline, 9).equations.motion.state).toBe("rule");
    expect(frameAt(timeline, 23.5).equations.motion.state).toBe("result");
    expect(frameAt(timeline, 9).equations.motion.state).toBe("rule");
  });

  it("boxes the answer and clamps times outside the timeline", () => {
    const end = frameAt(timeline, 999);
    expect(end.time).toBe(23.5);
    expect(end.step).toBe(6);
    expect(end.answer).toMatchObject({ progress: 1, term: "res", text: "The ride takes 10 s." });
    expect(end.equations.motion.box).toEqual({ term: "res", progress: 1 });
    expect(end.spans["q-ask"].active).toBe(1);
    expect(frameAt(timeline, -5).time).toBe(0);
    expect(stepAt(timeline, 13)).toBe(4);
  });

  it("draws graph items and figure shapes one after another", () => {
    const g = compileTimeline(graph);
    const mid = frameAt(g, g.steps[1].start + 1);
    expect(mid.parts.speed.line).toBeGreaterThan(0);
    expect(mid.parts.speed.line).toBeLessThan(1);
    expect(mid.parts.speed.area).toBeUndefined();
    expect(frameAt(g, g.total).parts.speed).toEqual({ line: 1, cart: 1, edge: 1, area: 1 });

    const f = compileTimeline(geometry);
    const construct = f.steps[2];
    const half = frameAt(f, construct.start + construct.motion / 2);
    const shapes = half.parts.ladder;
    expect(shapes.ground).toBe(1);
    expect(shapes.A ?? 0).toBe(0);
    expect(frameAt(f, f.total).opacity.hyp).toBe(1);
  });

  it("hides elements a step lists in hide", () => {
    const script = clone(kinematics);
    script.steps[6].hide = ["d", "v"];
    const t = compileTimeline(script);
    expect(frameAt(t, t.steps[6].start).opacity.d).toBe(1);
    expect(frameAt(t, t.total).opacity.d).toBe(0);
  });
});

describe("opening at the learner's first wrong line", () => {
  const timeline = compileTimeline(kinematics);

  it("finds the step whose state matches the corrected line", () => {
    expect(stepForWrongLine(timeline, 3, "t = 10\\,\\mathrm{s}")).toBe(5);
    expect(stepForWrongLine(timeline, 1, "t=\\frac{d}{v}")).toBe(3);
  });

  it("falls back to the n-th equation line, then the first step", () => {
    expect(equationSteps(timeline).map((step) => step.index)).toEqual([2, 3, 4, 5]);
    expect(stepForWrongLine(timeline, 3, "something else")).toBe(4);
    expect(stepForWrongLine(timeline, 9)).toBe(5);
    expect(stepForWrongLine(timeline, 0)).toBe(0);
  });

  it("shows the correct line of that step without tags", () => {
    expect(lineShownAt(timeline, 3)).toBe("t = \\frac{d}{v}");
    expect(lineShownAt(timeline, 0)).toBeNull();
  });
});
