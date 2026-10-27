// Shared pieces of the math routes (app/api/math): the signed-in user, a same-origin check,
// JSON bodies read with a size cap, per-account rate limits and one error shape.
import { NextResponse } from "next/server";

import { AiError, describeAiError, isAiError } from "@/lib/ai/errors";
import { createRateLimiter } from "@/lib/ai/rate-limit";
import { getCurrentUser } from "@/lib/auth";

import { MathError } from "./service";

/** Requests per account to the math routes, apart from the AI layer's own limit. */
export const mathRouteLimiter = createRateLimiter([
  { windowMs: 60_000, max: 30 },
  { windowMs: 86_400_000, max: 2000 },
]);

export const jsonError = (status: number, error: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ error, ...extra }, { status, headers: { "cache-control": "no-store" } });

export const jsonOk = (body: unknown) =>
  NextResponse.json(body, { headers: { "cache-control": "no-store" } });

/** Browsers send Origin on POST; it must name this site (the cookie is SameSite=Lax anyway). */
export const sameOrigin = (request: Request) => {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return !!host && new URL(origin).host === host.split(",")[0].trim();
  } catch {
    return false;
  }
};

/** Reads a JSON body of at most maxBytes, also when no Content-Length was sent. */
export const readJson = async (request: Request, maxBytes: number): Promise<unknown> => {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new MathError(413, "The request is too large.");
  if (!request.body) throw new MathError(400, "The request has no body.");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new MathError(413, "The request is too large.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new MathError(400, "The request is not JSON.");
  }
};

export type RouteUser = { id: string; isAdmin: boolean };

/**
 * Runs a math route for a signed-in account: origin check, rate limit, and errors turned into
 * JSON with a sentence the learner can read (never provider details beyond describeAiError).
 */
export const mathRoute = async (
  request: Request,
  name: string,
  handler: (user: RouteUser) => Promise<Response>
): Promise<Response> => {
  if (!sameOrigin(request)) return jsonError(403, "Requests must come from this site.");
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "Sign in first.");

  const { ok, retryAfter } = mathRouteLimiter.take(`${name}:${user.id}`);
  if (!ok)
    return jsonError(429, "Too many requests in a short time. Try again shortly.", {
      retryAfter,
    });

  try {
    return await handler({ id: user.id, isAdmin: user.isAdmin });
  } catch (error) {
    if (error instanceof MathError) return jsonError(error.status, error.message);
    if (isAiError(error)) return aiErrorResponse(error);
    console.error(`math route ${name} failed:`, error instanceof Error ? error.message : error);
    return jsonError(500, "Something went wrong. Please try again.");
  }
};

const AI_STATUS: Partial<Record<AiError["kind"], number>> = {
  "no-key": 409,
  config: 503,
  auth: 502,
  "rate-limit": 429,
  "local-rate-limit": 429,
  quota: 402,
  timeout: 504,
};

export const aiErrorResponse = (error: AiError) =>
  jsonError(AI_STATUS[error.kind] ?? 502, describeAiError(error), {
    aiError: error.kind,
    retryAfter: error.retryAfter,
  });
