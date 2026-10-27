// Browser side of the solution routes in app/api/math/solutions.
import type {
  SolutionScript,
  SolutionVersion,
  SolutionVersionInfo,
} from "@/lib/math/solution/types";

import { MathApiError } from "../api";

/** An error of a solution route, with the problems of a script that did not pass the check. */
export class SolutionApiError extends MathApiError {
  readonly problems: string[];
  constructor(status: number, message: string, problems: string[] = [], aiError?: string) {
    super(status, message, aiError);
    this.name = "SolutionApiError";
    this.problems = problems;
  }
}

const call = async <T>(path: string, init?: RequestInit): Promise<T> => {
  let response: Response;
  try {
    response = await fetch(path, { credentials: "same-origin", ...init });
  } catch {
    throw new SolutionApiError(0, "The server could not be reached. Check the connection.");
  }
  const data = (await response.json().catch(() => null)) as
    | (T & { error?: string; aiError?: string; problems?: string[] })
    | null;
  if (!response.ok || !data)
    throw new SolutionApiError(
      response.status,
      data?.error ?? "Something went wrong. Please try again.",
      Array.isArray(data?.problems) ? data.problems : [],
      data?.aiError
    );
  return data;
};

const postJson = <T>(path: string, body: unknown) =>
  call<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

export type LoadedSolution = SolutionVersion & { versions?: SolutionVersionInfo[] };

export const fetchSolution = (challengeId: number, version?: number) =>
  call<LoadedSolution>(
    `/api/math/solutions/${challengeId}${version ? `?version=${version}` : ""}`,
    { cache: "no-store" }
  );

export const saveSolutionVersion = (input: {
  challengeId: number;
  script: SolutionScript;
  baseVersion: number | null;
  force?: boolean;
}) =>
  postJson<{ version: number; versions: SolutionVersionInfo[] }>(
    `/api/math/solutions/${input.challengeId}`,
    { script: input.script, baseVersion: input.baseVersion, force: input.force === true }
  );

export const draftSolutionWithAi = (challengeId: number) =>
  postJson<{ script: SolutionScript; provider: string; model: string }>(
    `/api/math/solutions/${challengeId}/draft`,
    {}
  );
