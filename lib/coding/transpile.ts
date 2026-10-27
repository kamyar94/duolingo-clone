// TypeScript to JavaScript in the browser (section 4.4). The TypeScript compiler is handed in,
// so the same code runs in the TypeScript worker (global `ts` loaded from the app's runtime
// folder) and in the unit tests (the typescript package under Node).
import type * as TS from "typescript";

export type TranspileDiagnostic = { line: number; column: number; message: string };

export type TranspileResult = {
  js: string;
  /** For each 1-based line of `js`, the 1-based line of the TypeScript source (0 when unknown). */
  lineMap: number[];
  diagnostics: TranspileDiagnostic[];
};

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_VALUE = new Map([...BASE64].map((char, i) => [char, i]));

/** Decodes one segment of a source map's `mappings` (Base64 VLQ numbers). */
const decodeSegment = (segment: string) => {
  const values: number[] = [];
  let value = 0;
  let shift = 0;
  for (const char of segment) {
    const digit = BASE64_VALUE.get(char);
    if (digit === undefined) break;
    value += (digit & 31) << shift;
    if (digit & 32) shift += 5;
    else {
      values.push(value & 1 ? -(value >>> 1) : value >>> 1);
      value = 0;
      shift = 0;
    }
  }
  return values;
};

/**
 * Generated line to source line from a version 3 source map with one source. Lines without a
 * mapping take the line of the nearest mapped line above.
 */
export const lineMapFromSourceMap = (mappings: string, generatedLines: number) => {
  const map: number[] = [0];
  let sourceLine = 0;
  let lastKnown = 0;
  const lines = mappings.split(";");
  for (let i = 0; i < generatedLines; i++) {
    let first: number | undefined;
    for (const segment of (lines[i] ?? "").split(",")) {
      if (!segment) continue;
      const values = decodeSegment(segment);
      if (values.length >= 4) {
        sourceLine += values[2];
        first ??= sourceLine;
      }
    }
    if (first !== undefined) lastKnown = first + 1;
    map.push(first !== undefined ? first + 1 : lastKnown);
  }
  return map;
};

export const transpileTypeScript = (
  ts: typeof TS,
  code: string,
  fileName = "main.ts"
): TranspileResult => {
  const output = ts.transpileModule(code, {
    fileName,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      sourceMap: true,
      removeComments: false,
      isolatedModules: true,
    },
  });
  const js = output.outputText.replace(/\n\/\/# sourceMappingURL=.*\s*$/, "\n");
  const generatedLines = js.split("\n").length;
  let lineMap: number[] = [];
  try {
    const sourceMap = JSON.parse(output.sourceMapText ?? "{}") as { mappings?: string };
    lineMap = lineMapFromSourceMap(sourceMap.mappings ?? "", generatedLines);
  } catch {
    lineMap = [];
  }
  const diagnostics = (output.diagnostics ?? []).map((diagnostic) => {
    const position =
      diagnostic.file && diagnostic.start !== undefined
        ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
        : { line: 0, character: 0 };
    return {
      line: position.line + 1,
      column: position.character + 1,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    };
  });
  return { js, lineMap, diagnostics };
};

/** Maps a line of the transpiled program back to the TypeScript source. */
export const sourceLine = (lineMap: number[], line: number | undefined) =>
  line === undefined ? undefined : lineMap[line] || undefined;
