"use server";

import crypto from "node:crypto";

import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { redirect } from "next/navigation";

import db from "@/db/drizzle";
import { invites, sessions, users } from "@/db/schema";
import {
  burnPasswordCheck,
  endSession,
  getClientIp,
  hashPassword,
  isIpBlocked,
  normalizeCode,
  loginPolicy,
  recordIpFailure,
  sha256,
  startSession,
  verifyPassword,
} from "@/lib/auth";

export type AuthState = { error?: string };

const USERNAME = /^[a-z0-9._-]{3,32}$/;
const MIN_PASSWORD = 10;
const MAX_PASSWORD = 200;

const field = (formData: FormData, name: string) =>
  String(formData.get(name) ?? "").trim();

const TOO_MANY = "Too many attempts. Wait 15 minutes and try again.";

export const signIn = async (
  _state: AuthState,
  formData: FormData
): Promise<AuthState> => {
  const ip = await getClientIp();
  if (isIpBlocked(ip)) return { error: TOO_MANY };

  const username = field(formData, "username").toLowerCase();
  const password = String(formData.get("password") ?? "");

  const user = await db.query.users.findFirst({
    where: eq(users.username, username),
  });

  if (!user || user.disabled) {
    await burnPasswordCheck(password);
    recordIpFailure(ip);
    return { error: "Wrong username or password." };
  }

  if (user.lockedUntil && user.lockedUntil > new Date())
    return {
      error: `This account is locked after too many wrong passwords. Try again after ${loginPolicy.LOGIN_LOCK_MINUTES} minutes.`,
    };

  if (!(await verifyPassword(password, user.passwordHash))) {
    recordIpFailure(ip);
    const failed = user.failedLogins + 1;
    const lock = failed >= loginPolicy.MAX_LOGIN_ATTEMPTS;
    await db
      .update(users)
      .set({
        failedLogins: lock ? 0 : failed,
        lockedUntil: lock
          ? new Date(Date.now() + loginPolicy.LOGIN_LOCK_MINUTES * 60_000)
          : null,
      })
      .where(eq(users.id, user.id));
    return { error: "Wrong username or password." };
  }

  await db
    .update(users)
    .set({ failedLogins: 0, lockedUntil: null })
    .where(eq(users.id, user.id));
  // Sign-ins that have run out are removed now and then, so the table stays small.
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
  await startSession(user.id);

  redirect("/learn");
};

export const signUp = async (
  _state: AuthState,
  formData: FormData
): Promise<AuthState> => {
  const ip = await getClientIp();
  if (isIpBlocked(ip)) return { error: TOO_MANY };

  const code = normalizeCode(field(formData, "code"));
  const displayName = field(formData, "displayName");
  const username = field(formData, "username").toLowerCase();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD)
    return { error: `Use a password of at least ${MIN_PASSWORD} characters.` };
  if (password !== confirm) return { error: "The two passwords differ." };

  const invite = await db.query.invites.findFirst({
    where: and(
      eq(invites.codeHash, sha256(code)),
      isNull(invites.usedAt),
      gt(invites.expiresAt, new Date())
    ),
  });

  if (!invite) {
    recordIpFailure(ip);
    return { error: "This code is not valid, has expired, or was already used." };
  }

  // A reset code: the existing account gets the new password, every old sign-in ends.
  if (invite.resetUserId) {
    const userId = invite.resetUserId;
    const passwordHash = await hashPassword(password);
    const done = await db.transaction(async (tx) => {
      const claimed = await tx
        .update(invites)
        .set({ usedAt: new Date(), usedBy: userId })
        .where(and(eq(invites.id, invite.id), isNull(invites.usedAt)))
        .returning();
      if (!claimed.length) return false;
      await tx
        .update(users)
        .set({ passwordHash, failedLogins: 0, lockedUntil: null })
        .where(eq(users.id, userId));
      await tx.delete(sessions).where(eq(sessions.userId, userId));
      return true;
    });
    if (!done) return { error: "This code was already used." };

    await startSession(userId);
    redirect("/learn");
  }

  if (!displayName || displayName.length > 40)
    return { error: "Enter your name (up to 40 characters)." };
  if (!USERNAME.test(username))
    return {
      error:
        "Usernames are 3 to 32 characters: lowercase letters, numbers, dot, dash or underscore.",
    };

  const taken = await db.query.users.findFirst({
    where: eq(users.username, username),
  });
  if (taken) return { error: "That username is taken. Pick another one." };

  const userId = crypto.randomUUID();
  const passwordHash = await hashPassword(password);

  const done = await db.transaction(async (tx) => {
    const claimed = await tx
      .update(invites)
      .set({ usedAt: new Date(), usedBy: userId })
      .where(and(eq(invites.id, invite.id), isNull(invites.usedAt)))
      .returning();
    if (!claimed.length) return false;
    await tx.insert(users).values({
      id: userId,
      username,
      displayName,
      passwordHash,
      isAdmin: invite.isAdmin,
    });
    return true;
  });
  if (!done) return { error: "This code was already used." };

  await startSession(userId);
  redirect("/courses");
};

export const signOut = async () => {
  await endSession();
  redirect("/");
};

