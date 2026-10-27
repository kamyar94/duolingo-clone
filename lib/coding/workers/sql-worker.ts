// SQL in the runner frame: sql.js (SQLite compiled to WebAssembly), handed over from the app's
// runtime folder on first use. Every run gets a fresh in-memory database. Runs as a classic
// worker inside the sandboxed frame; bundled to /runtimes/lingo/sql-worker.js.
import type { SqlJsStatic } from "sql.js";

import { runSqlProgram } from "../sql-run";
import { formatResultSets } from "../tests";

import { blobUrlOf, createFileBridge } from "./files";
import type { WorkerMessage, WorkerRequest } from "./protocol";

const scope = globalThis as unknown as {
  postMessage: (message: WorkerMessage) => void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  importScripts: (...urls: string[]) => void;
  initSqlJs?: (config: { wasmBinary: ArrayBuffer }) => Promise<SqlJsStatic>;
};
const post = (message: WorkerMessage) => scope.postMessage(message);

/** Files of the runtime, asked from the frame; the worker has no network access. */
const files = createFileBridge((id, path) => post({ type: "file", id, path }));
let sqlJs: Promise<SqlJsStatic> | null = null;

const load = (id: number) => {
  sqlJs ??= (async () => {
    post({ type: "status", id, text: "Loading SQLite…" });
    const [script, wasmBinary] = await Promise.all([
      files.get("sqljs/sql-wasm.js"),
      files.get("sqljs/sql-wasm.wasm"),
    ]);
    scope.importScripts(blobUrlOf(script, "text/javascript"));
    if (!scope.initSqlJs) throw new Error("sql.js did not load.");
    return scope.initSqlJs({ wasmBinary });
  })();
  return sqlJs;
};

const run = async (request: Extract<WorkerRequest, { type: "run" }>) => {
  let SQL: SqlJsStatic;
  try {
    SQL = await load(request.id);
  } catch (error) {
    sqlJs = null;
    post({
      type: "result",
      id: request.id,
      result: {
        status: "unavailable",
        stdout: "",
        stderr: "",
        error: { message: `SQLite could not be loaded: ${String(error)}` },
      },
    });
    return;
  }
  post({ type: "started", id: request.id });
  let first = true;
  const ran = runSqlProgram(SQL, {
    setup: request.setup,
    code: request.code,
    queries: request.queries,
    onSet: (set) => {
      post({
        type: "out",
        id: request.id,
        stream: "stdout",
        text: `${first ? "" : "\n"}${formatResultSets([set])}\n`,
      });
      first = false;
    },
  });
  if (ran.setupError) {
    post({
      type: "result",
      id: request.id,
      result: { status: "error", stdout: "", stderr: "", error: { message: ran.setupError } },
    });
    return;
  }
  if (ran.error)
    post({
      type: "out",
      id: request.id,
      stream: "stderr",
      text: `Error on line ${ran.error.line}: ${ran.error.message}\n`,
    });
  post({
    type: "result",
    id: request.id,
    result: {
      status: "ok",
      stdout: "",
      stderr: "",
      error: ran.error,
      sets: ran.sets,
      queries: ran.queries,
    },
  });
};

let queue = Promise.resolve();
scope.onmessage = (event) => {
  const message = event.data;
  if (message.type === "file") {
    files.answer(message);
    return;
  }
  if (message.type === "run") queue = queue.then(() => run(message));
  else post({ type: "completions", id: message.id, items: [] });
};
