// Applies the migrations in ./drizzle to real Postgres databases. Skipped unless
// LINGO_TEST_PG_URL points at a server where this user may create databases, for example
//
//   LINGO_TEST_PG_URL=postgres://lingo:secret@127.0.0.1:5432/postgres pnpm exec vitest run tests/db
//
// Two cases: a brand-new database, and a database that already went through the first two
// migrations (as in production) and holds data, which must survive the learning-tools migration.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const adminUrl = process.env.LINGO_TEST_PG_URL;
const MIGRATIONS = path.resolve(__dirname, "../../drizzle");
const suffix = `${process.pid}_${Date.now()}`;

const NEW_TABLES = [
  "ai_usage",
  "challenge_drafts",
  "code_snippets",
  "math_analyses",
  "math_attempts",
  "math_solutions",
  "user_ai_settings",
  "user_voice_settings",
];

const urlFor = (database: string) => {
  const url = new URL(adminUrl!);
  url.pathname = `/${database}`;
  return url.toString();
};

// A copy of ./drizzle that stops after the given number of migrations, like an older release.
const migrationsUpTo = (count: number) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "lingo-migrations-"));
  cpSync(MIGRATIONS, dir, { recursive: true });
  const journalPath = path.join(dir, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8"));
  journal.entries = journal.entries.slice(0, count);
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
};

describe.skipIf(!adminUrl)("drizzle migrations", () => {
  const admin = new pg.Pool({ connectionString: adminUrl, max: 1 });
  const created: string[] = [];
  const pools: pg.Pool[] = [];

  const freshDatabase = async (name: string) => {
    const database = `lingo_test_${name}_${suffix}`;
    await admin.query(`create database "${database}"`);
    created.push(database);
    const pool = new pg.Pool({ connectionString: urlFor(database), max: 2 });
    pools.push(pool);
    return pool;
  };

  const tableNames = async (pool: pg.Pool) =>
    (
      await pool.query(
        "select table_name from information_schema.tables where table_schema = 'public' order by 1"
      )
    ).rows.map((r) => r.table_name as string);

  const enumValues = async (pool: pg.Pool) =>
    (
      await pool.query(
        "select e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'type' order by e.enumsortorder"
      )
    ).rows.map((r) => r.enumlabel as string);

  beforeAll(async () => {
    await admin.query("select 1");
  });

  afterAll(async () => {
    await Promise.all(pools.map((p) => p.end()));
    for (const database of created)
      await admin.query(`drop database if exists "${database}" with (force)`);
    await admin.end();
  });

  it("builds a new database from scratch", async () => {
    const pool = await freshDatabase("fresh");
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS });

    const tables = await tableNames(pool);
    for (const table of NEW_TABLES) expect(tables).toContain(table);
    expect(await enumValues(pool)).toEqual([
      "SELECT",
      "ASSIST",
      "CODE_READ",
      "CODE_OUTPUT",
      "CODE_FILL",
      "CODE_ORDER",
      "CODE_WRITE",
      "CODE_FIX",
      "WEB_LIVE",
      "MATH",
    ]);

    // Running it again is a no-op, as on every container start.
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS });
  });

  it("upgrades a database that already has data", async () => {
    const pool = await freshDatabase("existing");
    const older = migrationsUpTo(2);
    try {
      await migrate(drizzle(pool), { migrationsFolder: older });
    } finally {
      rmSync(older, { recursive: true, force: true });
    }
    expect(await tableNames(pool)).not.toContain("user_ai_settings");

    // Data as an existing installation would have it.
    await pool.query(
      "insert into users (id, username, display_name, password_hash) values ('u1', 'learner', 'Learner', 'scrypt$x')"
    );
    await pool.query(
      "insert into sessions (id, user_id, expires_at) values ('s1', 'u1', now() + interval '1 day')"
    );
    const course = await pool.query(
      "insert into courses (title, image_src) values ('Old course', '/es.svg') returning id"
    );
    const unit = await pool.query(
      `insert into units (title, description, course_id, "order") values ('Unit 1', 'Basics', $1, 1) returning id`,
      [course.rows[0].id]
    );
    const lesson = await pool.query(
      `insert into lessons (title, unit_id, "order") values ('Lesson 1', $1, 1) returning id`,
      [unit.rows[0].id]
    );
    const challenge = await pool.query(
      `insert into challenges (lesson_id, type, question, hint, explanation, "order")
       values ($1, 'SELECT', 'Which one?', 'A hint', 'Because.', 1) returning id`,
      [lesson.rows[0].id]
    );
    const challengeId = challenge.rows[0].id;
    await pool.query(
      "insert into challenge_options (challenge_id, text, correct) values ($1, 'Yes', true), ($1, 'No', false)",
      [challengeId]
    );
    await pool.query(
      "insert into challenge_progress (user_id, challenge_id, completed) values ('u1', $1, true)",
      [challengeId]
    );
    await pool.query(
      "insert into user_progress (user_id, active_course_id, points) values ('u1', $1, 40)",
      [course.rows[0].id]
    );

    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS });

    const tables = await tableNames(pool);
    for (const table of NEW_TABLES) expect(tables).toContain(table);

    const kept = await pool.query(
      "select type, question, hint, explanation, payload from challenges where id = $1",
      [challengeId]
    );
    expect(kept.rows[0]).toEqual({
      type: "SELECT",
      question: "Which one?",
      hint: "A hint",
      explanation: "Because.",
      payload: null,
    });
    expect(
      (await pool.query("select count(*)::int as n from challenge_options")).rows[0].n
    ).toBe(2);
    expect(
      (await pool.query("select points from user_progress where user_id = 'u1'")).rows[0]
        .points
    ).toBe(40);
    expect(
      (await pool.query("select count(*)::int as n from sessions")).rows[0].n
    ).toBe(1);

    // The new types and tables work on the upgraded database.
    const math = await pool.query(
      `insert into challenges (lesson_id, type, question, "order", payload)
       values ($1, 'MATH', 'Solve 2x = 6', 2, $2) returning id`,
      [lesson.rows[0].id, JSON.stringify({ answer: { kind: "numeric", value: 3 } })]
    );
    await pool.query(
      "insert into challenge_drafts (user_id, challenge_id, draft) values ('u1', $1, $2)",
      [math.rows[0].id, JSON.stringify({ strokes: [] })]
    );
    await pool.query(
      "insert into user_ai_settings (user_id, provider, models, tasks) values ('u1', 'openai', '{}', '{recognition}')"
    );
    await expect(
      pool.query(
        "insert into user_ai_settings (user_id, provider) values ('u1', 'openai')"
      )
    ).rejects.toThrow(/unique/);
    await pool.query(
      "insert into ai_usage (user_id, provider, model, task, input_tokens, output_tokens) values ('u1', 'openai', 'm', 'grading', 10, 5)"
    );

    // Deleting an account removes its AI settings, drafts and usage with it.
    await pool.query("delete from users where id = 'u1'");
    for (const table of ["user_ai_settings", "challenge_drafts", "ai_usage"])
      expect(
        (await pool.query(`select count(*)::int as n from ${table}`)).rows[0].n
      ).toBe(0);
  });
});
