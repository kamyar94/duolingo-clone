// Whether voice can be used right now, and the signed-in account's voice settings. The
// interface calls this once per page to decide whether to show the voice controls; the gateway
// is asked at most every few seconds however many pages ask (lib/voice/gateway.ts).
import { NextResponse } from "next/server";

import { getVoiceSettings } from "@/lib/ai/service";
import { readVoiceConfig } from "@/lib/voice/config";
import { voiceRoute } from "@/lib/voice/http";
import { voiceAvailability } from "@/lib/voice/service";

export const dynamic = "force-dynamic";

export const GET = (request: Request) =>
  voiceRoute(request, "status", async (user) => {
    const config = readVoiceConfig();
    const [availability, settings] = await Promise.all([
      voiceAvailability(config),
      getVoiceSettings(user.id),
    ]);
    return NextResponse.json(
      {
        configured: availability.configured,
        speech: availability.speech,
        transcription: availability.transcription,
        settings,
        defaultVoice: config?.defaultVoice ?? null,
      },
      { headers: { "cache-control": "no-store" } }
    );
  });
