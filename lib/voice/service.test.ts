// The voice service against a stand-in gateway: clips are made once and kept, only new clips
// count against the generation limit, a missing gateway gives a clean "unavailable" error,
// recordings are checked before they leave the server, and the token never shows up in an error.
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { startForwardProxy, type ForwardProxy } from "@/tests/helpers/mock-http";
import { startMockGateway, type MockGateway } from "@/tests/helpers/mock-gateway";

import { readVoiceConfig, type VoiceConfig } from "./config";
import { VoiceError } from "./errors";
import { forgetGatewayHealth } from "./gateway";
import { speechGenerateLimiter, transcribeLimiter } from "./limits";
import { speakClip, transcribeRecording, voiceAvailability } from "./service";

let gateway: MockGateway;
let dataDir: string;

const configFor = (overrides: Record<string, string> = {}): VoiceConfig => {
  const config = readVoiceConfig({
    VOICE_URL: gateway.url,
    VOICE_TOKEN: gateway.token,
    VOICE_DATA_DIR: dataDir,
    ...overrides,
  });
  if (!config) throw new Error("test configuration is invalid");
  return config;
};

const webm = () => Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(600, 1)]);

const failure = async (work: Promise<unknown>) => {
  try {
    await work;
  } catch (error) {
    expect(error).toBeInstanceOf(VoiceError);
    return error as VoiceError;
  }
  throw new Error("expected a VoiceError");
};

beforeAll(async () => {
  gateway = await startMockGateway();
});
afterAll(async () => {
  await gateway.close();
});
beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "lingo-voice-service-"));
  gateway.calls.length = 0;
  gateway.failWith(0);
  gateway.delay(0);
  speechGenerateLimiter.reset();
  transcribeLimiter.reset();
  forgetGatewayHealth();
});
afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe("speakClip", () => {
  it("asks the gateway once for a text and serves repeats from the stored clip", async () => {
    const config = configFor();
    const request = { userId: "u1", text: "Divide both sides by v.", voice: null, speed: 1 };

    const first = await speakClip(config, request);
    expect(first.cached).toBe(false);
    expect(first.bytes.toString("latin1")).toContain("af_heart|1|Divide both sides by v.");

    const second = await speakClip(config, request);
    expect(second.cached).toBe(true);
    expect(second.key).toBe(first.key);
    expect(gateway.count("/v1/audio/speech")).toBe(1);

    // Another account gets the same stored clip.
    const other = await speakClip(config, { ...request, userId: "u2" });
    expect(other.cached).toBe(true);
    expect(gateway.count("/v1/audio/speech")).toBe(1);
  });

  it("sends the token, the model, the voice and the speed, and the spoken form of the text", async () => {
    await speakClip(configFor(), {
      userId: "u1",
      text: "So $t = \\frac{d}{v}$.",
      voice: "bf_emma",
      speed: 1.25,
    });
    const call = gateway.calls.find((c) => c.path === "/v1/audio/speech");
    expect(call?.authorization).toBe(`Bearer ${gateway.token}`);
    expect(JSON.parse(call!.body.toString())).toMatchObject({
      model: "kokoro",
      voice: "bf_emma",
      speed: 1.25,
      response_format: "mp3",
      input: "So t equals d over v.",
    });
  });

  it("makes a new clip when the text, the voice or the speed changes", async () => {
    const config = configFor();
    const base = { userId: "u1", text: "Same words.", voice: null, speed: 1 };
    await speakClip(config, base);
    await speakClip(config, { ...base, text: "Other words." });
    await speakClip(config, { ...base, voice: "am_adam" });
    await speakClip(config, { ...base, speed: 1.5 });
    expect(gateway.count("/v1/audio/speech")).toBe(4);
  });

  it("makes one clip for simultaneous requests", async () => {
    gateway.delay(40);
    const config = configFor();
    const request = { userId: "u1", text: "Both at once.", voice: null, speed: 1 };
    await Promise.all([speakClip(config, request), speakClip(config, request), speakClip(config, request)]);
    expect(gateway.count("/v1/audio/speech")).toBe(1);
  });

  it("refuses text with nothing to say", async () => {
    const error = await failure(speakClip(configFor(), { userId: "u1", text: "```\ncode\n```", voice: null, speed: 1 }));
    expect(error.status).toBe(400);
    expect(gateway.calls).toHaveLength(0);
  });

  it("counts only new clips against the account's limit", async () => {
    const config = configFor();
    for (let n = 0; n < 20; n++)
      await speakClip(config, { userId: "busy", text: `Clip number ${n}.`, voice: null, speed: 1 });
    // Stored clips are free however often they are played...
    for (let n = 0; n < 30; n++)
      await speakClip(config, { userId: "busy", text: "Clip number 3.", voice: null, speed: 1 });
    // ...but the twenty-first new clip in a minute is refused.
    const error = await failure(
      speakClip(config, { userId: "busy", text: "One more new clip.", voice: null, speed: 1 })
    );
    expect(error.status).toBe(429);
    expect(error.retryAfter).toBeGreaterThan(0);
    // Another account is not affected.
    await speakClip(config, { userId: "calm", text: "One more new clip.", voice: null, speed: 1 });
  });

  it("answers 503 when the gateway cannot be reached, without naming it", async () => {
    const away = await startMockGateway();
    const config = configFor({ VOICE_URL: away.url, VOICE_TOKEN: away.token });
    await away.close();
    const error = await failure(speakClip(config, { userId: "u1", text: "Hello.", voice: null, speed: 1 }));
    expect(error.status).toBe(503);
    expect(error.unavailable).toBe(true);
    expect(error.message).not.toContain("127.0.0.1");
    expect(error.message).not.toContain(away.token);
  });

  it("answers 503 for a refused token and for a failing gateway, 502 for other failures", async () => {
    const wrongToken = configFor({ VOICE_TOKEN: "w".repeat(48) });
    const refused = await failure(speakClip(wrongToken, { userId: "u1", text: "Hello.", voice: null, speed: 1 }));
    expect(refused.status).toBe(503);
    expect(refused.kind).toBe("rejected");
    expect(refused.message).not.toContain("w".repeat(48));

    gateway.failWith(503);
    const down = await failure(speakClip(configFor(), { userId: "u1", text: "Hello.", voice: null, speed: 1 }));
    expect(down.status).toBe(503);

    gateway.failWith(500);
    const broken = await failure(speakClip(configFor(), { userId: "u1", text: "Hello again.", voice: null, speed: 1 }));
    expect(broken.status).toBe(502);
  });

  it("times out instead of waiting for ever", async () => {
    gateway.delay(400);
    const error = await failure(
      speakClip(configFor({ VOICE_TIMEOUT_MS: "100" }), { userId: "u1", text: "Slow.", voice: null, speed: 1 })
    );
    expect(error.kind).toBe("timeout");
    expect(error.status).toBe(503);
  });

  it("sends requests through the egress proxy when one is set", async () => {
    const proxy: ForwardProxy = await startForwardProxy();
    try {
      const config = configFor({ AI_PROXY_URL: proxy.url });
      await speakClip(config, { userId: "u1", text: "Through the proxy.", voice: null, speed: 1 });
      expect(proxy.seen.some((seen) => seen.includes("/v1/audio/speech"))).toBe(true);
      expect(gateway.count("/v1/audio/speech")).toBe(1);
    } finally {
      await proxy.close();
    }
  });
});

describe("transcribeRecording", () => {
  it("sends a recording as a form with the model and returns the trimmed text", async () => {
    gateway.transcript("why does the sign change");
    const text = await transcribeRecording(configFor(), { userId: "u1", audio: webm() });
    expect(text).toBe("why does the sign change");
    const call = gateway.calls.find((c) => c.path === "/v1/audio/transcriptions");
    expect(call?.authorization).toBe(`Bearer ${gateway.token}`);
    const body = call!.body.toString("latin1");
    expect(body).toContain('name="model"');
    expect(body).toContain("Systran/faster-whisper-small");
    expect(body).toContain('name="file"; filename="recording.webm"');
    expect(body).not.toContain('name="language"');
  });

  it("passes a language when one is given", async () => {
    await transcribeRecording(configFor(), { userId: "u1", audio: webm(), language: "fa" });
    const body = gateway.calls.find((c) => c.path === "/v1/audio/transcriptions")!.body.toString("latin1");
    expect(body).toContain('name="language"');
  });

  it("checks size, emptiness and content before anything leaves the server", async () => {
    const config = configFor();
    const big = Buffer.concat([webm(), Buffer.alloc(6 * 1024 * 1024)]);
    expect((await failure(transcribeRecording(config, { userId: "u1", audio: big }))).status).toBe(413);
    expect((await failure(transcribeRecording(config, { userId: "u1", audio: new Uint8Array(10) }))).status).toBe(400);
    const html = Buffer.from("<html><body>".padEnd(600, "x"));
    expect((await failure(transcribeRecording(config, { userId: "u1", audio: html }))).status).toBe(400);
    expect(gateway.calls).toHaveLength(0);
  });

  it("limits recordings per account", async () => {
    const config = configFor();
    for (let n = 0; n < 10; n++) await transcribeRecording(config, { userId: "talker", audio: webm() });
    const error = await failure(transcribeRecording(config, { userId: "talker", audio: webm() }));
    expect(error.status).toBe(429);
    await transcribeRecording(config, { userId: "quiet", audio: webm() });
  });

  it("answers 503 when the gateway is away", async () => {
    gateway.failWith(502);
    const error = await failure(transcribeRecording(configFor(), { userId: "u1", audio: webm() }));
    expect(error.status).toBe(503);
  });
});

describe("voiceAvailability", () => {
  it("is not configured without settings", async () => {
    expect(await voiceAvailability(null)).toEqual({ configured: false, speech: false, transcription: false });
  });

  it("reports both services when the gateway answers", async () => {
    expect(await voiceAvailability(configFor())).toEqual({ configured: true, speech: true, transcription: true });
  });

  it("reports both as away when the gateway does not answer, and remembers that briefly", async () => {
    gateway.failWith(503);
    expect(await voiceAvailability(configFor())).toEqual({ configured: true, speech: false, transcription: false });
    const calls = gateway.calls.length;
    await voiceAvailability(configFor());
    expect(gateway.calls.length).toBe(calls);
  });
});
