// Recognition: the browser posts the rendered handwriting (a cropped PNG on white) and the
// strokes; the learner's chosen provider and model read it into LaTeX lines with confidences.
// Size caps here, a per-account limit in mathRoute and the AI layer's own limit in runAiTask.
import { checkPngImage } from "@/lib/math/image";
import { jsonError, jsonOk, mathRoute, readJson } from "@/lib/math/route-helpers";
import { recognizeHandwriting } from "@/lib/math/service";
import { validateStrokes } from "@/lib/math/strokes";

export const dynamic = "force-dynamic";

/** Picture (3 MB as PNG, about 4 MB as base64) plus strokes. */
const MAX_BODY = 7 * 1024 * 1024;

export const POST = (request: Request) =>
  mathRoute(request, "recognize", async (user) => {
    const body = (await readJson(request, MAX_BODY)) as Record<string, unknown> | null;
    const challengeId = Number(body?.challengeId);

    const strokes = validateStrokes(body?.strokes);
    if (!strokes.ok) return jsonError(400, strokes.error);
    if (!strokes.strokes.some((stroke) => stroke.k === "p"))
      return jsonError(422, "Write something on the canvas first.");

    const image = checkPngImage(body?.image);
    if (!image.ok) return jsonError(image.status, image.error);

    const result = await recognizeHandwriting({
      userId: user.id,
      challengeId,
      imageBase64: image.base64,
      strokes: strokes.strokes,
    });
    return jsonOk(result);
  });
