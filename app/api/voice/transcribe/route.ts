// Speech to text for the signed-in account: the body is one recording (WebM, Ogg, MP4, WAV,
// MP3, AAC or FLAC, at most 6 MB), the answer is { text }. The text goes into the question
// field for the learner to check; nothing is sent on from here. The container is recognized
// from the bytes, not from the Content-Type header.
import { NextResponse } from "next/server";

import { readVoiceConfig } from "@/lib/voice/config";
import { readBytes, voiceRoute } from "@/lib/voice/http";
import { requireVoiceConfig, transcribeRecording } from "@/lib/voice/service";
import { MAX_AUDIO_BYTES, parseLanguage } from "@/lib/voice/validate";

export const dynamic = "force-dynamic";

export const POST = (request: Request) =>
  voiceRoute(request, "transcribe", async (user) => {
    const config = requireVoiceConfig(readVoiceConfig());
    const audio = await readBytes(request, MAX_AUDIO_BYTES);
    const language = parseLanguage(new URL(request.url).searchParams.get("language"));
    const text = await transcribeRecording(config, { userId: user.id, audio, language });
    return NextResponse.json({ text }, { headers: { "cache-control": "no-store" } });
  });
