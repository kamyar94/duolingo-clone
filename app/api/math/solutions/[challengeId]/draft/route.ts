// "Draft with AI" in author mode: the author's own provider writes a first script from the
// question and the reference answer. The draft is validated before it is returned; nothing is
// saved until the author saves it.
import { jsonError, jsonOk, mathRoute, readJson } from "@/lib/math/route-helpers";
import { draftSolution, ScriptError } from "@/lib/math/solutions";

export const dynamic = "force-dynamic";
// A long script can take a provider a while to write.
export const maxDuration = 180;

export const POST = async (
  request: Request,
  { params }: { params: Promise<{ challengeId: string }> }
) => {
  const challengeId = Number((await params).challengeId);
  return mathRoute(request, "solutions-draft", async (user) => {
    if (!user.isAdmin) return jsonError(403, "Only authors can draft solutions.");
    await readJson(request, 4096).catch(() => null);
    try {
      return jsonOk(await draftSolution({ userId: user.id, challengeId }));
    } catch (error) {
      if (error instanceof ScriptError)
        return jsonError(error.status, error.message, { problems: error.problems });
      throw error;
    }
  });
};
