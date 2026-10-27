// Container start: waits for Postgres, applies the database migrations in ./drizzle, adds the
// Spanish demo course to a brand-new database, removes expired sign-ins, then starts Next.js.
// Bundled with esbuild into the image as /app/scripts/start.mjs (see Dockerfile).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

import { importCourse } from "./course-import.mjs";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pool = new pg.Pool({ max: 2 });

for (let attempt = 1; ; attempt++) {
  try {
    await pool.query("select 1");
    break;
  } catch (error) {
    if (attempt >= 30) throw error;
    console.log(`Waiting for the database (${error.code ?? error.message})...`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

const fresh = !(await pool.query("select to_regclass('drizzle.__drizzle_migrations') as t")).rows[0].t;
await migrate(drizzle(pool), { migrationsFolder: path.join(appDir, "drizzle") });
console.log("Database schema is up to date.");

if (fresh) {
  const demo = JSON.parse(readFileSync(path.join(appDir, "courses", "spanish-demo.json"), "utf8"));
  const result = await importCourse(pool, demo);
  console.log(`New database: added the demo course "${demo.title}" (${result.lessons} lessons).`);
}

const pruned = await pool.query("delete from sessions where expires_at < now()");
if (pruned.rowCount) console.log(`Removed ${pruned.rowCount} expired sign-ins.`);
await pool.end();

await import(pathToFileURL(path.join(appDir, "server.js")).href);
