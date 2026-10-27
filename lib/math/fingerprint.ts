// Fingerprints of a learner's work, under which step analyses are stored and found again
// (docs/DESIGN-coding-and-math.md, section 5.4): the same work on the same problem and
// solution version is answered from the database without a new AI call.
import { createHash } from "node:crypto";

import { normalizeLatexLine, normalizeLatexLines } from "./latex";
import type { GivenAnswer } from "./types";

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** Version tag of the fingerprint recipe; change it when the normalisation changes. */
export const FINGERPRINT_RECIPE = "lingo-math-analysis-1";

/**
 * A short digest of what the grader is told about the problem (statement, answer
 * specification, reference solution). A course update that changes them makes old analyses
 * stop matching, even before an animated solution with a version number exists.
 */
export const problemDigest = (payload: unknown, question: string) =>
  sha256(JSON.stringify([question, payload ?? null])).slice(0, 16);

/** The answer box in the fingerprint: normalised LaTeX, or the picked choices in order. */
export const answerKey = (answer: GivenAnswer | null) => {
  if (!answer) return "";
  if (answer.kind === "choice")
    return `choice:${[...answer.choices].sort((a, b) => a - b).join(",")}`;
  return `latex:${normalizeLatexLine(answer.latex)}`;
};

export type FingerprintInput = {
  challengeId: number;
  solutionVersion: number;
  problem: string;
  lines: string[];
  answer: GivenAnswer | null;
};

/**
 * sha256 of the challenge id, the solution version and the normalised LaTeX lines (with the
 * answer box as one more line, since a typed answer is part of the work that is judged).
 */
export const analysisFingerprint = (input: FingerprintInput) =>
  sha256(
    JSON.stringify([
      FINGERPRINT_RECIPE,
      input.challengeId,
      input.solutionVersion,
      input.problem,
      normalizeLatexLines(input.lines),
      answerKey(input.answer),
    ])
  );
