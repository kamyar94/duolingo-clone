"use server";

import { and, count, desc, eq } from "drizzle-orm";

import db from "@/db/drizzle";
import { codeSnippets } from "@/db/schema";
import { auth } from "@/lib/auth";
import { checkSnippet, MAX_SNIPPETS, snippetName } from "@/lib/coding/snippets";

// Programs saved in the playground (section 4.1): one row per program and account, opened,
// renamed, copied and deleted from /playground. (A "use server" file may only export async
// functions, so the limits live in lib/coding/snippets.ts.)

const requireUser = async () => {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized.");
  return userId;
};

const validId = (id: number) => Number.isInteger(id) && id > 0;

const own = (userId: string, id: number) =>
  and(eq(codeSnippets.userId, userId), eq(codeSnippets.id, id));

export const listSnippets = async () => {
  const userId = await requireUser();
  return db
    .select({
      id: codeSnippets.id,
      name: codeSnippets.name,
      language: codeSnippets.language,
      updatedAt: codeSnippets.updatedAt,
    })
    .from(codeSnippets)
    .where(eq(codeSnippets.userId, userId))
    .orderBy(desc(codeSnippets.updatedAt))
    .limit(MAX_SNIPPETS);
};

export const getSnippet = async (id: number) => {
  const userId = await requireUser();
  if (!validId(id)) return null;
  const [row] = await db
    .select({
      id: codeSnippets.id,
      name: codeSnippets.name,
      language: codeSnippets.language,
      files: codeSnippets.files,
    })
    .from(codeSnippets)
    .where(own(userId, id));
  return row ?? null;
};

const roomLeft = async (userId: string) => {
  const [{ total }] = await db
    .select({ total: count() })
    .from(codeSnippets)
    .where(eq(codeSnippets.userId, userId));
  return total < MAX_SNIPPETS;
};

export const createSnippet = async (name: string, language: string, files: unknown) => {
  const userId = await requireUser();
  const problem = checkSnippet(language, files);
  if (problem) return { error: problem };
  if (!(await roomLeft(userId)))
    return { error: `You can keep up to ${MAX_SNIPPETS} programs. Delete one first.` };
  const [row] = await db
    .insert(codeSnippets)
    .values({ userId, name: snippetName(name), language, files: files as object })
    .returning({ id: codeSnippets.id, name: codeSnippets.name });
  return { id: row.id, name: row.name };
};

export const saveSnippet = async (id: number, files: unknown) => {
  const userId = await requireUser();
  if (!validId(id)) return { error: "Unknown program." };
  const current = await getSnippet(id);
  if (!current) return { error: "Unknown program." };
  const problem = checkSnippet(current.language, files);
  if (problem) return { error: problem };
  await db
    .update(codeSnippets)
    .set({ files: files as object, updatedAt: new Date() })
    .where(own(userId, id));
  return { ok: true as const };
};

export const renameSnippet = async (id: number, name: string) => {
  const userId = await requireUser();
  if (!validId(id)) return { error: "Unknown program." };
  const [row] = await db
    .update(codeSnippets)
    .set({ name: snippetName(name), updatedAt: new Date() })
    .where(own(userId, id))
    .returning({ name: codeSnippets.name });
  return row ? { name: row.name } : { error: "Unknown program." };
};

export const copySnippet = async (id: number) => {
  const userId = await requireUser();
  const source = await getSnippet(id);
  if (!source) return { error: "Unknown program." };
  if (!(await roomLeft(userId)))
    return { error: `You can keep up to ${MAX_SNIPPETS} programs. Delete one first.` };
  const [row] = await db
    .insert(codeSnippets)
    .values({
      userId,
      name: snippetName(`Copy of ${source.name}`),
      language: source.language,
      files: source.files as object,
    })
    .returning({ id: codeSnippets.id, name: codeSnippets.name });
  return { id: row.id, name: row.name };
};

export const deleteSnippet = async (id: number) => {
  const userId = await requireUser();
  if (!validId(id)) return { error: "Unknown program." };
  await db.delete(codeSnippets).where(own(userId, id));
  return { ok: true as const };
};
