// Payload shapes of the coding exercise types (docs/DESIGN-coding-and-math.md, section 4.6) and
// the shapes that runs and checks produce. Plain types only, shared by the browser, the server
// and the course import script.
import type { CodeLanguage } from "./languages";

/** How a printed output is compared with the expected text. */
export type MatchMode = "exact" | "normalized" | "regex";

/** A primitive cell of an SQL result. Binary values are shown as hex text. */
export type SqlCell = string | number | null;

/**
 * One test of a program. Three kinds, told apart by their fields:
 * - a function test has `call` (an expression in the program's language) and `expect` (an
 *   expression for the expected value); JavaScript, TypeScript and Python only;
 * - an SQL test has `query` (run after the learner's statements) or compares the learner's own
 *   last result, by `rows` or by printed text in `expect`;
 * - every other test feeds `stdin` to the program and compares what it prints with `expect`.
 */
export type CodeTest = {
  name?: string;
  /** Visible tests show expected and actual values; hidden ones only pass or fail. Default true. */
  visible?: boolean;
  call?: string;
  stdin?: string;
  query?: string;
  expect?: string;
  rows?: SqlCell[][];
  /** SQL rows must come in this order. Default true. */
  ordered?: boolean;
  /** For printed output. Default "normalized". */
  match?: MatchMode;
  /** Allowed difference for numbers in function tests and SQL rows. Default 1e-9. */
  tolerance?: number;
};

/** A check of the rendered page of a web exercise. */
export type WebCheck = {
  name?: string;
  visible?: boolean;
  /** CSS selector. Without other fields the check passes when at least one element matches. */
  selector: string;
  /** Exact number of matching elements. */
  count?: number;
  /** Text of the first matching element (whitespace normalised). */
  text?: string;
  textMatch?: "exact" | "contains" | "regex";
  /** Computed style of the first matching element, for example { "color": "red" }. */
  style?: Record<string, string>;
  /** Attributes of the first matching element. */
  attr?: Record<string, string>;
};

type Common = {
  language: CodeLanguage;
  /** Wall-clock limit of one run in milliseconds. Default 3000, at most 20000. */
  timeLimitMs?: number;
  /** SQL only: statements that create and fill the tables before the learner's code runs. */
  setup?: string;
};

export type CodeReadPayload = Common & {
  code: string;
  /** Explanation shown above the program (plain text, paragraphs separated by blank lines). */
  text?: string;
  /** Text fed to input() when the program runs. */
  stdin?: string;
  /** The learner may change the program. Default true. */
  editable?: boolean;
};

export type CodeOutputPayload = Common & {
  code: string;
  /** What the program prints. */
  expect: string;
  /** Answers to choose from (must include the expected output). Without choices the learner types. */
  choices?: string[];
  match?: Exclude<MatchMode, "regex">;
  stdin?: string;
};

export type CodeFillPayload = Common & {
  /** The program with each blank written as ___ (three underscores, not part of a longer word). */
  template: string;
  /** Accepted text per blank, in order. Required unless tests decide. */
  answers?: (string | string[])[];
  /** Extra chips that do not belong in any blank. */
  distractors?: string[];
  /** When given, the completed program must pass these tests instead of matching `answers`. */
  tests?: CodeTest[];
};

export type CodeOrderPayload = Common & {
  /** The program's lines in the right order, with their indentation. */
  lines: string[];
  /** Extra lines that do not belong in the program. */
  distractors?: string[];
  /**
   * The learner sets the indentation of each line (true) or lines keep their own (false).
   * Default true for Python, false otherwise.
   */
  indent?: boolean;
  /** When given, the assembled program must pass these tests instead of matching `lines`. */
  tests?: CodeTest[];
};

export type CodeWritePayload = Common & {
  starter?: string;
  tests: CodeTest[];
  stdin?: string;
  /** A reference solution for authors. Never sent to the browser. */
  solution?: string;
};

export type WebLivePayload = {
  html?: string;
  css?: string;
  js?: string;
  checks: WebCheck[];
  /** Tabs that can be edited. Default all three. */
  editable?: ("html" | "css" | "js")[];
  /** A reference solution for authors. Never sent to the browser. */
  solution?: { html?: string; css?: string; js?: string };
};

export type CodingPayload =
  | CodeReadPayload
  | CodeOutputPayload
  | CodeFillPayload
  | CodeOrderPayload
  | CodeWritePayload
  | WebLivePayload;

// ---- runs ----

export type RunStatus = "ok" | "error" | "timeout" | "cancelled" | "unavailable";

export type RunError = {
  message: string;
  /** 1-based line in the learner's code, when known. */
  line?: number;
  column?: number;
};

export type RunEvent = {
  stream: "stdout" | "stderr" | "info";
  text: string;
};

export type CallSpec = { call: string; expect: string; tolerance?: number };

export type CallResult = {
  passed: boolean;
  actual?: string;
  expected?: string;
  error?: string;
};

export type SqlResultSet = { columns: string[]; rows: SqlCell[][] };

export type QueryResult = {
  output: string;
  sets: SqlResultSet[];
  error?: string;
};

export type RunRequest = {
  language: CodeLanguage;
  code: string;
  stdin?: string;
  calls?: CallSpec[];
  setup?: string;
  queries?: string[];
  timeLimitMs?: number;
};

export type RunResult = {
  status: RunStatus;
  stdout: string;
  stderr: string;
  error?: RunError;
  calls?: CallResult[];
  /** SQL: the result sets of the learner's own statements. */
  sets?: SqlResultSet[];
  /** SQL: one result per requested query. */
  queries?: QueryResult[];
  /** Output went over the cap and was cut. */
  truncated?: boolean;
  durationMs?: number;
};

// ---- checks ----

export type TestOutcome = {
  index: number;
  name: string;
  visible: boolean;
  passed: boolean;
  /** Visible tests only. */
  expected?: string;
  actual?: string;
  message?: string;
  /** Line in the learner's code the failure belongs to, when known. */
  line?: number;
};

export type CheckReport = {
  outcomes: TestOutcome[];
  passed: number;
  total: number;
  allPassed: boolean;
  /** Set when the program could not be checked at all (runtime missing, runner unavailable). */
  unavailable?: string;
  error?: RunError;
};
