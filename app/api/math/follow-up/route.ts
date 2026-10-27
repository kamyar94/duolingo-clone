// Follow-up questions about a graded attempt, typed by the learner (voice comes later). The
// conversation is stored with the attempt.
import { jsonOk, mathRoute, readJson } from "@/lib/math/route-helpers";
import { askFollowUp } from "@/lib/math/service";

export const dynamic = "force-dynamic";

const MAX_BODY = 16 * 1024;

export const POST = (request: Request) =>
  mathRoute(request, "follow-up", async (user) => {
    const body = (await readJson(request, MAX_BODY)) as Record<string, unknown> | null;
    const result = await askFollowUp({
      userId: user.id,
      attemptId: Number(body?.attemptId),
      question: typeof body?.question === "string" ? body.question : "",
    });
    return jsonOk(result);
  });
