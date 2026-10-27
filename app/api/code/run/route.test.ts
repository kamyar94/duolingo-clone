import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentUser = vi.fn();
const runOnServer = vi.fn();

vi.mock("@/lib/auth", () => ({ getCurrentUser: () => getCurrentUser() }));
vi.mock("@/lib/coding/server/client", () => ({
  runOnServer: (...args: unknown[]) => runOnServer(...args),
  serverLanguages: () => ["csharp"],
}));

const { POST, GET } = await import("./route");
const { runnerRateLimiter } = await import("@/lib/coding/server/limits");

const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new Request("http://app.example.com/api/code/run", {
      method: "POST",
      headers: {
        host: "app.example.com",
        origin: "http://app.example.com",
        "content-type": "application/json",
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );

describe("POST /api/code/run", () => {
  beforeEach(() => {
    getCurrentUser.mockResolvedValue({ id: "user-1" });
    runOnServer.mockResolvedValue({ status: "ok", stdout: "hi\n", stderr: "" });
    runnerRateLimiter.reset();
  });

  it("runs a checked program for a signed-in account", async () => {
    const response = await post({ language: "csharp", code: "x", stdin: "1" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", stdout: "hi\n", stderr: "" });
    expect(runOnServer.mock.calls[0][0]).toMatchObject({ language: "csharp", inputs: ["1"] });
  });

  it("refuses visitors without a session", async () => {
    getCurrentUser.mockResolvedValue(null);
    expect((await post({ language: "csharp", code: "x" })).status).toBe(401);
    expect((await GET()).status).toBe(401);
    expect(runOnServer).not.toHaveBeenCalled();
  });

  it("refuses other origins, other content types and bad bodies", async () => {
    expect((await post({ language: "csharp", code: "x" }, { origin: "http://evil.example.org" })).status).toBe(403);
    expect((await post({ language: "csharp", code: "x" }, { "content-type": "text/plain" })).status).toBe(415);
    expect((await post("{not json")).status).toBe(400);
    expect((await post({ language: "python", code: "print(1)" })).status).toBe(400);
    expect((await post("x".repeat(1024 * 1024 + 1))).status).toBe(413);
    expect(runOnServer).not.toHaveBeenCalled();
  });

  it("limits the runs of an account", async () => {
    for (let i = 0; i < 20; i++) expect((await post({ language: "c", code: "x" })).status).toBe(200);
    const limited = await post({ language: "c", code: "x" });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
    // Another account is not affected.
    getCurrentUser.mockResolvedValue({ id: "user-2" });
    expect((await post({ language: "c", code: "x" })).status).toBe(200);
  });

  it("lets an account run two programs at a time", async () => {
    const waiting: (() => void)[] = [];
    runOnServer.mockImplementation(
      () => new Promise((resolve) => waiting.push(() => resolve({ status: "ok", stdout: "", stderr: "" })))
    );
    const first = post({ language: "c", code: "x" });
    const second = post({ language: "c", code: "x" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect((await post({ language: "c", code: "x" })).status).toBe(429);
    waiting.forEach((finish) => finish());
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
  });

  it("lists the server languages", async () => {
    expect(await (await GET()).json()).toEqual({ languages: ["csharp"] });
  });
});
