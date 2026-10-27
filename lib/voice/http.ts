// HTTP pieces of the voice routes (app/api/voice): the signed-in user, the same-origin check,
// per-account limits, bodies read with a size cap, errors turned into one JSON shape, and audio
// answers with byte ranges (phones need them to play and seek audio). Server only.
import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { jsonError, sameOrigin, type RouteUser } from "@/lib/math/route-helpers";

import { VoiceError } from "./errors";
import { voiceRequestLimiter } from "./limits";

/**
 * Runs a voice route for a signed-in account: origin check for anything but GET, a request
 * limit, and every VoiceError answered with its own status and a sentence a learner can read.
 * "unavailable" is true when the voice service itself is away, so the page can hide its controls.
 */
export const voiceRoute = async (
  request: Request,
  name: string,
  handler: (user: RouteUser) => Promise<Response>
): Promise<Response> => {
  if (request.method !== "GET" && request.method !== "HEAD" && !sameOrigin(request))
    return jsonError(403, "Requests must come from this site.");
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "Sign in first.");

  const taken = voiceRequestLimiter.take(`${name}:${user.id}`);
  if (!taken.ok)
    return voiceFailure(new VoiceError("rate-limit", undefined, taken.retryAfter));

  try {
    return await handler({ id: user.id, isAdmin: user.isAdmin });
  } catch (error) {
    if (error instanceof VoiceError) return voiceFailure(error);
    console.error(`voice route ${name} failed:`, error instanceof Error ? error.message : error);
    return jsonError(500, "Something went wrong. Please try again.");
  }
};

export const voiceFailure = (error: VoiceError) =>
  NextResponse.json(
    { error: error.message, unavailable: error.unavailable, retryAfter: error.retryAfter },
    {
      status: error.status,
      headers: {
        "cache-control": "no-store",
        ...(error.retryAfter ? { "retry-after": String(error.retryAfter) } : {}),
      },
    }
  );

/** Reads a request body of at most maxBytes, also when no Content-Length was sent. */
export const readBytes = async (request: Request, maxBytes: number): Promise<Uint8Array> => {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new VoiceError("too-large", "That is too large to send.");
  if (!request.body) throw new VoiceError("invalid", "The request has no body.");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new VoiceError("too-large", "That is too large to send.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

export const readJsonBody = async (request: Request, maxBytes: number): Promise<unknown> => {
  const bytes = await readBytes(request, maxBytes);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new VoiceError("invalid", "The request is not JSON.");
  }
};

/**
 * An MP3 clip as a response, with byte ranges and an ETag (the clip's key), so a browser keeps
 * asking the server but gets a 304 while the clip is unchanged.
 */
export const audioResponse = (request: Request, bytes: Buffer, etag: string): Response => {
  const headers: Record<string, string> = {
    "Content-Type": "audio/mpeg",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-cache",
    ETag: `"${etag}"`,
    "X-Content-Type-Options": "nosniff",
  };
  if (request.headers.get("if-none-match") === headers.ETag)
    return new Response(null, { status: 304, headers });

  const size = bytes.length;
  let start = 0;
  let end = size - 1;
  let status = 200;
  const range = request.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && size > 0) {
    if (range[1]) {
      start = Number(range[1]);
      if (range[2]) end = Math.min(Number(range[2]), size - 1);
    } else if (range[2]) {
      start = Math.max(size - Number(range[2]), 0);
    }
    if (start > end || start >= size)
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    status = 206;
    headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  }
  headers["Content-Length"] = String(end - start + 1);
  if (request.method === "HEAD") return new Response(null, { status, headers });
  return new Response(new Uint8Array(bytes.subarray(start, end + 1)), { status, headers });
};
