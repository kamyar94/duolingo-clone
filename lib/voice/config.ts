// Settings of the voice layer, read from the environment of the app container.
//
//   VOICE_URL         base address of the gateway on the workstation, for example
//                     https://192.0.2.10:8443 (https is required except for a loopback address)
//   VOICE_TOKEN       the bearer token the gateway requires on every request (secrets file)
//   VOICE_CA_FILE     path of the gateway's root certificate (PEM) that the app should trust
//   VOICE_TTS_MODEL   model name sent to Kokoro (default "kokoro")
//   VOICE_STT_MODEL   Whisper model installed on the gateway (default Systran/faster-whisper-small)
//   VOICE_STT_LANGUAGE  optional two-letter language code that fixes the language of recordings
//   VOICE_DEFAULT_VOICE  voice used when a learner has not chosen one (default af_heart)
//   VOICE_DATA_DIR    writable folder for cached narration audio (default ./.voice-data)
//   VOICE_CACHE_MAX_MB  size limit of that folder (default 512)
//   VOICE_TIMEOUT_MS  limit for one gateway request (default 60000)
// Requests go through the egress proxy when AI_PROXY_URL is set, like the AI provider requests.
import path from "node:path";

export type VoiceEnv = Partial<Record<string, string | undefined>>;

export type VoiceConfig = {
  baseUrl: URL;
  token: string;
  caFile: string | null;
  proxyUrl: string | null;
  ttsModel: string;
  sttModel: string;
  sttLanguage: string | null;
  defaultVoice: string;
  dataDir: string;
  cacheMaxBytes: number;
  timeoutMs: number;
};

export const DEFAULT_TTS_MODEL = "kokoro";
export const DEFAULT_STT_MODEL = "Systran/faster-whisper-small";
export const DEFAULT_VOICE = "af_heart";

const positive = (value: string | undefined, fallback: number) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
};

const isLoopback = (host: string) =>
  host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost");

/**
 * The voice settings, or null when voice is not configured (no address or no token, or an
 * address that is not https and not loopback). The token is never sent over plain http to
 * anything but a loopback address.
 */
export const readVoiceConfig = (env: VoiceEnv = process.env): VoiceConfig | null => {
  const rawUrl = env.VOICE_URL?.trim();
  const token = env.VOICE_TOKEN?.trim();
  if (!rawUrl || !token) return null;

  let baseUrl: URL;
  try {
    baseUrl = new URL(rawUrl);
  } catch {
    return null;
  }
  if (baseUrl.protocol !== "https:" && !(baseUrl.protocol === "http:" && isLoopback(baseUrl.hostname)))
    return null;
  // A path, credentials or query in the base address would only cause confusion.
  baseUrl.pathname = "/";
  baseUrl.search = "";
  baseUrl.hash = "";
  baseUrl.username = "";
  baseUrl.password = "";

  const language = env.VOICE_STT_LANGUAGE?.trim().toLowerCase();

  return {
    baseUrl,
    token,
    caFile: env.VOICE_CA_FILE?.trim() || null,
    proxyUrl: env.AI_PROXY_URL?.trim() || null,
    ttsModel: env.VOICE_TTS_MODEL?.trim() || DEFAULT_TTS_MODEL,
    sttModel: env.VOICE_STT_MODEL?.trim() || DEFAULT_STT_MODEL,
    sttLanguage: language && /^[a-z]{2,3}$/.test(language) ? language : null,
    defaultVoice: env.VOICE_DEFAULT_VOICE?.trim() || DEFAULT_VOICE,
    // The ignore comment keeps Next from tracing the whole project into the server build.
    dataDir: path.resolve(/*turbopackIgnore: true*/ env.VOICE_DATA_DIR?.trim() || ".voice-data"),
    cacheMaxBytes: Math.floor(positive(env.VOICE_CACHE_MAX_MB, 512) * 1024 * 1024),
    timeoutMs: Math.floor(positive(env.VOICE_TIMEOUT_MS, 60_000)),
  };
};
