// Browser side of the math routes in app/api/math.
import type {
  ConversationTurn,
  GivenAnswer,
  GradeResult,
  RecognizeResult,
  StoredStroke,
} from "@/lib/math/types";

export class MathApiError extends Error {
  readonly status: number;
  /** The AI error kind when the provider step failed ("no-key", "auth"...). */
  readonly aiError?: string;
  constructor(status: number, message: string, aiError?: string) {
    super(message);
    this.name = "MathApiError";
    this.status = status;
    this.aiError = aiError;
  }
}

const post = async <T>(path: string, body: unknown): Promise<T> => {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    throw new MathApiError(0, "The server could not be reached. Check the connection.");
  }
  const data = (await response.json().catch(() => null)) as
    | (T & { error?: string; aiError?: string })
    | null;
  if (!response.ok || !data)
    throw new MathApiError(
      response.status,
      data?.error ?? "Something went wrong. Please try again.",
      data?.aiError
    );
  return data;
};

export const recognize = (input: {
  challengeId: number;
  image: string;
  strokes: StoredStroke[];
}) => post<RecognizeResult>("/api/math/recognize", input);

export const grade = (input: {
  challengeId: number;
  attemptId: number | null;
  lines: string[];
  answer: GivenAnswer | null;
}) => post<GradeResult>("/api/math/grade", input);

export const askFollowUp = (input: { attemptId: number; question: string }) =>
  post<{ reply: string; conversation: ConversationTurn[] }>("/api/math/follow-up", input);

export const markCommonMistake = (analysisId: number, commonMistake: boolean) =>
  post<{ id: number; commonMistake: boolean }>(`/api/math/analyses/${analysisId}`, {
    commonMistake,
  });
