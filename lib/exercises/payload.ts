// Checks the payload of a challenge from a course file or the admin screens, and trims it to
// what the learner's browser may see. Every type gets the shared checks here; the coding and
// math tracks add their own rules in lib/coding/payload.ts and lib/math/payload.ts.
//
// Imported by scripts/course-import.mjs (bundled with esbuild), so keep this file and the rule
// files free of Next.js and database imports. Relative imports only, for the same reason.
import { codingPayloadRules } from "../coding/payload";
import { mathPayloadRules } from "../math/payload";

import type { PayloadRules, PayloadRuleSet } from "./payload-types";
import {
  isChallengeType,
  isExerciseType,
  type ChallengeType,
} from "./types";

export type { PayloadContext, PayloadRules } from "./payload-types";

/** Upper bound for one payload, as JSON text. Big media belongs in the media folder. */
export const MAX_PAYLOAD_BYTES = 256 * 1024;

const rules = new Map<ChallengeType, PayloadRules>();

const addRuleSet = (set: PayloadRuleSet) => {
  for (const [type, rule] of Object.entries(set))
    if (rule && isChallengeType(type)) rules.set(type, rule);
};
addRuleSet(codingPayloadRules);
addRuleSet(mathPayloadRules);

/** Adds or replaces the rules for one type at run time (tests, plugins). */
export const registerPayloadRules = (
  type: ChallengeType,
  rule: PayloadRules | null
) => {
  if (rule) rules.set(type, rule);
  else rules.delete(type);
};

export const getPayloadRules = (type: ChallengeType) => rules.get(type);

export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

/**
 * Problems with a challenge's payload, as short sentences; an empty list means it is fine.
 * Coding and math types need a payload object; SELECT and ASSIST may leave it out.
 */
export const checkChallengePayload = (
  type: ChallengeType,
  payload: unknown,
  context: { question: string; options?: { text: string; correct?: boolean }[] }
): string[] => {
  if (payload == null)
    return isExerciseType(type) ? [`${type} needs a payload object.`] : [];
  if (!isPlainObject(payload)) return ["payload must be an object."];

  let size = 0;
  try {
    size = new TextEncoder().encode(JSON.stringify(payload)).length;
  } catch {
    return ["payload must be plain JSON."];
  }
  if (size > MAX_PAYLOAD_BYTES)
    return [
      `payload is ${Math.ceil(size / 1024)} KB; the limit is ${MAX_PAYLOAD_BYTES / 1024} KB.`,
    ];

  const rule = rules.get(type);
  if (!rule?.validate) return [];
  try {
    return rule.validate(payload, {
      type,
      question: context.question,
      options: context.options ?? [],
    });
  } catch (error) {
    return [
      `payload check failed: ${error instanceof Error ? error.message : String(error)}`,
    ];
  }
};

/** The part of a payload that is sent to the learner's browser (hidden answers removed). */
export const toClientPayload = (type: ChallengeType, payload: unknown) => {
  if (payload == null) return null;
  const rule = rules.get(type);
  return rule?.toClient ? rule.toClient(payload) : payload;
};
