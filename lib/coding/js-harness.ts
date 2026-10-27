// Builds the script a JavaScript run executes inside its web worker: a one-line prelude that
// captures console output, supplies input() from the run's stdin, caps the output and tracks
// timers, then the learner's code, then the function tests. The worker posts messages:
//   { t: "out", s: "stdout" | "stderr", x: text }   output, streamed while the program runs
//   { t: "err", m: message, l: line, c: column }     an uncaught error (line in the learner's code)
//   { t: "calls", r: CallResult[] }                  function test results
//   { t: "done", cut: boolean }                      the program finished (cut: output was capped)
import type { CallSpec } from "./types";

export const OUTPUT_LIMIT = 64 * 1024;

/** Lines before the learner's code in the built script. */
export const PRELUDE_LINES = 1;

// No // comments and every statement ends with a semicolon: the prelude is folded into one line.
const PRELUDE = `(function () {
  var C = __CONFIG__;
  var P = self.postMessage.bind(self);
  var used = 0, cut = false, finished = false, mainDone = false;
  var live = new Set();
  var sT = self.setTimeout.bind(self), cT = self.clearTimeout.bind(self);
  var sI = self.setInterval.bind(self), cI = self.clearInterval.bind(self);
  function emit(s, x) {
    if (cut || finished) return;
    if (used + x.length > C.limit) { x = x.slice(0, Math.max(0, C.limit - used)); cut = true; }
    used += x.length;
    if (x) P({ t: "out", s: s, x: x });
  }
  function show(v, depth, seen) {
    depth = depth || 0; seen = seen || [];
    if (typeof v === "string") return depth === 0 ? JSON.stringify(v) : JSON.stringify(v);
    if (typeof v === "number") return Object.is(v, -0) ? "-0" : String(v);
    if (typeof v === "bigint") return String(v) + "n";
    if (typeof v === "symbol") return v.toString();
    if (typeof v === "undefined" || v === null) return String(v);
    if (typeof v === "boolean") return String(v);
    if (typeof v === "function") return "[Function: " + (v.name || "anonymous") + "]";
    if (seen.indexOf(v) >= 0) return "[Circular]";
    if (depth > 4) return Array.isArray(v) ? "[Array]" : "[Object]";
    seen = seen.concat([v]);
    if (v instanceof Error) return v.name + ": " + v.message;
    if (v instanceof Date) return isNaN(v.getTime()) ? "Invalid Date" : v.toISOString();
    if (v instanceof RegExp) return String(v);
    if (Array.isArray(v)) return "[" + v.map(function (x) { return show(x, depth + 1, seen); }).join(", ") + "]";
    if (v instanceof Map) { var m = []; v.forEach(function (val, key) { m.push(show(key, depth + 1, seen) + " => " + show(val, depth + 1, seen)); }); return "Map(" + v.size + ") {" + (m.length ? " " + m.join(", ") + " " : "") + "}"; }
    if (v instanceof Set) { var s = []; v.forEach(function (val) { s.push(show(val, depth + 1, seen)); }); return "Set(" + v.size + ") {" + (s.length ? " " + s.join(", ") + " " : "") + "}"; }
    var keys = Object.keys(v);
    var name = v.constructor && v.constructor !== Object && v.constructor.name ? v.constructor.name + " " : "";
    if (!keys.length) return name + "{}";
    return name + "{ " + keys.map(function (k) { return (/^[A-Za-z_$][\\w$]*$/.test(k) ? k : JSON.stringify(k)) + ": " + show(v[k], depth + 1, seen); }).join(", ") + " }";
  }
  function fmt(args) {
    var out = [];
    for (var i = 0; i < args.length; i++) out.push(typeof args[i] === "string" ? args[i] : show(args[i], 1));
    return out.join(" ");
  }
  function eq(a, b, tol, depth) {
    if (depth > 50) return false;
    if (typeof a === "number" && typeof b === "number") {
      if (a !== a && b !== b) return true;
      if (a === b) return true;
      return Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
    }
    if (a === b) return true;
    if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
    if (a instanceof Map && b instanceof Map) {
      if (a.size !== b.size) return false;
      var ok = true; a.forEach(function (val, key) { if (!b.has(key) || !eq(val, b.get(key), tol, depth + 1)) ok = false; }); return ok;
    }
    if (a instanceof Set && b instanceof Set) {
      if (a.size !== b.size) return false;
      var all = true; a.forEach(function (val) { if (!b.has(val)) all = false; }); return all;
    }
    var ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (var i = 0; i < ka.length; i++)
      if (!Object.prototype.hasOwnProperty.call(b, ka[i]) || !eq(a[ka[i]], b[ka[i]], tol, depth + 1)) return false;
    return true;
  }
  function errText(e) { return e && e.name && e.message !== undefined ? e.name + ": " + e.message : "Error: " + show(e, 1); }
  function lineOf(stack) {
    var m = /blob:[^\\s)]*?:(\\d+):(\\d+)/.exec(String(stack || ""));
    return m ? Number(m[1]) - ${PRELUDE_LINES} : 0;
  }
  function finish() { if (finished) return; finished = true; P({ t: "done", cut: cut }); }
  function settle() {
    if (!mainDone || finished) return;
    sT(function () { if (!finished && live.size === 0) finish(); }, 0);
  }
  var con = {};
  ["log", "info", "debug", "trace", "dir", "table"].forEach(function (k) { con[k] = function () { emit("stdout", fmt(arguments) + "\\n"); }; });
  ["warn", "error"].forEach(function (k) { con[k] = function () { emit("stderr", fmt(arguments) + "\\n"); }; });
  con.assert = function (c) { if (!c) emit("stderr", "Assertion failed" + (arguments.length > 1 ? ": " + fmt([].slice.call(arguments, 1)) : "") + "\\n"); };
  Object.defineProperty(self, "console", { value: con, configurable: true, writable: true });
  var lines = C.stdin === "" ? [] : C.stdin.replace(/\\r\\n?/g, "\\n").replace(/\\n$/, "").split("\\n");
  var pos = 0;
  function read(q) { if (q !== undefined && q !== null) emit("stdout", String(q)); return pos < lines.length ? lines[pos++] : null; }
  self.input = read; self.prompt = read; self.readLine = read; self.readline = read;
  self.exports = {}; self.module = { exports: self.exports };
  self.require = function (n) { throw new Error("require() is not available here (" + n + ")."); };
  self.setTimeout = function (f, ms) {
    var args = [].slice.call(arguments, 2);
    var id = sT(function () { live.delete(id); try { if (typeof f === "function") f.apply(null, args); } finally { settle(); } }, ms);
    live.add(id); return id;
  };
  self.clearTimeout = function (id) { live.delete(id); cT(id); settle(); };
  self.setInterval = function (f, ms) {
    var args = [].slice.call(arguments, 2);
    var id = sI(function () { if (typeof f === "function") f.apply(null, args); }, ms);
    live.add(id); return id;
  };
  self.clearInterval = function (id) { live.delete(id); cI(id); settle(); };
  self.onerror = function (msg, src, line, col, err) {
    var m = err && err.name ? errText(err) : String(msg).replace(/^Uncaught /, "");
    P({ t: "err", m: m, l: line ? line - ${PRELUDE_LINES} : lineOf(err && err.stack), c: col || 0 });
    finish(); return true;
  };
  self.onunhandledrejection = function (e) {
    var r = e.reason;
    P({ t: "err", m: r && r.name ? errText(r) : "Uncaught (in promise) " + show(r, 1), l: lineOf(r && r.stack), c: 0 });
    if (e.preventDefault) e.preventDefault();
    finish();
  };
  self.__lingo = {
    post: P, show: show, err: errText,
    result: function (a, e, tol) { return { passed: eq(a, e, tol, 0), actual: show(a, 1), expected: show(e, 1) }; },
    end: function () { mainDone = true; settle(); }
  };
})();`;

const folded = PRELUDE.replace(/\n\s*/g, " ");

const callBlock = ({ call, expect, tolerance }: CallSpec) => {
  const tol = typeof tolerance === "number" && tolerance >= 0 ? tolerance : 1e-9;
  return `try { var __lingo_a = await (${call}); try { var __lingo_e = (${expect}); __lingo_r.push(__lingo.result(__lingo_a, __lingo_e, ${tol})); } catch (__lingo_x) { __lingo_r.push({ passed: false, actual: __lingo.show(__lingo_a, 1), error: "the expected value could not be computed: " + __lingo.err(__lingo_x) }); } } catch (__lingo_x) { __lingo_r.push({ passed: false, error: __lingo.err(__lingo_x) }); }`;
};

export type JsProgramOptions = {
  code: string;
  stdin?: string;
  calls?: CallSpec[];
  outputLimit?: number;
};

/** The worker script for one run. Line n of the learner's code is line n + PRELUDE_LINES. */
export const buildJsProgram = ({
  code,
  stdin = "",
  calls = [],
  outputLimit = OUTPUT_LIMIT,
}: JsProgramOptions) => {
  const config = JSON.stringify({ stdin, limit: outputLimit });
  const prelude = folded.replace("__CONFIG__", () => config);
  const epilogue = `;(async function () { var __lingo_r = []; ${calls
    .map(callBlock)
    .join(" ")} ${calls.length ? '__lingo.post({ t: "calls", r: __lingo_r });' : ""} __lingo.end(); })();`;
  return {
    source: `${prelude}\n${code}\n${epilogue}\n`,
    lineOffset: PRELUDE_LINES,
    codeLines: code.split("\n").length,
  };
};
