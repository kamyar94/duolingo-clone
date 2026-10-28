import { describe, expect, it } from "vitest";

import { MAX_TIME_LIMIT_MS } from "../payload";

import { MAX_CODE, MAX_INPUTS, MAX_STDIN, parseServerRun } from "./request";

describe("server run requests", () => {
  it("accepts a plain run and fills in the defaults", () => {
    const parsed = parseServerRun({ language: "csharp", code: 'Console.WriteLine("hi");' });
    expect(parsed).toEqual({
      ok: true,
      run: {
        language: "csharp",
        code: 'Console.WriteLine("hi");',
        inputs: [""],
        batch: false,
        timeLimitMs: 3000,
      },
    });
  });

  it("turns stdin into the single input and keeps a batch of inputs", () => {
    const plain = parseServerRun({ language: "c", code: "", stdin: "Oak\n" });
    expect(plain.ok && plain.run.inputs).toEqual(["Oak\n"]);
    const batch = parseServerRun({ language: "java", code: "", inputs: ["1\n", "2\n"] });
    expect(batch.ok && batch.run).toMatchObject({ inputs: ["1\n", "2\n"], batch: true });
  });

  it("clamps the time limit to the lesson limits", () => {
    const high = parseServerRun({ language: "go", code: "", timeLimitMs: 999_999 });
    expect(high.ok && high.run.timeLimitMs).toBe(MAX_TIME_LIMIT_MS);
    const low = parseServerRun({ language: "go", code: "", timeLimitMs: 1 });
    expect(low.ok && low.run.timeLimitMs).toBe(100);
  });

  it.each([
    ["not an object", "run"],
    ["an array", []],
    ["a browser language", { language: "python", code: "print(1)" }],
    ["an unknown language", { language: "cobol", code: "" }],
    ["no code", { language: "csharp" }],
    ["code that is not text", { language: "csharp", code: 42 }],
    ["code over the cap", { language: "csharp", code: "x".repeat(MAX_CODE + 1) }],
    ["a NUL character", { language: "c", code: "int main(){}\u0000" }],
    ["stdin that is not text", { language: "c", code: "", stdin: 5 }],
    ["stdin over the cap", { language: "c", code: "", stdin: "x".repeat(MAX_STDIN + 1) }],
    ["both stdin and inputs", { language: "c", code: "", stdin: "", inputs: [""] }],
    ["empty inputs", { language: "c", code: "", inputs: [] }],
    ["too many inputs", { language: "c", code: "", inputs: Array(MAX_INPUTS + 1).fill("") }],
    ["an input that is not text", { language: "c", code: "", inputs: ["", 1] }],
    ["a time limit that is not a number", { language: "c", code: "", timeLimitMs: "3000" }],
    ["fields of browser runs", { language: "c", code: "", calls: [] }],
    ["unknown fields", { language: "c", code: "", files: [] }],
  ])("refuses %s", (_, body) => {
    const parsed = parseServerRun(body);
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.error).toBeTruthy();
  });
});
