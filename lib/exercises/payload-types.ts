import type { ChallengeType } from "./types";

export type PayloadContext = {
  type: ChallengeType;
  question: string;
  options: { text: string; correct?: boolean }[];
};

export type PayloadRules = {
  /**
   * Problems with the payload, as short sentences such as "tests must be a list."; an empty
   * list means it is fine. Called by the course import (check, import, update) after the shared
   * checks of lib/exercises/payload.ts, so the payload is already a plain JSON object.
   */
  validate?: (payload: Record<string, unknown>, context: PayloadContext) => string[];
  /**
   * What the learner's browser receives, for example without the stored answer of a math
   * problem. Runs on the server when a lesson loads. Default: the whole payload.
   */
  toClient?: (payload: unknown) => unknown;
};

export type PayloadRuleSet = Partial<Record<ChallengeType, PayloadRules>>;
