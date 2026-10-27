// Limits per account on server runs, kept in memory like the AI limits (one app process holds
// them). RUNNER_RATE_PER_MINUTE and RUNNER_RATE_PER_DAY count requests; a Check of a lesson is
// one request however many tests it has.
import { createRateLimiter } from "@/lib/ai/rate-limit";

const fromEnv = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
};

export const runnerRateLimiter = createRateLimiter([
  { windowMs: 60_000, max: fromEnv("RUNNER_RATE_PER_MINUTE", 20) },
  { windowMs: 86_400_000, max: fromEnv("RUNNER_RATE_PER_DAY", 600) },
]);

/** Runs of one account at the same time; more wait their turn in the browser. */
export const MAX_RUNS_IN_FLIGHT = 2;

const inFlight = new Map<string, number>();

/** Takes a slot for the account, or returns null when it already has MAX_RUNS_IN_FLIGHT runs. */
export const takeRunSlot = (userId: string) => {
  const count = inFlight.get(userId) ?? 0;
  if (count >= MAX_RUNS_IN_FLIGHT) return null;
  inFlight.set(userId, count + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const left = (inFlight.get(userId) ?? 1) - 1;
    if (left > 0) inFlight.set(userId, left);
    else inFlight.delete(userId);
  };
};
