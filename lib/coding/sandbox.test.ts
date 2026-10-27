import { describe, expect, it } from "vitest";

import {
  FRAME_SANDBOX,
  isRuntimePath,
  previewHtml,
  runnerFrameHtml,
  runnerFramePolicy,
  webCheckOutcomes,
} from "./sandbox";
import { checkSnippet, snippetName } from "./snippets";
import { createFileBridge } from "./workers/files";

describe("the runner frame", () => {
  it("runs with an opaque origin and no network access", () => {
    expect(FRAME_SANDBOX).toBe("allow-scripts");
    const policy = runnerFramePolicy("abc");
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("script-src 'nonce-abc' blob: 'wasm-unsafe-eval'");
    expect(policy).toContain("worker-src blob:");
    expect(policy).toContain("connect-src blob:");
    expect(policy).not.toMatch(/https?:|'self'|'unsafe-eval'/);
  });

  it("writes its own script inline under the nonce, unable to close the script element", () => {
    const html = runnerFrameHtml('console.log("</script><img src=x>")', "n0nce");
    expect(html).toContain('<script nonce="n0nce">');
    expect(html).toContain("<\\/script><img src=x>");
    expect(html.match(/<\/script>/g)).toHaveLength(1);
  });

  it("hands out runtime files only", () => {
    expect(isRuntimePath("pyodide/pyodide.asm.wasm")).toBe(true);
    expect(isRuntimePath("lingo/frame.js")).toBe(true);
    expect(isRuntimePath("python/jedi-0.19.2-py2.py3-none-any.whl")).toBe(true);
    expect(isRuntimePath("../api/courses")).toBe(false);
    expect(isRuntimePath("pyodide/../../secrets")).toBe(false);
    expect(isRuntimePath("typescript/typescript.js")).toBe(false);
    expect(isRuntimePath("https://example.com/x.js")).toBe(false);
  });
});

describe("the web preview", () => {
  it("blocks the network and counts error lines from the JavaScript tab", () => {
    const html = previewHtml({ html: "<p>Hi</p>", css: "p { color: red }", js: "a();\nb();" });
    expect(html).toContain("default-src 'none'");
    expect(html).not.toContain("connect-src");
    const lines = html.split("\n");
    const start = Number(/var JS_START = (\d+)/.exec(html)![1]);
    expect(lines[start - 1]).toBe("a();");
    expect(lines[start]).toBe("b();");
  });

  it("keeps the learner's code inside its elements", () => {
    const html = previewHtml({ css: "</style><script>x()</script>", js: "'</script>'" });
    expect(html).toContain("<\\/style>");
    expect(html).not.toContain("'</script>'");
  });

  it("reduces hidden checks to pass or fail", () => {
    const outcomes = webCheckOutcomes(
      [
        { selector: "button", name: "A button" },
        { selector: "h1", text: "Hi", visible: false },
        { selector: "p" },
      ],
      [
        { passed: true },
        { passed: false, expected: "Hi", actual: "Ho", message: "different" },
      ]
    );
    expect(outcomes[0]).toMatchObject({ name: "A button", passed: true });
    expect(outcomes[1]).toEqual({ index: 1, name: "Check 2", visible: false, passed: false });
    expect(outcomes[2]).toMatchObject({ passed: false, message: "The check did not run." });
  });
});

describe("playground programs", () => {
  it("accepts only the files of the program's language", () => {
    expect(checkSnippet("python", { "main.py": "print(1)" })).toBeNull();
    expect(
      checkSnippet("web", { "index.html": "<p>", "style.css": "", "script.js": "" })
    ).toBeNull();
    expect(checkSnippet("python", { "main.sh": "rm" })).toBe("A Python program has no file main.sh.");
    expect(checkSnippet("python", { "main.py": 3 })).toBe("main.py must be text.");
    expect(checkSnippet("cobol", { "main.py": "" })).toBe("Unknown language.");
    expect(checkSnippet("python", {})).toBe("The program has no files.");
    expect(checkSnippet("python", { "main.py": "x".repeat(300 * 1024) })).toMatch(/limit is 256 KB/);
  });

  it("tidies names", () => {
    expect(snippetName("  my   program ")).toBe("my program");
    expect(snippetName("")).toBe("Untitled");
    expect(snippetName("x".repeat(200))).toHaveLength(80);
  });
});

describe("the file bridge of the sandbox", () => {
  it("asks once per path and hands the answer to the right request", async () => {
    const asked: [number, string][] = [];
    const bridge = createFileBridge((id, path) => asked.push([id, path]));
    const first = bridge.get("sqljs/sql-wasm.wasm");
    const again = bridge.get("sqljs/sql-wasm.wasm");
    const other = bridge.get("sqljs/sql-wasm.js");
    expect(asked.map(([, path]) => path)).toEqual(["sqljs/sql-wasm.wasm", "sqljs/sql-wasm.js"]);
    bridge.answer({ id: asked[1][0], error: "missing" });
    bridge.answer({ id: asked[0][0], buffer: new Uint8Array([1, 2]).buffer });
    expect(new Uint8Array(await first)).toEqual(new Uint8Array([1, 2]));
    expect(await again).toBe(await first);
    await expect(other).rejects.toThrow("missing");
    // A failed file is asked for again next time.
    void bridge.get("sqljs/sql-wasm.js");
    expect(asked).toHaveLength(3);
  });
});
