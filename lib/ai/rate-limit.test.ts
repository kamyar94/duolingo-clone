import { describe, expect, it } from "vitest";

import { cleanProviderMessage } from "./errors";
import { createRateLimiter } from "./rate-limit";

describe("createRateLimiter", () => {
  it("allows up to the limit per window, then says how long to wait", () => {
    const limiter = createRateLimiter([{ windowMs: 60_000, max: 3 }]);
    const t = 1_000_000;
    expect(limiter.take("a", t).ok).toBe(true);
    expect(limiter.take("a", t + 1).ok).toBe(true);
    expect(limiter.take("a", t + 2).ok).toBe(true);
    expect(limiter.take("a", t + 30_000)).toEqual({ ok: false, retryAfter: 30 });
    // Other accounts are not affected, and the window resets.
    expect(limiter.take("b", t + 30_000).ok).toBe(true);
    expect(limiter.take("a", t + 60_000).ok).toBe(true);
  });

  it("needs room in every window, and refused requests do not count", () => {
    const limiter = createRateLimiter([
      { windowMs: 1_000, max: 2 },
      { windowMs: 10_000, max: 3 },
    ]);
    const t = 5_000_000;
    expect(limiter.take("a", t).ok).toBe(true);
    expect(limiter.take("a", t).ok).toBe(true);
    expect(limiter.take("a", t).ok).toBe(false);
    expect(limiter.take("a", t + 1_000).ok).toBe(true);
    const refused = limiter.take("a", t + 2_000);
    expect(refused.ok).toBe(false);
    expect(refused.retryAfter).toBe(8);
    limiter.reset("a");
    expect(limiter.take("a", t + 2_000).ok).toBe(true);
  });
});

describe("cleanProviderMessage", () => {
  it("removes the key and key-shaped text", () => {
    const key = "my-custom-key-123456";
    expect(
      cleanProviderMessage(`Key ${key} refused; also sk-ant-api03-abcdef123 and AIzaSyA1234567890abcdef`, key)
    ).toBe("Key [key] refused; also [key] and [key]");
    expect(cleanProviderMessage("Authorization: Bearer abc.def-123")).toBe(
      "Authorization: [key]"
    );
  });

  it("shortens long messages and ignores non-text", () => {
    expect(cleanProviderMessage("x".repeat(1000))).toHaveLength(300);
    expect(cleanProviderMessage(undefined)).toBe("");
    expect(cleanProviderMessage({ nested: true })).toBe("");
  });
});
