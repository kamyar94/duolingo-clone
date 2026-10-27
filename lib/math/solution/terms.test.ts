import { describe, expect, it } from "vitest";

import {
  autoTag,
  normalizeLatex,
  parseTerms,
  stripTerms,
  termForValue,
  termIds,
  termPairs,
} from "./terms";

describe("tagged terms", () => {
  it("finds nested tags with their parents", () => {
    const { terms, problems } = parseTerms(
      "\\term{t}{t} = \\term{rhs}{\\frac{\\term{d}{d}}{\\term{v}{v}}}"
    );
    expect(problems).toEqual([]);
    expect(terms.map((term) => [term.id, term.body, term.parent])).toEqual([
      ["t", "t", null],
      ["rhs", "\\frac{\\term{d}{d}}{\\term{v}{v}}", null],
      ["d", "d", "rhs"],
      ["v", "v", "rhs"],
    ]);
  });

  it("reports bad ids, duplicates and missing braces", () => {
    expect(parseTerms("\\term{1x}{a}").problems[0]).toMatch(/must start with a letter/);
    expect(parseTerms("\\term{a}{x} + \\term{a}{y}").problems[0]).toMatch(/used twice/);
    expect(parseTerms("\\term{a} x").problems[0]).toMatch(/needs the term in braces/);
    expect(parseTerms("\\term{a}{x").problems[0]).toMatch(/not closed/);
    // \\term is a line break followed by the word term, not a tag.
    expect(parseTerms("a \\\\term{b}").terms).toEqual([]);
  });

  it("strips tags back to plain LaTeX", () => {
    expect(stripTerms("\\term{t}{t} = \\frac{\\term{d}{d}}{\\term{v}{v}}")).toBe(
      "t = \\frac{d}{v}"
    );
    expect(stripTerms("x^{\\term{n2}{2}}")).toBe("x^{2}");
  });

  it("normalises spacing for comparisons", () => {
    expect(normalizeLatex("120 \\, \\mathrm{m}")).toBe(normalizeLatex("120\\mathrm{m}"));
    expect(normalizeLatex("\\left( a \\right)")).toBe("(a)");
    expect(normalizeLatex("\\dfrac{1}{2}")).toBe("\\frac{1}{2}");
  });
});

describe("automatic tagging", () => {
  it("tags letters, quantities and the equals sign of a first state", () => {
    const tagged = autoTag("d = v t");
    expect(tagged).toBe("\\term{d}{d} \\term{eq}{=} \\term{v}{v} \\term{t}{t}");
    expect(stripTerms(tagged)).toBe("d = v t");
  });

  it("keeps the ids of identical subexpressions from the state before", () => {
    const first = autoTag("d = v t");
    const second = autoTag("t = \\frac{d}{v}", first);
    expect(termIds(second).sort()).toEqual(["d", "eq", "t", "v"]);
    expect(second).toBe("\\term{t}{t} \\term{eq}{=} \\frac{\\term{d}{d}}{\\term{v}{v}}");
  });

  it("matches longer terms first and keeps inner terms", () => {
    const previous = "\\term{y}{y} = \\term{rhs}{\\frac{\\term{a}{a}}{\\term{b}{b}}}";
    const next = autoTag("2y = 2\\frac{a}{b}", previous);
    const ids = termIds(next);
    expect(ids).toContain("rhs");
    expect(ids).toContain("a");
    expect(ids).toContain("y");
    expect(parseTerms(next).terms.find((term) => term.id === "a")?.parent).toBe("rhs");
  });

  it("treats a number with its unit as one term and gives new ids that do not collide", () => {
    const previous = "\\term{t}{t} \\term{eq}{=} \\frac{\\term{d}{d}}{\\term{v}{v}}";
    const next = autoTag("t = \\frac{120\\,\\mathrm{m}}{12\\,\\mathrm{m/s}}", previous);
    const { terms } = parseTerms(next);
    expect(terms.map((term) => term.body)).toEqual([
      "t",
      "=",
      "120\\,\\mathrm{m}",
      "12\\,\\mathrm{m/s}",
    ]);
    expect(terms.map((term) => term.id)).not.toContain("d");
    // No letters inside \mathrm become terms.
    expect(terms.some((term) => term.body === "m")).toBe(false);
  });

  it("wraps a tagged superscript in braces and never tags script arguments alone", () => {
    const tagged = autoTag("x^2 + v_0");
    expect(termIds(tagged)).toEqual(["x", "v_0"]);
    const next = autoTag("y = x^2", "\\term{sq}{x^2}");
    expect(termIds(next)).toContain("sq");
    const scripted = autoTag("a^{b}", "\\term{b}{b}");
    expect(scripted).toBe("\\term{a}{a}^{\\term{b}{b}}");
  });
});

describe("term pairs between states", () => {
  const a = "\\term{d}{d} \\term{eq}{=} \\term{v}{v} \\term{t}{t}";
  const b = "\\term{t}{t} \\term{eq}{=} \\frac{\\term{d}{d}}{\\term{v}{v}}";

  it("pairs the same ids", () => {
    expect(termPairs(a, b).sort()).toEqual(
      [
        ["d", "d"],
        ["eq", "eq"],
        ["t", "t"],
        ["v", "v"],
      ].sort()
    );
  });

  it("pairs identical content under different ids", () => {
    expect(termPairs("\\term{x}{120}", "\\term{n120}{120}")).toEqual([["x", "n120"]]);
  });

  it("applies hand links and unlinks", () => {
    const pairs = termPairs(a, b, { unlinks: [["eq", "eq"]], links: [["v", "t"]] });
    expect(pairs).toContainEqual(["v", "t"]);
    expect(pairs).not.toContainEqual(["t", "t"]);
    expect(pairs).not.toContainEqual(["eq", "eq"]);
    expect(pairs).toContainEqual(["v", "v"]);
  });

  it("leaves out terms filled by a substitution", () => {
    const filled = "\\term{t}{t} = \\frac{\\term{d}{120}}{\\term{v}{12}}";
    expect(termPairs(b, filled, { exclude: ["d", "v"] })).toEqual([["t", "t"]]);
  });

  it("finds the term that holds a given's value", () => {
    const state = "\\term{t}{t} = \\frac{\\term{dv}{120\\,\\mathrm{m}}}{\\term{vv}{12\\,\\mathrm{m/s}}}";
    expect(termForValue(state, 120, "m")).toBe("dv");
    expect(termForValue(state, 12, "m/s")).toBe("vv");
    expect(termForValue(state, 7)).toBeNull();
  });
});
