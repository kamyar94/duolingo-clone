// End to end over HTTP against the production build: the voice relays (app/api/voice) with a
// stand-in for the voice gateway. Checks sign-in and origin rules, the text and audio limits,
// the cache (a text is spoken once), narration for solution steps under the same access rule as
// the solution, regeneration only when the narration text changes, and a clean 503 when the
// gateway is away. The live check against the real Kokoro and Whisper containers is described in
// .build-notes/voice.md.
//
// Needs a build (pnpm build) and a Postgres server; skipped unless LINGO_E2E=1 and
// LINGO_TEST_PG_URL are set. LINGO_E2E_VOICE_PORT picks the port of the app (default 3112).
import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startMockGateway, type MockGateway } from "@/tests/helpers/mock-gateway";

import { importCourse } from "../../scripts/course-import.mjs";

const root = path.resolve(__dirname, "../..");
const serverFile = path.join(root, ".next/standalone/server.js");
const adminUrl = process.env.LINGO_TEST_PG_URL;
const enabled = process.env.LINGO_E2E === "1" && !!adminUrl && existsSync(serverFile);
const port = Number(process.env.LINGO_E2E_VOICE_PORT ?? 3112);
const base = `http://127.0.0.1:${port}`;
const database = `lingo_test_voice_${process.pid}_${Date.now()}`;

const NARRATION_ONE = "The distance is one hundred twenty meters.";
const NARRATION_TWO = "Time equals distance divided by speed.";

const SCRIPT = (first: string) => ({
  format: 1,
  question: [{ text: "A cyclist rides " }, { id: "q-d", text: "120 m" }, { text: " at 12 m/s. How long does the ride take?" }],
  givens: [{ id: "d", symbol: "d", value: 120, unit: "m", span: "q-d" }],
  equations: [{ id: "eq", states: [{ id: "s1", latex: "\\term{t}{t} = \\frac{\\term{d}{d}}{v}" }] }],
  steps: [
    { kind: "Extract", given: "d", duration: 2, narration: first },
    { kind: "Relate", equation: "eq", givens: ["d"], duration: 2, narration: NARRATION_TWO },
    { kind: "Answer", equation: "eq", term: "t", duration: 2 },
  ],
});

const course = {
  title: "E2E voice",
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
              payload: {
                statement: "A cyclist rides 120 m at 12 m/s. How long does the ride take?",
                answer: { kind: "numeric", value: 10, unit: "s", tolerance: 0.01 },
                solution: ["t = \\frac{d}{v}", "t = \\frac{120}{12} = 10"],
                solutionScript: SCRIPT(NARRATION_ONE),
              },
            },
          ],
        },
      ],
    },
  ],
};

// A recording as a browser makes it: the WebM header followed by data.
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(900, 7)]);

describe.skipIf(!enabled)("voice relays over HTTP", () => {
  let admin: pg.Pool;
  let pool: pg.Pool;
  let gateway: MockGateway;
  let server: ChildProcess;
  let dataDir = "";
  let challengeId = 0;
  const log: string[] = [];
  const cookies: Record<string, string> = {};

  const request = (route: string, init: RequestInit & { as?: string; json?: unknown; sameOrigin?: boolean } = {}) => {
    const { as, json, sameOrigin = true, headers, ...rest } = init;
    return fetch(`${base}${route}`, {
      ...rest,
      body: json === undefined ? rest.body : JSON.stringify(json),
      headers: {
        ...(json === undefined ? {} : { "content-type": "application/json" }),
        ...(rest.method && rest.method !== "GET" && sameOrigin ? { origin: base } : {}),
        ...(as ? { cookie: cookies[as] } : {}),
        ...headers,
      },
    });
  };

  const addUser = async (id: string, name: string, isAdmin: boolean, courseId: number) => {
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync("unused", salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    await pool.query(
      "insert into users (id, username, display_name, password_hash, is_admin) values ($1, $2, $2, $3, $4)",
      [id, name, `scrypt$32768$8$1$${salt.toString("base64")}$${hash.toString("base64")}`, isAdmin]
    );
    await pool.query("insert into user_progress (user_id, user_name, active_course_id) values ($1, $2, $3)", [
      id,
      name,
      courseId,
    ]);
    const token = crypto.randomBytes(32).toString("base64url");
    await pool.query("insert into sessions (id, user_id, expires_at) values ($1, $2, now() + interval '1 day')", [
      crypto.createHash("sha256").update(token).digest("hex"),
      id,
    ]);
    cookies[name] = `lingo_session=${token}`;
  };

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: adminUrl, max: 1 });
    await admin.query(`create database "${database}"`);
    const url = new URL(adminUrl!);
    url.pathname = `/${database}`;
    pool = new pg.Pool({ connectionString: url.toString(), max: 2 });
    await migrate(drizzle(pool), { migrationsFolder: path.join(root, "drizzle") });
    await importCourse(pool, course);
    challengeId = (await pool.query("select id from challenges where type = 'MATH'")).rows[0].id;
    const courseId = (await pool.query("select id from courses")).rows[0].id;
    await addUser("voice-e2e-author", "author", true, courseId);
    await addUser("voice-e2e-learner", "learner", false, courseId);
    // The learner has voice on and a chosen voice; the author keeps the defaults.
    await pool.query("insert into user_voice_settings (user_id, enabled, voice, speed) values ($1, true, 'bf_emma', 1.25)", [
      "voice-e2e-learner",
    ]);

    gateway = await startMockGateway();
    dataDir = await mkdtemp(path.join(os.tmpdir(), "lingo-voice-e2e-"));

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
        LINGO_SECRET_KEY: crypto.randomBytes(32).toString("base64"),
        VOICE_URL: gateway.url,
        VOICE_TOKEN: gateway.token,
        VOICE_DATA_DIR: dataDir,
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
    await gateway?.close();
    await pool?.end();
    await admin?.query(`drop database if exists "${database}" with (force)`);
    await admin?.end();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  it("answers 401 without a session", async () => {
    for (const [route, init] of [
      ["/api/voice/status", {}],
      ["/api/voice/speech", { method: "POST", json: { text: "Hello." } }],
      ["/api/voice/transcribe", { method: "POST", body: WEBM }],
      [`/api/voice/narration/${challengeId}/0`, {}],
    ] as const) {
      const response = await request(route, init);
      expect(response.status, route).toBe(401);
    }
    expect(gateway.calls).toHaveLength(0);
  });

  it("reports that voice is set up and the gateway answers, with the account's voice settings", async () => {
    const author = await request("/api/voice/status", { as: "author" }).then((r) => r.json());
    expect(author).toMatchObject({
      configured: true,
      speech: true,
      transcription: true,
      settings: { enabled: false, voice: null, speed: 1 },
      defaultVoice: "af_heart",
    });
    const learner = await request("/api/voice/status", { as: "learner" }).then((r) => r.json());
    expect(learner.settings).toEqual({ enabled: true, voice: "bf_emma", speed: 1.25 });
    // The token is never part of an answer.
    expect(JSON.stringify([author, learner])).not.toContain(gateway.token);
  });

  describe("text to speech", () => {
    it("speaks a text once and serves repeats from the stored clip, in the account's voice and speed", async () => {
      const first = await request("/api/voice/speech", { method: "POST", as: "learner", json: { text: "Divide both sides by v." } });
      expect(first.status).toBe(200);
      expect(first.headers.get("content-type")).toBe("audio/mpeg");
      expect(first.headers.get("etag")).toMatch(/^"[0-9a-f]{64}"$/);
      const bytes = Buffer.from(await first.arrayBuffer());
      expect(bytes.toString("latin1")).toContain("bf_emma|1.25|Divide both sides by v.");

      const speech = () => gateway.count("/v1/audio/speech");
      const before = speech();
      const second = await request("/api/voice/speech", { method: "POST", as: "learner", json: { text: "Divide both sides by v." } });
      expect(second.status).toBe(200);
      expect(Buffer.from(await second.arrayBuffer()).equals(bytes)).toBe(true);
      expect(speech()).toBe(before);

      // Another speed is another clip.
      await request("/api/voice/speech", { method: "POST", as: "learner", json: { text: "Divide both sides by v.", speed: 1.5 } });
      expect(speech()).toBe(before + 1);
    });

    it("speaks the formulas of an explanation as words", async () => {
      const response = await request("/api/voice/speech", { method: "POST", as: "author", json: { text: "So $t = \\frac{d}{v}$." } });
      expect(response.status).toBe(200);
      expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(64);
      const call = [...gateway.calls].reverse().find((c) => c.path === "/v1/audio/speech");
      expect(JSON.parse(call!.body.toString()).input).toBe("So t equals d over v.");
    });

    it("sends the gateway token only to the gateway", async () => {
      const call = gateway.calls.find((c) => c.path === "/v1/audio/speech");
      expect(call?.authorization).toBe(`Bearer ${gateway.token}`);
    });

    it.each([
      ["no text", { json: {} }, 400],
      ["blank text", { json: { text: "   " } }, 400],
      ["a bad voice name", { json: { text: "Hi.", voice: "../x" } }, 400],
      ["a speed out of range", { json: { text: "Hi.", speed: 5 } }, 400],
      ["too much text", { json: { text: "a".repeat(3001) } }, 413],
      ["text that is not JSON", { body: "not json", headers: { "content-type": "application/json" } }, 400],
    ])("refuses %s", async (_, init, status) => {
      const before = gateway.calls.length;
      const response = await request("/api/voice/speech", { method: "POST", as: "author", ...init });
      expect(response.status).toBe(status);
      expect(gateway.calls.length).toBe(before);
    });

    it("refuses a request from another site", async () => {
      const response = await fetch(`${base}/api/voice/speech`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://evil.example.com", cookie: cookies.author },
        body: JSON.stringify({ text: "Hi." }),
      });
      expect(response.status).toBe(403);
    });
  });

  describe("speech to text", () => {
    it("turns a recording into text", async () => {
      gateway.transcript("why does the sign change");
      const response = await request("/api/voice/transcribe", {
        method: "POST",
        as: "learner",
        body: WEBM,
        headers: { "content-type": "audio/webm;codecs=opus" },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ text: "why does the sign change" });
    });

    it("refuses things that are not recordings and recordings that are too large", async () => {
      const before = gateway.calls.length;
      const html = await request("/api/voice/transcribe", {
        method: "POST",
        as: "author",
        body: Buffer.from("<html>".padEnd(600, "x")),
        headers: { "content-type": "audio/webm" },
      });
      expect(html.status).toBe(400);
      const empty = await request("/api/voice/transcribe", { method: "POST", as: "author", body: Buffer.alloc(10) });
      expect(empty.status).toBe(400);
      const big = await request("/api/voice/transcribe", {
        method: "POST",
        as: "author",
        body: Buffer.concat([WEBM, Buffer.alloc(6 * 1024 * 1024)]),
        headers: { "content-type": "audio/webm" },
      });
      expect(big.status).toBe(413);
      expect(gateway.calls.length).toBe(before);
    });
  });

  describe("narration of solution steps", () => {
    const narration = (step: number, as: string, query = "") =>
      request(`/api/voice/narration/${challengeId}/${step}${query}`, { as });
    const speechCalls = () => gateway.count("/v1/audio/speech");

    it("keeps narration behind the same rule as the solution", async () => {
      const response = await narration(0, "learner");
      expect(response.status).toBe(403);
    });

    it("makes the clip of a step once, in the author's voice, and serves it from a file afterwards", async () => {
      const before = speechCalls();
      const first = await narration(0, "author");
      expect(first.status).toBe(200);
      expect(first.headers.get("content-type")).toBe("audio/mpeg");
      expect(first.headers.get("accept-ranges")).toBe("bytes");
      const bytes = Buffer.from(await first.arrayBuffer());
      expect(bytes.toString("latin1")).toContain(`af_heart|1|${NARRATION_ONE}`);
      expect(speechCalls()).toBe(before + 1);

      const second = await narration(0, "author");
      expect(Buffer.from(await second.arrayBuffer()).equals(bytes)).toBe(true);
      expect(speechCalls()).toBe(before + 1);

      // The clip is a file in the voice data folder.
      const names: string[] = [];
      for (const folder of await readdir(path.join(dataDir, "clips")))
        names.push(...(await readdir(path.join(dataDir, "clips", folder))));
      expect(names.some((name) => name.endsWith(".mp3"))).toBe(true);
      expect(names.some((name) => name.endsWith(".tmp"))).toBe(false);
    });

    it("answers a browser's conditional and range requests", async () => {
      const first = await narration(0, "author");
      const etag = first.headers.get("etag")!;
      const conditional = await request(`/api/voice/narration/${challengeId}/0`, { as: "author", headers: { "if-none-match": etag } });
      expect(conditional.status).toBe(304);
      const ranged = await request(`/api/voice/narration/${challengeId}/0`, { as: "author", headers: { range: "bytes=0-9" } });
      expect(ranged.status).toBe(206);
      expect(ranged.headers.get("content-range")).toMatch(/^bytes 0-9\/\d+$/);
      expect((await ranged.arrayBuffer()).byteLength).toBe(10);
    });

    it("uses the learner's own voice once the learner may open the solution", async () => {
      await pool.query(
        "insert into challenge_progress (user_id, challenge_id, completed) values ('voice-e2e-learner', $1, true)",
        [challengeId]
      );
      const response = await narration(0, "learner");
      expect(response.status).toBe(200);
      expect(Buffer.from(await response.arrayBuffer()).toString("latin1")).toContain(`bf_emma|1|${NARRATION_ONE}`);
    });

    it("refuses a step without narration and steps that do not exist", async () => {
      expect((await narration(2, "author")).status).toBe(404);
      expect((await narration(40, "author")).status).toBe(404);
      expect((await narration(-1, "author")).status).toBe(400);
      expect((await narration(0, "author", "?version=abc")).status).toBe(400);
      expect((await narration(0, "author", "?version=9")).status).toBe(404);
    });

    it("makes a new clip only for the step whose narration text changed", async () => {
      const changed = "The distance is one hundred and twenty meters.";
      const save = await request(`/api/math/solutions/${challengeId}`, {
        method: "POST",
        as: "author",
        json: { script: SCRIPT(changed), baseVersion: 1 },
      });
      expect(save.status, log.join("")).toBe(200);

      const before = speechCalls();
      const stepOne = await narration(0, "author");
      expect(Buffer.from(await stepOne.arrayBuffer()).toString("latin1")).toContain(changed);
      expect(speechCalls()).toBe(before + 1);

      // The second step kept its text, so its clip is the one that was already stored.
      await narration(1, "author");
      const afterSecond = speechCalls();
      await narration(1, "author");
      expect(speechCalls()).toBe(afterSecond);

      // Version 1 still plays its own wording from its own file.
      const oldVersion = await narration(0, "author", "?version=1");
      expect(Buffer.from(await oldVersion.arrayBuffer()).toString("latin1")).toContain(NARRATION_ONE);
    });
  });

  describe("when the gateway is away", () => {
    it("answers 503 with a short sentence, and the status route reports it", async () => {
      gateway.failWith(502);
      const speech = await request("/api/voice/speech", { method: "POST", as: "author", json: { text: "A sentence nobody has heard." } });
      expect(speech.status).toBe(503);
      const body = await speech.json();
      expect(body).toMatchObject({ unavailable: true });
      expect(JSON.stringify(body)).not.toContain(gateway.token);
      expect(JSON.stringify(body)).not.toContain("127.0.0.1");

      const transcribe = await request("/api/voice/transcribe", { method: "POST", as: "author", body: WEBM });
      expect(transcribe.status).toBe(503);

      // Remembered text still plays: stored clips need no gateway.
      const stored = await request("/api/voice/speech", { method: "POST", as: "learner", json: { text: "Divide both sides by v." } });
      expect(stored.status).toBe(200);

      // Health is remembered for a few seconds; the next check is after that.
      await new Promise((resolve) => setTimeout(resolve, 5500));
      const status = await request("/api/voice/status", { as: "author" }).then((r) => r.json());
      expect(status).toMatchObject({ configured: true, speech: false, transcription: false });
    }, 20_000);

    it("recovers when the gateway comes back", async () => {
      gateway.failWith(0);
      const response = await request("/api/voice/speech", { method: "POST", as: "author", json: { text: "A sentence nobody has heard." } });
      expect(response.status).toBe(200);
    });
  });
});
