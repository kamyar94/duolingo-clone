import { describe, expect, it, vi } from "vitest";

import {
  familyOf,
  runOnServer,
  runnerUrl,
  serverLanguages,
  stepResult,
  toRunResult,
  type RunnerResponse,
  type RunnerStep,
} from "./client";
import type { ServerRun } from "./request";

const TOKEN = "t".repeat(32);
const env = {
  RUNNER_TOKEN: TOKEN,
  RUNNER_URL_DOTNET: "http://runner-dotnet:8080/",
  RUNNER_URL_NATIVE: "http://runner-native:8080",
};

const step = (fields: Partial<RunnerStep> = {}): RunnerStep => ({
  exitCode: 0,
  stdout: "",
  stderr: "",
  durationMs: 10,
  timedOut: false,
  truncated: false,
  oomKilled: false,
  ...fields,
});

const run = (fields: Partial<ServerRun> = {}): ServerRun => ({
  language: "csharp",
  code: 'Console.WriteLine("hi");',
  inputs: [""],
  batch: false,
  timeLimitMs: 3000,
  ...fields,
});

const answer = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("runner routing", () => {
  it("maps every server language to one family", () => {
    expect(familyOf("csharp")).toBe("dotnet");
    expect(familyOf("kotlin")).toBe("jvm");
    expect(familyOf("cpp")).toBe("native");
    expect(familyOf("lua")).toBe("script");
    expect(familyOf("python")).toBeNull();
  });

  it("reads the runner address of the family and the token", () => {
    expect(runnerUrl("csharp", env)).toBe("http://runner-dotnet:8080");
    expect(runnerUrl("java", env)).toBeNull();
    expect(serverLanguages(env)).toEqual(["csharp", "c", "cpp"]);
    expect(serverLanguages({ ...env, RUNNER_TOKEN: "short" })).toEqual([]);
  });
});

describe("runner answers", () => {
  it("passes a clean run through", () => {
    expect(stepResult("c", step({ stdout: "hi\n" }))).toEqual({
      status: "ok",
      stdout: "hi\n",
      stderr: "",
      durationMs: 10,
    });
  });

  it("marks time-outs, output caps, memory and crashes", () => {
    expect(stepResult("c", step({ timedOut: true, exitCode: 137, signal: "SIGKILL" })).status).toBe("timeout");
    expect(stepResult("c", step({ truncated: true })).error?.message).toMatch(/64 KB/);
    expect(stepResult("c", step({ oomKilled: true, exitCode: 137, signal: "SIGKILL" })).error?.message).toMatch(
      /too much memory/
    );
    expect(stepResult("c", step({ exitCode: 139, signal: "SIGSEGV" })).error?.message).toMatch(/Segmentation/);
    expect(stepResult("c", step({ cancelled: true })).status).toBe("cancelled");
  });

  it("reports a compile error with its line and no runs", () => {
    const response: RunnerResponse = {
      language: "csharp",
      compile: step({ exitCode: 1, stdout: "Program.cs(3,9): error CS0029: Cannot convert\n" }),
      runs: [],
      queueMs: 0,
    };
    const result = toRunResult(run({ inputs: ["1", "2"], batch: true }), response);
    expect(result).toMatchObject({
      status: "ok",
      stdout: "",
      error: { line: 3, column: 9, message: "CS0029: Cannot convert" },
    });
    expect(result.runs).toBeUndefined();
  });

  it("gives one result per input for a batch, with compiler warnings apart", () => {
    const response: RunnerResponse = {
      language: "c",
      compile: step({ stderr: "main.c:2:5: warning: unused variable 'x'\n" }),
      runs: [step({ stdout: "1\n" }), step({ exitCode: 2, stderr: "bad\n" })],
      queueMs: 0,
    };
    const result = toRunResult(run({ language: "c", inputs: ["a", "b"], batch: true }), response);
    expect(result.runs?.map((single) => single.stdout)).toEqual(["1\n", ""]);
    expect(result.runs?.[1].error?.message).toBe("bad");
    expect(result.compileOutput).toMatch(/unused variable/);
  });

  it("gives a single result for a plain run", () => {
    const result = toRunResult(run(), { language: "csharp", compile: step(), runs: [step({ stdout: "hi\n" })], queueMs: 0 });
    expect(result).toMatchObject({ status: "ok", stdout: "hi\n" });
    expect(result.runs).toBeUndefined();
  });
});

describe("runOnServer", () => {
  it("is unavailable without a runner address or token", async () => {
    const fetch = vi.fn();
    const result = await runOnServer(run({ language: "java" }), { env, fetch });
    expect(result.status).toBe("unavailable");
    expect(result.error?.message).toMatch(/Java programs cannot run on this server/);
    expect(fetch).not.toHaveBeenCalled();
    expect((await runOnServer(run(), { env: { ...env, RUNNER_TOKEN: "" }, fetch })).status).toBe("unavailable");
  });

  it("sends the program, the inputs and the token to the family's runner", async () => {
    const fetch = vi.fn(async () => answer({ language: "csharp", compile: step(), runs: [step({ stdout: "hi\n" })], queueMs: 3 }));
    const result = await runOnServer(run({ inputs: ["Oak\n"], timeLimitMs: 2000 }), { env, fetch });
    expect(result).toMatchObject({ status: "ok", stdout: "hi\n" });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://runner-dotnet:8080/run");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(init.body as string)).toEqual({
      language: "csharp",
      files: [{ name: "Program.cs", content: 'Console.WriteLine("hi");' }],
      runs: [{ stdin: "Oak\n" }],
      timeLimitMs: 2000,
    });
  });

  it("retries once when the runner is restarting", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(answer({ language: "c", runs: [step({ stdout: "ok\n" })], queueMs: 0 }));
    const result = await runOnServer(run({ language: "c" }), { env, fetch, retryDelayMs: 1 });
    expect(result.stdout).toBe("ok\n");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("is unavailable when the runner stays away, is busy or refuses the token", async () => {
    const down = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    expect((await runOnServer(run(), { env, fetch: down, retryDelayMs: 1 })).error?.message).toMatch(
      /not running/
    );
    const busy = vi.fn(async () => answer({ error: "busy" }, 503));
    expect((await runOnServer(run(), { env, fetch: busy })).error?.message).toMatch(/busy/);
    const refused = vi.spyOn(console, "error").mockImplementation(() => {});
    const wrongToken = vi.fn(async () => answer({ error: "unauthorized" }, 401));
    const result = await runOnServer(run(), { env, fetch: wrongToken });
    expect(result.status).toBe("unavailable");
    expect(refused).toHaveBeenCalled();
  });

  it("reports a request the runner refused as an error", async () => {
    const fetch = vi.fn(async () => answer({ error: "the file name is not allowed" }, 400));
    const result = await runOnServer(run(), { env, fetch });
    expect(result).toMatchObject({ status: "error", error: { message: expect.stringMatching(/not allowed/) } });
  });

  it("stops waiting when the learner cancels", async () => {
    const controller = new AbortController();
    const fetch = vi.fn((_: string, init: RequestInit) => {
      controller.abort();
      return Promise.reject(init.signal?.reason ?? new Error("aborted"));
    });
    const result = await runOnServer(run(), { env, fetch: fetch as unknown as typeof globalThis.fetch, signal: controller.signal });
    expect(result.status).toBe("cancelled");
  });
});
