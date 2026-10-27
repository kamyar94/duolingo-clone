import { describe, expect, it } from "vitest";

import {
  evaluateCallTests,
  evaluateIoTest,
  evaluateSqlTest,
  findFunctionLine,
  formatResultSets,
  matchOutput,
  normalizeOutput,
  rowsEqual,
  summarize,
} from "./tests";
import type { RunResult } from "./types";

const ok = (stdout: string, extra: Partial<RunResult> = {}): RunResult => ({
  status: "ok",
  stdout,
  stderr: "",
  ...extra,
});

describe("output matching", () => {
  it("compares exactly, ignoring line endings and one final newline", () => {
    expect(matchOutput("7\n", "7", "exact")).toBe(true);
    expect(matchOutput("7\r\n", "7\n", "exact")).toBe(true);
    expect(matchOutput("7 \n", "7", "exact")).toBe(false);
    expect(matchOutput("a\n\n", "a", "exact")).toBe(false);
  });

  it("normalises whitespace by default", () => {
    expect(normalizeOutput("  a   b \t\n\nc  \n\n")).toBe("a b\n\nc");
    expect(matchOutput("Hello,   world!  \n", "Hello, world!")).toBe(true);
    expect(matchOutput("Hello, world", "Hello, world!")).toBe(false);
  });

  it("searches a regular expression across lines", () => {
    expect(matchOutput("count: 42\n", "^count: \\d+$", "regex")).toBe(true);
    expect(matchOutput("count: x\n", "^count: \\d+$", "regex")).toBe(false);
    expect(matchOutput("x", "(", "regex")).toBe(false);
  });
});

describe("input and output tests", () => {
  it("shows expected and actual output for a visible test", () => {
    const outcome = evaluateIoTest({ stdin: "3\n4\n", expect: "7" }, 0, ok("8\n"));
    expect(outcome).toMatchObject({
      name: "Test 1",
      visible: true,
      passed: false,
      expected: "7",
      actual: "8\n",
      message: "The output is different.",
    });
  });

  it("keeps only pass or fail for a hidden test", () => {
    const outcome = evaluateIoTest(
      { name: "Big numbers", expect: "7", visible: false },
      2,
      ok("8")
    );
    expect(outcome).toEqual({
      index: 2,
      name: "Big numbers",
      visible: false,
      passed: false,
      line: undefined,
    });
  });

  it("reports errors with their line and time-outs", () => {
    const failed = evaluateIoTest({ expect: "1" }, 0, {
      status: "ok",
      stdout: "",
      stderr: "",
      error: { message: "NameError: name 'x' is not defined", line: 3 },
    });
    expect(failed).toMatchObject({
      passed: false,
      line: 3,
      message: "Line 3: NameError: name 'x' is not defined",
    });
    const slow = evaluateIoTest({ expect: "1" }, 0, { ...ok(""), status: "timeout" });
    expect(slow.message).toMatch(/too long/);
  });
});

describe("function tests", () => {
  const tests = [
    { test: { call: "area(2, 3)", expect: "6" }, index: 0 },
    { test: { call: "area(0.5, 4)", expect: "2.0", visible: false }, index: 1 },
  ];

  it("maps call results to outcomes and points failures at the function", () => {
    const outcomes = evaluateCallTests(
      tests,
      ok("", {
        calls: [
          { passed: false, actual: "5", expected: "6" },
          { passed: true, actual: "2.0", expected: "2.0" },
        ],
      }),
      () => 1
    );
    expect(outcomes[0]).toMatchObject({
      passed: false,
      actual: "5",
      expected: "6",
      line: 1,
      message: "area(2, 3) returned 5, expected 6.",
    });
    expect(outcomes[1]).toEqual({
      index: 1,
      name: "Test 2",
      visible: false,
      passed: true,
      line: undefined,
    });
  });

  it("fails every call when the program did not get that far", () => {
    const outcomes = evaluateCallTests(tests, {
      status: "ok",
      stdout: "",
      stderr: "",
      error: { message: "SyntaxError: invalid syntax", line: 2 },
    });
    expect(outcomes.map((o) => o.passed)).toEqual([false, false]);
    expect(outcomes[0].message).toBe("area(2, 3): Line 2: SyntaxError: invalid syntax");
    expect(outcomes[1].line).toBe(2);
  });

  it("finds where a function is defined", () => {
    const python = "import math\n\ndef area(w, h):\n    return w * h\n";
    expect(findFunctionLine(python, "area(2, 3)")).toBe(3);
    const js = "// helpers\nconst double = (x) => x * 2;\nfunction area(w, h) {}\n";
    expect(findFunctionLine(js, "area(1, 2)")).toBe(3);
    expect(findFunctionLine(js, "double(4)")).toBe(2);
    expect(findFunctionLine(js, "missing()")).toBeUndefined();
  });
});

describe("SQL tests", () => {
  const sets = [
    {
      columns: ["name", "age"],
      rows: [
        ["Ada", 36],
        ["Alan", 41],
      ],
    },
  ];

  it("prints result sets with a header line", () => {
    expect(formatResultSets(sets)).toBe("name | age\nAda | 36\nAlan | 41");
    expect(formatResultSets([{ columns: ["x"], rows: [[null]] }])).toBe("x\nNULL");
  });

  it("compares rows in order or as a set, numbers with a tolerance", () => {
    expect(rowsEqual([["Ada", 36]], [["Ada", "36"]])).toBe(true);
    expect(rowsEqual([[0.1 + 0.2]], [[0.3]])).toBe(true);
    expect(rowsEqual([["a"], ["b"]], [["b"], ["a"]])).toBe(false);
    expect(rowsEqual([["a"], ["b"]], [["b"], ["a"]], false)).toBe(true);
    expect(rowsEqual([[null]], [["NULL"]])).toBe(false);
  });

  it("checks the learner's last result, or a check query", () => {
    const run = ok("", { sets, queries: [{ output: "n\n2", sets: [{ columns: ["n"], rows: [[2]] }] }] });
    expect(
      evaluateSqlTest({ rows: [["Alan", 41], ["Ada", 36]], ordered: false }, 0, run).passed
    ).toBe(true);
    expect(evaluateSqlTest({ expect: "name | age\nAda | 36\nAlan | 41" }, 1, run).passed).toBe(
      true
    );
    const query = run.queries![0];
    expect(evaluateSqlTest({ query: "SELECT count(*) AS n FROM people", rows: [[2]] }, 2, run, query).passed).toBe(true);
    expect(
      evaluateSqlTest({ query: "SELECT 1", expect: "x" }, 3, run, { output: "", sets: [], error: "no such table" })
    ).toMatchObject({ passed: false, message: "The check query failed: no such table" });
  });
});

describe("summaries", () => {
  it("counts passes and needs at least one test", () => {
    expect(summarize([])).toMatchObject({ total: 0, allPassed: false });
    const report = summarize([
      { index: 1, name: "b", visible: true, passed: true },
      { index: 0, name: "a", visible: true, passed: true },
    ]);
    expect(report).toMatchObject({ passed: 2, total: 2, allPassed: true });
    expect(report.outcomes.map((o) => o.name)).toEqual(["a", "b"]);
  });
});
