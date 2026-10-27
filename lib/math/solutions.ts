// Server side of animated solutions (sections 5.5 and 5.6): versions of a problem's solution
// script, saving a new version for an author, who may open a solution, the list of problems
// for author mode, and "Draft with AI". The routes under app/api/math/solutions call this.
// Never import it into a client component.
import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm";

import db from "@/db/drizzle";
import {
  challengeProgress,
  challenges,
  courses,
  lessons,
  mathAttempts,
  mathSolutions,
  units,
  users,
} from "@/db/schema";
import { AiError } from "@/lib/ai/errors";
import { runAiTask } from "@/lib/ai/service";

import { describeExpectedAnswer } from "./ai";
import { solutionLines } from "./payload";
import { getMathChallenge, MathError } from "./service";
import { DRAFT_SCHEMA, DRAFT_SYSTEM, draftPrompt, draftToScript } from "./solution/draft";
import type { SolutionScript, SolutionVersion, SolutionVersionInfo } from "./solution/types";
import { validateSolutionScript } from "./solution/validate";

/** A script that does not pass the schema check, with its problems (and the AI draft, if any). */
export class ScriptError extends MathError {
  readonly problems: string[];
  readonly draft?: unknown;
  constructor(status: number, message: string, problems: string[], draft?: unknown) {
    super(status, message);
    this.name = "ScriptError";
    this.problems = problems;
    this.draft = draft;
  }
}

/** The versions of a problem's solution, newest first, without their scripts. */
export const listSolutionVersions = async (challengeId: number): Promise<SolutionVersionInfo[]> => {
  const rows = await db
    .select({
      version: mathSolutions.version,
      createdAt: mathSolutions.createdAt,
      author: users.username,
    })
    .from(mathSolutions)
    .leftJoin(users, eq(users.id, mathSolutions.authorId))
    .where(eq(mathSolutions.challengeId, challengeId))
    .orderBy(desc(mathSolutions.version));
  return rows.map((row) => ({
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    author: row.author ?? null,
  }));
};

/** One version of a problem's solution, the newest when no version is named. */
export const getSolution = async (
  challengeId: number,
  version?: number
): Promise<SolutionVersion | null> => {
  const [row] = await db
    .select({
      version: mathSolutions.version,
      script: mathSolutions.script,
      createdAt: mathSolutions.createdAt,
      author: users.username,
    })
    .from(mathSolutions)
    .leftJoin(users, eq(users.id, mathSolutions.authorId))
    .where(
      version === undefined
        ? eq(mathSolutions.challengeId, challengeId)
        : and(eq(mathSolutions.challengeId, challengeId), eq(mathSolutions.version, version))
    )
    .orderBy(desc(mathSolutions.version))
    .limit(1);
  if (!row) return null;
  // Scripts were checked when they were saved; a script that no longer passes is not played.
  const checked = validateSolutionScript(row.script);
  if (!checked.script) return null;
  return {
    version: row.version,
    script: checked.script,
    createdAt: row.createdAt.toISOString(),
    author: row.author ?? null,
  };
};

/**
 * A learner may watch a solution once the problem was checked or completed, so the animation
 * never gives the answer away before a try. Authors may always.
 */
export const canViewSolution = async (userId: string, isAdmin: boolean, challengeId: number) => {
  if (isAdmin) return true;
  const graded = await db.query.mathAttempts.findFirst({
    where: and(
      eq(mathAttempts.userId, userId),
      eq(mathAttempts.challengeId, challengeId),
      isNotNull(mathAttempts.grading)
    ),
    columns: { id: true },
  });
  if (graded) return true;
  const done = await db.query.challengeProgress.findFirst({
    where: and(
      eq(challengeProgress.userId, userId),
      eq(challengeProgress.challengeId, challengeId),
      eq(challengeProgress.completed, true)
    ),
    columns: { id: true },
  });
  return !!done;
};

const isUniqueViolation = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  ((error as { code?: string }).code === "23505" ||
    (error as { cause?: { code?: string } }).cause?.code === "23505");

/**
 * Saves a script as the next version of a problem's solution. Earlier versions stay, and
 * analyses keep the version they were made against. When the author edited an older version
 * than the newest (baseVersion), the save is refused so a colleague's version is not passed
 * over unseen; the author can reload or save again with force.
 */
export const saveSolution = async (input: {
  challengeId: number;
  authorId: string;
  script: unknown;
  baseVersion?: number | null;
  force?: boolean;
}): Promise<{ version: number; problems: [] }> => {
  await getMathChallenge(input.challengeId);
  const checked = validateSolutionScript(input.script);
  if (!checked.script)
    throw new ScriptError(422, "The script has problems.", checked.problems);

  for (let attempt = 0; attempt < 3; attempt++) {
    const newest = (await listSolutionVersions(input.challengeId))[0]?.version ?? 0;
    if (!input.force && typeof input.baseVersion === "number" && newest > input.baseVersion)
      throw new MathError(
        409,
        `Version ${newest} was saved after the version you edited (${input.baseVersion}). Load it first, or save anyway.`
      );
    try {
      const [row] = await db
        .insert(mathSolutions)
        .values({
          challengeId: input.challengeId,
          version: newest + 1,
          script: checked.script,
          authorId: input.authorId,
        })
        .returning({ version: mathSolutions.version });
      return { version: row.version, problems: [] };
    } catch (error) {
      // Two saves at the same moment: try the next number.
      if (!isUniqueViolation(error)) throw error;
    }
  }
  throw new MathError(409, "Another version was being saved at the same time. Try again.");
};

export type MathProblemRow = {
  id: number;
  course: string;
  unit: string;
  lesson: string;
  question: string;
  versions: number;
};

/** Every MATH problem with the number of solution versions, for author mode. */
export const listMathProblems = async (): Promise<MathProblemRow[]> => {
  const rows = await db
    .select({
      id: challenges.id,
      question: challenges.question,
      lesson: lessons.title,
      unit: units.title,
      course: courses.title,
      versions: sql<number>`(select count(*) from ${mathSolutions} where ${mathSolutions.challengeId} = ${challenges.id})::int`,
    })
    .from(challenges)
    .innerJoin(lessons, eq(lessons.id, challenges.lessonId))
    .innerJoin(units, eq(units.id, lessons.unitId))
    .innerJoin(courses, eq(courses.id, units.courseId))
    .where(eq(challenges.type, "MATH"))
    .orderBy(asc(courses.title), asc(units.order), asc(lessons.order), asc(challenges.order));
  return rows;
};

/** What author mode needs about a problem: its texts and the reference answer. */
export const getAuthorProblem = async (challengeId: number) => {
  const challenge = await getMathChallenge(challengeId);
  return {
    id: challenge.id,
    question: challenge.question,
    statement: challenge.statement,
    answer: describeExpectedAnswer(challenge.spec),
    solution: solutionLines(challenge.payload.solution),
  };
};

/**
 * Asks the author's own provider (task "drafting") for a first script from the question and
 * the reference answer. The reply is turned into a script and validated before it is returned;
 * a draft that does not pass is refused with its problems.
 */
export const draftSolution = async (input: { userId: string; challengeId: number }) => {
  const problem = await getAuthorProblem(input.challengeId);
  const response = await runAiTask(input.userId, "drafting", {
    system: DRAFT_SYSTEM,
    prompt: draftPrompt(problem),
    json: { name: "solution_script", schema: DRAFT_SCHEMA },
    maxOutputTokens: 16000,
  });
  if (response.json === undefined)
    throw new AiError("invalid-output", "The provider did not return a script.");
  const script = draftToScript(response.json);
  const checked = validateSolutionScript(script);
  if (!checked.script)
    throw new ScriptError(
      502,
      "The AI draft did not match the solution format. Try again, or write the script by hand.",
      checked.problems,
      script
    );
  return {
    script: checked.script as SolutionScript,
    provider: response.provider,
    model: response.model,
  };
};
