"use server";

import { eq } from "drizzle-orm";

import db from "@/db/drizzle";
import { challenges, mathAttempts, mathSolutions } from "@/db/schema";
import { auth } from "@/lib/auth";

// "I don't know": the answer of one challenge, for a learner who gives up on it. The lesson
// shows it, moves on and asks the question again at the end. Math answers never reach the
// browser before this, so they are read here; a math reveal also stores a graded attempt
// marked as revealed, so the animated solution opens as it does after a check.

export type RevealedAnswer = {
  /** "text" may hold math between dollar signs; "latex" is one formula; "code" is a program. */
  kind: "text" | "latex" | "code";
  value: string;
  /** True when the problem has an animated solution the learner can now open. */
  solution: boolean;
};

type Rec = Record<string, unknown>;

const isRecord = (value: unknown): value is Rec =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const firstAnswer = (answer: unknown) =>
  Array.isArray(answer) ? String(answer[0] ?? "") : String(answer ?? "");

const mathAnswer = (payload: Rec): Omit<RevealedAnswer, "solution"> | null => {
  const answer = payload.answer;
  if (!isRecord(answer)) return null;
  if (answer.kind === "numeric") {
    const unit = typeof answer.unit === "string" && answer.unit ? `\\,\\mathrm{${answer.unit}}` : "";
    return { kind: "latex", value: `${String(answer.value)}${unit}` };
  }
  if (answer.kind === "expression") return { kind: "latex", value: String(answer.value) };
  if (answer.kind === "choice" && Array.isArray(answer.choices)) {
    const picked = (Array.isArray(answer.correct) ? answer.correct : [answer.correct]).map(
      (index) => String(answer.choices instanceof Array ? answer.choices[Number(index)] : "")
    );
    return { kind: "text", value: picked.join("\n") };
  }
  if (typeof answer.value === "string" && answer.value.trim())
    return { kind: "text", value: answer.value };
  if (Array.isArray(payload.solution) && payload.solution.length)
    return { kind: "latex", value: payload.solution.map(String).join(" \\\\ ") };
  return null;
};

const codeAnswer = (type: string, payload: Rec): Omit<RevealedAnswer, "solution"> | null => {
  if (type === "CODE_OUTPUT" && typeof payload.expect === "string")
    return { kind: "code", value: payload.expect };
  if (type === "CODE_FILL" && typeof payload.template === "string" && Array.isArray(payload.answers)) {
    const answers = payload.answers;
    let blank = 0;
    const filled = payload.template.replace(/___/g, () => firstAnswer(answers[blank++]));
    return { kind: "code", value: filled };
  }
  if (type === "CODE_ORDER" && Array.isArray(payload.lines))
    return { kind: "code", value: payload.lines.map(String).join("\n") };
  if (typeof payload.solution === "string" && payload.solution.trim())
    return { kind: "code", value: payload.solution };
  if (isRecord(payload.solution)) {
    const parts = (["html", "css", "js"] as const)
      .filter((part) => typeof (payload.solution as Rec)[part] === "string")
      .map((part) => `/* ${part} */\n${String((payload.solution as Rec)[part])}`);
    if (parts.length) return { kind: "code", value: parts.join("\n\n") };
  }
  return null;
};

export const revealAnswer = async (challengeId: number): Promise<RevealedAnswer | null> => {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized.");
  if (!Number.isInteger(challengeId) || challengeId <= 0) return null;

  const challenge = await db.query.challenges.findFirst({
    where: eq(challenges.id, challengeId),
    with: { challengeOptions: true },
  });
  if (!challenge) return null;

  if (challenge.type === "SELECT" || challenge.type === "ASSIST") {
    const right = challenge.challengeOptions.filter((option) => option.correct);
    return right.length
      ? { kind: "text", value: right.map((option) => option.text).join("\n"), solution: false }
      : null;
  }

  const payload = isRecord(challenge.payload) ? challenge.payload : {};
  if (challenge.type !== "MATH") {
    const found = codeAnswer(challenge.type, payload);
    return found ? { ...found, solution: false } : null;
  }

  const found = mathAnswer(payload);
  await db.insert(mathAttempts).values({
    userId,
    challengeId,
    strokes: [],
    grading: { correct: false, revealed: true, gradedAt: new Date().toISOString() },
  });
  const script = await db.query.mathSolutions.findFirst({
    where: eq(mathSolutions.challengeId, challengeId),
    columns: { id: true },
  });
  return { ...(found ?? { kind: "text", value: "" }), solution: !!script };
};
