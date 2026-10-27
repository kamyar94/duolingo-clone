// The client of the voice gateway on the workstation (deploy/voice). It is the only code that
// talks to the gateway: HTTPS with the gateway's own certificate authority trusted from a file,
// the bearer token on every request, and the egress proxy when AI_PROXY_URL is set. Failures
// become VoiceError with a message that names neither the address nor the token. Server only.
import { readFileSync, statSync } from "node:fs";

import {
  Agent,
  FormData,
  ProxyAgent,
  fetch as undiciFetch,
  type Dispatcher,
} from "undici";

import type { VoiceConfig } from "./config";
import { VoiceError } from "./errors";
import { AUDIO_TYPES, type AudioKind } from "./validate";

/** Largest clip the gateway may send back; a text of 3000 characters is far below this. */
const MAX_CLIP_BYTES = 24 * 1024 * 1024;

// One dispatcher per (proxy, certificate file, its modification time), so replacing the
// certificate file takes effect without a restart.
let dispatcher: { key: string; agent: Dispatcher } | null = null;

const readCa = (caFile: string | null) => {
  if (!caFile) return { ca: undefined, stamp: "" };
  try {
    return { ca: readFileSync(caFile), stamp: String(statSync(caFile).mtimeMs) };
  } catch {
    throw new VoiceError("unreachable");
  }
};

const dispatcherFor = (config: VoiceConfig): Dispatcher => {
  const { ca, stamp } = readCa(config.caFile);
  const key = `${config.proxyUrl ?? ""}|${config.caFile ?? ""}|${stamp}`;
  if (dispatcher?.key === key) return dispatcher.agent;
  void dispatcher?.agent.close().catch(() => undefined);
  const tls = ca ? { ca } : {};
  const agent = config.proxyUrl
    ? new ProxyAgent({ uri: config.proxyUrl, requestTls: tls })
    : new Agent({ connect: tls });
  dispatcher = { key, agent };
  return agent;
};

// Log each failure code at most once a minute; the learner only sees a short sentence.
const lastLogged = new Map<string, number>();
const logFailure = (what: string) => {
  const now = Date.now();
  if ((lastLogged.get(what) ?? 0) + 60_000 > now) return;
  lastLogged.set(what, now);
  console.warn(`voice gateway: ${what}`);
};

const errorCode = (error: unknown): string => {
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause;
  const code = cause?.code ?? (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "unknown";
};

type GatewayReply = { status: number; headers: Headers; body: Buffer };

const readCapped = async (response: Awaited<ReturnType<typeof undiciFetch>>, max: number) => {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > max) throw new VoiceError("upstream");
  if (!response.body) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.byteLength;
    if (size > max) {
      throw new VoiceError("upstream");
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
};

/** One request to the gateway. Throws VoiceError when it cannot be completed. */
export const gatewayRequest = async (
  config: VoiceConfig,
  pathname: string,
  init: { method?: "GET" | "POST"; headers?: Record<string, string>; body?: string | FormData; timeoutMs?: number }
): Promise<GatewayReply> => {
  const url = new URL(pathname, config.baseUrl);
  const timeout = AbortSignal.timeout(init.timeoutMs ?? config.timeoutMs);

  let response;
  try {
    response = await undiciFetch(url, {
      method: init.method ?? "GET",
      headers: { authorization: `Bearer ${config.token}`, ...init.headers },
      body: init.body,
      signal: timeout,
      dispatcher: dispatcherFor(config),
    });
    const body = await readCapped(response, MAX_CLIP_BYTES);
    return { status: response.status, headers: response.headers as unknown as Headers, body };
  } catch (error) {
    if (error instanceof VoiceError) throw error;
    if (timeout.aborted) {
      logFailure("request timed out");
      throw new VoiceError("timeout");
    }
    logFailure(`connection failed (${errorCode(error)})`);
    throw new VoiceError("unreachable");
  }
};

/** Turns a gateway answer that is not a success into the VoiceError a route reports. */
const failure = (status: number): VoiceError => {
  if (status === 401 || status === 403) {
    logFailure("the token was refused (check VOICE_TOKEN)");
    return new VoiceError("rejected");
  }
  if (status === 502 || status === 503 || status === 504) return new VoiceError("unreachable");
  if (status === 413) return new VoiceError("too-large");
  logFailure(`unexpected status ${status}`);
  return new VoiceError("upstream");
};

export type SynthesisRequest = { text: string; voice: string; speed: number };

/** Text to speech: an MP3 clip of the text, made by Kokoro through the gateway. */
export const synthesize = async (config: VoiceConfig, request: SynthesisRequest): Promise<Buffer> => {
  const reply = await gatewayRequest(config, "/v1/audio/speech", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: config.ttsModel,
      input: request.text,
      voice: request.voice,
      response_format: "mp3",
      speed: request.speed,
      stream: false,
    }),
  });
  if (reply.status !== 200) throw failure(reply.status);
  if (reply.body.length < 64) throw new VoiceError("upstream");
  return reply.body;
};

export type TranscriptionRequest = { audio: Uint8Array; kind: AudioKind; language?: string | null };

/** Speech to text: the words of a recording, from Whisper through the gateway. */
export const transcribe = async (config: VoiceConfig, request: TranscriptionRequest): Promise<string> => {
  const form = new FormData();
  form.set("file", new Blob([request.audio as BlobPart], { type: AUDIO_TYPES[request.kind] }), `recording.${request.kind}`);
  form.set("model", config.sttModel);
  form.set("response_format", "json");
  const language = request.language ?? config.sttLanguage;
  if (language) form.set("language", language);

  const reply = await gatewayRequest(config, "/v1/audio/transcriptions", { method: "POST", body: form });
  if (reply.status === 400 || reply.status === 415 || reply.status === 422)
    throw new VoiceError("invalid", "The recording could not be read.");
  if (reply.status !== 200) throw failure(reply.status);

  try {
    const parsed = JSON.parse(reply.body.toString("utf8")) as { text?: unknown };
    return typeof parsed.text === "string" ? parsed.text.trim() : "";
  } catch {
    throw new VoiceError("upstream");
  }
};

export type GatewayHealth = { speech: boolean; transcription: boolean };

const probe = async (config: VoiceConfig, pathname: string) => {
  try {
    const reply = await gatewayRequest(config, pathname, { timeoutMs: 3000 });
    return reply.status === 200;
  } catch {
    return false;
  }
};

let health: { at: number; ttl: number; key: string; value: GatewayHealth } | null = null;

/**
 * Whether the gateway answers its two health checks. Remembered for 20 seconds when it works
 * and 5 seconds when it does not, so a page full of voice buttons does not poll the laptop.
 */
export const checkGateway = async (config: VoiceConfig, now = Date.now()): Promise<GatewayHealth> => {
  const key = config.baseUrl.href;
  if (health && health.key === key && now - health.at < health.ttl) return health.value;
  const [speech, transcription] = await Promise.all([
    probe(config, "/health"),
    probe(config, "/health/transcription"),
  ]);
  const value = { speech, transcription };
  health = { at: now, ttl: speech && transcription ? 20_000 : 5_000, key, value };
  return value;
};

/** Forgets the remembered health, for example after a request failed. */
export const forgetGatewayHealth = () => {
  health = null;
};
