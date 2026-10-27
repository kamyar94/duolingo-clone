// Limits per account for AI requests, kept in memory like the sign-in limits in lib/auth.ts
// (one app container, so one process holds them). Later routes such as the code runner and the
// voice relay can make their own limiter with createRateLimiter.

export type RateLimiter = {
  /** Counts one request for the key. ok is false when a limit is reached. */
  take: (key: string, now?: number) => { ok: boolean; retryAfter: number };
  reset: (key?: string) => void;
};

export type RateWindow = { windowMs: number; max: number };

/** Fixed windows: a request counts against every window, and all must have room. */
export const createRateLimiter = (windows: RateWindow[]): RateLimiter => {
  const counters = windows.map(
    () => new Map<string, { count: number; resetAt: number }>()
  );

  const sweep = (now: number) => {
    for (const map of counters)
      if (map.size > 5000)
        for (const [key, entry] of map) if (entry.resetAt <= now) map.delete(key);
  };

  return {
    take(key, now = Date.now()) {
      sweep(now);
      let retryAfter = 0;
      const entries = windows.map((window, i) => {
        let entry = counters[i].get(key);
        if (!entry || entry.resetAt <= now) {
          entry = { count: 0, resetAt: now + window.windowMs };
          counters[i].set(key, entry);
        }
        if (entry.count >= window.max)
          retryAfter = Math.max(retryAfter, Math.ceil((entry.resetAt - now) / 1000));
        return entry;
      });
      if (retryAfter > 0) return { ok: false, retryAfter };
      for (const entry of entries) entry.count += 1;
      return { ok: true, retryAfter: 0 };
    },
    reset(key) {
      for (const map of counters) {
        if (key === undefined) map.clear();
        else map.delete(key);
      }
    },
  };
};

const fromEnv = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
};

/** AI requests per account: AI_RATE_PER_MINUTE (default 10) and AI_RATE_PER_DAY (default 300). */
export const aiRateLimiter = createRateLimiter([
  { windowMs: 60_000, max: fromEnv("AI_RATE_PER_MINUTE", 10) },
  { windowMs: 86_400_000, max: fromEnv("AI_RATE_PER_DAY", 300) },
]);

/** Saving, replacing and testing keys: 20 changes per 10 minutes per account. */
export const aiSettingsRateLimiter = createRateLimiter([
  { windowMs: 600_000, max: 20 },
]);
