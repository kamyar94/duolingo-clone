// The script of the sandboxed runner frame (section 4.4). The frame has an opaque origin (sandbox
// without allow-same-origin) and a content security policy without any network source, so
// programs cannot reach the network, the app's cookies or its storage; runtimes arrive from the
// page by postMessage. Each program runs in a web worker that is terminated when its time limit
// passes or its output grows past the cap. Bundled by scripts/build-runtimes.mjs to
// /runtimes/lingo/frame.js, which the page writes inline into the frame.
import { buildJsProgram, PRELUDE_LINES } from "../js-harness";
import type { RunResult } from "../types";

import { blobUrlOf, createFileBridge } from "./files";
import type {
  FrameMessage,
  FrameRequest,
  FrameRunRequest,
  WorkerMessage,
  WorkerRequest,
} from "./protocol";

const send = (message: FrameMessage) => window.parent.postMessage(message, "*");

/** Runtime files come from the page: this frame cannot fetch anything itself. */
const files = createFileBridge((id, path) => send({ lingo: "file", id, path }));

/** How long a runtime may take to load before its own time limit starts. */
const LOAD_LIMIT_MS = 120_000;

type Job = {
  id: number;
  kind: FrameRunRequest["runtime"];
  timeLimitMs: number;
  result: RunResult;
  used: number;
  outputLimit: number;
  timer?: ReturnType<typeof setTimeout>;
  kill: () => void;
  finish: (status?: RunResult["status"]) => void;
};

const jobs = new Map<number, Job>();

const makeJob = (request: FrameRunRequest, kill: () => void): Job => {
  const started = performance.now();
  const job: Job = {
    id: request.id,
    kind: request.runtime,
    timeLimitMs: request.timeLimitMs,
    result: { status: "ok", stdout: "", stderr: "" },
    used: 0,
    outputLimit: request.outputLimit,
    kill,
    finish: (status) => {
      if (!jobs.has(job.id)) return;
      jobs.delete(job.id);
      clearTimeout(job.timer);
      if (status) job.result.status = status;
      job.result.durationMs = Math.round(performance.now() - started);
      send({ lingo: "result", id: job.id, result: job.result });
    },
  };
  jobs.set(job.id, job);
  return job;
};

const startTimer = (job: Job, limitMs: number) => {
  clearTimeout(job.timer);
  // Finish first: killing a shared runtime cancels the jobs still left on it.
  job.timer = setTimeout(() => {
    job.finish("timeout");
    job.kill();
  }, limitMs);
};

/** Adds output to the job and streams it; past the cap the program is stopped. */
const output = (job: Job, stream: "stdout" | "stderr", text: string) => {
  if (!jobs.has(job.id)) return;
  const room = job.outputLimit - job.used;
  const part = text.length > room ? text.slice(0, Math.max(0, room)) : text;
  job.used += part.length;
  if (stream === "stdout") job.result.stdout += part;
  else job.result.stderr += part;
  if (part) send({ lingo: "event", id: job.id, event: { stream, text: part } });
  if (text.length > room) {
    job.result.truncated = true;
    job.result.error = {
      message: `The program printed more than ${Math.round(job.outputLimit / 1024)} KB and was stopped.`,
    };
    job.finish();
    job.kill();
  }
};

const blobUrl = (source: string) =>
  URL.createObjectURL(new Blob([source], { type: "text/javascript" }));

// ---- JavaScript and TypeScript (already transpiled by the page) ----

const runJs = (request: FrameRunRequest) => {
  const { source, codeLines } = buildJsProgram({
    code: request.code,
    stdin: request.stdin,
    calls: request.calls,
    outputLimit: request.outputLimit,
  });
  const url = blobUrl(source);
  let worker: Worker;
  try {
    worker = new Worker(url);
  } catch (error) {
    URL.revokeObjectURL(url);
    send({
      lingo: "result",
      id: request.id,
      result: {
        status: "unavailable",
        stdout: "",
        stderr: "",
        error: { message: `This browser cannot start the runner: ${String(error)}` },
      },
    });
    return;
  }
  const job = makeJob(request, () => {
    worker.terminate();
    URL.revokeObjectURL(url);
  });
  const inCode = (line: number) => (line > 0 && line <= codeLines ? line : undefined);
  startTimer(job, request.timeLimitMs);
  worker.onmessage = (event: MessageEvent) => {
    const message = event.data;
    if (message.t === "out") output(job, message.s, message.x);
    else if (message.t === "err")
      job.result.error = {
        message: message.l > codeLines ? `${message.m} (in a test call)` : message.m,
        line: inCode(message.l),
        column: message.c || undefined,
      };
    else if (message.t === "calls") job.result.calls = message.r;
    else if (message.t === "done") {
      job.kill();
      job.finish();
    }
  };
  // Syntax errors stop the script before its own error handler exists; they arrive here.
  worker.onerror = (event: ErrorEvent) => {
    event.preventDefault();
    const line = event.lineno ? event.lineno - PRELUDE_LINES : 0;
    job.result.error = {
      message: String(event.message || "The program could not start.").replace(/^Uncaught /, ""),
      line: inCode(line),
      column: event.colno || undefined,
    };
    job.kill();
    job.finish();
  };
};

// ---- Python and SQL: one long-lived worker each, loaded on first use ----

type Runtime = {
  /** Resolves once the worker exists (its script comes from the page first). */
  worker: Promise<Worker>;
  completions: Map<number, (items: unknown[]) => void>;
  dropped: boolean;
};

const runtimes: Partial<Record<"python" | "sql", Runtime>> = {};

const dropRuntime = (kind: "python" | "sql") => {
  const runtime = runtimes[kind];
  if (!runtime) return;
  delete runtimes[kind];
  runtime.dropped = true;
  runtime.worker.then((worker) => worker.terminate()).catch(() => undefined);
  for (const resolve of runtime.completions.values()) resolve([]);
  for (const job of [...jobs.values()])
    if (job.kind === kind) {
      job.result.error ??= { message: "Stopped together with an earlier program." };
      job.finish("cancelled");
    }
};

const failRuntime = (kind: "python" | "sql", reason: string) => {
  for (const job of [...jobs.values()])
    if (job.kind === kind) {
      job.result.status = "unavailable";
      job.result.error = {
        message: `The ${kind === "python" ? "Python" : "SQL"} runtime could not be loaded: ${reason}`,
      };
      job.finish();
    }
  dropRuntime(kind);
};

const startWorker = async (kind: "python" | "sql", runtime: Runtime) => {
  const source = await files.get(`lingo/${kind}-worker.js`);
  if (runtime.dropped) throw new Error("dropped");
  // Classic workers: module workers from blob URLs do not start in an opaque-origin frame.
  const worker = new Worker(blobUrlOf(source, "text/javascript"));
  worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
    const message = event.data;
    if (message.type === "file") {
      files
        .get(message.path)
        .then((buffer) => {
          const copy = buffer.slice(0);
          worker.postMessage({ type: "file", id: message.id, buffer: copy } satisfies WorkerRequest, [copy]);
        })
        .catch((error: Error) =>
          worker.postMessage({ type: "file", id: message.id, error: error.message } satisfies WorkerRequest)
        );
      return;
    }
    if (message.type === "completions") {
      runtime.completions.get(message.id)?.(message.items);
      runtime.completions.delete(message.id);
      return;
    }
    const job = jobs.get(message.id);
    if (!job) return;
    if (message.type === "status")
      send({ lingo: "event", id: job.id, event: { stream: "info", text: message.text } });
    else if (message.type === "started") startTimer(job, job.timeLimitMs);
    else if (message.type === "out") output(job, message.stream, message.text);
    else if (message.type === "result") {
      const { stdout, stderr, truncated } = job.result;
      job.result = { ...message.result, stdout, stderr, truncated };
      job.finish();
    }
  };
  worker.onerror = (event: ErrorEvent) => {
    event.preventDefault();
    failRuntime(kind, event.message || "unknown error");
  };
  return worker;
};

const getRuntime = (kind: "python" | "sql"): Runtime => {
  const existing = runtimes[kind];
  if (existing) return existing;
  const runtime: Runtime = {
    worker: Promise.resolve(null as unknown as Worker),
    completions: new Map(),
    dropped: false,
  };
  runtime.worker = startWorker(kind, runtime);
  runtime.worker.catch((error: Error) => {
    if (!runtime.dropped) failRuntime(kind, error.message);
  });
  runtimes[kind] = runtime;
  return runtime;
};

const postTo = (runtime: Runtime, message: WorkerRequest) =>
  runtime.worker.then((worker) => worker.postMessage(message)).catch(() => undefined);

const runInRuntime = (kind: "python" | "sql", request: FrameRunRequest) => {
  const runtime = getRuntime(kind);
  // A program that hangs or floods the output takes its runtime down with it; the next run
  // loads a fresh one.
  const job = makeJob(request, () => dropRuntime(kind));
  startTimer(job, LOAD_LIMIT_MS + request.timeLimitMs);
  void postTo(runtime, {
    type: "run",
    id: request.id,
    code: request.code,
    stdin: request.stdin,
    calls: request.calls,
    setup: request.setup,
    queries: request.queries,
  });
};

const complete = (id: number, code: string, line: number, column: number) => {
  const runtime = getRuntime("python");
  const timer = setTimeout(() => {
    runtime.completions.delete(id);
    send({ lingo: "completions", id, items: [] });
  }, 15_000);
  runtime.completions.set(id, (items) => {
    clearTimeout(timer);
    send({ lingo: "completions", id, items: items as never });
  });
  void postTo(runtime, { type: "complete", id, code, line, column });
};

window.addEventListener("message", (event: MessageEvent<FrameRequest>) => {
  if (event.source !== window.parent) return;
  const request = event.data;
  if (!request || typeof request !== "object") return;
  if (request.lingo === "file") files.answer(request);
  else if (request.lingo === "run") {
    if (request.runtime === "js") runJs(request);
    else runInRuntime(request.runtime, request);
  } else if (request.lingo === "cancel") {
    const job = jobs.get(request.id);
    if (job) {
      job.finish("cancelled");
      job.kill();
    }
  } else if (request.lingo === "complete") {
    try {
      complete(request.id, request.code, request.line, request.column);
    } catch {
      send({ lingo: "completions", id: request.id, items: [] });
    }
  }
});

send({ lingo: "ready" });
