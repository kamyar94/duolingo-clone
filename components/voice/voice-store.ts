"use client";

// What the browser knows about voice: the account's voice settings, whether the voice server
// can be reached right now, and the per-device choice to fall back to the browser's own speech
// synthesis. One small store shared by every voice button on the page, filled from
// /api/voice/status. Controls stay hidden until the first answer is in.
import { useEffect, useSyncExternalStore } from "react";

export type VoiceState = {
  /** The first answer from the server has arrived. */
  loaded: boolean;
  /** The server has a voice gateway set up at all. */
  configured: boolean;
  /** The gateway can make speech right now. */
  speech: boolean;
  /** The gateway can transcribe right now. */
  transcription: boolean;
  /** The account's settings. */
  enabled: boolean;
  voice: string | null;
  speed: number;
  /** This device may read aloud with the browser's own voice when the gateway is away. */
  browserFallback: boolean;
};

const FALLBACK_KEY = "lingo.voice.browserFallback";
const STALE_AFTER_MS = 30_000;

const readFallback = () => {
  try {
    return window.localStorage.getItem(FALLBACK_KEY) === "1";
  } catch {
    return false;
  }
};

const INITIAL: VoiceState = {
  loaded: false,
  configured: false,
  speech: false,
  transcription: false,
  enabled: false,
  voice: null,
  speed: 1,
  browserFallback: false,
};

let state: VoiceState = INITIAL;
let fetchedAt = 0;
let inflight: Promise<void> | null = null;
let fallbackRead = false;
const listeners = new Set<() => void>();

const set = (next: Partial<VoiceState>) => {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Asks the server again (at most every 30 seconds unless forced). */
export const refreshVoice = (force = false): Promise<void> => {
  if (typeof window === "undefined") return Promise.resolve();
  if (!fallbackRead) {
    fallbackRead = true;
    set({ browserFallback: readFallback() });
  }
  if (inflight) return inflight;
  if (!force && state.loaded && Date.now() - fetchedAt < STALE_AFTER_MS) return Promise.resolve();

  inflight = (async () => {
    try {
      const response = await fetch("/api/voice/status", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error("status");
      const data = (await response.json()) as {
        configured: boolean;
        speech: boolean;
        transcription: boolean;
        settings: { enabled: boolean; voice: string | null; speed: number };
      };
      fetchedAt = Date.now();
      set({
        loaded: true,
        configured: !!data.configured,
        speech: !!data.speech,
        transcription: !!data.transcription,
        enabled: !!data.settings?.enabled,
        voice: data.settings?.voice ?? null,
        speed: typeof data.settings?.speed === "number" ? data.settings.speed : 1,
      });
    } catch {
      // Signed out, offline or a server error: voice stays off, and the next mount asks again.
      fetchedAt = Date.now() - STALE_AFTER_MS + 5_000;
      set({ loaded: true, configured: false, speech: false, transcription: false, enabled: false });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
};

/** A request found the voice server away: hide its controls until the next check. */
export const markVoiceAway = () => {
  fetchedAt = Date.now() - STALE_AFTER_MS + 8_000;
  set({ speech: false, transcription: false });
};

export const setBrowserFallback = (on: boolean) => {
  try {
    window.localStorage.setItem(FALLBACK_KEY, on ? "1" : "0");
  } catch {
    // The choice then lasts until the page closes.
  }
  set({ browserFallback: on });
};

export const browserCanSpeak = () =>
  typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;

export const browserCanRecord = () =>
  typeof navigator !== "undefined" &&
  !!navigator.mediaDevices?.getUserMedia &&
  typeof MediaRecorder !== "undefined";

export type Voice = VoiceState & {
  /** Something can read aloud: the gateway, or the browser when the learner allows it. */
  canSpeak: boolean;
  /** The gateway can make the clips (as opposed to the browser's own voice). */
  useGateway: boolean;
  /** A hold-to-talk button can work. */
  canListen: boolean;
  /** Voice is on for this account and set up on the server, but cannot be reached. */
  away: boolean;
};

const derive = (current: VoiceState): Voice => {
  const live = current.loaded && current.enabled;
  const useGateway = live && current.speech;
  return {
    ...current,
    useGateway,
    canSpeak: useGateway || (live && current.browserFallback && browserCanSpeak()),
    canListen: live && current.transcription && browserCanRecord(),
    away: live && current.configured && !current.speech,
  };
};

let derived: { source: VoiceState; value: Voice } | null = null;
const snapshot = (): Voice => {
  if (!derived || derived.source !== state) derived = { source: state, value: derive(state) };
  return derived.value;
};
const serverSnapshot = (): Voice => derive(INITIAL);
let serverValue: Voice | null = null;
const cachedServerSnapshot = () => (serverValue ??= serverSnapshot());

/** The voice state, refreshed when a component using it mounts. */
export const useVoice = (): Voice => {
  useEffect(() => {
    void refreshVoice();
  }, []);
  return useSyncExternalStore(subscribe, snapshot, cachedServerSnapshot);
};

/** The current state outside React (event handlers). */
export const voiceNow = (): Voice => snapshot();
