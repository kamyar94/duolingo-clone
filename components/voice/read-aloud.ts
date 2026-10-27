"use client";

// Reading text aloud for the play buttons: one sound at a time on the page. The text goes to the
// voice server (/api/voice/speech) and the clip plays in an audio element; when the server is
// away and this device allows it, the browser's own speech synthesis reads it instead.
import { useSyncExternalStore } from "react";

import { speakable } from "@/lib/voice/speakable";

import { browserCanSpeak, markVoiceAway, voiceNow } from "./voice-store";

export type ReadAloudPhase = "idle" | "loading" | "playing";

type Active = { id: string; phase: ReadAloudPhase };

let active: Active | null = null;
let audio: HTMLAudioElement | null = null;
let token = 0;
let abort: AbortController | null = null;
const listeners = new Set<() => void>();

const emit = (next: Active | null) => {
  active = next;
  listeners.forEach((listener) => listener());
};

// Short clips are kept for replays: the same text with the same settings plays at once.
const clips = new Map<string, string>();
const MAX_CLIPS = 24;

const remember = (key: string, url: string) => {
  clips.set(key, url);
  while (clips.size > MAX_CLIPS) {
    const oldest = clips.keys().next().value as string;
    URL.revokeObjectURL(clips.get(oldest)!);
    clips.delete(oldest);
  }
};

export class ReadAloudError extends Error {
  constructor(
    message: string,
    readonly unavailable = false
  ) {
    super(message);
    this.name = "ReadAloudError";
  }
}

/** Fetches the clip for a text from the voice server, as an object URL. */
export const fetchSpeechClip = async (
  text: string,
  options: { signal?: AbortSignal; speed?: number } = {}
): Promise<string> => {
  const settings = voiceNow();
  const key = `${settings.voice ?? ""}|${options.speed ?? settings.speed}|${text}`;
  const known = clips.get(key);
  if (known) return known;

  let response: Response;
  try {
    response = await fetch("/api/voice/speech", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(options.speed === undefined ? { text } : { text, speed: options.speed }),
      signal: options.signal,
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ReadAloudError("Voice is not available right now.", true);
  }
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { error?: string; unavailable?: boolean } | null;
    throw new ReadAloudError(
      data?.error ?? "Voice is not available right now.",
      data?.unavailable === true || response.status === 503
    );
  }
  const url = URL.createObjectURL(await response.blob());
  remember(key, url);
  return url;
};

/** Stops whatever is playing. */
export const stopReadAloud = () => {
  token += 1;
  abort?.abort();
  abort = null;
  if (audio) {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }
  if (browserCanSpeak()) window.speechSynthesis.cancel();
  emit(null);
};

const speakWithBrowser = (id: string, text: string, myToken: number) => {
  const utterance = new SpeechSynthesisUtterance(speakable(text));
  utterance.rate = voiceNow().speed;
  utterance.onend = utterance.onerror = () => {
    if (token === myToken) emit(null);
  };
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
  emit({ id, phase: "playing" });
};

/**
 * Reads a text aloud for the button with this id. Resolves when playback has started; throws a
 * ReadAloudError with a sentence for the learner when nothing can read it.
 */
export const readAloud = async (id: string, text: string): Promise<void> => {
  stopReadAloud();
  const myToken = token;
  const voice = voiceNow();

  if (!voice.useGateway) {
    if (voice.canSpeak) return speakWithBrowser(id, text, myToken);
    throw new ReadAloudError("Voice is not available right now.", true);
  }

  emit({ id, phase: "loading" });
  abort = new AbortController();
  try {
    const url = await fetchSpeechClip(text, { signal: abort.signal });
    if (token !== myToken) return;
    audio ??= new Audio();
    audio.src = url;
    audio.onended = () => {
      if (token === myToken) emit(null);
    };
    await audio.play();
    if (token === myToken) emit({ id, phase: "playing" });
  } catch (error) {
    if (token !== myToken) return;
    emit(null);
    if (error instanceof ReadAloudError && error.unavailable) {
      markVoiceAway();
      if (voiceNow().canSpeak) return speakWithBrowser(id, text, myToken);
    }
    if (error instanceof DOMException && error.name === "NotAllowedError")
      throw new ReadAloudError("The browser blocked the sound. Tap the button again.");
    throw error instanceof Error ? error : new ReadAloudError("The text could not be read aloud.");
  }
};

/** The phase of the button with this id. */
export const useReadAloudPhase = (id: string): ReadAloudPhase =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => (active?.id === id ? active.phase : "idle"),
    () => "idle"
  );
