// The documents of the two sandboxed frames the app creates (sections 4.4 and 7). Both are
// written into an iframe's srcdoc with sandbox="allow-scripts" and no allow-same-origin, so they
// run with an opaque origin: no access to the app's cookies, storage or pages. Their content
// security policies block every network request. The runner frame gets its runtimes (Pyodide,
// sql.js) from the app page by postMessage and loads them from blob URLs of its own.
import type { TestOutcome, WebCheck } from "./types";

/** The sandbox attribute of every frame that runs a learner's code. */
export const FRAME_SANDBOX = "allow-scripts";

const escapeAttribute = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** Keeps a text from closing the element it is written into. */
const escapeEnd = (text: string, tag: "script" | "style") =>
  text.replace(new RegExp(`</(${tag})`, "gi"), "<\\/$1");

export const runnerFramePolicy = (nonce: string) =>
  [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' blob: 'wasm-unsafe-eval'`,
    "worker-src blob:",
    "connect-src blob:",
    "style-src 'unsafe-inline'",
  ].join("; ");

/**
 * The runner frame: its own script inline (allowed by a nonce), workers and runtimes from blob
 * URLs it creates itself, WebAssembly compilation allowed for Pyodide and sql.js, and no network.
 */
export const runnerFrameHtml = (frameScript: string, nonce: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escapeAttribute(runnerFramePolicy(nonce))}"></head><body><script nonce="${escapeAttribute(nonce)}">${escapeEnd(frameScript, "script")}</script></body></html>`;

/** Runtime files the runner frame may ask the page for (paths under /runtimes/). */
export const isRuntimePath = (path: string) =>
  /^(lingo|pyodide|sqljs|python)\/[\w.@+-]+$/.test(path) && !path.includes("..");

export const PREVIEW_OUTPUT_LIMIT = 64 * 1024;

// Runs first in the preview: forwards console output and errors to the app page and answers
// check requests. No // comments: it is inlined as is.
const BRIDGE = `(function () {
  var JS_START = __JS_START__, used = 0, LIMIT = ${PREVIEW_OUTPUT_LIMIT};
  function post(m) { m.lingo = "preview"; parent.postMessage(m, "*"); }
  function show(v) {
    if (typeof v === "string") return v;
    try { return JSON.stringify(v); } catch (e) { return String(v); }
  }
  function out(stream, args) {
    var text = [].map.call(args, show).join(" ") + "\\n";
    if (used >= LIMIT) return;
    used += text.length;
    post({ type: "console", stream: stream, text: text.slice(0, LIMIT) });
  }
  ["log", "info", "debug"].forEach(function (k) { console[k] = function () { out("stdout", arguments); }; });
  ["warn", "error"].forEach(function (k) { console[k] = function () { out("stderr", arguments); }; });
  window.addEventListener("error", function (e) {
    var line = e.lineno && e.lineno >= JS_START ? e.lineno - JS_START + 1 : 0;
    post({ type: "error", message: String(e.message || "Error").replace(/^Uncaught /, ""), line: line });
  });
  function norm(s) { return String(s == null ? "" : s).replace(/\\s+/g, " ").trim(); }
  function sameStyle(el, prop, expected) {
    var actual = getComputedStyle(el).getPropertyValue(prop).trim();
    if (norm(actual) === norm(expected)) return { ok: true, actual: actual };
    var probe = el.cloneNode(false);
    probe.removeAttribute("id");
    probe.style.setProperty(prop, expected);
    probe.style.setProperty("position", "absolute");
    probe.style.setProperty("visibility", "hidden");
    probe.style.setProperty("pointer-events", "none");
    (el.parentNode || document.body).insertBefore(probe, el.nextSibling);
    var wanted = getComputedStyle(probe).getPropertyValue(prop).trim();
    probe.remove();
    return { ok: norm(actual) === norm(wanted), actual: actual, wanted: wanted };
  }
  function check(c) {
    var all;
    try { all = document.querySelectorAll(c.selector); }
    catch (e) { return { passed: false, message: "The selector " + c.selector + " is not valid." }; }
    if (typeof c.count === "number" && all.length !== c.count)
      return { passed: false, expected: c.count + " element(s)", actual: all.length + " element(s)", message: "Expected " + c.count + " element(s) matching " + c.selector + ", found " + all.length + "." };
    if (typeof c.count !== "number" && all.length === 0)
      return { passed: false, expected: c.selector, actual: "nothing", message: "Nothing on the page matches " + c.selector + "." };
    var el = all[0];
    if (!el) return { passed: true };
    if (typeof c.text === "string") {
      var text = norm(el.textContent), want = norm(c.text), mode = c.textMatch || "exact", ok;
      if (mode === "contains") ok = text.indexOf(want) >= 0;
      else if (mode === "regex") { try { ok = new RegExp(c.text).test(text); } catch (e) { ok = false; } }
      else ok = text === want;
      if (!ok) return { passed: false, expected: c.text, actual: text, message: "The text of " + c.selector + " is different." };
    }
    var key;
    for (key in c.attr || {}) {
      var value = el.getAttribute(key);
      if (value !== c.attr[key]) return { passed: false, expected: key + "=" + c.attr[key], actual: value === null ? "no " + key : key + "=" + value, message: "The " + key + " of " + c.selector + " is different." };
    }
    for (key in c.style || {}) {
      var s = sameStyle(el, key, c.style[key]);
      if (!s.ok) return { passed: false, expected: key + ": " + c.style[key], actual: key + ": " + s.actual, message: "The " + key + " of " + c.selector + " is different." };
    }
    return { passed: true };
  }
  window.addEventListener("load", function () { post({ type: "ready" }); });
  window.addEventListener("message", function (e) {
    if (e.source !== parent || !e.data || e.data.lingo !== "check") return;
    var results = (e.data.checks || []).map(function (c) {
      try { return check(c); } catch (err) { return { passed: false, message: String(err) }; }
    });
    post({ type: "checks", id: e.data.id, results: results });
  });
})();`;

const PREVIEW_POLICY = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "media-src data: blob:",
].join("; ");

/**
 * The live preview of a web program. The learner's JavaScript runs after the page, and its error
 * lines are counted from the start of the JavaScript tab.
 */
export const previewHtml = ({
  html = "",
  css = "",
  js = "",
}: {
  html?: string;
  css?: string;
  js?: string;
}) => {
  const head = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${escapeAttribute(PREVIEW_POLICY)}"><script>`;
  const afterBridge = `</script><style>\n${escapeEnd(css, "style")}\n</style></head><body>\n${html}\n<script>\n`;
  const before = head + BRIDGE.replace("__JS_START__", "0") + afterBridge;
  const jsStart = before.split("\n").length;
  return (
    head +
    BRIDGE.replace("__JS_START__", String(jsStart)) +
    afterBridge +
    escapeEnd(js, "script") +
    "\n</script></body></html>"
  );
};

export type WebCheckResult = {
  passed: boolean;
  expected?: string;
  actual?: string;
  message?: string;
};

/** Outcomes of the page checks, hidden checks reduced to pass or fail. */
export const webCheckOutcomes = (
  checks: WebCheck[],
  results: WebCheckResult[]
): TestOutcome[] =>
  checks.map((check, index) => {
    const result = results[index] ?? { passed: false, message: "The check did not run." };
    const visible = check.visible !== false;
    const name = check.name?.trim() || `Check ${index + 1}`;
    return visible
      ? {
          index,
          name,
          visible,
          passed: result.passed,
          expected: result.expected,
          actual: result.actual,
          message: result.passed ? undefined : result.message,
        }
      : { index, name, visible, passed: result.passed };
  });
