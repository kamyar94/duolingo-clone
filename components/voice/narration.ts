"use client";

// Narration for the solution player (docs/DESIGN-coding-and-math.md, sections 5.5 and 6.4).
//
// The animation is drawn from a clock (components/math/solution/use-playback.ts), and the
// narration follows that clock instead of driving it: when a step starts, its clip starts; when
// the learner drags the handle, the clip of the new step starts at the matching offset; pause
// pauses the clip. A clip that is longer than its step holds the clock just before the step's
// end until it has finished, so the picture never moves on while a sentence is still being
// said. A step whose clip is shorter than the step simply has a quiet end.
//
// Clips come from the voice server, one per step, from /api/voice/narration (made once and kept
// on the server). When the server is away and this device allows it, the browser's own voice
// reads the step instead.
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";

import type { Timeline } from "@/lib/math/solution/timeline";
import { speakable } from "@/lib/voice/speakable";

import { markVoiceAway, voiceNow, useVoice } from "./voice-store";

export type NarrationSource =
  /** A saved solution: clips are made and kept by the server. */
  | { kind: "saved"; challengeId: number; version: number }
  /** An unsaved script in author mode: clips are made from the text on request. */
  | { kind: "preview" };

export type NarrationPhase = "idle" | "loading" | "playing";

// A silent half-second WAV. Playing it from a tap unlocks the audio element on iOS, which
// otherwise refuses to start sound that a timer (not a tap) asks for.
const SILENCE =
  "data:audio/wav;base64,UklGRjQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YRAAAACAgICAgICAgICAgICAgICA";

class ClipError extends Error {
  constructor(
    message: string,
    readonly unavailable: boolean
  ) {
    super(message);
  }
}

type ControllerOptions = {
  texts: (string | null)[];
  source: NarrationSource;
  onPhase: (index: number, phase: NarrationPhase) => void;
};

export class NarrationController {
  private audio: HTMLAudioElement | null = null;
  private readonly clips = new Map<number, Promise<string>>();
  private token = 0;
  private rate = 1;
  private paused = false;
  private live = false;
  private resumeStart: (() => void) | null = null;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private browserSpeaking = false;

  constructor(private readonly options: ControllerOptions) {}

  setRate(rate: number) {
    this.rate = Math.min(3, Math.max(0.5, rate));
    if (this.audio) {
      this.audio.defaultPlaybackRate = this.rate;
      this.audio.playbackRate = this.rate;
    }
  }

  /** Call from a tap or click so the browser lets later clips start by themselves. */
  unlock() {
    this.audio ??= new Audio();
    if (this.live) return;
    this.audio.src = SILENCE;
    void this.audio.play().catch(() => undefined);
  }

  private async fetchClip(index: number): Promise<string> {
    const { source, texts } = this.options;
    const text = texts[index];
    if (!text) throw new ClipError("This step has no narration.", false);
    let response: Response;
    try {
      response =
        source.kind === "saved"
          ? await fetch(`/api/voice/narration/${source.challengeId}/${index}?version=${source.version}`, {
              credentials: "same-origin",
            })
          : await fetch("/api/voice/speech", {
              method: "POST",
              credentials: "same-origin",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ text, speed: 1 }),
            });
    } catch {
      throw new ClipError("Voice is not available right now.", true);
    }
    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { error?: string; unavailable?: boolean } | null;
      throw new ClipError(data?.error ?? "Voice is not available right now.", data?.unavailable === true);
    }
    return URL.createObjectURL(await response.blob());
  }

  private clip(index: number): Promise<string> {
    let promise = this.clips.get(index);
    if (!promise) {
      promise = this.fetchClip(index);
      this.clips.set(index, promise);
      promise.catch(() => this.clips.delete(index));
    }
    return promise;
  }

  /** Starts fetching the clip of a step ahead of time. */
  prefetch(index: number) {
    if (index < 0 || index >= this.options.texts.length || !this.options.texts[index]) return;
    this.clip(index).catch(() => undefined);
  }

  private arm(ms: number, token: number, index: number) {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => {
      if (token === this.token) this.finish(index, token);
    }, ms);
  }

  private finish(index: number, token: number) {
    if (token !== this.token) return;
    // A clip that arrives after this point is too late and must not start.
    this.token += 1;
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = null;
    this.live = false;
    this.browserSpeaking = false;
    this.resumeStart = null;
    this.options.onPhase(index, "idle");
  }

  private silence() {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = null;
    this.live = false;
    this.resumeStart = null;
    if (this.audio) {
      this.audio.onended = this.audio.onerror = this.audio.onloadedmetadata = null;
      this.audio.pause();
    }
    if (this.browserSpeaking && typeof window !== "undefined") window.speechSynthesis.cancel();
    this.browserSpeaking = false;
  }

  /** Plays the narration of a step from an offset (seconds into the step). */
  async play(index: number, offset: number) {
    const token = ++this.token;
    this.silence();
    this.paused = false;
    const text = this.options.texts[index];
    const voice = voiceNow();
    if (!text || !voice.enabled) return this.options.onPhase(index, "idle");

    if (voice.useGateway) {
      this.options.onPhase(index, "loading");
      this.arm(15_000, token, index);
      try {
        const url = await this.clip(index);
        if (token !== this.token) return;
        const start = () => this.startClip(url, offset, token, index);
        if (this.paused) this.resumeStart = start;
        else await start();
        return;
      } catch (error) {
        if (token !== this.token) return;
        if (error instanceof ClipError && error.unavailable) markVoiceAway();
      }
    }

    if (voiceNow().canSpeak) return this.startBrowser(text, offset, token, index);
    this.finish(index, token);
  }

  private async startClip(url: string, offset: number, token: number, index: number) {
    const audio = (this.audio ??= new Audio());
    audio.onended = () => this.finish(index, token);
    audio.onerror = () => this.finish(index, token);
    audio.src = url;
    audio.defaultPlaybackRate = this.rate;
    audio.playbackRate = this.rate;
    await new Promise<void>((resolve) => {
      if (audio.readyState >= 1) return resolve();
      audio.onloadedmetadata = () => resolve();
      setTimeout(resolve, 4000);
    });
    if (token !== this.token) return;
    audio.playbackRate = this.rate;
    if (offset > 0.05) {
      // Dragged into the quiet end of a step: nothing is left to say.
      if (!Number.isFinite(audio.duration) || offset >= audio.duration - 0.1) return this.finish(index, token);
      audio.currentTime = offset;
    }
    try {
      await audio.play();
    } catch {
      // The browser refused to start sound without a tap; the subtitles carry on.
      return this.finish(index, token);
    }
    if (token !== this.token) return;
    this.live = true;
    this.options.onPhase(index, "playing");
    const remaining = Number.isFinite(audio.duration) ? (audio.duration - audio.currentTime) / this.rate : 30;
    this.arm((remaining + 3) * 1000, token, index);
  }

  private startBrowser(text: string, offset: number, token: number, index: number) {
    if (offset > 1) return this.finish(index, token); // the browser's voice cannot start mid-sentence
    const utterance = new SpeechSynthesisUtterance(speakable(text));
    utterance.rate = this.rate;
    utterance.onend = utterance.onerror = () => this.finish(index, token);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    this.browserSpeaking = true;
    this.live = true;
    this.options.onPhase(index, "playing");
    this.arm(Math.max(10, (text.length / 12 / this.rate) * 1.5 + 5) * 1000, token, index);
  }

  /** The animation paused. */
  pause() {
    this.paused = true;
    if (this.audio && this.live) this.audio.pause();
    if (this.browserSpeaking) window.speechSynthesis.pause();
  }

  /** The animation continues. Does nothing when this step's clip already finished. */
  resume() {
    if (!this.paused) return;
    this.paused = false;
    if (this.resumeStart) {
      const start = this.resumeStart;
      this.resumeStart = null;
      void start();
    } else if (this.browserSpeaking) window.speechSynthesis.resume();
    else if (this.audio && this.live) void this.audio.play().catch(() => undefined);
  }

  stop() {
    this.token += 1;
    const index = -1;
    this.silence();
    this.paused = false;
    this.options.onPhase(index, "idle");
  }

  dispose() {
    this.stop();
    for (const promise of this.clips.values()) promise.then((url) => URL.revokeObjectURL(url), () => undefined);
    this.clips.clear();
    if (this.audio) {
      this.audio.removeAttribute("src");
      this.audio = null;
    }
  }
}

type UseNarrationOptions = {
  source: NarrationSource | null | undefined;
  timeline: Timeline;
  step: number;
  /** The clock, read when a clip starts to find the offset into the step. */
  time: number;
  playing: boolean;
  speed: number;
  seekEpoch: number;
  /** Set by the narration to keep the clock from leaving a step before its clip has finished. */
  holdRef: MutableRefObject<number | null>;
};

export const useNarration = ({
  source,
  timeline,
  step,
  time,
  playing,
  speed,
  seekEpoch,
  holdRef,
}: UseNarrationOptions) => {
  const voice = useVoice();
  const [on, setOn] = useState(true);
  const [phase, setPhase] = useState<NarrationPhase>("idle");
  const controller = useRef<NarrationController | null>(null);
  const lastKey = useRef("");
  const timeRef = useRef(time);
  // Declared before the effects that read it, so it is current when they run.
  useEffect(() => {
    timeRef.current = time;
  });

  const texts = useMemo(
    () => timeline.steps.map((timed) => timed.step.narration?.trim() || null),
    [timeline]
  );
  const hasNarration = texts.some(Boolean);
  const sourceKey = source ? (source.kind === "saved" ? `${source.challengeId}:${source.version}` : "preview") : "";
  const available = !!source && hasNarration && voice.canSpeak;
  const active = available && on;

  useEffect(() => {
    if (!source || !hasNarration) return;
    const created = new NarrationController({
      texts,
      source,
      onPhase: (index, next) => {
        // Hold the clock just before the end of the step whose clip is still being said.
        holdRef.current = next !== "idle" && index >= 0 ? timeline.steps[index].end - 0.02 : null;
        setPhase(next);
      },
    });
    controller.current = created;
    lastKey.current = "";
    return () => {
      created.dispose();
      controller.current = null;
      holdRef.current = null;
    };
    // `source` is captured through its key so a new object with the same content keeps the controller.
  }, [sourceKey, texts, timeline, hasNarration, holdRef]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    controller.current?.setRate(speed * voice.speed);
  }, [speed, voice.speed, sourceKey, texts]);

  // Fetch the next clips while the current one plays (saved solutions only; an author's preview
  // makes a clip only when it is played, so typing does not start a stream of requests).
  useEffect(() => {
    if (!active || source?.kind !== "saved") return;
    controller.current?.prefetch(step);
    controller.current?.prefetch(step + 1);
  }, [active, source?.kind, step, sourceKey, texts]);

  // Follow the clock.
  useEffect(() => {
    const current = controller.current;
    if (!current) return;
    if (!active) {
      current.stop();
      lastKey.current = "";
      return;
    }
    if (!playing) {
      current.pause();
      return;
    }
    const key = `${step}:${seekEpoch}`;
    if (key === lastKey.current) {
      current.resume();
      return;
    }
    lastKey.current = key;
    const offset = Math.max(0, timeRef.current - (timeline.steps[step]?.start ?? 0));
    void current.play(step, offset);
  }, [active, playing, step, seekEpoch, timeline, sourceKey, texts]);

  const unlock = useCallback(() => controller.current?.unlock(), []);
  const hearStep = useCallback(() => {
    controller.current?.unlock();
    void controller.current?.play(step, 0);
  }, [step]);

  return {
    /** Voice is on and something can read the narration here. */
    available,
    on,
    setOn,
    phase,
    unlock,
    hearStep,
    hasStepNarration: !!texts[step],
    /** Voice is on for the account, but the server cannot be reached. */
    away: voice.away && !!source && hasNarration,
  };
};
