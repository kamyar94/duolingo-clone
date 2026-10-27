import * as ts from "typescript";
import { describe, expect, it } from "vitest";

import { lineMapFromSourceMap, sourceLine, transpileTypeScript } from "./transpile";

describe("TypeScript in the browser", () => {
  it("removes types and keeps the program runnable", () => {
    const { js, diagnostics } = transpileTypeScript(
      ts,
      "const area = (w: number, h: number): number => w * h;\nconsole.log(area(2, 3));\n"
    );
    expect(diagnostics).toEqual([]);
    expect(js).not.toMatch(/: number/);
    expect(js).not.toMatch(/sourceMappingURL/);
    const logs: unknown[] = [];
    new Function("console", js)({ log: (v: unknown) => logs.push(v) });
    expect(logs).toEqual([6]);
  });

  it("maps lines of the JavaScript back to the TypeScript source", () => {
    const code = [
      "interface Point {", // 1
      "  x: number;", // 2
      "  y: number;", // 3
      "}", // 4
      "", // 5
      "function len(p: Point): number {", // 6
      "  throw new Error('boom');", // 7
      "}", // 8
    ].join("\n");
    const { js, lineMap } = transpileTypeScript(ts, code);
    const jsLines = js.split("\n");
    const throwAt = jsLines.findIndex((line) => line.includes("throw")) + 1;
    expect(throwAt).toBeLessThan(7);
    expect(sourceLine(lineMap, throwAt)).toBe(7);
    const functionAt = jsLines.findIndex((line) => line.includes("function len")) + 1;
    expect(sourceLine(lineMap, functionAt)).toBe(6);
    expect(sourceLine(lineMap, undefined)).toBeUndefined();
  });

  it("reports syntax errors with their line", () => {
    const { diagnostics } = transpileTypeScript(ts, "let a = 1;\nlet b = (2;\n");
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].line).toBe(2);
    expect(diagnostics[0].message).toMatch(/expected/i);
  });

  it("supports modules through a CommonJS shim", () => {
    const { js } = transpileTypeScript(ts, "export const x: number = 1;\n");
    expect(js).toMatch(/exports\.x = 1/);
  });

  it("decodes source map lines", () => {
    // Generated line 1 from source line 1, line 2 unmapped, line 3 from source line 3.
    expect(lineMapFromSourceMap("AAAA;;AAEA", 3)).toEqual([0, 1, 1, 3]);
  });
});
