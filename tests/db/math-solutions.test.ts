// Animated solutions against a real database: scripts from course files become versions on
// import and update, authors save new versions with earlier ones kept, conflicting saves are
// refused or numbered apart, learners see a solution only after a check, and "Draft with AI"
// goes through the author's provider (a local mock) and is validated before it is returned.
// Skipped unless LINGO_TEST_PG_URL is set (see tests/db/migrations.test.ts).
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startMockServer, type MockServer } from "@/tests/helpers/mock-http";

import { importCourse, updateCourse } from "../../scripts/course-import.mjs";

const adminUrl = process.env.LINGO_TEST_PG_URL;
const database = `lingo_test_solutions_${process.pid}_${Date.now()}`;
const root = path.resolve(__dirname, "../..");
const demo = JSON.parse(readFileSync(path.join(root, "courses/math-demo.json"), "utf8"));
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const emptyStep = { narration: "", state: "", givens: [], parts: [], pairs: [], links: [], term: "", text: "", span: "" };
const DRAFT = {
  title: "Time",
  question: [
    { id: "", text: "A cyclist rides " },
    { id: "q-d", text: "120 m" },
    { id: "", text: " at 12 m/s. How long does the ride take?" },
  ],
  givens: [
    { id: "d", symbol: "d", value: "120", unit: "m", span: "q-d", label: "distance" },
    { id: "v", symbol: "v", value: "12", unit: "m/s", span: "", label: "speed" },
  ],
  equations: [
    {
      id: "eq",
      states: [
        { id: "s1", latex: "\\term{t}{t} = \\frac{\\term{d}{d}}{\\term{v}{v}}" },
        { id: "s2", latex: "\\term{t}{t} = \\frac{\\term{dv}{120\\,\\mathrm{m}}}{\\term{vv}{12\\,\\mathrm{m/s}}} = \\term{r}{10\\,\\mathrm{s}}" },
      ],
    },
  ],
  graphs: [],
  figures: [],
  tables: [],
  notes: [],
  steps: [
    { ...emptyStep, kind: "Extract", duration: 3, target: "d" },
    { ...emptyStep, kind: "Relate", duration: 3, target: "eq", state: "s1", givens: ["d", "v"] },
    { ...emptyStep, kind: "Substitute", duration: 3, target: "eq", state: "s2", pairs: [{ given: "d", term: "dv" }, { given: "v", term: "vv" }] },
    { ...emptyStep, kind: "Answer", duration: 3, target: "eq", term: "r", text: "10 s." },
  ],
};

describe.skipIf(!adminUrl)("animated solutions", () => {
  let admin: pg.Pool;
  let pool: pg.Pool;
  let mock: MockServer;
  let solutions: typeof import("@/lib/math/solutions");
  let mathService: typeof import("@/lib/math/service");
  let ids: number[] = [];
  let reply: unknown = DRAFT;
  const saved = { ...process.env };

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: adminUrl, max: 1 });
    await admin.query(`create database "${database}"`);
    const url = new URL(adminUrl!);
    url.pathname = `/${database}`;
    pool = new pg.Pool({ connectionString: url.toString(), max: 3 });
    await migrate(drizzle(pool), { migrationsFolder: path.join(root, "drizzle") });
    await pool.query(
      "insert into users (id, username, display_name, password_hash, is_admin) values ('author', 'author', 'Author', 'x', true), ('learner', 'learner', 'Learner', 'x', false)"
    );
    Object.assign(process.env, {
      PGHOST: url.hostname,
      PGPORT: url.port,
      PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password),
      PGDATABASE: database,
      LINGO_SECRET_KEY: crypto.randomBytes(32).toString("base64"),
    });
    mock = await startMockServer();
    process.env.AI_ANTHROPIC_BASE_URL = mock.url;
    mock.reply(() => ({
      json: {
        type: "message",
        model: "claude-sonnet-5-5",
        content: [{ type: "text", text: JSON.stringify(reply) }],
        stop_reason: "end_turn",
        usage: { input_tokens: 900, output_tokens: 700 },
      },
    }));
    solutions = await import("@/lib/math/solutions");
    mathService = await import("@/lib/math/service");
  });

  afterAll(async () => {
    process.env = saved;
    await mock?.close();
    await (await import("@/db/drizzle")).default.$client.end();
    await pool?.end();
    await admin?.query(`drop database if exists "${database}" with (force)`);
    await admin?.end();
  });

  it("stores the scripts of a course file as first versions, outside the payload", async () => {
    const result = await importCourse(pool, demo);
    expect(result.solutions).toBe(3);
    const rows = (
      await pool.query(
        "select c.id, c.payload, s.version, s.author_id from challenges c left join math_solutions s on s.challenge_id = c.id where c.type = 'MATH' order by c.id"
      )
    ).rows;
    expect(rows).toHaveLength(5);
    expect(rows.filter((row) => row.version === 1)).toHaveLength(3);
    for (const row of rows) expect(row.payload).not.toHaveProperty("solutionScript");
    ids = rows.filter((row) => row.version === 1).map((row) => row.id);
    expect(rows.every((row) => row.author_id === null)).toBe(true);
  });

  it("adds a version on update only when a script changed", async () => {
    expect((await updateCourse(pool, demo)).solutions).toBe(0);
    const changed = clone(demo);
    changed.units[0].lessons[0].challenges[0].payload.solutionScript.steps[0].narration = "A new first sentence.";
    expect((await updateCourse(pool, changed)).solutions).toBe(1);
    const versions = await solutions.listSolutionVersions(ids[0]);
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect((await solutions.getSolution(ids[0]))?.script.steps[0].narration).toBe("A new first sentence.");
    expect((await solutions.getSolution(ids[0], 1))?.script.steps[0].narration).toMatch(/120 metres/);
    expect(await mathService.getSolutionVersion(ids[0])).toBe(2);
  });

  it("saves an author's script as the next version and keeps the earlier ones", async () => {
    const current = (await solutions.getSolution(ids[0]))!;
    const script = clone(current.script);
    script.title = "Edited by an author";
    const result = await solutions.saveSolution({ challengeId: ids[0], authorId: "author", script, baseVersion: 2 });
    expect(result.version).toBe(3);
    const versions = await solutions.listSolutionVersions(ids[0]);
    expect(versions.map((v) => [v.version, v.author])).toEqual([
      [3, "author"],
      [2, null],
      [1, null],
    ]);
    expect((await solutions.getSolution(ids[0]))?.script.title).toBe("Edited by an author");
    // A stored analysis keeps the version it was made against.
    expect(await mathService.getSolutionVersion(ids[0])).toBe(3);
  });

  it("refuses a save based on an older version unless forced, and numbers parallel saves apart", async () => {
    const script = (await solutions.getSolution(ids[0]))!.script;
    await expect(
      solutions.saveSolution({ challengeId: ids[0], authorId: "author", script, baseVersion: 2 })
    ).rejects.toMatchObject({ status: 409 });
    const forced = await solutions.saveSolution({ challengeId: ids[0], authorId: "author", script, baseVersion: 2, force: true });
    expect(forced.version).toBe(4);
    const both = await Promise.all([
      solutions.saveSolution({ challengeId: ids[0], authorId: "author", script }),
      solutions.saveSolution({ challengeId: ids[0], authorId: "author", script }),
    ]);
    expect(both.map((r) => r.version).sort()).toEqual([5, 6]);
  });

  it("refuses scripts with problems, and problems that do not exist", async () => {
    const broken = clone((await solutions.getSolution(ids[0]))!.script);
    (broken.steps[0] as { given: string }).given = "nobody";
    await expect(
      solutions.saveSolution({ challengeId: ids[0], authorId: "author", script: broken })
    ).rejects.toMatchObject({ status: 422, problems: ["steps[0].given: must be the id of a given."] });
    await expect(
      solutions.saveSolution({ challengeId: 999999, authorId: "author", script: broken })
    ).rejects.toMatchObject({ status: 404 });
  });

  it("opens a solution for a learner only after a check", async () => {
    expect(await solutions.canViewSolution("learner", false, ids[0])).toBe(false);
    expect(await solutions.canViewSolution("author", true, ids[0])).toBe(true);
    await pool.query(
      "insert into math_attempts (user_id, challenge_id, grading) values ('learner', $1, '{\"correct\": false}')",
      [ids[0]]
    );
    expect(await solutions.canViewSolution("learner", false, ids[0])).toBe(true);
    expect(await solutions.canViewSolution("learner", false, ids[1])).toBe(false);
    await pool.query("insert into challenge_progress (user_id, challenge_id, completed) values ('learner', $1, true)", [ids[1]]);
    expect(await solutions.canViewSolution("learner", false, ids[1])).toBe(true);
  });

  it("drafts a script with the author's provider and validates it", async () => {
    const ai = await import("@/lib/ai/service");
    await ai.saveProviderKey("author", "anthropic", "sk-ant-test-draft-0000");
    mock.requests.length = 0;
    const draft = await solutions.draftSolution({ userId: "author", challengeId: ids[0] });
    expect(draft.provider).toBe("anthropic");
    expect(draft.script.steps.map((step) => step.kind)).toEqual(["Extract", "Relate", "Substitute", "Answer"]);
    expect(draft.script.givens[0]).toMatchObject({ id: "d", value: 120, unit: "m", span: "q-d" });

    const request = mock.requests[0].body as { system: string; messages: { content: unknown }[]; output_config: unknown };
    expect(request.system).toMatch(/animated step-by-step solutions/);
    expect(JSON.stringify(request.messages)).toContain("How long does the ride take?");
    expect(JSON.stringify(request.output_config)).toContain("\"steps\"");
    const usage = (await pool.query("select task, output_tokens from ai_usage")).rows;
    expect(usage).toEqual([{ task: "drafting", output_tokens: 700 }]);
    // Nothing is saved until the author saves.
    expect((await solutions.listSolutionVersions(ids[0]))[0].version).toBe(6);
  });

  it("refuses a draft that does not match the format", async () => {
    reply = { ...DRAFT, steps: [{ ...emptyStep, kind: "Transform", duration: 3, target: "eq", state: "nowhere" }] };
    await expect(solutions.draftSolution({ userId: "author", challengeId: ids[0] })).rejects.toMatchObject({
      status: 502,
      problems: expect.arrayContaining([expect.stringMatching(/steps\[0\]/)]),
    });
    reply = DRAFT;
  });

  it("needs a key to draft", async () => {
    await expect(solutions.draftSolution({ userId: "learner", challengeId: ids[0] })).rejects.toMatchObject({
      kind: "no-key",
    });
  });
});
