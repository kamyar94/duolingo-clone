// Turns what compilers and programs print on the server into the error shown in the console and
// marked in the editor: a short message and, when the output names one, the line in the
// learner's file. Plain code: unit tests import it.
import type { CodeLanguage } from "../languages";
import type { RunError } from "../types";

/** A pattern and the numbers of its groups for the message, the line and the column. */
type Rule = { re: RegExp; msg?: number; line?: number; col?: number };

// Compiler messages, first error first. The file name is matched loosely: Java files are named
// after their public class, and paths are already relative to the scratch folder.
const COMPILE: Partial<Record<CodeLanguage, Rule>> = {
  csharp: { re: /^[\w.]+\.cs\((\d+),(\d+)\): error (CS\d+: .*)$/m, line: 1, col: 2, msg: 3 },
  java: { re: /^[\w$]+\.java:(\d+): error: (.*)$/m, line: 1, msg: 2 },
  kotlin: { re: /^[\w.]+\.kt:(\d+):(\d+): error: (.*)$/m, line: 1, col: 2, msg: 3 },
  c: { re: /^[\w.]+\.[ch]:(\d+):(\d+): (?:fatal )?error: (.*)$/m, line: 1, col: 2, msg: 3 },
  cpp: {
    re: /^[\w.]+\.(?:cpp|cc|h|hpp):(\d+):(\d+): (?:fatal )?error: (.*)$/m,
    line: 1,
    col: 2,
    msg: 3,
  },
  go: { re: /^(?:\.\/)?[\w.]+\.go:(\d+):(\d+): (.*)$/m, line: 1, col: 2, msg: 3 },
  rust: { re: /^(error(?:\[E\d+\])?: .*)\n\s*--> [\w.]+\.rs:(\d+):(\d+)/m, msg: 1, line: 2, col: 3 },
};

// Errors while the program runs: the message, then the first line of the learner's file in the
// stack trace. Script languages report their syntax errors this way too.
const RUNTIME: Partial<Record<CodeLanguage, { msg: Rule; where?: Rule }>> = {
  csharp: {
    msg: { re: /^Unhandled exception\. (.*)$/m, msg: 1 },
    where: { re: /in [\w./]*?[\w.]+\.cs:line (\d+)/, line: 1 },
  },
  java: {
    msg: { re: /^Exception in thread "main" (.*)$/m, msg: 1 },
    where: { re: /\([\w$]+\.java:(\d+)\)/, line: 1 },
  },
  kotlin: {
    msg: { re: /^Exception in thread "main" (.*)$/m, msg: 1 },
    where: { re: /\([\w.]+\.kt:(\d+)\)/, line: 1 },
  },
  go: {
    msg: { re: /^(panic: .*)$/m, msg: 1 },
    where: { re: /^\s+(?:\.\/)?[\w.]+\.go:(\d+)/m, line: 1 },
  },
  rust: {
    msg: { re: /panicked at [\w.]+\.rs:\d+:\d+:\n(.*)/, msg: 1 },
    where: { re: /panicked at [\w.]+\.rs:(\d+):(\d+)/, line: 1, col: 2 },
  },
  ruby: {
    msg: { re: /^main\.rb:\d+:(?:in [^:]*:)? (.*)$/m, msg: 1 },
    where: { re: /main\.rb:(\d+)/, line: 1 },
  },
  php: {
    msg: { re: /(?:Parse error|Fatal error|Warning|Error): (.*?)(?: in main\.php|$)/m, msg: 1 },
    where: { re: /main\.php(?: on line |:)(\d+)/, line: 1 },
  },
  perl: {
    msg: { re: /^(.*?) at main\.pl line \d+/m, msg: 1 },
    where: { re: /at main\.pl line (\d+)/, line: 1 },
  },
  lua: {
    msg: { re: /main\.lua:\d+: (.*)$/m, msg: 1 },
    where: { re: /main\.lua:(\d+):/, line: 1 },
  },
  bash: {
    msg: { re: /^main\.sh: line \d+: (.*)$/m, msg: 1 },
    where: { re: /^main\.sh: line (\d+):/m, line: 1 },
  },
};

const SIGNALS: Record<string, string> = {
  SIGSEGV: "Segmentation fault: the program read or wrote memory that is not its own.",
  SIGFPE: "Arithmetic error, for example a division by zero.",
  SIGABRT: "The program aborted.",
  SIGBUS: "Bus error: the program used memory in a way the machine does not allow.",
  SIGILL: "The program ran an illegal instruction.",
  SIGKILL: "The program was stopped.",
  SIGXCPU: "The program used too much processor time and was stopped.",
  SIGXFSZ: "The program wrote a file larger than allowed and was stopped.",
  SIGPIPE: "The program wrote to a closed pipe.",
  SIGTRAP: "The program stopped at a trap.",
};

const MAX_MESSAGE = 300;

const firstLine = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean) ?? "";

const clip = (text: string) =>
  text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE - 1)}…` : text;

const toNumber = (value: string | undefined) => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
};

const apply = (rule: Rule | undefined, text: string) => {
  const match = rule?.re.exec(text);
  if (!rule || !match) return null;
  return {
    message: rule.msg ? match[rule.msg]?.trim() : undefined,
    line: rule.line ? toNumber(match[rule.line]) : undefined,
    column: rule.col ? toNumber(match[rule.col]) : undefined,
  };
};

/** The first compile error, or the compiler's first line when its format is unknown. */
export const compileError = (language: CodeLanguage, output: string): RunError => {
  const found = apply(COMPILE[language], output);
  if (found?.message) return { message: clip(found.message), line: found.line, column: found.column };
  // Script languages report syntax errors as they run; their runtime rules apply.
  if (!COMPILE[language] && RUNTIME[language])
    return runtimeError(language, { stdout: "", stderr: output, exitCode: 1 });
  return { message: clip(firstLine(output) || "The program did not compile.") };
};

export type ProgramEnd = {
  stdout: string;
  stderr: string;
  exitCode: number;
  signal?: string;
};

/** The error of a program that ended with a non-zero exit code or a signal. */
export const runtimeError = (language: CodeLanguage, end: ProgramEnd): RunError => {
  const rules = RUNTIME[language];
  const text = end.stderr || end.stdout;
  const message = apply(rules?.msg, text)?.message;
  const where = apply(rules?.where, text);
  const line = where?.line;
  const column = where?.column;
  if (message) return { message: clip(message), line, column };
  const said = firstLine(end.stderr);
  if (end.signal) {
    const known = SIGNALS[end.signal] ?? `The program was ended by ${end.signal}.`;
    return { message: clip(said && end.signal === "SIGABRT" ? `${known} ${said}` : known), line };
  }
  return {
    message: clip(said || `The program ended with exit code ${end.exitCode}.`),
    line,
    column,
  };
};
