// Messages between the app page and the sandboxed runner frame, and between the frame and its
// workers. Every message from the frame carries `lingo` so the page can ignore anything else.
import type {
  CallSpec,
  RunEvent,
  RunResult,
} from "../types";

export type FrameRuntime = "js" | "python" | "sql";

export type FrameRunRequest = {
  lingo: "run";
  id: number;
  runtime: FrameRuntime;
  code: string;
  stdin?: string;
  calls?: CallSpec[];
  setup?: string;
  queries?: string[];
  timeLimitMs: number;
  outputLimit: number;
};

export type CompletionItem = { label: string; type?: string; detail?: string };

/** A runtime file the frame asked for (it cannot fetch anything itself). */
export type FileAnswer = { id: number; buffer?: ArrayBuffer; error?: string };

export type FrameRequest =
  | FrameRunRequest
  | ({ lingo: "file" } & FileAnswer)
  | { lingo: "cancel"; id: number }
  | { lingo: "complete"; id: number; code: string; line: number; column: number };

export type FrameMessage =
  | { lingo: "ready" }
  | { lingo: "file"; id: number; path: string }
  | { lingo: "event"; id: number; event: RunEvent }
  | { lingo: "result"; id: number; result: RunResult }
  | { lingo: "completions"; id: number; items: CompletionItem[] };

/** Frame to Python or SQL worker. */
export type WorkerRequest =
  | ({ type: "file" } & FileAnswer)
  | {
      type: "run";
      id: number;
      code: string;
      stdin?: string;
      calls?: CallSpec[];
      setup?: string;
      queries?: string[];
    }
  | { type: "complete"; id: number; code: string; line: number; column: number };

/** Python or SQL worker to frame. */
export type WorkerMessage =
  | { type: "file"; id: number; path: string }
  | { type: "status"; id: number; text: string }
  | { type: "started"; id: number }
  | { type: "out"; id: number; stream: "stdout" | "stderr"; text: string }
  | { type: "result"; id: number; result: RunResult }
  | { type: "completions"; id: number; items: CompletionItem[] };

/** App page to the TypeScript worker and back. */
export type TsRequest =
  | { id: number; type: "transpile"; code: string; fileName: string }
  | { id: number; type: "complete"; code: string; pos: number; fileName: string };

export type TsResponse =
  | {
      id: number;
      type: "transpile";
      js: string;
      lineMap: number[];
      diagnostics: { line: number; column: number; message: string }[];
    }
  | { id: number; type: "complete"; items: CompletionItem[] }
  | { id: number; type: "error"; message: string };
