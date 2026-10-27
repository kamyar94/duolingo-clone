// Python in the runner frame: Pyodide (CPython compiled to WebAssembly), handed over from the
// app's runtime folder on first use and kept until a program has to be stopped. Also answers
// code completion with Jedi, unpacked into Pyodide from wheels in the runtime folder. Runs as a
// classic worker inside the sandboxed frame and imports Pyodide's modules from blob URLs.
// (Pyodide refuses classic workers that may load data: scripts; the frame's policy forbids
// them, which is what Pyodide checks.) Bundled to /runtimes/lingo/python-worker.js.
import type { PyodideAPI } from "pyodide";

import type { CallSpec, RunResult } from "../types";

import { blobUrlOf, createFileBridge, textOf } from "./files";
import type { CompletionItem, WorkerMessage, WorkerRequest } from "./protocol";

const scope = globalThis as unknown as {
  postMessage: (message: WorkerMessage) => void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
};
const post = (message: WorkerMessage) => scope.postMessage(message);

// The harness: runs the learner's code as main.py with its own stdin, points errors at their
// line, and evaluates function tests with == (floats with a tolerance).
const HARNESS = `
import io, json, linecache, math, sys, traceback

def _lingo_error(exc):
    frames = [f for f in traceback.extract_tb(exc.__traceback__) if f.filename == "main.py"]
    line = frames[-1].lineno if frames else None
    if isinstance(exc, SyntaxError) and exc.filename == "main.py":
        line = exc.lineno
    text = ""
    if frames:
        text = "Traceback (most recent call last):\\n" + "".join(traceback.format_list(frames))
    text += "".join(traceback.format_exception_only(type(exc), exc))
    sys.stderr.write(text)
    message = traceback.format_exception_only(type(exc), exc)[-1].strip()
    return {"message": message, "line": line}

def _lingo_number(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool)

def _lingo_eq(a, b, tol, depth=0):
    if depth > 50:
        return False
    if _lingo_number(a) and _lingo_number(b):
        if isinstance(a, float) or isinstance(b, float):
            return math.isclose(a, b, rel_tol=1e-9, abs_tol=tol)
        return a == b
    if isinstance(a, (list, tuple)) and isinstance(b, (list, tuple)) and type(a) is type(b):
        return len(a) == len(b) and all(_lingo_eq(x, y, tol, depth + 1) for x, y in zip(a, b))
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(_lingo_eq(a[k], b[k], tol, depth + 1) for k in a)
    try:
        return bool(a == b)
    except Exception:
        return False

def _lingo_text(e):
    return type(e).__name__ + ": " + str(e)

def _lingo_run(code, stdin, calls_json):
    ns = {"__name__": "__main__", "__builtins__": __builtins__}
    linecache.cache["main.py"] = (len(code), None, code.splitlines(True), "main.py")
    sys.stdin = io.StringIO(stdin)
    result = {"error": None, "calls": None}
    try:
        exec(compile(code, "main.py", "exec"), ns)
    except SystemExit:
        pass
    except BaseException as exc:
        result["error"] = _lingo_error(exc)
    calls = json.loads(calls_json)
    if calls is not None and result["error"] is None:
        out = []
        for spec in calls:
            tol = spec.get("tolerance")
            tol = 1e-9 if tol is None else tol
            try:
                actual = eval(spec["call"], ns)
            except BaseException as exc:
                out.append({"passed": False, "error": _lingo_text(exc)})
                continue
            try:
                expected = eval(spec["expect"], ns)
            except BaseException as exc:
                out.append({"passed": False, "actual": repr(actual), "error": "the expected value could not be computed: " + _lingo_text(exc)})
                continue
            out.append({"passed": _lingo_eq(actual, expected, tol), "actual": repr(actual), "expected": repr(expected)})
        result["calls"] = out
    sys.stdout.flush()
    sys.stderr.flush()
    return json.dumps(result)
`;

const JEDI_HELPER = `
import json
import jedi

def _lingo_complete(code, line, column):
    try:
        found = jedi.Interpreter(code, [{}]).complete(line, column)
    except Exception:
        return "[]"
    return json.dumps([{"label": c.name, "type": c.type} for c in found[:150]])
`;

/** Files of the runtime, asked from the frame; the worker has no network access. */
const files = createFileBridge((id, path) => post({ type: "file", id, path }));

// Pyodide fetches its WebAssembly and standard library from its index URL. That URL is a name
// only: fetch is answered from the files the page handed over, never from the network.
const INDEX = "https://runtime.invalid/pyodide/";
const nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith(INDEX)) return nativeFetch(input, init);
  const name = url.slice(INDEX.length).split(/[?#]/)[0];
  const buffer = await files.get(`pyodide/${name}`);
  return new Response(buffer, {
    headers: { "Content-Type": name.endsWith(".wasm") ? "application/wasm" : "application/octet-stream" },
  });
}) as typeof fetch;

let runtime: Promise<PyodideAPI> | null = null;
let jedi: Promise<boolean> | null = null;
let currentId = 0;

const importFile = async <T>(path: string) =>
  (await import(/* webpackIgnore: true */ blobUrlOf(await files.get(path), "text/javascript"))) as T;

const load = (id: number) => {
  runtime ??= (async () => {
    post({ type: "status", id, text: "Loading Python…" });
    const [loader, asm, lock] = await Promise.all([
      importFile<{ loadPyodide: (options: object) => Promise<PyodideAPI> }>("pyodide/pyodide.mjs"),
      importFile<{ default: unknown }>("pyodide/pyodide.asm.mjs"),
      files.get("pyodide/pyodide-lock.json").then(textOf),
    ]);
    const pyodide = await loader.loadPyodide({
      indexURL: INDEX,
      createPyodideModule: asm.default,
      lockFileContents: lock,
    });
    const decoders = { stdout: new TextDecoder(), stderr: new TextDecoder() };
    for (const stream of ["stdout", "stderr"] as const) {
      const options = {
        isatty: true,
        write: (buffer: Uint8Array) => {
          const text = decoders[stream].decode(buffer, { stream: true });
          if (text) post({ type: "out", id: currentId, stream, text });
          return buffer.length;
        },
      };
      if (stream === "stdout") pyodide.setStdout(options);
      else pyodide.setStderr(options);
    }
    pyodide.runPython(HARNESS);
    return pyodide;
  })();
  return runtime;
};

const loadJedi = (pyodide: PyodideAPI) => {
  jedi ??= (async () => {
    try {
      const wheels = JSON.parse(textOf(await files.get("python/wheels.json"))) as string[];
      if (!wheels.length) return false;
      const site = pyodide.runPython("import site; site.getsitepackages()[0]") as string;
      for (const wheel of wheels)
        pyodide.unpackArchive(await files.get(`python/${wheel}`), "wheel", { extractDir: site });
      pyodide.runPython(JEDI_HELPER);
      return true;
    } catch {
      return false;
    }
  })();
  return jedi;
};

const run = async (request: Extract<WorkerRequest, { type: "run" }>) => {
  let pyodide: PyodideAPI;
  try {
    pyodide = await load(request.id);
  } catch (error) {
    runtime = null;
    post({
      type: "result",
      id: request.id,
      result: {
        status: "unavailable",
        stdout: "",
        stderr: "",
        error: { message: `Python could not be loaded: ${String(error)}` },
      },
    });
    return;
  }
  currentId = request.id;
  post({ type: "started", id: request.id });
  const calls: CallSpec[] | null = request.calls?.length ? request.calls : null;
  let result: RunResult;
  try {
    const runner = pyodide.globals.get("_lingo_run") as (
      code: string,
      stdin: string,
      calls: string
    ) => string;
    const raw = JSON.parse(runner(request.code, request.stdin ?? "", JSON.stringify(calls))) as {
      error: { message: string; line: number | null } | null;
      calls: RunResult["calls"] | null;
    };
    result = {
      status: "ok",
      stdout: "",
      stderr: "",
      error: raw.error ? { message: raw.error.message, line: raw.error.line ?? undefined } : undefined,
      calls: raw.calls ?? undefined,
    };
  } catch (error) {
    result = {
      status: "error",
      stdout: "",
      stderr: "",
      error: { message: String(error) },
    };
  }
  post({ type: "result", id: request.id, result });
};

const complete = async (request: Extract<WorkerRequest, { type: "complete" }>) => {
  let items: CompletionItem[] = [];
  try {
    const pyodide = await load(request.id);
    if (await loadJedi(pyodide)) {
      const completer = pyodide.globals.get("_lingo_complete") as (
        code: string,
        line: number,
        column: number
      ) => string;
      items = JSON.parse(completer(request.code, request.line, request.column));
    }
  } catch {
    items = [];
  }
  post({ type: "completions", id: request.id, items });
};

// One message at a time: Pyodide runs synchronously, and a completion must not interleave a run.
let queue = Promise.resolve();
scope.onmessage = (event) => {
  const message = event.data;
  if (message.type === "file") {
    files.answer(message);
    return;
  }
  queue = queue.then(() => (message.type === "run" ? run(message) : complete(message)));
};
