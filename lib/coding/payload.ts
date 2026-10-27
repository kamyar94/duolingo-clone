// Payload rules for the coding exercise types (CODE_READ ... WEB_LIVE). See
// lib/exercises/payload-types.ts for the contract and lib/exercises/payload.ts for the checks
// every type already gets. Keep this file free of Next.js and database imports, and use
// relative imports only: the course import script bundles it.
import type {
  PayloadContext,
  PayloadRules,
  PayloadRuleSet,
} from "../exercises/payload-types";

import { countBlanks } from "./chips";
import { CODE_LANGUAGES, isCodeLanguage, type CodeLanguage } from "./languages";

export const MAX_TIME_LIMIT_MS = 20_000;
export const DEFAULT_TIME_LIMIT_MS = 3_000;

type Payload = Record<string, unknown>;

const isObject = (value: unknown): value is Payload =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === "string";

const MATCH_MODES = ["exact", "normalized", "regex"];
const TEST_FIELDS = [
  "name",
  "visible",
  "call",
  "stdin",
  "query",
  "expect",
  "rows",
  "ordered",
  "match",
  "tolerance",
];
const CHECK_FIELDS = ["name", "visible", "selector", "count", "text", "textMatch", "style", "attr"];
const WEB_TABS = ["html", "css", "js"];

const unknownFields = (value: Payload, allowed: string[], where: string) =>
  Object.keys(value)
    .filter((key) => !allowed.includes(key))
    .map((key) => `${where} has an unknown field "${key}".`);

/** Whether a JavaScript expression parses (function tests of JavaScript and TypeScript). */
const parsesAsJs = (expression: string) => {
  try {
    new Function(`return (${expression}\n);`);
    return true;
  } catch {
    return false;
  }
};

const optionalString = (payload: Payload, key: string, problems: string[], where = "payload") => {
  if (payload[key] !== undefined && !isString(payload[key]))
    problems.push(`${where}.${key} must be text.`);
};

const optionalBoolean = (payload: Payload, key: string, problems: string[], where = "payload") => {
  if (payload[key] !== undefined && typeof payload[key] !== "boolean")
    problems.push(`${where}.${key} must be true or false.`);
};

const stringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(isString);

const checkLanguage = (payload: Payload, problems: string[]): CodeLanguage | null => {
  if (!isString(payload.language)) {
    problems.push(
      `payload.language is required (one of ${Object.keys(CODE_LANGUAGES)
        .filter((id) => id !== "web")
        .join(", ")}).`
    );
    return null;
  }
  if (!isCodeLanguage(payload.language) || payload.language === "web") {
    problems.push(`payload.language "${payload.language}" is not a supported language.`);
    return null;
  }
  return payload.language;
};

const checkCommon = (payload: Payload, language: CodeLanguage | null, problems: string[]) => {
  const limit = payload.timeLimitMs;
  if (
    limit !== undefined &&
    !(typeof limit === "number" && Number.isInteger(limit) && limit >= 100 && limit <= MAX_TIME_LIMIT_MS)
  )
    problems.push(`payload.timeLimitMs must be a whole number from 100 to ${MAX_TIME_LIMIT_MS}.`);
  optionalString(payload, "setup", problems);
  if (payload.setup !== undefined && language && language !== "sql")
    problems.push("payload.setup is only for SQL exercises.");
  optionalString(payload, "stdin", problems);
};

const checkRegex = (pattern: string, where: string, problems: string[]) => {
  try {
    new RegExp(pattern, "m");
  } catch {
    problems.push(`${where} is not a valid regular expression.`);
  }
};

const isCell = (value: unknown) =>
  value === null || typeof value === "string" || typeof value === "number";

export const checkTests = (
  tests: unknown,
  language: CodeLanguage | null,
  problems: string[],
  required: boolean
) => {
  if (tests === undefined) {
    if (required) problems.push("payload.tests must list at least one test.");
    return;
  }
  if (!Array.isArray(tests) || (required && tests.length === 0)) {
    problems.push("payload.tests must be a list of tests.");
    return;
  }
  const info = language ? CODE_LANGUAGES[language] : null;
  tests.forEach((test: unknown, i) => {
    const where = `payload.tests[${i}]`;
    if (!isObject(test)) {
      problems.push(`${where} must be an object.`);
      return;
    }
    problems.push(...unknownFields(test, TEST_FIELDS, where));
    for (const key of ["name", "call", "stdin", "query", "expect"])
      optionalString(test, key, problems, where);
    optionalBoolean(test, "visible", problems, where);
    optionalBoolean(test, "ordered", problems, where);
    if (test.match !== undefined && !MATCH_MODES.includes(test.match as string))
      problems.push(`${where}.match must be exact, normalized or regex.`);
    if (
      test.tolerance !== undefined &&
      !(typeof test.tolerance === "number" && test.tolerance >= 0)
    )
      problems.push(`${where}.tolerance must be a number of at least 0.`);

    if (test.call !== undefined) {
      if (info && !info.functionTests)
        problems.push(`${where}: function tests (call) are not available for ${language}.`);
      if (!isString(test.expect))
        problems.push(`${where} needs expect, the expected value of the call.`);
      if (language === "javascript" || language === "typescript") {
        if (isString(test.call) && !parsesAsJs(test.call))
          problems.push(`${where}.call is not a JavaScript expression.`);
        if (isString(test.expect) && !parsesAsJs(test.expect))
          problems.push(`${where}.expect is not a JavaScript expression.`);
      }
      return;
    }
    if (test.query !== undefined || test.rows !== undefined) {
      if (language && language !== "sql")
        problems.push(`${where}: query and rows are only for SQL exercises.`);
      if (
        test.rows !== undefined &&
        !(
          Array.isArray(test.rows) &&
          test.rows.every((row) => Array.isArray(row) && row.every(isCell))
        )
      )
        problems.push(`${where}.rows must be a list of rows, each a list of text, numbers or null.`);
      if (test.rows === undefined && !isString(test.expect))
        problems.push(`${where} needs rows or expect.`);
    } else if (!isString(test.expect)) {
      problems.push(`${where} needs expect, the expected output.`);
    }
    if (test.match === "regex" && isString(test.expect))
      checkRegex(test.expect, `${where}.expect`, problems);
  });
};

const checkWebChecks = (checks: unknown, problems: string[]) => {
  if (!Array.isArray(checks) || checks.length === 0) {
    problems.push("payload.checks must list at least one check of the page.");
    return;
  }
  checks.forEach((check: unknown, i) => {
    const where = `payload.checks[${i}]`;
    if (!isObject(check)) {
      problems.push(`${where} must be an object.`);
      return;
    }
    problems.push(...unknownFields(check, CHECK_FIELDS, where));
    if (!isString(check.selector) || !check.selector.trim())
      problems.push(`${where}.selector is required.`);
    optionalString(check, "name", problems, where);
    optionalString(check, "text", problems, where);
    optionalBoolean(check, "visible", problems, where);
    if (
      check.count !== undefined &&
      !(typeof check.count === "number" && Number.isInteger(check.count) && check.count >= 0)
    )
      problems.push(`${where}.count must be a whole number.`);
    if (
      check.textMatch !== undefined &&
      !["exact", "contains", "regex"].includes(check.textMatch as string)
    )
      problems.push(`${where}.textMatch must be exact, contains or regex.`);
    if (check.textMatch === "regex" && isString(check.text))
      checkRegex(check.text, `${where}.text`, problems);
    for (const key of ["style", "attr"] as const)
      if (
        check[key] !== undefined &&
        !(isObject(check[key]) && Object.values(check[key] as Payload).every(isString))
      )
        problems.push(`${where}.${key} must map names to text values.`);
  });
};

/** Reference solutions are for authors; the learner's browser never receives them. */
export const stripSolution = (payload: unknown) => {
  if (!isObject(payload) || !("solution" in payload)) return payload;
  const rest = { ...payload };
  delete rest.solution;
  return rest;
};

const COMMON_FIELDS = ["language", "timeLimitMs", "setup"];

const rule = (
  fields: string[],
  validate: (
    payload: Payload,
    language: CodeLanguage | null,
    problems: string[],
    context: PayloadContext
  ) => void
): PayloadRules => ({
  validate: (payload, context) => {
    const problems: string[] = [];
    const language = checkLanguage(payload, problems);
    checkCommon(payload, language, problems);
    problems.push(...unknownFields(payload, [...COMMON_FIELDS, ...fields], "payload"));
    validate(payload, language, problems, context);
    return problems;
  },
  toClient: stripSolution,
});

const requireString = (payload: Payload, key: string, problems: string[]) => {
  if (!isString(payload[key]) || !payload[key].trim())
    problems.push(`payload.${key} is required.`);
};

const sameText = (a: string, b: string) =>
  a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();

const codeRead = rule(["code", "text", "stdin", "editable"], (payload, _language, problems) => {
  requireString(payload, "code", problems);
  optionalString(payload, "text", problems);
  optionalBoolean(payload, "editable", problems);
});

const codeOutput = rule(
  ["code", "expect", "choices", "match", "stdin"],
  (payload, _language, problems, context) => {
    requireString(payload, "code", problems);
    // The answers may also come as the challenge's options, the correct one being the output.
    const fromOptions = context.options.length > 0;
    if (payload.expect !== undefined ? !isString(payload.expect) : !fromOptions)
      problems.push("payload.expect, the printed output, is required.");
    if (fromOptions && payload.choices !== undefined)
      problems.push("Give the answers either as options or as payload.choices, not both.");
    if (payload.match !== undefined && !["exact", "normalized"].includes(payload.match as string))
      problems.push("payload.match must be exact or normalized.");
    if (payload.choices !== undefined) {
      if (!stringList(payload.choices) || payload.choices.length < 2)
        problems.push("payload.choices must list at least two answers.");
      else if (
        isString(payload.expect) &&
        !payload.choices.some((choice) => sameText(choice, payload.expect as string))
      )
        problems.push("payload.choices must include the expected output.");
    }
  }
);

const codeFill = rule(
  ["template", "answers", "distractors", "tests"],
  (payload, language, problems) => {
    if (!isString(payload.template)) {
      problems.push("payload.template is required.");
      return;
    }
    const blanks = countBlanks(payload.template);
    if (blanks === 0) problems.push("payload.template needs at least one blank written as ___.");
    if (payload.answers === undefined) {
      if (payload.tests === undefined) problems.push("payload needs answers, tests or both.");
    } else if (
      !Array.isArray(payload.answers) ||
      !payload.answers.every(
        (answer) =>
          (isString(answer) && answer.trim() !== "") ||
          (stringList(answer) && answer.length > 0)
      )
    )
      problems.push(
        "payload.answers must list, per blank, the accepted text or a list of accepted texts."
      );
    else if (payload.answers.length !== blanks)
      problems.push(
        `payload.answers has ${payload.answers.length} entries but the template has ${blanks} blanks.`
      );
    if (payload.distractors !== undefined && !stringList(payload.distractors))
      problems.push("payload.distractors must be a list of text.");
    checkTests(payload.tests, language, problems, false);
  }
);

const codeOrder = rule(
  ["lines", "distractors", "indent", "tests"],
  (payload, language, problems) => {
    if (
      !stringList(payload.lines) ||
      payload.lines.filter((line) => line.trim() !== "").length < 2
    )
      problems.push("payload.lines must list at least two lines of the program.");
    if (payload.distractors !== undefined && !stringList(payload.distractors))
      problems.push("payload.distractors must be a list of text.");
    optionalBoolean(payload, "indent", problems);
    checkTests(payload.tests, language, problems, false);
  }
);

const codeWrite = (needsStarter: boolean) =>
  rule(["starter", "tests", "stdin", "solution"], (payload, language, problems) => {
    if (needsStarter) requireString(payload, "starter", problems);
    else optionalString(payload, "starter", problems);
    optionalString(payload, "solution", problems);
    checkTests(payload.tests, language, problems, true);
  });

const webLive: PayloadRules = {
  validate: (payload) => {
    const problems: string[] = [];
    problems.push(
      ...unknownFields(
        payload,
        ["language", "html", "css", "js", "checks", "editable", "solution", "timeLimitMs"],
        "payload"
      )
    );
    if (payload.language !== undefined && payload.language !== "web")
      problems.push('payload.language of a WEB_LIVE exercise can only be "web".');
    for (const key of ["html", "css", "js"]) optionalString(payload, key, problems);
    if (
      payload.editable !== undefined &&
      !(stringList(payload.editable) && payload.editable.every((tab) => WEB_TABS.includes(tab)))
    )
      problems.push("payload.editable must list some of html, css and js.");
    if (payload.solution !== undefined && !isObject(payload.solution))
      problems.push("payload.solution must hold html, css and js texts.");
    checkWebChecks(payload.checks, problems);
    return problems;
  },
  toClient: stripSolution,
};

export const codingPayloadRules: PayloadRuleSet = {
  CODE_READ: codeRead,
  CODE_OUTPUT: codeOutput,
  CODE_FILL: codeFill,
  CODE_ORDER: codeOrder,
  CODE_WRITE: codeWrite(false),
  CODE_FIX: codeWrite(true),
  WEB_LIVE: webLive,
};
