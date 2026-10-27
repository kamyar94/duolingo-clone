// Server side of math practice: recognition of handwriting into LaTeX lines, grading (the
// deterministic answer check first, then the AI step analysis, stored and reused under a
// fingerprint), follow-up questions and the promotion of analyses to common mistakes.
// The routes under app/api/math call this; never import it into a client component.
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";

import db from "@/db/drizzle";
import { challenges, mathAnalyses, mathAttempts, mathSolutions } from "@/db/schema";
import { describeAiError, isAiError, AiError } from "@/lib/ai/errors";
import { runAiTask } from "@/lib/ai/service";

import {
  ANALYSIS_SCHEMA,
  ANALYSIS_SYSTEM,
  analysisPrompt,
  followUpSystem,
  MAX_LINE_LENGTH,
  MAX_LINES,
  MAX_QUESTION,
  MAX_TURNS,
  parseAnalysis,
  parseRecognition,
  RECOGNITION_SCHEMA,
  RECOGNITION_SYSTEM,
  recognitionPrompt,
  type AnalysisContext,
} from "./ai";
import { checkAnswer } from "./answer";
import { analysisFingerprint, answerKey, problemDigest } from "./fingerprint";
import { stripMathDelimiters } from "./latex";
import { validateMathPayload } from "./payload";
import type {
  AnalysisSource,
  AnswerSpec,
  ConversationTurn,
  GivenAnswer,
  GradeResult,
  MathPayload,
  RecognizedLine,
  StepAnalysis,
  StoredStroke,
} from "./types";

/** An error with an HTTP status and a sentence for the learner. */
export class MathError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "MathError";
    this.status = status;
  }
}

/** Stored in math_analyses.analysis: the verdict plus what it was made from, for review. */
export type StoredAnalysis = {
  verdict: StepAnalysis;
  provider: string;
  model: string;
  lines: string[];
  answer: string;
};

export type MathChallenge = {
  id: number;
  question: string;
  statement: string;
  payload: MathPayload;
  spec: AnswerSpec;
};

export const getMathChallenge = async (challengeId: number): Promise<MathChallenge> => {
  if (!Number.isInteger(challengeId) || challengeId <= 0)
    throw new MathError(400, "Unknown problem.");
  const row = await db.query.challenges.findFirst({
    where: eq(challenges.id, challengeId),
    columns: { id: true, type: true, question: true, payload: true },
  });
  if (!row || row.type !== "MATH") throw new MathError(404, "Unknown problem.");
  const payload = row.payload as MathPayload | null;
  if (
    !payload ||
    typeof payload !== "object" ||
    validateMathPayload(payload as unknown as Record<string, unknown>).length
  )
    throw new MathError(409, "This problem's course file has no valid answer specification.");
  return {
    id: row.id,
    question: row.question,
    statement: payload.statement ?? row.question,
    payload,
    spec: payload.answer,
  };
};

/** The newest animated solution version of a problem, 0 while there is none. */
export const getSolutionVersion = async (challengeId: number) => {
  const [row] = await db
    .select({ version: sql<number>`coalesce(max(${mathSolutions.version}), 0)::int` })
    .from(mathSolutions)
    .where(eq(mathSolutions.challengeId, challengeId));
  return row?.version ?? 0;
};

const toLines = (lines: RecognizedLine[] | string[] | unknown): string[] =>
  Array.isArray(lines)
    ? lines
        .map((line) =>
          typeof line === "string"
            ? line
            : typeof line === "object" && line && "latex" in line
              ? String((line as RecognizedLine).latex)
              : ""
        )
        .filter(Boolean)
    : [];

/** Lines sent by a browser: strings, trimmed, without delimiters, within the limits. */
export const cleanLines = (value: unknown): string[] => {
  if (!Array.isArray(value)) throw new MathError(400, "lines must be a list.");
  if (value.length > MAX_LINES) throw new MathError(413, `At most ${MAX_LINES} lines.`);
  return value.map((line) => {
    if (typeof line !== "string") throw new MathError(400, "Each line must be text.");
    if (line.length > MAX_LINE_LENGTH)
      throw new MathError(413, `A line may hold at most ${MAX_LINE_LENGTH} characters.`);
    return stripMathDelimiters(line).trim();
  }).filter(Boolean);
};

export const cleanAnswer = (value: unknown): GivenAnswer | null => {
  if (value == null) return null;
  if (typeof value !== "object") throw new MathError(400, "answer must be an object.");
  const answer = value as Record<string, unknown>;
  if (answer.kind === "latex") {
    if (typeof answer.latex !== "string" || answer.latex.length > MAX_LINE_LENGTH)
      throw new MathError(400, "The answer must be LaTeX text.");
    return { kind: "latex", latex: stripMathDelimiters(answer.latex) };
  }
  if (answer.kind === "choice") {
    const choices = answer.choices;
    if (
      !Array.isArray(choices) ||
      choices.length > 20 ||
      !choices.every((index) => Number.isInteger(index) && index >= 0 && index < 20)
    )
      throw new MathError(400, "Picked choices must be a list of indexes.");
    return { kind: "choice", choices: [...new Set(choices as number[])] };
  }
  throw new MathError(400, "Unknown answer kind.");
};

const answerText = (answer: GivenAnswer | null) =>
  !answer ? null : answer.kind === "choice" ? answerKey(answer) : answer.latex;

const answerFromText = (text: string | null): GivenAnswer | null => {
  if (!text) return null;
  if (text.startsWith("choice:"))
    return {
      kind: "choice",
      choices: text
        .slice("choice:".length)
        .split(",")
        .filter(Boolean)
        .map(Number)
        .filter(Number.isInteger),
    };
  return { kind: "latex", latex: text };
};

const ownAttempt = async (userId: string, attemptId: number) => {
  if (!Number.isInteger(attemptId) || attemptId <= 0)
    throw new MathError(400, "Unknown attempt.");
  const attempt = await db.query.mathAttempts.findFirst({
    where: and(eq(mathAttempts.id, attemptId), eq(mathAttempts.userId, userId)),
  });
  if (!attempt) throw new MathError(404, "Unknown attempt.");
  return attempt;
};

// ---- Recognition ----

export type RecognizeResult = {
  attemptId: number;
  lines: RecognizedLine[];
  /** True when the same strokes were read before and the lines were reused (no AI call). */
  reused: boolean;
  provider: string | null;
  model: string | null;
};

export const recognizeHandwriting = async (input: {
  userId: string;
  challengeId: number;
  imageBase64: string;
  strokes: StoredStroke[];
}): Promise<RecognizeResult> => {
  const challenge = await getMathChallenge(input.challengeId);

  // The same drawing read before by this learner: reuse its lines.
  const previous = await db.query.mathAttempts.findFirst({
    where: and(
      eq(mathAttempts.userId, input.userId),
      eq(mathAttempts.challengeId, challenge.id),
      isNotNull(mathAttempts.recognizedLatex),
      sql`${mathAttempts.strokes} = ${JSON.stringify(input.strokes)}::jsonb`
    ),
    orderBy: [desc(mathAttempts.createdAt)],
    columns: { recognizedLatex: true, provider: true, model: true },
  });
  if (previous?.recognizedLatex && Array.isArray(previous.recognizedLatex)) {
    const lines = previous.recognizedLatex as RecognizedLine[];
    const [row] = await db
      .insert(mathAttempts)
      .values({
        userId: input.userId,
        challengeId: challenge.id,
        strokes: input.strokes,
        recognizedLatex: lines,
        provider: previous.provider,
        model: previous.model,
      })
      .returning({ id: mathAttempts.id });
    return {
      attemptId: row.id,
      lines,
      reused: true,
      provider: previous.provider,
      model: previous.model,
    };
  }

  const response = await runAiTask(input.userId, "recognition", {
    system: RECOGNITION_SYSTEM,
    prompt: recognitionPrompt(challenge.statement),
    images: [{ mediaType: "image/png", data: input.imageBase64 }],
    json: { name: "handwriting_lines", schema: RECOGNITION_SCHEMA },
    maxOutputTokens: 4096,
  });
  const lines = parseRecognition(response.json);
  if (!lines)
    throw new AiError("invalid-output", "The reply had no lines.", {
      provider: response.provider,
    });

  const [row] = await db
    .insert(mathAttempts)
    .values({
      userId: input.userId,
      challengeId: challenge.id,
      strokes: input.strokes,
      recognizedLatex: lines,
      provider: response.provider,
      model: response.model,
    })
    .returning({ id: mathAttempts.id });

  return {
    attemptId: row.id,
    lines,
    reused: false,
    provider: response.provider,
    model: response.model,
  };
};

// ---- Grading ----

const findAnalysis = (fingerprint: string) =>
  db.query.mathAnalyses.findFirst({ where: eq(mathAnalyses.fingerprint, fingerprint) });

const verdictOf = (stored: unknown): StoredAnalysis | null => {
  const value = stored as StoredAnalysis | null;
  return value && typeof value === "object" && value.verdict ? value : null;
};

export const gradeAttempt = async (input: {
  userId: string;
  isAdmin: boolean;
  challengeId: number;
  attemptId: number | null;
  lines: string[];
  answer: GivenAnswer | null;
}): Promise<GradeResult> => {
  const challenge = await getMathChallenge(input.challengeId);
  const attempt = input.attemptId ? await ownAttempt(input.userId, input.attemptId) : null;
  if (attempt && attempt.challengeId !== challenge.id)
    throw new MathError(400, "The attempt belongs to another problem.");

  const check = checkAnswer(challenge.spec, input.answer);
  if (check.unreadable) throw new MathError(422, check.detail);
  if (challenge.spec.kind === "freeform" && !input.lines.length && !input.answer)
    throw new MathError(422, "Write your solution first.");

  // The AI studies the steps when there are steps to study.
  let analysis: StepAnalysis | null = null;
  let analysisId: number | null = null;
  let analysisSource: AnalysisSource = "none";
  let analysisError: string | null = null;
  let commonMistake = false;
  let provider: string | null = null;
  let model: string | null = null;

  const wantsAnalysis = input.lines.length > 0 || challenge.spec.kind === "freeform";
  if (wantsAnalysis) {
    const solutionVersion = await getSolutionVersion(challenge.id);
    const fingerprint = analysisFingerprint({
      challengeId: challenge.id,
      solutionVersion,
      problem: problemDigest(challenge.payload, challenge.question),
      lines: input.lines,
      answer: input.answer,
    });

    const existing = await findAnalysis(fingerprint);
    const stored = existing ? verdictOf(existing.analysis) : null;
    if (existing && stored) {
      analysis = stored.verdict;
      analysisId = existing.id;
      commonMistake = existing.commonMistake;
      analysisSource = existing.commonMistake ? "common" : "stored";
      provider = stored.provider;
      model = stored.model;
    } else {
      const context: AnalysisContext = {
        statement: challenge.statement,
        spec: challenge.spec,
        solution: challenge.payload.solution,
        lines: input.lines,
        answer: input.answer,
      };
      try {
        const response = await runAiTask(input.userId, "grading", {
          system: ANALYSIS_SYSTEM,
          prompt: analysisPrompt(context),
          json: { name: "step_analysis", schema: ANALYSIS_SCHEMA },
          maxOutputTokens: 4096,
        });
        const verdict = parseAnalysis(response.json, input.lines.length);
        if (!verdict)
          throw new AiError("invalid-output", "The reply was not a step analysis.", {
            provider: response.provider,
          });
        const record: StoredAnalysis = {
          verdict,
          provider: response.provider,
          model: response.model,
          lines: input.lines,
          answer: answerKey(input.answer),
        };
        await db
          .insert(mathAnalyses)
          .values({
            fingerprint,
            challengeId: challenge.id,
            solutionVersion,
            analysis: record,
          })
          .onConflictDoNothing({ target: mathAnalyses.fingerprint });
        const saved = await findAnalysis(fingerprint);
        analysis = verdict;
        analysisId = saved?.id ?? null;
        analysisSource = "ai";
        provider = response.provider;
        model = response.model;
      } catch (error) {
        if (!isAiError(error)) throw error;
        analysisError = describeAiError(error);
      }
    }
  }

  // The deterministic check decides; free-form answers have only the AI's verdict.
  const correct = check.correct ?? analysis?.finalAnswerCorrect ?? null;
  if (correct === null)
    throw new MathError(
      503,
      analysisError ??
        "This answer can only be graded by an AI provider. Save a key on the AI settings page."
    );
  const disagreement =
    check.correct !== null && !!analysis && analysis.finalAnswerCorrect !== check.correct;

  const grading = {
    correct,
    check: { correct: check.correct, detail: check.detail, read: check.read ?? null },
    analysisSource,
    analysisError,
    disagreement,
    aiFinalAnswerCorrect: analysis?.finalAnswerCorrect ?? null,
    gradingProvider: provider,
    gradingModel: model,
    gradedAt: new Date().toISOString(),
  };

  let attemptId: number;
  if (attempt) {
    await db
      .update(mathAttempts)
      .set({
        correctedLatex: input.lines,
        answer: answerText(input.answer),
        grading,
        analysisId,
        updatedAt: new Date(),
      })
      .where(eq(mathAttempts.id, attempt.id));
    attemptId = attempt.id;
  } else {
    const [row] = await db
      .insert(mathAttempts)
      .values({
        userId: input.userId,
        challengeId: challenge.id,
        correctedLatex: input.lines,
        answer: answerText(input.answer),
        grading,
        analysisId,
      })
      .returning({ id: mathAttempts.id });
    attemptId = row.id;
  }

  return {
    attemptId,
    correct,
    check: { correct: check.correct, detail: check.detail, read: check.read },
    analysis,
    analysisId,
    analysisSource,
    disagreement,
    analysisError,
    commonMistake,
    canPromote: input.isAdmin && analysisId !== null,
    provider,
    model,
  };
};

// ---- Follow-up questions ----

export const askFollowUp = async (input: {
  userId: string;
  attemptId: number;
  question: string;
}) => {
  const question = input.question.trim();
  if (!question) throw new MathError(400, "Write a question first.");
  if (question.length > MAX_QUESTION)
    throw new MathError(413, `A question may hold at most ${MAX_QUESTION} characters.`);

  const attempt = await ownAttempt(input.userId, input.attemptId);
  if (!attempt.grading) throw new MathError(409, "Check the answer before asking about it.");
  const conversation = (
    Array.isArray(attempt.conversation) ? attempt.conversation : []
  ) as ConversationTurn[];
  if (conversation.length >= MAX_TURNS)
    throw new MathError(429, "This attempt has reached its number of questions.");

  const challenge = await getMathChallenge(attempt.challengeId);
  const analysisRow = attempt.analysisId
    ? await db.query.mathAnalyses.findFirst({
        where: eq(mathAnalyses.id, attempt.analysisId),
      })
    : null;
  const analysis = verdictOf(analysisRow?.analysis)?.verdict ?? null;
  const lines = toLines(attempt.correctedLatex ?? attempt.recognizedLatex);
  const context: AnalysisContext = {
    statement: challenge.statement,
    spec: challenge.spec,
    solution: challenge.payload.solution,
    lines,
    answer: answerFromText(attempt.answer),
  };

  const response = await runAiTask(
    input.userId,
    "grading",
    {
      system: followUpSystem(context, analysis),
      history: conversation.map((turn) => ({ role: turn.role, text: turn.text })),
      prompt: question,
      maxOutputTokens: 1500,
    },
    { usageTask: "follow-up" }
  );
  const reply = response.text.trim().slice(0, 4000) || "(no answer)";
  const at = new Date().toISOString();
  const next: ConversationTurn[] = [
    ...conversation,
    { role: "user", text: question, at },
    { role: "assistant", text: reply, at },
  ];
  await db
    .update(mathAttempts)
    .set({ conversation: next, updatedAt: new Date() })
    .where(eq(mathAttempts.id, attempt.id));
  return { reply, conversation: next };
};

// ---- Review by authors ----

export const setCommonMistake = async (analysisId: number, commonMistake: boolean) => {
  if (!Number.isInteger(analysisId) || analysisId <= 0)
    throw new MathError(400, "Unknown analysis.");
  const [row] = await db
    .update(mathAnalyses)
    .set({ commonMistake, updatedAt: new Date() })
    .where(eq(mathAnalyses.id, analysisId))
    .returning({ id: mathAnalyses.id, commonMistake: mathAnalyses.commonMistake });
  if (!row) throw new MathError(404, "Unknown analysis.");
  return row;
};

export type ReviewItem = {
  id: number;
  challengeId: number;
  question: string;
  commonMistake: boolean;
  analysis: StoredAnalysis | null;
  attempts: number;
  disagreements: number;
  updatedAt: Date;
};

/** Newest stored analyses with how often they were used and how often the check disagreed. */
export const listAnalysesForReview = async (limit = 50): Promise<ReviewItem[]> => {
  const rows = await db
    .select({
      id: mathAnalyses.id,
      challengeId: mathAnalyses.challengeId,
      question: challenges.question,
      commonMistake: mathAnalyses.commonMistake,
      analysis: mathAnalyses.analysis,
      updatedAt: mathAnalyses.updatedAt,
      attempts: sql<number>`(select count(*)::int from math_attempts a where a.analysis_id = ${mathAnalyses.id})`,
      disagreements: sql<number>`(select count(*)::int from math_attempts a where a.analysis_id = ${mathAnalyses.id} and a.grading->>'disagreement' = 'true')`,
    })
    .from(mathAnalyses)
    .innerJoin(challenges, eq(challenges.id, mathAnalyses.challengeId))
    .orderBy(desc(mathAnalyses.updatedAt))
    .limit(limit);
  return rows.map((row) => ({ ...row, analysis: verdictOf(row.analysis) }));
};

export { describeAiError };
