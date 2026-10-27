// Solution scripts in course files. A MATH challenge may carry its animated solution as
// payload.solutionScript. The course import keeps the script out of the challenge's payload
// (so it never reaches the lesson page) and stores it in math_solutions as a new version, unless
// the newest version already holds the same script. Earlier versions stay.
//
// Imported by scripts/course-import.mjs (bundled with esbuild): relative imports only, no
// Next.js or database modules. The database client is passed in.
import { validateSolutionScript } from "./validate";
import type { SolutionScript } from "./types";

export const SCRIPT_KEY = "solutionScript";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The payload stored with the challenge and the solution script it carried, if any. */
export const splitSolutionScript = (
  type: string,
  payload: unknown
): { payload: unknown; script: unknown } => {
  if (type !== "MATH" || !isRecord(payload) || !(SCRIPT_KEY in payload))
    return { payload, script: null };
  const { [SCRIPT_KEY]: script, ...rest } = payload;
  return { payload: rest, script: script ?? null };
};

/** JSON with object keys sorted, so two scripts compare equal however jsonb ordered them. */
export const canonicalJson = (value: unknown): string =>
  JSON.stringify(value, (_key, inner: unknown) =>
    isRecord(inner)
      ? Object.fromEntries(Object.keys(inner).sort().map((key) => [key, inner[key]]))
      : inner
  );

type Queryable = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};

/**
 * Stores a course file's script for a challenge as the next version, unless the newest version
 * is the same script. Returns the version stored, or null when nothing changed. Throws when the
 * script is not valid (checkCourse reports that before anything is written).
 */
export const storeCourseSolution = async (
  client: Queryable,
  challengeId: number,
  script: unknown
): Promise<number | null> => {
  const checked = validateSolutionScript(script);
  if (!checked.script)
    throw new Error(`The solution script is not valid: ${checked.problems.join(" ")}`);
  const clean: SolutionScript = checked.script;
  const { rows } = await client.query(
    "select version, script from math_solutions where challenge_id = $1 order by version desc limit 1",
    [challengeId]
  );
  const newest = rows[0];
  if (newest && canonicalJson(newest.script) === canonicalJson(clean)) return null;
  const version = Number(newest?.version ?? 0) + 1;
  await client.query(
    "insert into math_solutions (challenge_id, version, script) values ($1, $2, $3)",
    [challengeId, version, JSON.stringify(clean)]
  );
  return version;
};
