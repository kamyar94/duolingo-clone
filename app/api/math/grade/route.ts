// Grading: the corrected LaTeX lines and the final answer. The deterministic check decides,
// the AI step analysis explains (stored and reused by fingerprint). The browser then reports
// the result to the lesson, which applies hearts and points as for any other exercise.
import { jsonOk, mathRoute, readJson } from "@/lib/math/route-helpers";
import { cleanAnswer, cleanLines, gradeAttempt } from "@/lib/math/service";

export const dynamic = "force-dynamic";

const MAX_BODY = 128 * 1024;

export const POST = (request: Request) =>
  mathRoute(request, "grade", async (user) => {
    const body = (await readJson(request, MAX_BODY)) as Record<string, unknown> | null;
    const attemptId = body?.attemptId == null ? null : Number(body.attemptId);
    const result = await gradeAttempt({
      userId: user.id,
      isAdmin: user.isAdmin,
      challengeId: Number(body?.challengeId),
      attemptId,
      lines: cleanLines(body?.lines ?? []),
      answer: cleanAnswer(body?.answer),
    });
    return jsonOk(result);
  });
