import { describe, expect, it } from "vitest";

import { runJsInVm, runSqlInNode } from "@/tests/helpers/coding-runners";

import { checkProgram } from "./check";
import { buildJsProgram, PRELUDE_LINES } from "./js-harness";

describe("the JavaScript harness", () => {
  it("folds the prelude into one line before the learner's code", () => {
    const { source, lineOffset } = buildJsProgram({ code: "let a = 1;\nlet b = 2;" });
    expect(lineOffset).toBe(PRELUDE_LINES);
    expect(source.split("\n")[PRELUDE_LINES]).toBe("let a = 1;");
  });

  it("captures console output, input() and formats values", async () => {
    const result = await runJsInVm({
      language: "javascript",
      code: [
        "const name = input();",
        "console.log('Hi', name, [1, 'two', { three: 3 }], null);",
        "console.error('careful');",
        "console.log(input(), input());",
      ].join("\n"),
      stdin: "Ada\n42\n",
    });
    expect(result.stdout).toBe('Hi Ada [1, "two", { three: 3 }] null\n42 null\n');
    expect(result.stderr).toBe("careful\n");
  });

  it("waits for timers before finishing", async () => {
    const result = await runJsInVm({
      language: "javascript",
      code: "setTimeout(() => console.log('later'), 20);\nconsole.log('now');",
    });
    expect(result.stdout).toBe("now\nlater\n");
  });

  it("caps the output", async () => {
    const { source } = buildJsProgram({ code: "for (;;) console.log('x'.repeat(100));", outputLimit: 1000 });
    expect(source).toContain('"limit":1000');
  });

  it("points runtime errors at the learner's line", async () => {
    const result = await runJsInVm({
      language: "javascript",
      code: "const a = 1;\n\nundefinedFunction();\n",
    });
    expect(result.error).toMatchObject({ line: 3 });
    expect(result.error?.message).toMatch(/ReferenceError/);
  });
});

describe("checking programs against their tests", () => {
  it("runs JavaScript function tests with deep equality and tolerance", async () => {
    const report = await checkProgram(runJsInVm, {
      language: "javascript",
      code: [
        "function area(w, h) { return w * h; }",
        "const pair = (a, b) => [a, { b }];",
        "async function later(x) { return x + 1; }",
      ].join("\n"),
      tests: [
        { call: "area(2, 3)", expect: "6" },
        { call: "area(0.1, 3)", expect: "0.3" },
        { call: "pair(1, 'x')", expect: "[1, { b: 'x' }]" },
        { call: "later(1)", expect: "2", visible: false },
        { call: "area(2, 2)", expect: "5" },
        { call: "missing(1)", expect: "1" },
      ],
    });
    expect(report.outcomes.map((o) => o.passed)).toEqual([true, true, true, true, false, false]);
    expect(report.outcomes[4]).toMatchObject({ actual: "4", expected: "5", line: 1 });
    expect(report.outcomes[5].message).toMatch(/ReferenceError: missing is not defined/);
    expect(report.outcomes[3]).toEqual({
      index: 3,
      name: "Test 4",
      visible: false,
      passed: true,
      line: undefined,
    });
    expect(report).toMatchObject({ passed: 4, total: 6, allPassed: false });
  });

  it("runs input and output tests once per test", async () => {
    const report = await checkProgram(runJsInVm, {
      language: "javascript",
      code: "const a = Number(input());\nconst b = Number(input());\nconsole.log(a + b);\n",
      tests: [
        { stdin: "3\n4\n", expect: "7" },
        { stdin: "10\n-3\n", expect: "7", match: "exact" },
        { stdin: "1\n1\n", expect: "^\\d$", match: "regex", visible: false },
        { stdin: "1\n2\n", expect: "4" },
      ],
    });
    expect(report.outcomes.map((o) => o.passed)).toEqual([true, true, true, false]);
    expect(report.outcomes[3]).toMatchObject({ expected: "4", actual: "3\n" });
  });

  it("checks SQL exercises with sql.js", async () => {
    const setup =
      "CREATE TABLE people (name TEXT, age INTEGER);\nINSERT INTO people VALUES ('Ada', 36), ('Alan', 41), ('Grace', 85);";
    const tests = [
      { rows: [["Grace"], ["Alan"]] },
      { expect: "name\nGrace\nAlan", visible: false },
    ];
    const right = await checkProgram(runSqlInNode, {
      language: "sql",
      setup,
      code: "SELECT name FROM people WHERE age > 40 ORDER BY age DESC;",
      tests,
    });
    expect(right.allPassed).toBe(true);

    const wrongOrder = await checkProgram(runSqlInNode, {
      language: "sql",
      setup,
      code: "SELECT name FROM people WHERE age > 40 ORDER BY age;",
      tests,
    });
    expect(wrongOrder.outcomes.map((o) => o.passed)).toEqual([false, false]);
    expect(wrongOrder.outcomes[0]).toMatchObject({ expected: "Grace\nAlan", actual: "Alan\nGrace" });
  });

  it("checks SQL changes with a query and reports errors on their line", async () => {
    const setup = "CREATE TABLE items (name TEXT);";
    const tests = [{ query: "SELECT count(*) FROM items", rows: [[2]] }];
    const added = await checkProgram(runSqlInNode, {
      language: "sql",
      setup,
      code: "INSERT INTO items VALUES ('a');\nINSERT INTO items VALUES ('b');",
      tests,
    });
    expect(added.allPassed).toBe(true);

    const broken = await checkProgram(runSqlInNode, {
      language: "sql",
      setup,
      code: "INSERT INTO items VALUES ('a');\n\n-- second\nINSERT INTO itemz VALUES ('b');",
      tests,
    });
    expect(broken.outcomes[0]).toMatchObject({ passed: false, line: 4 });
    expect(broken.outcomes[0].message).toMatch(/no such table: itemz/);
  });

  it("reports a broken setup as the exercise's fault", async () => {
    const result = await runSqlInNode({ language: "sql", setup: "CREATE TABL x;", code: "SELECT 1;" });
    expect(result.error?.message).toMatch(/setup failed on line 1/);
  });
});
