// The narration of one step of an animated solution as audio. The clip is made once by the
// voice gateway from the step's narration text, stored as a file in the voice data folder and
// served from there; it is made again only when the text changes (the file name is a hash of
// the text, the voice and the model). Learners get it under the same rule as the solution
// itself: after a graded attempt or a completed challenge. The voice is the account's own.
import { getVoiceSettings } from "@/lib/ai/service";
import { jsonError } from "@/lib/math/route-helpers";
import { canViewSolution, getSolution } from "@/lib/math/solutions";
import { audioResponse, voiceRoute } from "@/lib/voice/http";
import { requireVoiceConfig, speakClip } from "@/lib/voice/service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ challengeId: string; step: string }> };

export const GET = async (request: Request, { params }: Params) => {
  const { challengeId: rawChallenge, step: rawStep } = await params;
  const challengeId = Number(rawChallenge);
  const stepIndex = Number(rawStep);

  return voiceRoute(request, "narration", async (user) => {
    if (!Number.isInteger(challengeId) || challengeId <= 0 || !Number.isInteger(stepIndex) || stepIndex < 0)
      return jsonError(400, "Unknown step.");
    const raw = new URL(request.url).searchParams.get("version");
    const version = raw === null ? undefined : Number(raw);
    if (version !== undefined && !(Number.isInteger(version) && version > 0))
      return jsonError(400, "version must be a whole number.");

    const config = requireVoiceConfig();
    if (!(await canViewSolution(user.id, user.isAdmin, challengeId)))
      return jsonError(403, "Check your answer first, then the solution opens.");
    const solution = await getSolution(challengeId, version);
    if (!solution) return jsonError(404, "This problem has no animated solution yet.");
    const text = solution.script.steps[stepIndex]?.narration?.trim();
    if (!text) return jsonError(404, "This step has no narration.");

    const settings = await getVoiceSettings(user.id);
    const clip = await speakClip(config, { userId: user.id, text, voice: settings.voice, speed: 1 });
    return audioResponse(request, clip.bytes, clip.key);
  });
};
