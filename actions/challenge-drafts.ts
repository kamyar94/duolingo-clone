"use server";

import { and, eq } from "drizzle-orm";

import db from "@/db/drizzle";
import { challengeDrafts, challenges } from "@/db/schema";
import { auth } from "@/lib/auth";

// The learner's unfinished work on one challenge (code files, ink strokes), saved while they
// work and restored when they come back. One draft per account and challenge; the newest wins.
// Server action bodies are limited to 1 MB by Next.js, so drafts stay under that. (A "use server"
// file may only export async functions, so the limit is not exported.)

const MAX_DRAFT_BYTES = 900 * 1024;

const requireUser = async () => {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized.");
  return userId;
};

const validChallengeId = (challengeId: number) =>
  Number.isInteger(challengeId) && challengeId > 0;

export const getChallengeDraft = async (challengeId: number) => {
  const userId = await requireUser();
  if (!validChallengeId(challengeId)) return null;

  const row = await db.query.challengeDrafts.findFirst({
    where: and(
      eq(challengeDrafts.userId, userId),
      eq(challengeDrafts.challengeId, challengeId)
    ),
  });

  return row ? { draft: row.draft, updatedAt: row.updatedAt } : null;
};

export const saveChallengeDraft = async (challengeId: number, draft: unknown) => {
  const userId = await requireUser();
  if (!validChallengeId(challengeId)) return { error: "challenge" as const };

  let size = 0;
  try {
    size = new TextEncoder().encode(JSON.stringify(draft ?? null)).length;
  } catch {
    return { error: "invalid" as const };
  }
  if (draft == null) return { error: "invalid" as const };
  if (size > MAX_DRAFT_BYTES) return { error: "too-large" as const };

  const challenge = await db.query.challenges.findFirst({
    where: eq(challenges.id, challengeId),
    columns: { id: true },
  });
  if (!challenge) return { error: "challenge" as const };

  await db
    .insert(challengeDrafts)
    .values({ userId, challengeId, draft })
    .onConflictDoUpdate({
      target: [challengeDrafts.userId, challengeDrafts.challengeId],
      set: { draft, updatedAt: new Date() },
    });

  return { ok: true as const };
};

export const clearChallengeDraft = async (challengeId: number) => {
  const userId = await requireUser();
  if (!validChallengeId(challengeId)) return;

  await db
    .delete(challengeDrafts)
    .where(
      and(
        eq(challengeDrafts.userId, userId),
        eq(challengeDrafts.challengeId, challengeId)
      )
    );
};
