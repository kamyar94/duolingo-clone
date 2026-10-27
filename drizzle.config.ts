import { defineConfig } from "drizzle-kit";

// Only used to generate the SQL migrations in ./drizzle (pnpm exec drizzle-kit generate).
// The app applies them itself on start (scripts/start.mjs).
export default defineConfig({
  schema: "./db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
});
