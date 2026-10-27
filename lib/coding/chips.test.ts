import { describe, expect, it } from "vitest";

import {
  assembleLines,
  checkBlanks,
  checkOrder,
  countBlanks,
  fillChips,
  fillTemplate,
  indentLevel,
  indentUnit,
  learnerSetsIndent,
  orderPieces,
  seededShuffle,
  splitTemplate,
} from "./chips";

describe("fill-in-the-blank templates", () => {
  it("finds blanks of exactly three underscores", () => {
    const template = "for i in range(___):\n    print(___)\nclass A:\n    def __init__(self): ____\n";
    expect(countBlanks(template)).toBe(2);
    expect(splitTemplate("a ___ b")).toEqual(["a ", " b"]);
    expect(countBlanks("x = my___name")).toBe(0);
    expect(countBlanks("___")).toBe(1);
  });

  it("assembles the program from the learner's values", () => {
    expect(fillTemplate("print(___ + ___)", ["1", "2"])).toBe("print(1 + 2)");
    expect(fillTemplate("print(___ + ___)", ["1"])).toBe("print(1 + )");
  });

  it("checks values against the accepted answers", () => {
    expect(checkBlanks([" 3", "i"], ["3", ["i", "x"]])).toEqual([true, true]);
    expect(checkBlanks(["4", null], ["3", "i"])).toEqual([false, false]);
  });

  it("offers one chip per blank plus distractors, in a stable shuffle", () => {
    const chips = fillChips(["3", ["i", "x"]], ["range", "len"], 42);
    expect(chips.map((c) => c.text).sort()).toEqual(["3", "i", "len", "range"]);
    expect(fillChips(["3", ["i", "x"]], ["range", "len"], 42)).toEqual(chips);
    expect(chips.map((c) => c.id)).toEqual([0, 1, 2, 3]);
  });

  it("never returns a shuffle that leaves every item in place", () => {
    for (let seed = 1; seed < 50; seed++) {
      const shuffled = seededShuffle(["a", "b"], seed);
      expect(shuffled).not.toEqual(["a", "b"]);
    }
  });
});

describe("line order", () => {
  const python = ["def double(x):", "    y = x * 2", "    return y", "print(double(4))"];

  it("guesses the indentation unit and levels", () => {
    expect(indentUnit(python)).toBe("    ");
    expect(indentUnit(["if (a) {", "  b();", "}"])).toBe("  ");
    expect(indentUnit(["a", "\tb"])).toBe("\t");
    expect(indentLevel("        x", "    ")).toBe(2);
    expect(indentLevel("\tx", "    ")).toBe(1);
  });

  it("strips indentation when the learner sets it", () => {
    const pieces = orderPieces(python, ["return x"], true, 7);
    expect(pieces).toHaveLength(5);
    expect(pieces.every((p) => p.indent === 0 && p.text === p.text.trim())).toBe(true);
    const kept = orderPieces(python, [], false, 7);
    expect(kept.find((p) => p.text === "return y")?.indent).toBe(1);
    expect(learnerSetsIndent("python")).toBe(true);
    expect(learnerSetsIndent("javascript")).toBe(false);
    expect(learnerSetsIndent("python", false)).toBe(false);
  });

  it("accepts the right order and indentation only", () => {
    const placed = [
      { text: "def double(x):", indent: 0 },
      { text: "y = x * 2", indent: 1 },
      { text: "return y", indent: 1 },
      { text: "print(double(4))", indent: 0 },
    ];
    expect(checkOrder(placed, python)).toBe(true);
    expect(checkOrder(placed.map((p) => ({ ...p, indent: p.indent + 1 })), python)).toBe(true);
    expect(checkOrder([placed[0], placed[2], placed[1], placed[3]], python)).toBe(false);
    expect(checkOrder([placed[0], { ...placed[1], indent: 0 }, placed[2], placed[3]], python)).toBe(
      false
    );
    expect(checkOrder(placed.slice(0, 3), python)).toBe(false);
    expect(assembleLines(placed, "    ")).toBe(python.join("\n") + "\n");
  });

  it("treats identical lines as interchangeable", () => {
    const lines = ["print(1)", "print(1)", "print(2)"];
    const pieces = orderPieces(lines, [], false, 3);
    const ones = pieces.filter((p) => p.text === "print(1)");
    const two = pieces.find((p) => p.text === "print(2)")!;
    expect(checkOrder([ones[1], ones[0], two], lines)).toBe(true);
  });
});
