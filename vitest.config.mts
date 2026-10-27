import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

// Unit tests run in Node without a browser. Tests live next to the code they test
// (*.test.ts, *.test.tsx) or under tests/.
export default defineConfig({
  resolve: {
    alias: { "@": root },
  },
  test: {
    environment: "node",
    include: ["**/*.test.{ts,tsx,mjs}"],
    exclude: ["node_modules/**", ".next/**", ".worktrees/**", "dist/**"],
    restoreMocks: true,
  },
});
