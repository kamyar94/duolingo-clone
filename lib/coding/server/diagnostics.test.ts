import { describe, expect, it } from "vitest";

import { compileError, runtimeError } from "./diagnostics";

// The outputs below are what the runner images printed in the local runner test.
describe("compile errors", () => {
  it.each([
    [
      "csharp",
      "Program.cs(3,9): error CS0029: Cannot implicitly convert type 'string' to 'int'\n",
      { line: 3, column: 9, message: "CS0029: Cannot implicitly convert type 'string' to 'int'" },
    ],
    [
      "java",
      "Greeter.java:3: error: incompatible types: String cannot be converted to int\n        int x = \"text\";\n",
      { line: 3, message: "incompatible types: String cannot be converted to int" },
    ],
    [
      "kotlin",
      "Main.kt:3:16: error: initializer type mismatch: expected 'Int', actual 'String'.\n",
      { line: 3, column: 16, message: "initializer type mismatch: expected 'Int', actual 'String'." },
    ],
    [
      "c",
      "main.c: In function 'main':\nmain.c:3:13: error: expected expression before ';' token\n    3 |     int x = ;\n",
      { line: 3, column: 13, message: "expected expression before ';' token" },
    ],
    [
      "cpp",
      "main.cpp: In function 'int main()':\nmain.cpp:3:13: error: invalid conversion from 'const char*' to 'int' [-fpermissive]\n",
      { line: 3, column: 13 },
    ],
    [
      "go",
      "# command-line-arguments\n./main.go:3:27: cannot use \"text\" (untyped string constant) as int value in variable declaration\n",
      { line: 3, column: 27 },
    ],
    [
      "rust",
      "error[E0308]: mismatched types\n --> main.rs:3:18\n  |\n3 |     let x: i32 = \"text\";\n",
      { line: 3, column: 18, message: "error[E0308]: mismatched types" },
    ],
  ] as const)("finds the first %s error and its line", (language, output, expected) => {
    expect(compileError(language, output)).toMatchObject(expected);
  });

  it("falls back to the compiler's first line", () => {
    expect(compileError("c", "\ncc1: out of memory\n")).toEqual({ message: "cc1: out of memory" });
    expect(compileError("csharp", "")).toEqual({ message: "The program did not compile." });
  });
});

describe("runtime errors", () => {
  const end = (stderr: string, exitCode = 1, signal?: string) => ({
    stdout: "",
    stderr,
    exitCode,
    signal,
  });

  it.each([
    [
      "csharp",
      "Unhandled exception. System.IndexOutOfRangeException: Index was outside the bounds of the array.\n   at Program.<Main>$(String[] args) in Program.cs:line 3\n",
      { line: 3, message: "System.IndexOutOfRangeException: Index was outside the bounds of the array." },
    ],
    [
      "java",
      'Exception in thread "main" java.lang.ArrayIndexOutOfBoundsException: Index 5 out of bounds for length 2\n\tat Main.main(Main.java:4)\n',
      { line: 4 },
    ],
    [
      "kotlin",
      'Exception in thread "main" java.lang.ArrayIndexOutOfBoundsException: Index 5 out of bounds for length 2\n\tat MainKt.main(Main.kt:3)\n\tat MainKt.main(Main.kt)\n',
      { line: 3 },
    ],
    [
      "go",
      "panic: runtime error: index out of range [5] with length 0\n\ngoroutine 1 [running]:\nmain.main()\n\t./main.go:5 +0x9\n",
      { line: 5, message: "panic: runtime error: index out of range [5] with length 0" },
    ],
    [
      "rust",
      "\nthread 'main' (87) panicked at main.rs:3:25:\nindex out of bounds: the len is 0 but the index is 5\n",
      { line: 3, column: 25, message: "index out of bounds: the len is 0 but the index is 5" },
    ],
    [
      "ruby",
      "main.rb:2:in '<main>': undefined method 'upcase' for nil (NoMethodError)\n",
      { line: 2, message: "undefined method 'upcase' for nil (NoMethodError)" },
    ],
    [
      "ruby",
      "main.rb: --> main.rb\nUnmatched `[', missing `]' ?\nmain.rb:3: syntax errors found (SyntaxError)\n",
      { line: 3, message: "syntax errors found (SyntaxError)" },
    ],
    [
      "php",
      'Parse error: syntax error, unexpected token ";" in main.php on line 3\n',
      { line: 3, message: 'syntax error, unexpected token ";"' },
    ],
    [
      "php",
      "Fatal error: Uncaught Exception: boom in main.php:3\nStack trace:\n#0 {main}\n",
      { line: 3, message: "Uncaught Exception: boom" },
    ],
    ["perl", "boom at main.pl line 2.\n", { line: 2, message: "boom" }],
    [
      "lua",
      "lua5.4: main.lua:3: attempt to index a nil value (local 't')\nstack traceback:\n",
      { line: 3, message: "attempt to index a nil value (local 't')" },
    ],
    [
      "bash",
      "main.sh: line 3: no_such_command_here: command not found\n",
      { line: 3, message: "no_such_command_here: command not found" },
    ],
  ] as const)("reads a %s error and its line", (language, stderr, expected) => {
    expect(runtimeError(language, end(stderr))).toMatchObject(expected);
  });

  it("explains signals and exit codes", () => {
    expect(runtimeError("c", end("", 139, "SIGSEGV")).message).toMatch(/Segmentation fault/);
    expect(
      runtimeError("cpp", end("terminate called after throwing an instance of 'std::runtime_error'\n", 134, "SIGABRT"))
        .message
    ).toMatch(/aborted\. terminate called/);
    expect(runtimeError("c", end("", 3)).message).toBe("The program ended with exit code 3.");
    expect(runtimeError("c", end("bad input\n", 1)).message).toBe("bad input");
  });

  it("keeps messages short", () => {
    const message = runtimeError("bash", end(`main.sh: line 1: ${"x".repeat(1000)}\n`)).message;
    expect(message.length).toBeLessThanOrEqual(300);
  });
});
