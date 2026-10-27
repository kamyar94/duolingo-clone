import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { runOnServer, serverLanguages } from "@/lib/coding/server/client";
import { runnerRateLimiter, takeRunSlot } from "@/lib/coding/server/limits";
import { MAX_BODY, parseServerRun } from "@/lib/coding/server/request";

export const dynamic = "force-dynamic";

// Runs a learner's program in a language without a browser runtime (section 4.4) on the code
// runner of its language family. Signed-in accounts only, with a rate limit per account, size
// caps on the program and its inputs, and at most two runs of one account at a time.

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

/** The request comes from the app's own pages (like the check Next.js does for actions). */
const sameOrigin = (req: Request) => {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
};

/** Reads the body up to a size cap; null when it is larger. */
const readCapped = async (req: Request, cap: number) => {
  const length = Number(req.headers.get("content-length"));
  if (Number.isFinite(length) && length > cap) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > cap) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
};

/** The server languages this installation can run, for the signed-in account. */
export const GET = async () => {
  const user = await getCurrentUser();
  if (!user) return json({ error: "Sign in to run programs." }, 401);
  return json({ languages: serverLanguages() });
};

export const POST = async (req: Request) => {
  const user = await getCurrentUser();
  if (!user) return json({ error: "Sign in to run programs." }, 401);
  if (!sameOrigin(req)) return json({ error: "This request did not come from the app." }, 403);
  if (!req.headers.get("content-type")?.startsWith("application/json"))
    return json({ error: "Send the run as JSON." }, 415);

  const text = await readCapped(req, MAX_BODY);
  if (text === null) return json({ error: "The program and its inputs are too large." }, 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "The request is not valid JSON." }, 400);
  }
  const parsed = parseServerRun(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);

  const limit = runnerRateLimiter.take(user.id);
  if (!limit.ok)
    return json(
      { error: `You are running programs very quickly. Try again in ${limit.retryAfter} seconds.` },
      429,
      { "Retry-After": String(limit.retryAfter) }
    );
  const release = takeRunSlot(user.id);
  if (!release)
    return json({ error: "Your other programs are still running. Try again when they finish." }, 429, {
      "Retry-After": "2",
    });

  try {
    return json(await runOnServer(parsed.run, { signal: req.signal }));
  } finally {
    release();
  }
};
