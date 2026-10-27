// Animated solutions of a problem. GET returns a version's script (the newest unless
// ?version=N) to authors and to learners who have checked or completed the problem, with the
// list of versions for authors. POST saves a new version (authors only); earlier versions stay.
import { jsonError, jsonOk, mathRoute, readJson } from "@/lib/math/route-helpers";
import {
  canViewSolution,
  getSolution,
  listSolutionVersions,
  saveSolution,
  ScriptError,
} from "@/lib/math/solutions";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ challengeId: string }> };

const MAX_SCRIPT_BODY = 260 * 1024;

export const GET = async (request: Request, { params }: Params) => {
  const challengeId = Number((await params).challengeId);
  return mathRoute(request, "solutions-read", async (user) => {
    if (!Number.isInteger(challengeId) || challengeId <= 0) return jsonError(400, "Unknown problem.");
    if (!(await canViewSolution(user.id, user.isAdmin, challengeId)))
      return jsonError(403, "Check your answer first, then the solution opens.");
    const raw = new URL(request.url).searchParams.get("version");
    const version = raw === null ? undefined : Number(raw);
    if (version !== undefined && !(Number.isInteger(version) && version > 0))
      return jsonError(400, "version must be a whole number.");
    const solution = await getSolution(challengeId, version);
    if (!solution) return jsonError(404, "This problem has no animated solution yet.");
    return jsonOk({
      ...solution,
      versions: user.isAdmin ? await listSolutionVersions(challengeId) : undefined,
    });
  });
};

export const POST = async (request: Request, { params }: Params) => {
  const challengeId = Number((await params).challengeId);
  return mathRoute(request, "solutions-save", async (user) => {
    if (!user.isAdmin) return jsonError(403, "Only authors can save solutions.");
    const body = (await readJson(request, MAX_SCRIPT_BODY)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") return jsonError(400, "Send { script }.");
    try {
      const saved = await saveSolution({
        challengeId,
        authorId: user.id,
        script: body.script,
        baseVersion: typeof body.baseVersion === "number" ? body.baseVersion : null,
        force: body.force === true,
      });
      return jsonOk({ ...saved, versions: await listSolutionVersions(challengeId) });
    } catch (error) {
      if (error instanceof ScriptError)
        return jsonError(error.status, error.message, { problems: error.problems });
      throw error;
    }
  });
};
