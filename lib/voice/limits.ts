// Limits per account on the voice routes, kept in memory like the AI limits (one app container,
// so one process holds them). Reading a clip that is already stored costs almost nothing and
// only counts against the request limit; making a new clip or transcribing a recording uses
// the workstation's GPU and has its own, tighter limit.
import { createRateLimiter } from "@/lib/ai/rate-limit";

/** Every voice request of an account, hits included. */
export const voiceRequestLimiter = createRateLimiter([
  { windowMs: 60_000, max: 120 },
  { windowMs: 86_400_000, max: 5000 },
]);

/** New clips (a stored clip does not count). */
export const speechGenerateLimiter = createRateLimiter([
  { windowMs: 60_000, max: 20 },
  { windowMs: 86_400_000, max: 500 },
]);

/** Recordings sent for transcription. */
export const transcribeLimiter = createRateLimiter([
  { windowMs: 60_000, max: 10 },
  { windowMs: 86_400_000, max: 300 },
]);
