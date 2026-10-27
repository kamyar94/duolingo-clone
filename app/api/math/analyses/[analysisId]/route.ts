// Authors (admin accounts) mark a stored analysis as a common mistake of its problem, or take
// the mark away.
import { jsonError, jsonOk, mathRoute, readJson } from "@/lib/math/route-helpers";
import { setCommonMistake } from "@/lib/math/service";

export const dynamic = "force-dynamic";

export const POST = async (
  request: Request,
  { params }: { params: Promise<{ analysisId: string }> }
) => {
  const { analysisId } = await params;
  return mathRoute(request, "analyses", async (user) => {
    if (!user.isAdmin) return jsonError(403, "Only authors can mark common mistakes.");
    const body = (await readJson(request, 4096)) as Record<string, unknown> | null;
    if (typeof body?.commonMistake !== "boolean")
      return jsonError(400, "commonMistake must be true or false.");
    return jsonOk(await setCommonMistake(Number(analysisId), body.commonMistake));
  });
};
