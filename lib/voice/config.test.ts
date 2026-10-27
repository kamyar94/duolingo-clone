import { describe, expect, it } from "vitest";

import { readVoiceConfig } from "./config";

const base = { VOICE_URL: "https://192.0.2.10:8443", VOICE_TOKEN: "x".repeat(40) };

describe("readVoiceConfig", () => {
  it("is null until both the address and the token are set", () => {
    expect(readVoiceConfig({})).toBeNull();
    expect(readVoiceConfig({ VOICE_URL: base.VOICE_URL })).toBeNull();
    expect(readVoiceConfig({ VOICE_TOKEN: base.VOICE_TOKEN })).toBeNull();
    expect(readVoiceConfig({ ...base, VOICE_TOKEN: "   " })).toBeNull();
  });

  it("reads defaults and trims the address to its origin", () => {
    const config = readVoiceConfig({ ...base, VOICE_URL: "https://user:pw@192.0.2.10:8443/some/path?a=1" });
    expect(config?.baseUrl.href).toBe("https://192.0.2.10:8443/");
    expect(config).toMatchObject({
      ttsModel: "kokoro",
      sttModel: "Systran/faster-whisper-small",
      defaultVoice: "af_heart",
      timeoutMs: 60_000,
      caFile: null,
      proxyUrl: null,
      sttLanguage: null,
    });
    expect(config?.cacheMaxBytes).toBe(512 * 1024 * 1024);
  });

  it("requires https except for a loopback address", () => {
    expect(readVoiceConfig({ ...base, VOICE_URL: "http://192.0.2.10:8443" })).toBeNull();
    expect(readVoiceConfig({ ...base, VOICE_URL: "http://voice.example.com" })).toBeNull();
    expect(readVoiceConfig({ ...base, VOICE_URL: "ftp://192.0.2.10" })).toBeNull();
    expect(readVoiceConfig({ ...base, VOICE_URL: "not a url" })).toBeNull();
    expect(readVoiceConfig({ ...base, VOICE_URL: "http://127.0.0.1:8443" })).not.toBeNull();
    expect(readVoiceConfig({ ...base, VOICE_URL: "http://localhost:8443" })).not.toBeNull();
  });

  it("takes the certificate file, the proxy and the overrides from the environment", () => {
    const config = readVoiceConfig({
      ...base,
      VOICE_CA_FILE: "/voice/ca.pem",
      AI_PROXY_URL: "http://egress:3128",
      VOICE_STT_MODEL: "Systran/faster-whisper-base.en",
      VOICE_STT_LANGUAGE: "EN",
      VOICE_CACHE_MAX_MB: "8",
      VOICE_TIMEOUT_MS: "2500",
      VOICE_DEFAULT_VOICE: "bf_emma",
    });
    expect(config).toMatchObject({
      caFile: "/voice/ca.pem",
      proxyUrl: "http://egress:3128",
      sttModel: "Systran/faster-whisper-base.en",
      sttLanguage: "en",
      cacheMaxBytes: 8 * 1024 * 1024,
      timeoutMs: 2500,
      defaultVoice: "bf_emma",
    });
  });
});
