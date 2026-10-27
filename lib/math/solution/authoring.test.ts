import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  elementIds,
  emptyScript,
  mathRanges,
  mergePlainSpans,
  newStep,
  parseQuantity,
  retagStates,
  splitSpan,
  stateBefore,
  stepInto,
  suggestSymbol,
  toggleLink,
  uniqueId,
} from "./authoring";
import { DRAFT_SCHEMA, draftPrompt, draftToScript } from "./draft";
import { termIds, termPairs } from "./terms";
import type { SolutionScript } from "./types";
import { validateSolutionScript } from "./validate";

const course = JSON.parse(readFileSync(path.resolve(__dirname, "../../../courses/math-demo.json"), "utf8"));
const kinematics = course.units[0].lessons[0].challenges[0].payload.solutionScript as SolutionScript;

describe("question spans from a selection", () => {
  const statement = "A cyclist rides $120\\,\\mathrm{m}$ at $12\\,\\mathrm{m/s}$. How long?";

  it("finds the formulas of a text", () => {
    expect(mathRanges(statement).map((r) => statement.slice(r.start, r.end))).toEqual([
      "$120\\,\\mathrm{m}$",
      "$12\\,\\mathrm{m/s}$",
    ]);
    expect(mathRanges("costs \\$5 and $x$")).toEqual([{ start: 14, end: 17 }]);
  });

  it("splits a span and grows the selection to whole formulas", () => {
    const start = statement.indexOf("120");
    const result = splitSpan([{ text: statement }], 0, start, start + 3, new Set(), "q-d");
    expect(result?.id).toBe("q-d");
    expect(result?.spans.map((span) => span.text)).toEqual([
      "A cyclist rides ",
      "$120\\,\\mathrm{m}$",
      " at $12\\,\\mathrm{m/s}$. How long?",
    ]);
    expect(result?.spans.map((span) => span.text).join("")).toBe(statement);
  });

  it("keeps spaces outside, refuses empty selections and reuses whole spans", () => {
    const spans = [{ text: "go " }, { id: "q-x", text: "far" }];
    expect(splitSpan(spans, 0, 2, 3, new Set())).toBeNull();
    expect(splitSpan(spans, 1, 0, 3, new Set())).toEqual({ spans, id: "q-x" });
    const taken = new Set(["q"]);
    expect(splitSpan([{ text: "  fast  " }], 0, 0, 8, taken)?.spans).toEqual([
      { text: "  " },
      { id: "q-2", text: "fast" },
      { text: "  " },
    ]);
    expect(mergePlainSpans([{ text: "a" }, { text: "b" }, { id: "c", text: "c" }])).toEqual([
      { text: "ab" },
      { id: "c", text: "c" },
    ]);
  });

  it("reads quantities and suggests symbols", () => {
    expect(parseQuantity("$120\\,\\mathrm{m}$")).toEqual({ value: 120, unit: "m" });
    expect(parseQuantity("$12\\,\\mathrm{m/s}$")).toEqual({ value: 12, unit: "m/s" });
    expect(parseQuantity("$3$ seconds")).toEqual({ value: 3, unit: "s" });
    expect(parseQuantity("2,5 kg")).toEqual({ value: 2.5, unit: "kg" });
    expect(parseQuantity("$4\\,\\mathrm{m}$ up the wall")).toEqual({ value: 4, unit: "m" });
    expect(parseQuantity("seven")).toBeNull();
    expect(suggestSymbol("m/s")).toBe("v");
    expect(suggestSymbol("parsec")).toBe("x");
    expect(uniqueId("v_0", new Set(["v_0"]))).toBe("v_0-2");
    expect(uniqueId("\\alpha", new Set())).toBe("alpha");
    expect(uniqueId("2x", new Set())).toBe("x2x");
  });
});

describe("equation states typed by an author", () => {
  it("tags a changed state and re-tags the states after it", () => {
    const states = ["d = v t", "t = \\frac{d}{v}"].reduce<string[]>(
      (out, typed, k) => retagStates([...out, ""], k, typed),
      []
    );
    expect(termIds(states[0]).sort()).toEqual(["d", "eq", "t", "v"]);
    expect(termIds(states[1]).sort()).toEqual(["d", "eq", "t", "v"]);
    // The author renames v to u in the first state: the second keeps its own v, new id.
    const changed = retagStates(states, 0, "d = u t");
    expect(termIds(changed[0])).toContain("u");
    expect(termIds(changed[1])).toContain("t");
    expect(termIds(changed[1])).not.toContain("u");
  });

  it("links, unlinks and relinks terms by hand", () => {
    const a = "\\term{x}{x} \\term{eq}{=} \\term{n2}{2}";
    const b = "\\term{n2}{2} \\term{eq}{=} \\term{x}{x}";
    let step: { links?: [string, string][]; unlinks?: [string, string][] } = {};
    step = toggleLink(step, "x", "x", a, b);
    expect(step).toEqual({ unlinks: [["x", "x"]], links: undefined });
    expect(termPairs(a, b, step)).not.toContainEqual(["x", "x"]);
    step = toggleLink(step, "x", "n2", a, b);
    expect(step.links).toEqual([["x", "n2"]]);
    expect(termPairs(a, b, step)).toContainEqual(["x", "n2"]);
    step = toggleLink(step, "x", "n2", a, b);
    step = toggleLink(step, "x", "x", a, b);
    expect(step).toEqual({ links: undefined, unlinks: undefined });
  });

  it("knows which state an equation shows before a step and which step leads into a state", () => {
    expect(stateBefore(kinematics, 2, "motion")).toBeNull();
    expect(stateBefore(kinematics, 3, "motion")).toBe("rule");
    expect(stateBefore(kinematics, 6, "motion")).toBe("result");
    expect(stepInto(kinematics, "motion", "numbers")).toBe(4);
    expect(stepInto(kinematics, "motion", "rule")).toBe(-1);
  });

  it("creates new steps and empty scripts", () => {
    expect(newStep(kinematics, "Transform")).toMatchObject({ kind: "Transform", equation: "motion", to: "solved" });
    expect(newStep(kinematics, "Extract")).toMatchObject({ kind: "Extract", given: "d", duration: 3 });
    const empty = emptyScript("What is $1+1$?", "Sums");
    expect(empty.question).toEqual([{ text: "What is $1+1$?" }]);
    expect(validateSolutionScript(empty).problems).toEqual(["steps: needs at least one step."]);
    expect([...elementIds(kinematics)].sort()).toEqual(["d", "motion", "q-ask", "q-d", "q-v", "v"]);
  });
});

describe("AI drafts", () => {
  /** Every object closed, every property required, no length or range keywords. */
  const strictProblems = (node: unknown, at = "$"): string[] => {
    if (!node || typeof node !== "object") return [];
    const schema = node as Record<string, unknown>;
    const problems: string[] = [];
    for (const key of ["minLength", "maxLength", "minimum", "maximum", "minItems", "maxItems", "pattern", "format"])
      if (key in schema) problems.push(`${at} uses ${key}`);
    if (schema.type === "object") {
      if (schema.additionalProperties !== false) problems.push(`${at} is open`);
      const keys = Object.keys((schema.properties as object) ?? {});
      const required = (schema.required as string[]) ?? [];
      if (keys.some((key) => !required.includes(key))) problems.push(`${at} has an optional key`);
      for (const key of keys) problems.push(...strictProblems((schema.properties as Record<string, unknown>)[key], `${at}.${key}`));
    }
    if (schema.type === "array") problems.push(...strictProblems(schema.items, `${at}[]`));
    if (Array.isArray(schema.type)) problems.push(`${at} has a type list`);
    return problems;
  };

  it("asks for a schema that follows the strictest provider rules", () => {
    expect(strictProblems(DRAFT_SCHEMA)).toEqual([]);
  });

  it("puts the problem and the reference answer into the prompt", () => {
    const prompt = draftPrompt({ question: "Q", statement: "How long?", answer: "10 s", solution: ["t = d/v"] });
    expect(prompt).toContain("How long?");
    expect(prompt).toContain("10 s");
    expect(prompt).toContain("t = d/v");
  });

  it("turns a flat draft into a valid script, tagging untagged states and finding pairs", () => {
    const point = { ref: "", x: 0, y: 0 };
    const draft = {
      title: "Time",
      question: [
        { id: "", text: "A cyclist rides " },
        { id: "q-d", text: "120 m" },
        { id: "", text: " at " },
        { id: "q-v", text: "12 m/s" },
        { id: "", text: ". How long?" },
      ],
      givens: [
        { id: "d", symbol: "d", value: "120", unit: "m", span: "q-d", label: "distance" },
        { id: "v", symbol: "v", value: "12", unit: "m/s", span: "q-v", label: "" },
      ],
      equations: [
        {
          id: "eq",
          states: [
            { id: "s1", latex: "d = v t" },
            { id: "s2", latex: "t = \\frac{d}{v}" },
            { id: "s3", latex: "t = \\frac{120\\,\\mathrm{m}}{12\\,\\mathrm{m/s}} = 10\\,\\mathrm{s}" },
          ],
        },
      ],
      graphs: [],
      figures: [
        {
          id: "fig",
          width: 200,
          height: 100,
          shapes: [
            { id: "road", type: "arrow", points: [{ ...point, x: 10, y: 50 }, { ...point, x: 190, y: 50 }], r: 0, min: 0, max: 0, step: 0, text: "", flag: false, color: "blue", label: "120 m" },
          ],
        },
      ],
      tables: [],
      notes: [],
      steps: [
        { kind: "Extract", duration: 3, narration: "The distance.", target: "d", state: "", givens: [], parts: [], pairs: [], links: [], term: "", text: "", span: "" },
        { kind: "Construct", duration: 2, narration: "", target: "fig", state: "", givens: [], parts: ["road"], pairs: [], links: [], term: "", text: "", span: "" },
        { kind: "Relate", duration: 3, narration: "", target: "eq", state: "s1", givens: ["d", "v"], parts: [], pairs: [], links: [], term: "", text: "", span: "" },
        { kind: "Transform", duration: 3, narration: "", target: "eq", state: "s2", givens: [], parts: [], pairs: [], links: [], term: "", text: "", span: "" },
        { kind: "Substitute", duration: 99, narration: "", target: "eq", state: "s3", givens: [], parts: [], pairs: [], links: [], term: "", text: "", span: "" },
        { kind: "Answer", duration: 3, narration: "", target: "eq", state: "", givens: [], parts: [], pairs: [], links: [], term: "", text: "It takes 10 s.", span: "" },
      ],
    };
    const script = draftToScript(draft);
    const { problems, script: valid } = validateSolutionScript(script);
    expect(problems).toEqual([]);
    expect(termIds(valid!.equations[0].states[0].latex).sort()).toEqual(["d", "eq", "t", "v"]);
    const substitute = valid!.steps[4];
    expect(substitute.kind === "Substitute" && substitute.pairs.map((pair) => pair.given)).toEqual(["d", "v"]);
    expect(substitute.duration).toBe(20);
    expect(valid!.givens[0].value).toBe(120);
    expect(valid!.givens[1]).not.toHaveProperty("label");
    expect(valid!.figures[0].shapes[0]).toEqual({ id: "road", type: "arrow", color: "blue", label: "120 m", from: [10, 50], to: [190, 50] });
  });

  it("leaves broken drafts to the validator", () => {
    const script = draftToScript({ question: [{ id: "", text: "Q" }], steps: [{ kind: "Relate", target: "nothing", duration: 2 }] });
    expect(validateSolutionScript(script).problems).toEqual(["steps[0].equation: must be the id of an equation."]);
  });
});
