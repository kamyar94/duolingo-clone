// End to end over HTTP against the production build: a MATH challenge imported from a course
// file, a test account signed in through the sign-in action, strokes posted for recognition,
// the read lines graded with an AI analysis, and the same work submitted again answered from
// the stored analysis without a provider call. The provider is a local mock.
//
// Needs a build (pnpm build) and a Postgres server; skipped unless LINGO_E2E=1 and
// LINGO_TEST_PG_URL are set. LINGO_E2E_PORT picks the port of the app (default 3102).
import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { encryptSecret, keyContext } from "@/lib/ai/crypto";
import { startMockServer, type MockServer } from "@/tests/helpers/mock-http";

import { importCourse } from "../../scripts/course-import.mjs";

const root = path.resolve(__dirname, "../..");
const serverFile = path.join(root, ".next/standalone/server.js");
const adminUrl = process.env.LINGO_TEST_PG_URL;
const enabled = process.env.LINGO_E2E === "1" && !!adminUrl && existsSync(serverFile);
const port = Number(process.env.LINGO_E2E_PORT ?? 3102);
const base = `http://127.0.0.1:${port}`;
const database = `lingo_test_e2e_${process.pid}_${Date.now()}`;

const USER_ID = "lingo-e2e-user";
const USERNAME = "e2etester";
const PASSWORD = crypto.randomBytes(12).toString("base64url");
const SECRET = crypto.randomBytes(32).toString("base64");
const SOLUTION_MARK = "REFERENCE-ONLY-7f3a";

// A 1x1 white PNG stands in for the rendered handwriting.
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC";

const strokes = [
  { i: "s1", k: "p", c: "#1f2937", s: 4, pr: 1, t: 1_761_000_000_000, p: [10, 10, 0.4, 0, 60, 12, 0.6, 16, 110, 14, 0.5, 33] },
  { i: "s2", k: "p", c: "#1f2937", s: 4, pr: 1, t: 1_761_000_001_000, p: [10, 80, 0.5, 0, 90, 82, 0.7, 20] },
  { i: "s3", k: "h", c: "#facc15", s: 20, pr: 0, t: 1_761_000_002_000, p: [0, 150, 0.5, 0, 200, 150, 0.5, 30] },
];

const course = {
  title: "E2E math",
  imageSrc: "/mascot.svg",
  units: [
    {
      title: "Unit 1",
      description: "Motion",
      lessons: [
        {
          title: "Speed",
          challenges: [
            {
              type: "MATH",
              question: "A cyclist rides 120 m at 12 m/s. How long does the ride take?",
              explanation: "t = d / v = 10 s.",
              payload: {
                statement: "A cyclist rides $120\\,\\mathrm{m}$ at $12\\,\\mathrm{m/s}$. How long does the ride take?",
                answer: { kind: "numeric", value: 10, unit: "s", tolerance: 0.01 },
                solution: ["t = \\frac{d}{v}", `t = \\frac{120}{12} = 10\\,\\mathrm{s} % ${SOLUTION_MARK}`],
              },
            },
          ],
        },
      ],
    },
  ],
};

const RECOGNIZED = [
  { latex: "t = \\frac{d}{v}", confidence: 0.95 },
  { latex: "t = \\frac{120}{12}", confidence: 0.9 },
  { latex: "t = 12\\,\\mathrm{s}", confidence: 0.55 },
];

const ANALYSIS = {
  finalAnswerCorrect: false,
  firstWrongLine: 3,
  mistakeType: "arithmetic error",
  explanation: "$120 / 12$ is $10$, not $12$.",
  correctedLine: "t = 10\\,\\mathrm{s}",
  nextHint: "Divide 120 by 12 again.",
};

type Calls = { recognition: number; grading: number; followUp: number };

describe.skipIf(!enabled)("math practice over HTTP", () => {
  let admin: pg.Pool;
  let pool: pg.Pool;
  let mock: MockServer;
  let server: ChildProcess;
  let cookie = "";
  let challengeId = 0;
  const calls: Calls = { recognition: 0, grading: 0, followUp: 0 };
  const log: string[] = [];

  const post = (route: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}${route}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base, cookie, ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: adminUrl, max: 1 });
    await admin.query(`create database "${database}"`);
    const url = new URL(adminUrl!);
    url.pathname = `/${database}`;
    pool = new pg.Pool({ connectionString: url.toString(), max: 2 });
    await migrate(drizzle(pool), { migrationsFolder: path.join(root, "drizzle") });
    await importCourse(pool, course);
    challengeId = (await pool.query("select id from challenges where type = 'MATH'")).rows[0].id;

    // The test account, its progress and an encrypted provider key.
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(PASSWORD, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    await pool.query(
      "insert into users (id, username, display_name, password_hash, is_admin) values ($1, $2, 'E2E', $3, true)",
      [USER_ID, USERNAME, `scrypt$32768$8$1$${salt.toString("base64")}$${hash.toString("base64")}`]
    );
    const courseId = (await pool.query("select id from courses")).rows[0].id;
    await pool.query("insert into user_progress (user_id, user_name, active_course_id) values ($1, 'E2E', $2)", [
      USER_ID,
      courseId,
    ]);
    const key = Buffer.from(SECRET, "base64");
    await pool.query(
      "insert into user_ai_settings (user_id, provider, encrypted_key, key_last_four, tasks) values ($1, 'anthropic', $2, 'MOCK', '{recognition,grading}')",
      [USER_ID, encryptSecret("sk-ant-e2e-mock-key-0000", keyContext(USER_ID, "anthropic"), key)]
    );

    // The provider mock answers by the schema it is asked for.
    mock = await startMockServer();
    mock.reply((request) => {
      const body = request.body as Record<string, unknown>;
      const schema = JSON.stringify((body.output_config as Record<string, unknown> | undefined) ?? {});
      const usage = { input_tokens: 100, output_tokens: 20 };
      const reply = (text: string) => ({
        json: { type: "message", model: "claude-sonnet-5-5", content: [{ type: "text", text }], stop_reason: "end_turn", usage },
      });
      if (schema.includes('"lines"')) {
        calls.recognition += 1;
        return reply(JSON.stringify({ lines: RECOGNIZED }));
      }
      if (schema.includes("finalAnswerCorrect")) {
        calls.grading += 1;
        return reply(JSON.stringify(ANALYSIS));
      }
      calls.followUp += 1;
      return reply("Because $12 \\cdot 10 = 120$.");
    });

    server = spawn(process.execPath, [serverFile], {
      cwd: path.dirname(serverFile),
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        NODE_ENV: "production",
        PORT: String(port),
        HOSTNAME: "127.0.0.1",
        PGHOST: url.hostname,
        PGPORT: url.port,
        PGUSER: decodeURIComponent(url.username),
        PGPASSWORD: decodeURIComponent(url.password),
        PGDATABASE: database,
        LINGO_SECRET_KEY: SECRET,
        AI_ANTHROPIC_BASE_URL: mock.url,
        COOKIE_SECURE: "false",
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout?.on("data", (chunk) => log.push(String(chunk)));
    server.stderr?.on("data", (chunk) => log.push(String(chunk)));

    for (let attempt = 0; attempt < 60; attempt += 1) {
      const ok = await fetch(`${base}/api/health`).then((r) => r.ok).catch(() => false);
      if (ok) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }, 60_000);

  afterAll(async () => {
    server?.kill();
    await mock?.close();
    await pool?.end();
    await admin?.query(`drop database if exists "${database}" with (force)`);
    await admin?.end();
  });

  it("signs in through the sign-in action", async () => {
    const manifest = JSON.parse(
      readFileSync(path.join(root, ".next/standalone/.next/server/server-reference-manifest.json"), "utf8")
    ) as { node: Record<string, { exportedName?: string; filename?: string }> };
    const actionId = Object.entries(manifest.node).find(
      ([, entry]) => entry.exportedName === "signIn" && entry.filename === "actions/auth.ts"
    )?.[0];
    expect(actionId).toBeTruthy();

    // The arguments as React encodes them: the form fields first, then the root [state, form].
    const form = new FormData();
    form.set("_1_username", USERNAME);
    form.set("_1_password", PASSWORD);
    form.set("0", JSON.stringify([{}, "$K1"]));
    const response = await fetch(`${base}/sign-in`, {
      method: "POST",
      headers: { "next-action": actionId!, origin: base, accept: "text/x-component" },
      body: form,
      redirect: "manual",
    });
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie, log.join("")).toMatch(/lingo_session=/);
    cookie = setCookie.split(";")[0];
  });

  it("keeps the stored answer and the reference solution out of the lesson page", async () => {
    const html = await fetch(`${base}/lesson`, { headers: { cookie } }).then((r) => r.text());
    expect(html).toContain("A cyclist rides");
    expect(html).not.toContain(SOLUTION_MARK);
    expect(html).not.toMatch(/\\"tolerance\\"|"tolerance"/);
  });

  let attemptId = 0;
  let analysisId = 0;
  const lines = RECOGNIZED.map((line) => line.latex);
  const answer = { kind: "latex", latex: "12\\,\\mathrm{s}" };

  it("reads posted strokes into LaTeX lines with the learner's provider", async () => {
    const response = await post("/api/math/recognize", { challengeId, image: PNG, strokes });
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.lines).toEqual(RECOGNIZED);
    expect(body.reused).toBe(false);
    expect(body.provider).toBe("anthropic");
    attemptId = body.attemptId;
    expect(calls.recognition).toBe(1);

    // The image went to the provider as base64, with the problem as context.
    const sent = mock.requests.at(-1)!.body as { messages: { content: { type: string; source?: { data: string } }[] }[] };
    expect(sent.messages[0].content[0]).toMatchObject({ type: "image", source: { data: PNG } });
    const row = (await pool.query("select strokes, recognized_latex from math_attempts where id = $1", [attemptId])).rows[0];
    expect(row.strokes).toHaveLength(3);
    expect(row.recognized_latex).toEqual(RECOGNIZED);
  });

  it("grades the work: the answer check decides, the AI explains", async () => {
    const response = await post("/api/math/grade", { challengeId, attemptId, lines, answer });
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.correct).toBe(false);
    expect(body.check.correct).toBe(false);
    expect(body.analysisSource).toBe("ai");
    expect(body.analysis).toEqual(ANALYSIS);
    expect(body.disagreement).toBe(false);
    expect(body.canPromote).toBe(true);
    analysisId = body.analysisId;
    expect(calls.grading).toBe(1);

    const stored = (await pool.query("select fingerprint, analysis from math_analyses")).rows;
    expect(stored).toHaveLength(1);
    expect(stored[0].fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("answers the same work again from the database without a provider call", async () => {
    const read = await post("/api/math/recognize", { challengeId, image: PNG, strokes });
    const readBody = await read.json();
    expect(readBody.reused).toBe(true);
    expect(readBody.lines).toEqual(RECOGNIZED);

    const response = await post("/api/math/grade", {
      challengeId,
      attemptId: readBody.attemptId,
      lines: ["t=\\frac{d}{v}", "t = \\frac{120}{12}", "t=12\\,\\mathrm{s}"],
      answer,
    });
    const body = await response.json();
    expect(body.analysisSource).toBe("stored");
    expect(body.analysisId).toBe(analysisId);
    expect(body.analysis).toEqual(ANALYSIS);
    expect(calls).toEqual({ recognition: 1, grading: 1, followUp: 0 });
  });

  it("lets an admin mark the analysis as a common mistake", async () => {
    const marked = await post(`/api/math/analyses/${analysisId}`, { commonMistake: true });
    expect(await marked.json()).toEqual({ id: analysisId, commonMistake: true });
    const body = await (await post("/api/math/grade", { challengeId, attemptId, lines, answer })).json();
    expect(body.analysisSource).toBe("common");
    expect(body.commonMistake).toBe(true);
    expect(calls.grading).toBe(1);
  });

  it("stores typed follow-up questions with the attempt", async () => {
    const response = await post("/api/math/follow-up", { attemptId, question: "Why is it 10?" });
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.reply).toContain("120");
    expect(body.conversation.map((turn: { role: string }) => turn.role)).toEqual(["user", "assistant"]);
    const row = (await pool.query("select conversation from math_attempts where id = $1", [attemptId])).rows[0];
    expect(row.conversation).toHaveLength(2);
    expect(calls.followUp).toBe(1);
  });

  it("records a disagreement and keeps the deterministic verdict", async () => {
    const response = await post("/api/math/grade", {
      challengeId,
      attemptId: null,
      lines: ["t = \\frac{120}{12}", "t = 10\\,\\mathrm{s}"],
      answer: { kind: "latex", latex: "10\\,\\mathrm{s}" },
    });
    const body = await response.json();
    // The mock analysis says wrong; the answer check says right and wins.
    expect(body.correct).toBe(true);
    expect(body.disagreement).toBe(true);
    const row = (await pool.query("select grading from math_attempts where id = $1", [body.attemptId])).rows[0];
    expect(row.grading.disagreement).toBe(true);
    expect(calls.grading).toBe(2);
  });

  it("counts tokens for every provider call", async () => {
    const usage = (await pool.query("select task, count(*)::int as n from ai_usage group by task order by task")).rows;
    expect(usage).toEqual([
      { task: "follow-up", n: 1 },
      { task: "grading", n: 2 },
      { task: "recognition", n: 1 },
    ]);
  });

  it("refuses requests that are signed out, from another site or too large", async () => {
    const signedOut = await fetch(`${base}/api/math/grade`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: "{}",
    });
    expect(signedOut.status).toBe(401);
    const foreign = await post("/api/math/grade", { challengeId, lines: [], answer }, { origin: "https://example.com" });
    expect(foreign.status).toBe(403);
    const large = await post("/api/math/grade", { challengeId, lines: ["x".repeat(200_000)], answer });
    expect(large.status).toBe(413);
    const unreadable = await post("/api/math/grade", { challengeId, lines: [], answer: { kind: "latex", latex: "\\frac{1}{" } });
    expect(unreadable.status).toBe(422);
    const notPng = await post("/api/math/recognize", { challengeId, image: Buffer.from("GIF89a").toString("base64"), strokes });
    expect(notPng.status).toBe(400);
  });
});
