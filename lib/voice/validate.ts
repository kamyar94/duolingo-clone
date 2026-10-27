// Checks of what the voice routes accept: the text to speak, a voice name, a speed and the
// audio of a recording. These run before anything is sent to the gateway.
import { VoiceError } from "./errors";

/** Longest text one request may ask to be read aloud. */
export const MAX_SPEECH_CHARS = 3000;
/** Largest recording the transcription route accepts. */
export const MAX_AUDIO_BYTES = 6 * 1024 * 1024;
/** A recording shorter than this has nothing to transcribe. */
export const MIN_AUDIO_BYTES = 256;
export const MIN_SPEED = 0.5;
export const MAX_SPEED = 2;

/** The same pattern the voice settings form uses; "+" mixes voices in Kokoro. */
export const VOICE_NAME = /^[A-Za-z0-9_.+-]{1,64}$/;

export const isVoiceName = (value: unknown): value is string =>
  typeof value === "string" && VOICE_NAME.test(value);

export const clampSpeed = (value: unknown, fallback = 1) => {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.round(Math.min(MAX_SPEED, Math.max(MIN_SPEED, number)) * 100) / 100;
};

/** voice and speed are null when the request leaves them out (the account's settings apply). */
export type SpeechRequest = { text: string; voice: string | null; speed: number | null };

/** Validates the JSON body of the speech route. The text is cleaned for speech later. */
export const parseSpeechRequest = (body: unknown): SpeechRequest => {
  if (typeof body !== "object" || body === null || Array.isArray(body))
    throw new VoiceError("invalid", "Send { text }.");
  const { text, voice, speed } = body as Record<string, unknown>;
  if (typeof text !== "string" || !text.trim()) throw new VoiceError("invalid", "There is no text to read.");
  if (text.length > MAX_SPEECH_CHARS)
    throw new VoiceError("too-large", `The text is longer than ${MAX_SPEECH_CHARS} characters.`);
  if (voice !== undefined && voice !== null && voice !== "" && !isVoiceName(voice))
    throw new VoiceError("invalid", "That is not a voice name.");
  if (speed !== undefined && speed !== null) {
    const number = typeof speed === "number" ? speed : NaN;
    if (!Number.isFinite(number) || number < MIN_SPEED || number > MAX_SPEED)
      throw new VoiceError("invalid", `Speed must be between ${MIN_SPEED} and ${MAX_SPEED}.`);
  }
  return {
    text,
    voice: typeof voice === "string" && voice ? voice : null,
    speed: typeof speed === "number" ? clampSpeed(speed) : null,
  };
};

export type AudioKind = "webm" | "ogg" | "wav" | "mp4" | "mp3" | "aac" | "flac";

export const AUDIO_TYPES: Record<AudioKind, string> = {
  webm: "audio/webm",
  ogg: "audio/ogg",
  wav: "audio/wav",
  mp4: "audio/mp4",
  mp3: "audio/mpeg",
  aac: "audio/aac",
  flac: "audio/flac",
};

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, start + length));

/**
 * Recognizes the container of a recording from its first bytes, so the declared type is not
 * trusted: browsers record WebM or Ogg (Opus) or MP4 (Safari); WAV, MP3, AAC and FLAC are
 * accepted too. Returns null for anything else.
 */
export const sniffAudio = (bytes: Uint8Array): AudioKind | null => {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "webm";
  if (ascii(bytes, 0, 4) === "OggS") return "ogg";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WAVE") return "wav";
  if (ascii(bytes, 4, 4) === "ftyp") return "mp4";
  if (ascii(bytes, 0, 4) === "fLaC") return "flac";
  if (ascii(bytes, 0, 3) === "ID3") return "mp3";
  if (bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0) return "aac"; // ADTS frame header
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return "mp3"; // MPEG audio frame header
  return null;
};

/** A language code for the recording, or null. */
export const parseLanguage = (value: string | null): string | null => {
  const code = value?.trim().toLowerCase();
  return code && /^[a-z]{2,3}$/.test(code) ? code : null;
};
