// Checks a program against its tests (section 4.5) through any runner: input and output tests
// run the program once each (server languages send all inputs in one request, so the program
// compiles once), function tests share one run, SQL tests share one run with their check
// queries. The outcome is computed by lib/coding/tests.ts.
import { languageInfo } from "./languages";
import {
  evaluateCallTests,
  evaluateIoTest,
  evaluateSqlTest,
  findFunctionLine,
  summarize,
  testKind,
} from "./tests";
import type {
  CheckReport,
  CodeTest,
  RunEvent,
  RunRequest,
  RunResult,
  TestOutcome,
} from "./types";
import type { CodeLanguage } from "./languages";

export type RunFn = (
  request: RunRequest,
  onEvent?: (event: RunEvent) => void
) => Promise<RunResult>;

export type CheckOptions = {
  language: CodeLanguage;
  code: string;
  tests: CodeTest[];
  setup?: string;
  timeLimitMs?: number;
  onEvent?: (event: RunEvent) => void;
};

const unavailable = (result: RunResult) =>
  result.status === "unavailable"
    ? result.error?.message || "This program cannot run here yet."
    : undefined;

export const checkProgram = async (
  run: RunFn,
  { language, code, tests, setup, timeLimitMs, onEvent }: CheckOptions
): Promise<CheckReport> => {
  const outcomes: TestOutcome[] = [];
  const indexed = tests.map((test, index) => ({ test, index }));
  const base = { language, code, setup, timeLimitMs };
  let firstError: RunResult["error"];

  const calls = indexed.filter(({ test }) => testKind(test) === "call");
  const sql = indexed.filter(({ test }) => testKind(test) === "sql");
  const io = indexed.filter(({ test }) => testKind(test) === "io");

  if (calls.length) {
    if (!languageInfo(language).functionTests)
      throw new Error(`${language} has no function tests.`);
    const result = await run(
      {
        ...base,
        calls: calls.map(({ test }) => ({
          call: test.call!,
          expect: test.expect ?? "undefined",
          tolerance: test.tolerance,
        })),
      },
      onEvent
    );
    const missing = unavailable(result);
    if (missing) return summarize([], { unavailable: missing });
    firstError ??= result.error;
    outcomes.push(
      ...evaluateCallTests(calls, result, (call) => findFunctionLine(code, call))
    );
  }

  if (sql.length || (language === "sql" && io.length)) {
    const all = [...sql, ...(language === "sql" ? io : [])];
    const queries = all
      .map(({ test }) => test.query)
      .filter((query): query is string => query !== undefined);
    const result = await run({ ...base, queries }, onEvent);
    const missing = unavailable(result);
    if (missing) return summarize([], { unavailable: missing });
    firstError ??= result.error;
    let q = 0;
    for (const { test, index } of all) {
      const query = test.query !== undefined ? result.queries?.[q++] : undefined;
      outcomes.push(evaluateSqlTest(test, index, result, query));
    }
  }

  // A server language compiles once and runs every input in one request.
  if (language !== "sql" && io.length > 1 && languageInfo(language).runtime === "server") {
    const result = await run({ ...base, inputs: io.map(({ test }) => test.stdin ?? "") }, onEvent);
    const missing = unavailable(result);
    if (missing) return summarize([], { unavailable: missing });
    firstError ??= result.error ?? result.runs?.find((single) => single.error)?.error;
    io.forEach(({ test, index }, i) =>
      // Without its own result (the program did not compile), each test gets the whole result.
      outcomes.push(evaluateIoTest(test, index, result.runs?.[i] ?? result))
    );
  } else if (language !== "sql")
    for (const { test, index } of io) {
      const result = await run({ ...base, stdin: test.stdin ?? "" }, onEvent);
      const missing = unavailable(result);
      if (missing) return summarize([], { unavailable: missing });
      firstError ??= result.error;
      outcomes.push(evaluateIoTest(test, index, result));
    }

  return summarize(outcomes, firstError ? { error: firstError } : {});
};
