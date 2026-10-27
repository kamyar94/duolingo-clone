// The TypeScript worker of the app page: transpiles TypeScript before a run and answers code
// completion for JavaScript and TypeScript with the TypeScript language service (completion tier
// 2, section 4.3). It never runs the learner's code, so it lives on the app's own origin and
// loads the compiler from /runtimes/typescript/. Bundled to /runtimes/lingo/ts-service.js.
import type * as TS from "typescript";

import { transpileTypeScript } from "../transpile";

import type { CompletionItem, TsRequest, TsResponse } from "./protocol";

const scope = globalThis as unknown as {
  postMessage: (message: TsResponse) => void;
  onmessage: ((event: MessageEvent<TsRequest>) => void) | null;
  importScripts: (...urls: string[]) => void;
  ts?: typeof TS;
  location: { href: string };
};

const runtimeBase = new URL("../", scope.location.href).href;
let compiler: typeof TS | null = null;

const getTs = () => {
  if (!compiler) {
    scope.importScripts(`${runtimeBase}typescript/typescript.js`);
    if (!scope.ts) throw new Error("TypeScript did not load.");
    compiler = scope.ts;
  }
  return compiler;
};

// ---- language service ----

/** Globals the runner provides on top of the web worker library. */
const GLOBALS = `declare function input(question?: unknown): string | null;
declare function prompt(question?: unknown): string | null;
declare function readLine(question?: unknown): string | null;
declare function readline(question?: unknown): string | null;
`;

const ROOT_LIBS = ["es2022", "webworker", "webworker.iterable", "webworker.asynciterable"];
const libs = new Map<string, string>();
let libsLoaded: Promise<void> | null = null;

/** Fetches the library files the service needs, following their reference directives. */
const loadLibs = () => {
  libsLoaded ??= (async () => {
    let wanted = [...ROOT_LIBS];
    while (wanted.length) {
      const texts = await Promise.all(
        wanted.map(async (name) => {
          const response = await fetch(`${runtimeBase}typescript/lib/lib.${name}.d.ts`);
          return [name, response.ok ? await response.text() : ""] as const;
        })
      );
      const next = new Set<string>();
      for (const [name, text] of texts) {
        libs.set(`/lib.${name}.d.ts`, text);
        for (const match of text.matchAll(/\/\/\/\s*<reference\s+lib="([^"]+)"\s*\/>/g))
          if (!libs.has(`/lib.${match[1]}.d.ts`)) next.add(match[1]);
      }
      wanted = [...next];
    }
  })();
  return libsLoaded;
};

const files = new Map<string, { text: string; version: number }>([
  ["/lingo-globals.d.ts", { text: GLOBALS, version: 1 }],
]);
let service: TS.LanguageService | null = null;
let currentFile = "/main.ts";

const getService = () => {
  if (service) return service;
  const ts = getTs();
  const host: TS.LanguageServiceHost = {
    getScriptFileNames: () => [currentFile, "/lingo-globals.d.ts", ...libs.keys()],
    getScriptVersion: (name) => String(files.get(name)?.version ?? 1),
    getScriptSnapshot: (name) => {
      const text = files.get(name)?.text ?? libs.get(name);
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
    },
    getCurrentDirectory: () => "/",
    getCompilationSettings: () => ({
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      allowJs: true,
      checkJs: false,
      noLib: true,
      strict: true,
      moduleDetection: ts.ModuleDetectionKind.Force,
    }),
    getDefaultLibFileName: () => "/lib.es2022.d.ts",
    fileExists: (name) => files.has(name) || libs.has(name),
    readFile: (name) => files.get(name)?.text ?? libs.get(name),
  };
  service = ts.createLanguageService(host, ts.createDocumentRegistry());
  return service;
};

const KINDS: Record<string, string> = {
  keyword: "keyword",
  function: "function",
  method: "method",
  "local function": "function",
  property: "property",
  getter: "property",
  setter: "property",
  var: "variable",
  let: "variable",
  const: "constant",
  "local var": "variable",
  parameter: "variable",
  class: "class",
  interface: "interface",
  type: "type",
  enum: "enum",
  "enum member": "constant",
  module: "namespace",
  alias: "variable",
};

const complete = async (code: string, pos: number, fileName: string): Promise<CompletionItem[]> => {
  await loadLibs();
  const name = `/${fileName.replace(/^\/+/, "")}`;
  const ls = getService();
  currentFile = name;
  const previous = files.get(name);
  files.set(name, { text: code, version: (previous?.version ?? 0) + 1 });
  const found = ls.getCompletionsAtPosition(name, pos, {
    includeCompletionsWithInsertText: true,
    includeCompletionsForModuleExports: false,
  });
  if (!found) return [];
  return found.entries
    .filter((entry) => !entry.name.startsWith("__lingo"))
    .slice(0, 400)
    .map((entry) => ({
      label: entry.name,
      type: KINDS[entry.kind] ?? "text",
      detail: entry.sortText,
    }));
};

scope.onmessage = async (event) => {
  const request = event.data;
  try {
    if (request.type === "transpile") {
      const result = transpileTypeScript(getTs(), request.code, request.fileName);
      scope.postMessage({ id: request.id, type: "transpile", ...result });
    } else {
      const items = await complete(request.code, request.pos, request.fileName);
      scope.postMessage({ id: request.id, type: "complete", items });
    }
  } catch (error) {
    scope.postMessage({ id: request.id, type: "error", message: String(error) });
  }
};
