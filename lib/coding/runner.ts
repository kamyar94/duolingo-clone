// The runner interface (section 4.4). Languages with a WebAssembly runtime run in the browser
// (lib/coding/browser-runner.ts); all others go to the server runner of phase 6, which
// implements ServerRunnerTransport. Until then those exercises say that they run on the server.
import { languageInfo, type CodeLanguage } from "./languages";
import type { RunEvent, RunRequest, RunResult } from "./types";

export interface CodeRunner {
  readonly where: "browser" | "server";
  run(request: RunRequest, onEvent?: (event: RunEvent) => void): Promise<RunResult>;
  /** Stops the run in progress, if any. */
  cancel?(): void;
}

/**
 * What phase 6 supplies: sends a run to the server (for example POST /api/code/run with the
 * session cookie) and streams its events back. Returning null means the server runner is not
 * available for this language.
 */
export type ServerRunnerTransport = (
  request: RunRequest,
  onEvent?: (event: RunEvent) => void
) => Promise<RunResult | null>;

let transport: ServerRunnerTransport | null = null;

/** Installs the server runner (phase 6). */
export const setServerRunnerTransport = (next: ServerRunnerTransport | null) => {
  transport = next;
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
};

export const serverRunnerAvailable = () => transport !== null;

/** Whether a language's programs run on the server (phase 6) rather than in the browser. */
export const runsOnServer = (language: CodeLanguage) =>
  languageInfo(language).runtime === "server";
