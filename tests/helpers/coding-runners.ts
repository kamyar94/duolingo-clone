// Runners for the coding tests under Node: JavaScript through the same harness the browser
// worker executes (in a node:vm context standing in for the worker), and SQL on sql.js.
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";

import type { SqlJsStatic } from "sql.js";

import type { RunFn } from "@/lib/coding/check";
import { buildJsProgram } from "@/lib/coding/js-harness";
import { runSqlProgram } from "@/lib/coding/sql-run";
import type { CallResult, RunResult } from "@/lib/coding/types";

type Message =
  | { t: "out"; s: "stdout" | "stderr"; x: string }
  | { t: "err"; m: string; l: number; c: number }
  | { t: "calls"; r: CallResult[] }
  | { t: "done"; cut: boolean };

/** Runs JavaScript like the worker does; `self` is the vm context's global object. */
export const runJsInVm: RunFn = (request, onEvent) =>
  new Promise((resolve) => {
    const { source } = buildJsProgram({
      code: request.code,
      stdin: request.stdin,
      calls: request.calls,
    });
    const result: RunResult = { status: "ok", stdout: "", stderr: "" };
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const context: Record<string, unknown> = {
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      postMessage: (message: Message) => {
        if (message.t === "out") {
          if (message.s === "stdout") result.stdout += message.x;
          else result.stderr += message.x;
          onEvent?.({ stream: message.s, text: message.x });
        } else if (message.t === "err") {
          result.status = "ok";
          result.error = { message: message.m, line: message.l || undefined };
        } else if (message.t === "calls") result.calls = message.r;
        else if (message.t === "done") {
          result.truncated = message.cut;
          finish();
        }
      },
    };
    context.self = context;
    vm.createContext(context);
    const timer = setTimeout(() => {
      result.status = "timeout";
      finish();
    }, request.timeLimitMs ?? 3000);
    try {
      new vm.Script(source, { filename: "blob:null/test" }).runInContext(context, {
        timeout: request.timeLimitMs ?? 3000,
      });
    } catch (error) {
      const err = error as Error;
      const line = /blob:null\/test:(\d+)/.exec(String(err.stack))?.[1];
      result.error = {
        message: `${err.name}: ${err.message}`,
        line: line ? Number(line) - 1 : undefined,
      };
      if (/timed out/.test(err.message)) result.status = "timeout";
      finish();
    }
  });

let sqlJs: Promise<SqlJsStatic> | undefined;

export const loadSqlJs = () => {
  const require = createRequire(import.meta.url);
  const init = require("sql.js") as (config?: object) => Promise<SqlJsStatic>;
  const dist = path.dirname(require.resolve("sql.js/dist/sql-wasm.wasm"));
  sqlJs ??= init({ locateFile: (file: string) => path.join(dist, file) });
  return sqlJs;
};

export const runSqlInNode: RunFn = async (request) => {
  const SQL = await loadSqlJs();
  const ran = runSqlProgram(SQL, {
    setup: request.setup,
    code: request.code,
    queries: request.queries,
  });
  if (ran.setupError)
    return {
      status: "error",
      stdout: "",
      stderr: "",
      error: { message: ran.setupError },
    };
  return {
    status: "ok",
    stdout: ran.output,
    stderr: "",
    error: ran.error,
    sets: ran.sets,
    queries: ran.queries,
  };
};
