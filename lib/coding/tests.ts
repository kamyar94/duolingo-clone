// Turns raw run results into test outcomes (section 4.5). Pure functions: the browser uses them
// after a run, and the unit tests use them without any runtime.
import type {
  CallResult,
  CheckReport,
  CodeTest,
  MatchMode,
  QueryResult,
  RunError,
  RunResult,
  SqlCell,
  SqlResultSet,
  TestOutcome,
} from "./types";

export const DEFAULT_TOLERANCE = 1e-9;

/** Line endings to \n, no trailing spaces, inner runs of spaces and tabs as one, no blank lines at either end. */
export const normalizeOutput = (text: string) =>
  text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/^\n+|\n+$/g, "");

/** Line endings to \n and one final newline ignored, since print() adds it. */
const exactForm = (text: string) =>
  text.replace(/\r\n?/g, "\n").replace(/\n$/, "");

export const matchOutput = (
  actual: string,
  expected: string,
  mode: MatchMode = "normalized"
): boolean => {
  if (mode === "exact") return exactForm(actual) === exactForm(expected);
  if (mode === "regex") {
    try {
      return new RegExp(expected, "m").test(actual.replace(/\r\n?/g, "\n"));
    } catch {
      return false;
    }
  }
  return normalizeOutput(actual) === normalizeOutput(expected);
};

export const testKind = (test: CodeTest): "call" | "sql" | "io" =>
  test.call !== undefined
    ? "call"
    : test.query !== undefined || test.rows !== undefined
      ? "sql"
      : "io";

const testName = (test: CodeTest, index: number) =>
  test.name?.trim() || `Test ${index + 1}`;

const shorten = (text: string, max = 2000) =>
  text.length > max ? `${text.slice(0, max)}…` : text;

const errorText = (error?: RunError) =>
  error ? (error.line ? `Line ${error.line}: ${error.message}` : error.message) : "";

/** Hidden tests keep only their name and whether they passed. */
const finish = (outcome: TestOutcome): TestOutcome =>
  outcome.visible
    ? outcome
    : {
        index: outcome.index,
        name: outcome.name,
        visible: false,
        passed: outcome.passed,
        line: outcome.passed ? undefined : outcome.line,
      };

/** An input and output test: the program ran with the test's stdin. */
export const evaluateIoTest = (
  test: CodeTest,
  index: number,
  run: RunResult
): TestOutcome => {
  const base = {
    index,
    name: testName(test, index),
    visible: test.visible !== false,
  };
  const expected = test.expect ?? "";
  if (run.status === "timeout")
    return finish({
      ...base,
      passed: false,
      expected,
      actual: shorten(run.stdout),
      message: "The program took too long and was stopped.",
    });
  if (run.status !== "ok" || run.error)
    return finish({
      ...base,
      passed: false,
      expected,
      actual: shorten(run.stdout),
      message: errorText(run.error) || "The program did not finish.",
      line: run.error?.line,
    });
  const passed = matchOutput(run.stdout, expected, test.match);
  return finish({
    ...base,
    passed,
    expected,
    actual: shorten(run.stdout),
    message: passed
      ? undefined
      : test.match === "regex"
        ? "The output does not match the expected pattern."
        : "The output is different.",
  });
};

/** Function tests: one run evaluated every call; results come in the order of `tests`. */
export const evaluateCallTests = (
  tests: { test: CodeTest; index: number }[],
  run: RunResult,
  functionLine?: (call: string) => number | undefined
): TestOutcome[] =>
  tests.map(({ test, index }, i) => {
    const base = {
      index,
      name: testName(test, index),
      visible: test.visible !== false,
    };
    const result: CallResult | undefined = run.calls?.[i];
    const line = test.call ? functionLine?.(test.call) : undefined;
    if (!result) {
      const message =
        run.status === "timeout"
          ? "The program took too long and was stopped."
          : errorText(run.error) || "The function was not called.";
      return finish({
        ...base,
        passed: false,
        expected: test.expect,
        message: `${test.call}: ${message}`,
        line: run.error?.line ?? line,
      });
    }
    return finish({
      ...base,
      passed: result.passed,
      expected: result.expected ?? test.expect,
      actual: result.actual,
      message: result.passed
        ? undefined
        : result.error
          ? `${test.call}: ${result.error}`
          : `${test.call} returned ${result.actual ?? "nothing"}, expected ${result.expected ?? test.expect}.`,
      line: result.passed ? undefined : line,
    });
  });

// ---- SQL ----

const cellText = (cell: SqlCell) => (cell === null ? "NULL" : String(cell));

/** Result sets printed the way the console shows them: a header line, then one line per row. */
export const formatResultSets = (sets: SqlResultSet[]) =>
  sets
    .map((set) =>
      [set.columns.join(" | "), ...set.rows.map((row) => row.map(cellText).join(" | "))].join(
        "\n"
      )
    )
    .join("\n\n");

const cellsEqual = (actual: SqlCell, expected: SqlCell, tolerance: number) => {
  if (actual === null || expected === null) return actual === expected;
  const a = Number(actual);
  const e = Number(expected);
  if (
    typeof actual === "number" ||
    typeof expected === "number"
  ) {
    if (Number.isFinite(a) && Number.isFinite(e) && String(actual).trim() !== "" && String(expected).trim() !== "")
      return Math.abs(a - e) <= tolerance;
  }
  return String(actual) === String(expected);
};

export const rowsEqual = (
  actual: SqlCell[][],
  expected: SqlCell[][],
  ordered = true,
  tolerance = DEFAULT_TOLERANCE
) => {
  if (actual.length !== expected.length) return false;
  const rowEq = (a: SqlCell[], e: SqlCell[]) =>
    a.length === e.length && a.every((cell, i) => cellsEqual(cell, e[i], tolerance));
  if (ordered) return actual.every((row, i) => rowEq(row, expected[i]));
  const left = [...expected];
  for (const row of actual) {
    const at = left.findIndex((candidate) => rowEq(row, candidate));
    if (at < 0) return false;
    left.splice(at, 1);
  }
  return true;
};

const showRows = (rows: SqlCell[][]) =>
  rows.map((row) => row.map(cellText).join(" | ")).join("\n");

/**
 * An SQL test. With `query`, `query` is that query's result; otherwise the learner's own
 * output (the last result set for `rows`, all printed sets for `expect`).
 */
export const evaluateSqlTest = (
  test: CodeTest,
  index: number,
  run: RunResult,
  query?: QueryResult
): TestOutcome => {
  const base = {
    index,
    name: testName(test, index),
    visible: test.visible !== false,
  };
  if (run.status !== "ok" || run.error)
    return finish({
      ...base,
      passed: false,
      message:
        run.status === "timeout"
          ? "The statements took too long and were stopped."
          : errorText(run.error) || "The statements did not finish.",
      line: run.error?.line,
    });
  if (test.query !== undefined && (!query || query.error))
    return finish({
      ...base,
      passed: false,
      message: `The check query failed: ${query?.error ?? "no result"}`,
    });

  const sets = test.query !== undefined ? query!.sets : (run.sets ?? []);
  const output = test.query !== undefined ? query!.output : formatResultSets(sets);

  if (test.rows) {
    const last = sets.at(-1)?.rows ?? [];
    const passed = rowsEqual(last, test.rows, test.ordered !== false, test.tolerance);
    return finish({
      ...base,
      passed,
      expected: showRows(test.rows),
      actual: shorten(showRows(last)),
      message: passed ? undefined : "The rows are different.",
    });
  }
  const passed = matchOutput(output, test.expect ?? "", test.match);
  return finish({
    ...base,
    passed,
    expected: test.expect ?? "",
    actual: shorten(output),
    message: passed ? undefined : "The result is different.",
  });
};

export const summarize = (
  outcomes: TestOutcome[],
  extra: Partial<CheckReport> = {}
): CheckReport => {
  const sorted = [...outcomes].sort((a, b) => a.index - b.index);
  const passed = sorted.filter((outcome) => outcome.passed).length;
  return {
    outcomes: sorted,
    passed,
    total: sorted.length,
    allPassed: sorted.length > 0 && passed === sorted.length && !extra.unavailable,
    ...extra,
  };
};

/**
 * The line where a function used in a call is defined, so a failing function test can be
 * shown next to it. Finds `def name`, `function name`, `name =` and `name(` method forms.
 */
export const findFunctionLine = (code: string, call: string) => {
  const name = /^\s*(?:await\s+)?([A-Za-z_$][\w$]*)/.exec(call)?.[1];
  if (!name) return undefined;
  const escaped = name.replace(/\$/g, "\\$");
  const pattern = new RegExp(
    `^\\s*(?:export\\s+)?(?:async\\s+)?(?:def\\s+${escaped}\\b|function\\s*\\*?\\s*${escaped}\\b|(?:const|let|var)\\s+${escaped}\\b|class\\s+${escaped}\\b)`
  );
  const lines = code.split("\n");
  const at = lines.findIndex((line) => pattern.test(line));
  return at >= 0 ? at + 1 : undefined;
};
