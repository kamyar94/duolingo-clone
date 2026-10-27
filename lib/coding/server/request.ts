// The run requests the browser sends to /api/code/run for languages that run on the server
// (section 4.4), checked before anything reaches a runner. Plain code: unit tests import it.
import { isCodeLanguage, languageInfo, type CodeLanguage } from "../languages";
import { DEFAULT_TIME_LIMIT_MS, MAX_TIME_LIMIT_MS } from "../payload";

/** Largest program, in characters. */
export const MAX_CODE = 64 * 1024;
/** Largest standard input of one run, in characters. */
export const MAX_STDIN = 64 * 1024;
/** Most inputs (runs after one compile) in one request: one per test of an exercise. */
export const MAX_INPUTS = 20;
/** Largest request body the route reads, in bytes. */
export const MAX_BODY = 1024 * 1024;

export type ServerRun = {
  language: CodeLanguage;
  code: string;
  /** One run per input; a plain run has one input (its stdin). */
  inputs: string[];
  /** Whether the browser asked for several inputs, so the answer carries `runs`. */
  batch: boolean;
  timeLimitMs: number;
};

export type ParsedRun = { ok: true; run: ServerRun } | { ok: false; error: string };

const ALLOWED = new Set(["language", "code", "stdin", "inputs", "timeLimitMs"]);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Checks a request from the browser. Only server languages, a program of at most MAX_CODE
 * characters, at most MAX_INPUTS inputs of at most MAX_STDIN characters each and a time limit
 * within the lesson limits are accepted. Fields of browser runs (calls, queries, setup) are not.
 */
export const parseServerRun = (body: unknown): ParsedRun => {
  if (!isPlainObject(body)) return { ok: false, error: "The request is not a run." };
  const unknown = Object.keys(body).filter((key) => !ALLOWED.has(key));
  if (unknown.length) return { ok: false, error: `Unknown field ${unknown[0]}.` };

  const { language, code, stdin, inputs, timeLimitMs } = body;
  if (!isCodeLanguage(language) || languageInfo(language).runtime !== "server")
    return { ok: false, error: "This language does not run on the server." };
  if (typeof code !== "string") return { ok: false, error: "The program is missing." };
  if (code.length > MAX_CODE)
    return { ok: false, error: `The program is longer than ${MAX_CODE / 1024} KB.` };
  if (code.includes("\u0000")) return { ok: false, error: "The program contains a NUL character." };

  let list: string[];
  if (inputs !== undefined) {
    if (stdin !== undefined) return { ok: false, error: "Send stdin or inputs, not both." };
    if (
      !Array.isArray(inputs) ||
      inputs.length === 0 ||
      inputs.length > MAX_INPUTS ||
      !inputs.every((input) => typeof input === "string")
    )
      return { ok: false, error: `inputs must be 1 to ${MAX_INPUTS} texts.` };
    list = inputs as string[];
  } else {
    if (stdin !== undefined && typeof stdin !== "string")
      return { ok: false, error: "stdin must be text." };
    list = [stdin ?? ""];
  }
  if (list.some((input) => input.length > MAX_STDIN))
    return { ok: false, error: `An input is longer than ${MAX_STDIN / 1024} KB.` };

  let limit = DEFAULT_TIME_LIMIT_MS;
  if (timeLimitMs !== undefined) {
    if (typeof timeLimitMs !== "number" || !Number.isFinite(timeLimitMs))
      return { ok: false, error: "timeLimitMs must be a number." };
    limit = Math.min(Math.max(Math.round(timeLimitMs), 100), MAX_TIME_LIMIT_MS);
  }

  return {
    ok: true,
    run: { language, code, inputs: list, batch: inputs !== undefined, timeLimitMs: limit },
  };
};
