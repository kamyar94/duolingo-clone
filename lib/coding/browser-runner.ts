// The browser side of the runners (section 4.4), for client components only. Programs run in one
// hidden, sandboxed frame per page (lib/coding/sandbox.ts, lib/coding/workers/frame.ts). The
// frame has no network access: this page fetches the runtime files it asks for and hands them
// over. TypeScript is transpiled first by the TypeScript worker, which also answers completions.
// Languages without a browser runtime go to the code runners on the server (server-transport.ts).
import { OUTPUT_LIMIT } from "./js-harness";
import { languageInfo } from "./languages";
import { DEFAULT_TIME_LIMIT_MS, MAX_TIME_LIMIT_MS } from "./payload";
import { serverRunner, setServerRunnerTransport, type CodeRunner } from "./runner";
import { FRAME_SANDBOX, isRuntimePath, runnerFrameHtml } from "./sandbox";
import { createServerTransport } from "./server-transport";
import { sourceLine } from "./transpile";
import type { RunEvent, RunRequest, RunResult } from "./types";
import type {
  CompletionItem,
  FrameMessage,
  FrameRequest,
  FrameRunRequest,
  TsRequest,
  TsResponse,
} from "./workers/protocol";

const server = createServerTransport();
setServerRunnerTransport(server.transport, server.cancel);

const READY_LIMIT_MS = 20_000;
/** Loading Pyodide on a slow phone can take a while; the frame's own limits apply first. */
const LOAD_ALLOWANCE_MS = 130_000;

type Pending = {
  onEvent?: (event: RunEvent) => void;
  resolve: (result: RunResult) => void;
  timer: ReturnType<typeof setTimeout>;
};

type Frame = {
  iframe: HTMLIFrameElement;
  ready: Promise<void>;
  markReady: () => void;
};

let frame: Frame | null = null;
let frameScript: Promise<string> | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();
const completions = new Map<number, (items: CompletionItem[]) => void>();

const failed = (message: string, status: RunResult["status"] = "unavailable"): RunResult => ({
  status,
  stdout: "",
  stderr: "",
  error: { message },
});

/** Answers the frame's request for a runtime file, from the app's /runtimes/ folder only. */
const sendFile = async (target: Frame, id: number, path: unknown) => {
  const answer = (message: FrameRequest, transfer: Transferable[] = []) =>
    target.iframe.contentWindow?.postMessage(message, "*", transfer);
  if (typeof path !== "string" || !isRuntimePath(path)) {
    answer({ lingo: "file", id, error: "Not a runtime file." });
    return;
  }
  try {
    const response = await fetch(`/runtimes/${path}`, { cache: "no-cache" });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    const buffer = await response.arrayBuffer();
    answer({ lingo: "file", id, buffer }, [buffer]);
  } catch (error) {
    answer({ lingo: "file", id, error: error instanceof Error ? error.message : String(error) });
  }
};

const onMessage = (event: MessageEvent<FrameMessage>) => {
  if (!frame || event.source !== frame.iframe.contentWindow) return;
  const message = event.data;
  if (!message || typeof message !== "object" || !("lingo" in message)) return;
  if (message.lingo === "ready") frame.markReady();
  else if (message.lingo === "file") void sendFile(frame, message.id, message.path);
  else if (message.lingo === "event") pending.get(message.id)?.onEvent?.(message.event);
  else if (message.lingo === "result") {
    const run = pending.get(message.id);
    if (!run) return;
    pending.delete(message.id);
    clearTimeout(run.timer);
    run.resolve(message.result);
  } else if (message.lingo === "completions") {
    completions.get(message.id)?.(message.items);
    completions.delete(message.id);
  }
};

/** Removes the frame (and every program in it); the next run builds a new one. */
const destroyFrame = (message: string, status: RunResult["status"] = "error") => {
  frame?.iframe.remove();
  frame = null;
  for (const [id, run] of pending) {
    clearTimeout(run.timer);
    run.resolve(failed(message, status));
    pending.delete(id);
  }
  for (const [id, resolve] of completions) {
    resolve([]);
    completions.delete(id);
  }
};

const getFrame = async () => {
  if (!frame) {
    window.removeEventListener("message", onMessage);
    window.addEventListener("message", onMessage);
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", FRAME_SANDBOX);
    iframe.setAttribute("aria-hidden", "true");
    iframe.setAttribute("tabindex", "-1");
    iframe.title = "Code runner";
    iframe.style.cssText =
      "position:absolute;width:1px;height:1px;border:0;opacity:0;pointer-events:none;left:-10px;top:-10px";
    let markReady = () => {};
    const ready = new Promise<void>((resolve, reject) => {
      markReady = resolve;
      setTimeout(() => reject(new Error("The code runner did not start.")), READY_LIMIT_MS);
    });
    ready.catch(() => undefined);
    frame = { iframe, ready, markReady };
    const created = frame;
    // The frame's own script is written into it, allowed by a fresh nonce.
    frameScript ??= fetch("/runtimes/lingo/frame.js", { cache: "no-cache" }).then((response) => {
      if (!response.ok) throw new Error("The code runner is not installed (runtimes missing).");
      return response.text();
    });
    frameScript.catch(() => {
      frameScript = null;
    });
    try {
      const nonce = [...crypto.getRandomValues(new Uint8Array(16))]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      iframe.srcdoc = runnerFrameHtml(await frameScript, nonce);
      document.body.appendChild(iframe);
    } catch (error) {
      if (frame === created) destroyFrame(String(error));
      throw error;
    }
  }
  const current = frame;
  try {
    await current.ready;
  } catch (error) {
    if (frame === current) destroyFrame(String(error));
    throw error;
  }
  return current;
};

const post = (target: Frame, request: FrameRequest) =>
  target.iframe.contentWindow?.postMessage(request, "*");

const runInFrame = async (
  request: Omit<FrameRunRequest, "lingo" | "id">,
  onEvent?: (event: RunEvent) => void
): Promise<RunResult> => {
  let target: Frame;
  try {
    target = await getFrame();
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error));
  }
  const id = nextId++;
  return new Promise<RunResult>((resolve) => {
    const allowance = request.runtime === "js" ? 5_000 : LOAD_ALLOWANCE_MS;
    const timer = setTimeout(() => {
      // The frame did not answer in time: drop it entirely.
      if (pending.has(id)) destroyFrame("The program took too long and was stopped.", "timeout");
    }, request.timeLimitMs + allowance);
    pending.set(id, { onEvent, resolve, timer });
    post(target, { lingo: "run", id, ...request });
  });
};

// ---- TypeScript worker ----

let tsWorker: Worker | null = null;
const tsPending = new Map<number, (response: TsResponse) => void>();

const tsRequest = <T extends TsResponse["type"]>(
  request: Omit<Extract<TsRequest, { type: T }>, "id">
) =>
  new Promise<Extract<TsResponse, { type: T }>>((resolve, reject) => {
    if (!tsWorker) {
      tsWorker = new Worker("/runtimes/lingo/ts-service.js");
      tsWorker.onmessage = (event: MessageEvent<TsResponse>) => {
        tsPending.get(event.data.id)?.(event.data);
        tsPending.delete(event.data.id);
      };
      tsWorker.onerror = () => {
        for (const settle of tsPending.values())
          settle({ id: 0, type: "error", message: "TypeScript could not be loaded." });
        tsPending.clear();
        tsWorker?.terminate();
        tsWorker = null;
      };
    }
    const id = nextId++;
    const timer = setTimeout(() => {
      tsPending.delete(id);
      reject(new Error("TypeScript did not answer in time."));
    }, 60_000);
    tsPending.set(id, (response) => {
      clearTimeout(timer);
      if (response.type === "error") reject(new Error(response.message));
      else resolve(response as Extract<TsResponse, { type: T }>);
    });
    tsWorker.postMessage({ ...request, id });
  });

export const transpile = (code: string, fileName = "main.ts") =>
  tsRequest<"transpile">({ type: "transpile", code, fileName });

export const tsCompletions = async (code: string, pos: number, fileName: string) => {
  try {
    return (await tsRequest<"complete">({ type: "complete", code, pos, fileName })).items;
  } catch {
    return [];
  }
};

/** Jedi completions from the Python runtime in the runner frame (loads Python if needed). */
export const pythonCompletions = async (code: string, line: number, column: number) => {
  let target: Frame;
  try {
    target = await getFrame();
  } catch {
    return [];
  }
  const id = nextId++;
  return new Promise<CompletionItem[]>((resolve) => {
    const timer = setTimeout(() => {
      completions.delete(id);
      resolve([]);
    }, 20_000);
    completions.set(id, (items) => {
      clearTimeout(timer);
      resolve(items);
    });
    post(target, { lingo: "complete", id, code, line, column });
  });
};

// ---- runner ----

const clampLimit = (limit?: number) =>
  Math.min(Math.max(limit ?? DEFAULT_TIME_LIMIT_MS, 100), MAX_TIME_LIMIT_MS);

export const browserRunner: CodeRunner = {
  where: "browser",
  run: async (request: RunRequest, onEvent) => {
    const info = languageInfo(request.language);
    if (info.runtime === "server") return serverRunner.run(request, onEvent);
    if (info.runtime === "web")
      return failed("Web programs run in their preview, not in the runner.");

    let code = request.code;
    let lineMap: number[] | null = null;
    if (request.language === "typescript") {
      try {
        const compiled = await transpile(code, "main.ts");
        const problem = compiled.diagnostics[0];
        if (problem)
          return {
            status: "ok",
            stdout: "",
            stderr: `SyntaxError: ${problem.message}\n`,
            error: {
              message: `SyntaxError: ${problem.message}`,
              line: problem.line,
              column: problem.column,
            },
          };
        code = compiled.js;
        lineMap = compiled.lineMap;
      } catch (error) {
        return failed(error instanceof Error ? error.message : String(error));
      }
    }

    const result = await runInFrame(
      {
        runtime: info.runtime,
        code,
        stdin: request.stdin,
        calls: request.calls,
        setup: request.setup,
        queries: request.queries,
        timeLimitMs: clampLimit(request.timeLimitMs),
        outputLimit: OUTPUT_LIMIT,
      },
      onEvent
    );

    if (result.error && lineMap) result.error.line = sourceLine(lineMap, result.error.line);
    // A syntax error stops a script before it can say where; the TypeScript parser knows.
    if (
      request.language === "javascript" &&
      result.error &&
      !result.error.line &&
      /SyntaxError/.test(result.error.message)
    )
      try {
        const parsed = await transpile(request.code, "main.js");
        if (parsed.diagnostics[0]) result.error.line = parsed.diagnostics[0].line;
      } catch {
        // Keep the error without a line.
      }
    return result;
  },
  cancel: () => {
    if (!frame) return;
    for (const id of pending.keys()) post(frame, { lingo: "cancel", id });
  },
};

/** The runner for a language: the browser for WebAssembly runtimes, the server for the rest. */
export const runnerFor = (language: RunRequest["language"]): CodeRunner =>
  languageInfo(language).runtime === "server" ? serverRunner : browserRunner;

export const runProgram = (request: RunRequest, onEvent?: (event: RunEvent) => void) =>
  runnerFor(request.language).run(request, onEvent);
