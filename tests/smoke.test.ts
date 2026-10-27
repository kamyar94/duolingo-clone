import { describe, expect, it } from "vitest";

import { MAX_HEARTS } from "@/constants";

describe("test setup", () => {
  it("resolves the @ alias", () => {
    expect(MAX_HEARTS).toBeGreaterThan(0);
  });
});
