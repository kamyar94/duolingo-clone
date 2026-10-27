import { describe, expect, it } from "vitest";

import { checkChallengePayload, toClientPayload } from "@/lib/exercises/payload";
import type { ChallengeType } from "@/lib/exercises/types";

const check = (
  type: ChallengeType,
  payload: unknown,
  options: { text: string; correct?: boolean }[] = []
) => checkChallengePayload(type, payload, { question: "Q", options });

describe("coding payloads", () => {
  it("accepts the CODE_WRITE example of the design spec", () => {
    expect(
      check("CODE_WRITE", {
        language: "python",
        starter: "def area(w, h):\n    pass\n",
        tests: [
          { call: "area(2, 3)", expect: "6", visible: true },
          { call: "area(0.5, 4)", expect: "2.0", visible: false },
        ],
        timeLimitMs: 3000,
      })
    ).toEqual([]);
  });

  it("needs a known language and sane limits", () => {
    expect(check("CODE_WRITE", { tests: [{ expect: "1" }] })[0]).toMatch(
      /payload.language is required/
    );
    expect(check("CODE_WRITE", { language: "cobol", tests: [{ expect: "1" }] })).toEqual([
      'payload.language "cobol" is not a supported language.',
    ]);
    expect(
      check("CODE_WRITE", { language: "python", tests: [{ expect: "1" }], timeLimitMs: 60000 })
    ).toEqual(["payload.timeLimitMs must be a whole number from 100 to 20000."]);
    expect(
      check("CODE_WRITE", { language: "python", tests: [{ expect: "1" }], setup: "x" })
    ).toEqual(["payload.setup is only for SQL exercises."]);
  });

  it("names unknown fields, so typos do not pass silently", () => {
    expect(
      check("CODE_WRITE", { language: "python", test: [], tests: [{ expect: "1", visibel: false }] })
    ).toEqual([
      'payload has an unknown field "test".',
      'payload.tests[0] has an unknown field "visibel".',
    ]);
  });

  it("checks every kind of test", () => {
    expect(check("CODE_WRITE", { language: "python", tests: [] })).toEqual([
      "payload.tests must be a list of tests.",
    ]);
    expect(
      check("CODE_WRITE", {
        language: "csharp",
        tests: [{ call: "Area(2, 3)", expect: "6" }, { stdin: "1", expect: "(", match: "regex" }],
      })
    ).toEqual([
      "payload.tests[0]: function tests (call) are not available for csharp.",
      "payload.tests[1].expect is not a valid regular expression.",
    ]);
    expect(
      check("CODE_WRITE", {
        language: "javascript",
        tests: [{ call: "area(2, ", expect: "6" }, { call: "f()" }],
      })
    ).toEqual([
      "payload.tests[0].call is not a JavaScript expression.",
      "payload.tests[1] needs expect, the expected value of the call.",
    ]);
    expect(
      check("CODE_WRITE", {
        language: "python",
        tests: [{ query: "SELECT 1", expect: "1" }],
      })
    ).toEqual(["payload.tests[0]: query and rows are only for SQL exercises."]);
    expect(
      check("CODE_WRITE", {
        language: "sql",
        setup: "CREATE TABLE t (x);",
        tests: [{ rows: [[1, "a", null]] }, { query: "SELECT 1" }, { rows: [1] }],
      })
    ).toEqual([
      "payload.tests[1] needs rows or expect.",
      "payload.tests[2].rows must be a list of rows, each a list of text, numbers or null.",
    ]);
  });

  it("requires the buggy program of a CODE_FIX", () => {
    expect(check("CODE_FIX", { language: "python", tests: [{ expect: "1" }] })).toEqual([
      "payload.starter is required.",
    ]);
  });

  it("validates CODE_READ and CODE_OUTPUT", () => {
    expect(check("CODE_READ", { language: "python", code: "print(1)", text: "Hi" })).toEqual([]);
    expect(check("CODE_READ", { language: "python" })).toEqual(["payload.code is required."]);
    expect(
      check("CODE_OUTPUT", {
        language: "javascript",
        code: "console.log(1 + 1)",
        expect: "2",
        choices: ["2", "11"],
      })
    ).toEqual([]);
    expect(
      check("CODE_OUTPUT", {
        language: "javascript",
        code: "console.log(1 + 1)",
        expect: "2",
        choices: ["3", "11"],
      })
    ).toEqual(["payload.choices must include the expected output."]);
    expect(
      check(
        "CODE_OUTPUT",
        { language: "javascript", code: "console.log(1 + 1)" },
        [
          { text: "2", correct: true },
          { text: "11" },
        ]
      )
    ).toEqual([]);
    expect(check("CODE_OUTPUT", { language: "javascript", code: "x" })).toEqual([
      "payload.expect, the printed output, is required.",
    ]);
  });

  it("validates CODE_FILL blanks against the answers", () => {
    expect(
      check("CODE_FILL", {
        language: "python",
        template: "for i in range(___):\n    print(___)\n",
        answers: ["3", ["i", "i * 1"]],
        distractors: ["x"],
      })
    ).toEqual([]);
    expect(
      check("CODE_FILL", { language: "python", template: "print(___)", answers: ["1", "2"] })
    ).toEqual(["payload.answers has 2 entries but the template has 1 blanks."]);
    expect(check("CODE_FILL", { language: "python", template: "print(1)" })).toEqual([
      "payload.template needs at least one blank written as ___.",
      "payload needs answers, tests or both.",
    ]);
    expect(
      check("CODE_FILL", {
        language: "python",
        template: "print(___)",
        tests: [{ expect: "1" }],
      })
    ).toEqual([]);
  });

  it("validates CODE_ORDER lines", () => {
    expect(
      check("CODE_ORDER", { language: "python", lines: ["def f():", "    return 1"], indent: true })
    ).toEqual([]);
    expect(check("CODE_ORDER", { language: "python", lines: ["only one"] })).toEqual([
      "payload.lines must list at least two lines of the program.",
    ]);
  });

  it("validates WEB_LIVE checks", () => {
    expect(
      check("WEB_LIVE", {
        html: "<button>Buy</button>",
        css: "button { color: red; }",
        checks: [{ selector: "button", text: "Buy", style: { color: "red" } }],
      })
    ).toEqual([]);
    expect(
      check("WEB_LIVE", {
        language: "python",
        checks: [{ selector: "", count: -1, style: { color: 1 } }],
        editable: ["php"],
      })
    ).toEqual([
      'payload.language of a WEB_LIVE exercise can only be "web".',
      "payload.editable must list some of html, css and js.",
      "payload.checks[0].selector is required.",
      "payload.checks[0].count must be a whole number.",
      "payload.checks[0].style must map names to text values.",
    ]);
  });

  it("keeps reference solutions out of the browser", () => {
    expect(
      toClientPayload("CODE_WRITE", {
        language: "python",
        tests: [{ call: "f()", expect: "1" }],
        solution: "def f(): return 1",
      })
    ).toEqual({ language: "python", tests: [{ call: "f()", expect: "1" }] });
    expect(toClientPayload("WEB_LIVE", { checks: [], solution: { html: "x" } })).toEqual({
      checks: [],
    });
  });
});
