// Text to speech for the signed-in account: the text of a hint, an explanation or a narration
// goes to Kokoro on the workstation and comes back as an MP3 clip. The voice and speed default
// to the account's voice settings. Clips are stored by what went into them, so a text that was
// read before costs nothing. A clean 503 means the workstation is away.
import { getVoiceSettings } from "@/lib/ai/service";
import { audioResponse, readJsonBody, voiceRoute } from "@/lib/voice/http";
import { requireVoiceConfig, speakClip } from "@/lib/voice/service";
import { parseSpeechRequest } from "@/lib/voice/validate";

export const dynamic = "force-dynamic";

const MAX_BODY = 32 * 1024;

export const POST = (request: Request) =>
  voiceRoute(request, "speech", async (user) => {
    const config = requireVoiceConfig();
    const parsed = parseSpeechRequest(await readJsonBody(request, MAX_BODY));
    const settings = await getVoiceSettings(user.id);
    const clip = await speakClip(config, {
      userId: user.id,
      text: parsed.text,
      voice: parsed.voice ?? settings.voice,
      speed: parsed.speed ?? settings.speed,
    });
    return audioResponse(request, clip.bytes, clip.key);
  });
