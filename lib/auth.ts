import crypto from "node:crypto";
import { promisify } from "node:util";

import { and, eq, gt } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import db from "@/db/drizzle";
import { sessions } from "@/db/schema";

// Self-hosted replacement for Clerk: accounts, password hashes and sessions are kept in the
// app's own Postgres database. `auth()` and `currentUser()` keep the shape the pages used with
// Clerk, so the rest of the app did not have to change.

export const SESSION_COOKIE = "lingo_session";

const SESSION_DAYS = Number(process.env.SESSION_DAYS) || 30;
const MAX_LOGIN_ATTEMPTS = Number(process.env.MAX_LOGIN_ATTEMPTS) || 5;
const LOGIN_LOCK_MINUTES = Number(process.env.LOGIN_LOCK_MINUTES) || 15;

const scrypt = promisify(crypto.scrypt) as (
  password: crypto.BinaryLike,
  salt: crypto.BinaryLike,
  keylen: number,
  options: crypto.ScryptOptions
) => Promise<Buffer>;

const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export const hashPassword = async (password: string) => {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${hash.toString("base64")}`;
};

export const verifyPassword = async (password: string, stored: string) => {
  const [kind, n, r, p, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;

  const expected = Buffer.from(hash, "base64");
  const actual = await scrypt(password, Buffer.from(salt, "base64"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });

  return crypto.timingSafeEqual(actual, expected);
};

// Spends the same time as a real check when the username does not exist, so response time
// does not reveal which usernames are taken.
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString("hex"));
export const burnPasswordCheck = async (password: string) => {
  await verifyPassword(password, await DUMMY_HASH);
};

export const sha256 = (value: string) =>
  crypto.createHash("sha256").update(value).digest("hex");

// Invite codes are shown as XXXX-XXXX-XXXX-XXXX; case and dashes do not matter when typed.
export const normalizeCode = (code: string) =>
  code.toUpperCase().replace(/[^A-Z0-9]/g, "");

export const loginPolicy = { MAX_LOGIN_ATTEMPTS, LOGIN_LOCK_MINUTES };

// Cloudflare is the only way in, so its visitor-address header is trustworthy here.
export const getClientIp = async () => {
  const h = await headers();
  return (
    h.get("cf-connecting-ip") ||
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "local"
  );
};

// Per-address limit on failed sign-in and invite attempts, kept in memory.
const failuresByIp = new Map<string, { count: number; resetAt: number }>();
const IP_WINDOW_MS = 15 * 60 * 1000;
const IP_MAX_FAILURES = 20;

export const isIpBlocked = (ip: string) => {
  const entry = failuresByIp.get(ip);
  if (!entry || entry.resetAt < Date.now()) return false;
  return entry.count >= IP_MAX_FAILURES;
};

export const recordIpFailure = (ip: string) => {
  const now = Date.now();
  const entry = failuresByIp.get(ip);
  if (!entry || entry.resetAt < now) {
    failuresByIp.set(ip, { count: 1, resetAt: now + IP_WINDOW_MS });
  } else {
    entry.count += 1;
  }
};

export const startSession = async (userId: string) => {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);

  await db.insert(sessions).values({ id: sha256(token), userId, expiresAt });

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE !== "false",
    path: "/",
    expires: expiresAt,
  });
};

export const endSession = async () => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;

  if (token) await db.delete(sessions).where(eq(sessions.id, sha256(token)));

  jar.delete(SESSION_COOKIE);
};

export const getCurrentUser = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;

  if (!token) return null;

  const session = await db.query.sessions.findFirst({
    where: and(
      eq(sessions.id, sha256(token)),
      gt(sessions.expiresAt, new Date())
    ),
    with: { user: true },
  });

  if (!session || session.user.disabled) return null;

  return session.user;
});

const getAuth = async () => {
  const user = await getCurrentUser();

  return { userId: user?.id ?? null };
};

export const auth = Object.assign(getAuth, {
  // Sends anyone who is not signed in to the sign-in page.
  protect: async () => {
    const user = await getCurrentUser();

    if (!user) redirect("/sign-in");

    return { userId: user.id };
  },
});

export const currentUser = async () => {
  const user = await getCurrentUser();

  if (!user) return null;

  return { id: user.id, firstName: user.displayName, imageUrl: user.imageSrc };
};
