// Imports and updates a course with coding and math challenges in a real database. Skipped
// unless LINGO_TEST_PG_URL is set (see tests/db/migrations.test.ts).
import path from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { importCourse, updateCourse } from "../../scripts/course-import.mjs";

const adminUrl = process.env.LINGO_TEST_PG_URL;
const database = `lingo_test_import_${process.pid}_${Date.now()}`;

const course = (payloadStarter: string) => ({
  title: "Coding and math (test)",
  imageSrc: "/mascot.svg",
  units: [
    {
      title: "Unit 1",
      description: "Mixed",
      lessons: [
        {
          title: "Lesson 1",
          challenges: [
            {
              type: "ASSIST",
              question: "Pick one",
              options: [
                { text: "A", correct: true },
                { text: "B", correct: false },
              ],
            },
            {
              type: "CODE_WRITE",
              question: "Write area(w, h).",
              hint: "Multiply.",
              payload: {
                language: "python",
                starter: payloadStarter,
                tests: [{ call: "area(2, 3)", expect: "6", visible: true }],
              },
            },
            {
              type: "MATH",
              question: "Solve 2x = 6.",
              payload: { answer: { kind: "numeric", value: 3 } },
            },
          ],
        },
      ],
    },
  ],
});

describe.skipIf(!adminUrl)("course import with payloads", () => {
  let admin: pg.Pool;
  let pool: pg.Pool;

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: adminUrl, max: 1 });
    await admin.query(`create database "${database}"`);
    const url = new URL(adminUrl!);
    url.pathname = `/${database}`;
    pool = new pg.Pool({ connectionString: url.toString(), max: 2 });
    await migrate(drizzle(pool), {
      migrationsFolder: path.resolve(__dirname, "../../drizzle"),
    });
  });

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`drop database if exists "${database}" with (force)`);
    await admin?.end();
  });

  it("imports the new types with their payloads, then updates them in place", async () => {
    const added = await importCourse(pool, course("def area(w, h):\n    pass\n"));
    expect(added.challenges).toBe(3);

    const rows = async () =>
      (
        await pool.query(
          'select id, type, payload, (select count(*)::int from challenge_options o where o.challenge_id = c.id) as options from challenges c order by "order"'
        )
      ).rows;

    const before = await rows();
    expect(before.map((r) => [r.type, r.options])).toEqual([
      ["ASSIST", 2],
      ["CODE_WRITE", 0],
      ["MATH", 0],
    ]);
    expect(before[0].payload).toBeNull();
    expect(before[1].payload.language).toBe("python");
    expect(before[2].payload).toEqual({ answer: { kind: "numeric", value: 3 } });

    await updateCourse(pool, course("def area(w, h):\n    return 0\n"));
    const after = await rows();
    expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id));
    expect(after[1].payload.starter).toBe("def area(w, h):\n    return 0\n");
  });

  it("refuses a course whose payload is missing", async () => {
    const broken = course("x");
    delete (broken.units[0].lessons[0].challenges[2] as { payload?: unknown })
      .payload;
    broken.title = "Broken";
    await expect(importCourse(pool, broken)).rejects.toThrow(
      /MATH needs a payload object/
    );
  });
});
