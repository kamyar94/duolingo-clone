// What the voice routes do, apart from HTTP: turn text into a cached clip, turn a recording
// into text, and report whether voice is available. No database and no Next.js here, so the
// pieces can be tested against a mock gateway. Server only.
import { clipCacheFor, clipKey } from "./cache";
import { readVoiceConfig, type VoiceConfig } from "./config";
import { VoiceError } from "./errors";
import { checkGateway, forgetGatewayHealth, synthesize, transcribe, type GatewayHealth } from "./gateway";
import { speechGenerateLimiter, transcribeLimiter } from "./limits";
import { speakable } from "./speakable";
import { MAX_AUDIO_BYTES, MIN_AUDIO_BYTES, sniffAudio } from "./validate";

/** The settings of this server, or a VoiceError when voice is not configured. */
export const requireVoiceConfig = (config: VoiceConfig | null = readVoiceConfig()): VoiceConfig => {
  if (!config) throw new VoiceError("not-configured");
  return config;
};

export type Clip = { bytes: Buffer; key: string; cached: boolean };

/** Runs a gateway call and forgets the remembered health when the gateway turns out to be away. */
const guarded = async <T>(work: () => Promise<T>): Promise<T> => {
  try {
    return await work();
  } catch (error) {
    if (error instanceof VoiceError && error.unavailable) forgetGatewayHealth();
    throw error;
  }
};

/**
 * The audio of a text for one voice and speed. The text is first turned into words a voice can
 * read (see speakable), and the clip is looked up by what went into it. Only a clip that has to
 * be made counts against the account's generation limit.
 */
export const speakClip = async (
  config: VoiceConfig,
  request: { userId: string; text: string; voice: string | null; speed: number }
): Promise<Clip> => {
  const spoken = speakable(request.text);
  if (!spoken) throw new VoiceError("invalid", "There is nothing to read aloud in that text.");
  const voice = request.voice ?? config.defaultVoice;
  const key = clipKey({ model: config.ttsModel, voice, speed: request.speed, text: spoken });

  const { bytes, created } = await clipCacheFor(config.dataDir, config.cacheMaxBytes).getOrCreate(
    key,
    () =>
      guarded(async () => {
        const taken = speechGenerateLimiter.take(request.userId);
        if (!taken.ok) throw new VoiceError("rate-limit", undefined, taken.retryAfter);
        return synthesize(config, { text: spoken, voice, speed: request.speed });
      })
  );
  return { bytes, key, cached: !created };
};

/** The words of a recording. The container is recognized from the bytes, not the header. */
export const transcribeRecording = async (
  config: VoiceConfig,
  request: { userId: string; audio: Uint8Array; language?: string | null }
): Promise<string> => {
  if (request.audio.length > MAX_AUDIO_BYTES)
    throw new VoiceError("too-large", "That recording is too long.");
  if (request.audio.length < MIN_AUDIO_BYTES)
    throw new VoiceError("invalid", "The recording is empty. Hold the button while you speak.");
  const kind = sniffAudio(request.audio);
  if (!kind) throw new VoiceError("invalid", "That is not an audio recording this server can read.");

  const taken = transcribeLimiter.take(request.userId);
  if (!taken.ok) throw new VoiceError("rate-limit", undefined, taken.retryAfter);
  return guarded(() => transcribe(config, { audio: request.audio, kind, language: request.language }));
};

export type VoiceAvailability = GatewayHealth & { configured: boolean };

/** Whether voice is set up and the gateway answers; this is what the interface checks. */
export const voiceAvailability = async (
  config: VoiceConfig | null = readVoiceConfig()
): Promise<VoiceAvailability> => {
  if (!config) return { configured: false, speech: false, transcription: false };
  return { configured: true, ...(await checkGateway(config)) };
};
