import { describe, expect, it, vi } from "vitest";

import { checkProgram } from "./check";
import { createServerTransport, replayEvents, serverRunBody, SERVER_RUN_PATH } from "./server-transport";
import type { RunEvent, RunRequest, RunResult } from "./types";

const answer = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("the server transport", () => {
  it("sends only the fields a server run uses", () => {
    expect(serverRunBody({ language: "c", code: "x", stdin: "1", setup: "s", timeLimitMs: 900 })).toEqual({
      language: "c",
      code: "x",
      stdin: "1",
      timeLimitMs: 900,
    });
    expect(serverRunBody({ language: "c", code: "x", inputs: ["1", "2"] })).toEqual({
      language: "c",
      code: "x",
      inputs: ["1", "2"],
    });
  });

  it("replays the output of every run, compiler warnings first", () => {
    const events: RunEvent[] = [];
    replayEvents(
      {
        status: "ok",
        stdout: "",
        stderr: "",
        compileOutput: "warning: unused",
        runs: [
          { status: "ok", stdout: "1\n", stderr: "" },
          { status: "ok", stdout: "", stderr: "oops\n" },
        ],
      },
      (event) => events.push(event)
    );
    expect(events).toEqual([
      { stream: "info", text: "warning: unused\n" },
      { stream: "stdout", text: "1\n" },
      { stream: "stderr", text: "oops\n" },
    ]);
  });

  it("posts to the app's route and returns its result", async () => {
    const result: RunResult = { status: "ok", stdout: "Hello\n", stderr: "" };
    const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => answer(result));
    const { transport } = createServerTransport(fetch as unknown as typeof globalThis.fetch);
    const events: RunEvent[] = [];
    const got = await transport({ language: "csharp", code: "x" }, (event) => events.push(event));
    expect(got).toEqual(result);
    expect(fetch.mock.calls[0][0]).toBe(SERVER_RUN_PATH);
    expect(events.map((event) => event.stream)).toEqual(["info", "stdout"]);
  });

  it("turns refusals into unavailable results with the route's message", async () => {
    const limited = vi.fn(async () => answer({ error: "You are running programs very quickly." }, 429));
    const { transport } = createServerTransport(limited as unknown as typeof globalThis.fetch);
    expect(await transport({ language: "c", code: "" })).toMatchObject({
      status: "unavailable",
      error: { message: "You are running programs very quickly." },
    });
    const signedOut = vi.fn(async () => answer({ error: "Sign in" }, 401));
    const second = createServerTransport(signedOut as unknown as typeof globalThis.fetch);
    expect((await second.transport({ language: "c", code: "" }))?.error?.message).toMatch(/session has ended/);
  });

  it("gives up on the run when cancelled", async () => {
    const fetch = vi.fn(
      (_: string, init: RequestInit) =>
        new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))))
    );
    const { transport, cancel } = createServerTransport(fetch as unknown as typeof globalThis.fetch);
    const pending = transport({ language: "c", code: "" });
    cancel();
    expect((await pending)?.status).toBe("cancelled");
  });
});

describe("checking a server language", () => {
  it("sends all input and output tests in one request and grades each run", async () => {
    const requests: RunRequest[] = [];
    const run = async (request: RunRequest): Promise<RunResult> => {
      requests.push(request);
      return {
        status: "ok",
        stdout: "",
        stderr: "",
        runs: (request.inputs ?? []).map((input) => ({
          status: "ok" as const,
          stdout: input === "3\n" ? "wrong\n" : `${Number(input) * 2}\n`,
          stderr: "",
        })),
      };
    };
    const report = await checkProgram(run, {
      language: "csharp",
      code: "…",
      tests: [
        { stdin: "1\n", expect: "2" },
        { stdin: "2\n", expect: "4", visible: false },
        { stdin: "3\n", expect: "6" },
      ],
    });
    expect(requests).toHaveLength(1);
    expect(requests[0].inputs).toEqual(["1\n", "2\n", "3\n"]);
    expect(report.outcomes.map((outcome) => outcome.passed)).toEqual([true, true, false]);
    expect(report.allPassed).toBe(false);
  });

  it("fails every test with the compile error when the program does not compile", async () => {
    const run = async (): Promise<RunResult> => ({
      status: "ok",
      stdout: "",
      stderr: "Program.cs(2,1): error CS1002: ; expected",
      error: { message: "CS1002: ; expected", line: 2 },
    });
    const report = await checkProgram(run, {
      language: "csharp",
      code: "…",
      tests: [
        { stdin: "1", expect: "1" },
        { stdin: "2", expect: "2" },
      ],
    });
    expect(report.outcomes.every((outcome) => !outcome.passed && outcome.line === 2)).toBe(true);
    expect(report.error?.line).toBe(2);
  });

  it("does not grade when the runner is unavailable", async () => {
    const run = async (): Promise<RunResult> => ({
      status: "unavailable",
      stdout: "",
      stderr: "",
      error: { message: "The server is busy." },
    });
    const report = await checkProgram(run, {
      language: "java",
      code: "…",
      tests: [
        { stdin: "1", expect: "1" },
        { stdin: "2", expect: "2" },
      ],
    });
    expect(report.unavailable).toBe("The server is busy.");
  });
});
