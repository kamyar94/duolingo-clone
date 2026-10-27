// The app's side of the code runners (section 4.4): picks the runner of a language's family,
// sends the program with the shared token and turns the runner's answer into a RunResult. Used
// by app/api/code/run only; it reads RUNNER_URL_<FAMILY> and RUNNER_TOKEN from the environment.
import { languageInfo, type CodeLanguage } from "../languages";
import type { RunResult } from "../types";

import { compileError, runtimeError } from "./diagnostics";
import type { ServerRun } from "./request";

/** Runner images (runners/<family>/Dockerfile) and the languages each one serves. */
export const RUNNER_FAMILIES = {
  dotnet: ["csharp"],
  jvm: ["java", "kotlin"],
  native: ["c", "cpp"],
  go: ["go"],
  rust: ["rust"],
  script: ["ruby", "php", "perl", "lua", "bash"],
} as const satisfies Record<string, readonly CodeLanguage[]>;

export type RunnerFamily = keyof typeof RUNNER_FAMILIES;

export const familyOf = (language: CodeLanguage): RunnerFamily | null => {
  for (const [family, languages] of Object.entries(RUNNER_FAMILIES))
    if ((languages as readonly string[]).includes(language)) return family as RunnerFamily;
  return null;
};

type Env = Record<string, string | undefined>;

/** The runner address for a language, from RUNNER_URL_<FAMILY>, or null when none is set. */
export const runnerUrl = (language: CodeLanguage, env: Env = process.env) => {
  const family = familyOf(language);
  const url = family ? env[`RUNNER_URL_${family.toUpperCase()}`]?.trim() : undefined;
  return url ? url.replace(/\/+$/, "") : null;
};

/** Server languages that have a runner address and a token. */
export const serverLanguages = (env: Env = process.env) =>
  (env.RUNNER_TOKEN ?? "").length >= 24
    ? (Object.values(RUNNER_FAMILIES).flat() as CodeLanguage[]).filter((language) =>
        runnerUrl(language, env)
      )
    : [];

// ---- the runner's answer (runners/service/execute.go, job.go) ----

export type RunnerStep = {
  exitCode: number;
  signal?: string;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  truncated: boolean;
  oomKilled: boolean;
  cancelled?: boolean;
};

export type RunnerResponse = {
  language: string;
  compile?: RunnerStep;
  runs: RunnerStep[];
  queueMs: number;
};

const OUTPUT_CAP_KB = 64;

const unavailable = (message: string): RunResult => ({
  status: "unavailable",
  stdout: "",
  stderr: "",
  error: { message },
});

/** One run of the program as the lesson's runners report it. */
export const stepResult = (language: CodeLanguage, step: RunnerStep): RunResult => {
  const base = {
    stdout: step.stdout,
    stderr: step.stderr,
    durationMs: step.durationMs,
    ...(step.truncated ? { truncated: true } : {}),
  };
  if (step.cancelled) return { ...base, status: "cancelled" };
  if (step.timedOut) return { ...base, status: "timeout" };
  if (step.truncated)
    return {
      ...base,
      status: "ok",
      error: { message: `The program printed more than ${OUTPUT_CAP_KB} KB and was stopped.` },
    };
  if (step.oomKilled)
    return {
      ...base,
      status: "ok",
      error: { message: "The program used too much memory and was stopped." },
    };
  if (step.exitCode === 0 && !step.signal) return { ...base, status: "ok" };
  return { ...base, status: "ok", error: runtimeError(language, step) };
};

/** The runner's answer as a RunResult: one run, or one per input in `runs` for a batch. */
export const toRunResult = (run: ServerRun, response: RunnerResponse): RunResult => {
  const { language } = run;
  const compile = response.compile;
  if (compile && (compile.exitCode !== 0 || compile.timedOut || compile.cancelled)) {
    const output = [compile.stdout, compile.stderr].filter(Boolean).join("\n");
    if (compile.cancelled) return { status: "cancelled", stdout: "", stderr: output };
    return {
      status: "ok",
      stdout: "",
      stderr: output,
      durationMs: compile.durationMs,
      error: compile.timedOut
        ? { message: "Compiling took too long and was stopped." }
        : compile.oomKilled
          ? { message: "The compiler ran out of memory." }
          : compileError(language, output),
    };
  }
  const compileOutput = compile
    ? [compile.stdout, compile.stderr].filter(Boolean).join("\n").trim() || undefined
    : undefined;
  const runs = response.runs.map((step) => stepResult(language, step));
  if (!runs.length) return unavailable("The runner returned no result.");
  if (run.batch)
    return {
      status: "ok",
      stdout: "",
      stderr: "",
      runs,
      compileOutput,
      durationMs: runs.reduce((sum, single) => sum + (single.durationMs ?? 0), 0),
    };
  return { ...runs[0], ...(compileOutput ? { compileOutput } : {}) };
};

export type RunOnServerOptions = {
  env?: Env;
  fetch?: typeof fetch;
  signal?: AbortSignal;
  /** Pause before the one retry when a runner is restarting. */
  retryDelayMs?: number;
};

/** Time to wait for the runner: queue, compile, every run, and some slack. */
export const requestTimeoutMs = (run: ServerRun) =>
  30_000 + 60_000 + run.inputs.length * (run.timeLimitMs + 2_000) + 10_000;

/**
 * Sends a checked run to the runner of its language family and returns what the lesson shows.
 * A missing or unreachable runner, a busy one or a refused token make the result "unavailable",
 * which the lesson treats as "cannot check now" rather than as a wrong answer.
 */
export const runOnServer = async (
  run: ServerRun,
  { env = process.env, fetch: fetchImpl = fetch, signal, retryDelayMs = 1500 }: RunOnServerOptions = {}
): Promise<RunResult> => {
  const label = languageInfo(run.language).label;
  const url = runnerUrl(run.language, env);
  const token = env.RUNNER_TOKEN ?? "";
  if (!url || token.length < 24)
    return unavailable(`${label} programs cannot run on this server yet: no runner is set up for them.`);

  const body = JSON.stringify({
    language: run.language,
    files: [{ name: languageInfo(run.language).file, content: run.code }],
    runs: run.inputs.map((stdin) => ({ stdin })),
    timeLimitMs: run.timeLimitMs,
  });
  const timeout = AbortSignal.timeout(requestTimeoutMs(run));
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  let response: Response | null = null;
  for (let attempt = 0; attempt < 2 && !response; attempt++) {
    try {
      response = await fetchImpl(`${url}/run`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body,
        signal: combined,
        cache: "no-store",
      });
    } catch {
      if (signal?.aborted) return { status: "cancelled", stdout: "", stderr: "" };
      if (timeout.aborted) return unavailable(`The ${label} runner did not answer in time.`);
      // A runner that recycles itself is back within a second or two.
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
  if (!response) return unavailable(`The ${label} runner is not running on this server.`);

  if (response.status === 503)
    return unavailable("The server is busy running other programs. Try again in a moment.");
  if (response.status === 401) {
    console.error(`code runner for ${run.language} refused the token; check RUNNER_TOKEN`);
    return unavailable(`The ${label} runner is not set up correctly on this server.`);
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return unavailable(`The ${label} runner gave an answer the app does not understand.`);
  }
  if (response.status === 400) {
    const reason = (data as { error?: unknown })?.error;
    return {
      status: "error",
      stdout: "",
      stderr: "",
      error: { message: `The runner refused the program: ${typeof reason === "string" ? reason : "bad request"}.` },
    };
  }
  if (!response.ok || !Array.isArray((data as RunnerResponse)?.runs))
    return unavailable(`The ${label} runner could not run the program.`);
  return toRunResult(run, data as RunnerResponse);
};
