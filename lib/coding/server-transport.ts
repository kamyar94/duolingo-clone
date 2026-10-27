// The browser side of the code runners on the server (section 4.4): sends a run of a server
// language to /api/code/run with the session cookie and replays the output it gets back as
// console events. browser-runner.ts installs it with setServerRunnerTransport.
import { languageInfo } from "./languages";
import type { ServerRunnerTransport } from "./runner";
import type { RunEvent, RunRequest, RunResult } from "./types";

export const SERVER_RUN_PATH = "/api/code/run";

let current: AbortController | null = null;

const unavailable = (message: string): RunResult => ({
  status: "unavailable",
  stdout: "",
  stderr: "",
  error: { message },
});

/** The body the route expects: only the fields a server run uses. */
export const serverRunBody = (request: RunRequest) => ({
  language: request.language,
  code: request.code,
  ...(request.inputs ? { inputs: request.inputs } : { stdin: request.stdin ?? "" }),
  ...(request.timeLimitMs !== undefined ? { timeLimitMs: request.timeLimitMs } : {}),
});

/** Passes one result's output on as console events, compiler warnings first. */
export const replayEvents = (result: RunResult, onEvent: (event: RunEvent) => void) => {
  if (result.compileOutput) onEvent({ stream: "info", text: `${result.compileOutput}\n` });
  for (const single of result.runs ?? [result]) {
    if (single.stdout) onEvent({ stream: "stdout", text: single.stdout });
    if (single.stderr) onEvent({ stream: "stderr", text: single.stderr });
  }
};

export const createServerTransport = (
  fetchImpl: typeof fetch = (...args) => fetch(...args)
): { transport: ServerRunnerTransport; cancel: () => void } => {
  const transport: ServerRunnerTransport = async (request, onEvent) => {
    current?.abort();
    const mine = new AbortController();
    current = mine;
    onEvent?.({
      stream: "info",
      text: `Running on the server (${languageInfo(request.language).label})…\n`,
    });
    try {
      const response = await fetchImpl(SERVER_RUN_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(serverRunBody(request)),
        credentials: "same-origin",
        signal: mine.signal,
      });
      let data: unknown = null;
      try {
        data = await response.json();
      } catch {
        // handled below
      }
      if (!response.ok) {
        const message = (data as { error?: unknown } | null)?.error;
        if (response.status === 401)
          return unavailable("Your session has ended. Sign in again to run programs.");
        return unavailable(
          typeof message === "string" ? message : `The server could not run the program (${response.status}).`
        );
      }
      const result = data as RunResult;
      if (onEvent) replayEvents(result, onEvent);
      return result;
    } catch {
      if (mine.signal.aborted) return { status: "cancelled", stdout: "", stderr: "" };
      return unavailable("The server could not be reached. Check the connection and try again.");
    } finally {
      if (current === mine) current = null;
    }
  };
  return { transport, cancel: () => current?.abort() };
};
