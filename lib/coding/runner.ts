// The runner interface (section 4.4). Languages with a WebAssembly runtime run in the browser
// (lib/coding/browser-runner.ts); all others go to the code runners on the server through a
// ServerRunnerTransport (lib/coding/server-transport.ts, installed by browser-runner.ts).
// Without a transport those exercises say that they run on the server.
import { languageInfo, type CodeLanguage } from "./languages";
import type { RunEvent, RunRequest, RunResult } from "./types";

export interface CodeRunner {
  readonly where: "browser" | "server";
  run(request: RunRequest, onEvent?: (event: RunEvent) => void): Promise<RunResult>;
  /** Stops the run in progress, if any. */
  cancel?(): void;
}

/**
 * Sends a run to the server (POST /api/code/run with the session cookie) and passes its output
 * on as events. Returning null means the server runner is not available for this language.
 */
export type ServerRunnerTransport = (
  request: RunRequest,
  onEvent?: (event: RunEvent) => void
) => Promise<RunResult | null>;

let transport: ServerRunnerTransport | null = null;
let cancelTransport: (() => void) | null = null;

/** Installs the server runner, with a function that gives up on the run in progress. */
export const setServerRunnerTransport = (
  next: ServerRunnerTransport | null,
  cancel: (() => void) | null = null
) => {
  transport = next;
  cancelTransport = next ? cancel : null;
};

export const SERVER_RUNNER_MESSAGE =
  "This language runs on the server, and the server runner is not available yet.";

export const serverRunner: CodeRunner = {
  where: "server",
  run: async (request, onEvent) => {
    const result = transport ? await transport(request, onEvent) : null;
    return (
      result ?? {
        status: "unavailable",
        stdout: "",
        stderr: "",
        error: { message: `${languageInfo(request.language).label}: ${SERVER_RUNNER_MESSAGE}` },
      }
    );
  },
  cancel: () => cancelTransport?.(),
};

export const serverRunnerAvailable = () => transport !== null;

/** Whether a language's programs run on the server rather than in the browser. */
export const runsOnServer = (language: CodeLanguage) =>
  languageInfo(language).runtime === "server";
