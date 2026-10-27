import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MAX_PAYLOAD_BYTES,
  checkChallengePayload,
  getPayloadRules,
  registerPayloadRules,
  toClientPayload,
} from "./payload";
import { EXERCISE_TYPES } from "./types";

const ctx = { question: "Q?", options: [] };

describe("checkChallengePayload", () => {
  afterEach(() => {
    registerPayloadRules("CODE_WRITE", null);
    registerPayloadRules("MATH", null);
  });

  it("requires a payload object for every coding and math type", () => {
    for (const type of EXERCISE_TYPES) {
      expect(checkChallengePayload(type, undefined, ctx)).toEqual([
        `${type} needs a payload object.`,
      ]);
      // An empty object passes the shared checks; track rules may still ask for fields.
      expect(checkChallengePayload(type, {}, ctx)).not.toContain(
        `${type} needs a payload object.`
      );
    }
  });

  it("lets multiple-choice types go without a payload", () => {
    expect(checkChallengePayload("SELECT", undefined, ctx)).toEqual([]);
    expect(checkChallengePayload("ASSIST", null, ctx)).toEqual([]);
  });

  it("refuses payloads that are not plain objects", () => {
    expect(checkChallengePayload("MATH", [1, 2], ctx)).toEqual([
      "payload must be an object.",
    ]);
    expect(checkChallengePayload("MATH", "text", ctx)).toEqual([
      "payload must be an object.",
    ]);
    expect(checkChallengePayload("SELECT", 3, ctx)).toEqual([
      "payload must be an object.",
    ]);
  });

  it("caps the payload size", () => {
    const big = { starter: "x".repeat(MAX_PAYLOAD_BYTES) };
    const [problem] = checkChallengePayload("CODE_WRITE", big, ctx);
    expect(problem).toMatch(/limit is 256 KB/);
  });

  it("runs the rules a track registered, with the challenge context", () => {
    const validate = vi.fn((payload: Record<string, unknown>) =>
      typeof payload.language === "string" ? [] : ["language missing."]
    );
    registerPayloadRules("CODE_WRITE", { validate });

    const options = [{ text: "a", correct: true }];
    expect(
      checkChallengePayload(
        "CODE_WRITE",
        { starter: "" },
        { question: "Write it", options }
      )
    ).toEqual(["language missing."]);
    expect(validate).toHaveBeenCalledWith(
      { starter: "" },
      { type: "CODE_WRITE", question: "Write it", options }
    );
    expect(
      checkChallengePayload("CODE_WRITE", { language: "python" }, ctx)
    ).toEqual([]);
  });

  it("turns a crashing rule into a problem instead of an exception", () => {
    registerPayloadRules("MATH", {
      validate: () => {
        throw new Error("boom");
      },
    });
    expect(checkChallengePayload("MATH", {}, ctx)).toEqual([
      "payload check failed: boom",
    ]);
  });

  it("does not run rules for a missing payload", () => {
    const validate = vi.fn(() => []);
    registerPayloadRules("MATH", { validate });
    checkChallengePayload("MATH", null, ctx);
    expect(validate).not.toHaveBeenCalled();
  });

  it("can remove registered rules", () => {
    registerPayloadRules("MATH", { validate: () => ["no"] });
    expect(getPayloadRules("MATH")).toBeDefined();
    registerPayloadRules("MATH", null);
    expect(getPayloadRules("MATH")).toBeUndefined();
  });
});

describe("toClientPayload", () => {
  afterEach(() => registerPayloadRules("MATH", null));

  it("passes payloads through by default", () => {
    expect(toClientPayload("CODE_READ", { language: "js" })).toEqual({
      language: "js",
    });
    expect(toClientPayload("SELECT", null)).toBeNull();
    expect(toClientPayload("SELECT", undefined)).toBeNull();
  });

  it("uses the trimming rule of the type", () => {
    registerPayloadRules("MATH", {
      toClient: (payload) => {
        const rest = { ...(payload as Record<string, unknown>) };
        delete rest.answer;
        return rest;
      },
    });
    expect(
      toClientPayload("MATH", { statement: "2x = 6", answer: { value: 3 } })
    ).toEqual({ statement: "2x = 6" });
  });
});
