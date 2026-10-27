"use client";

// Hold to talk: the learner presses and holds the microphone button while speaking, the
// recording goes to /api/voice/transcribe on release, and the words are handed to the page to
// put in the text field. Nothing is sent on from here; the learner checks the text first.
// Pointer events cover mouse, touch and pen; Space and Enter work for the keyboard.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { LoaderCircle, Mic } from "lucide-react";

import { cn } from "@/lib/utils";

import { markVoiceAway, useVoice } from "./voice-store";

const MAX_SECONDS = 60;
const MIN_MS = 500;

type Phase = "idle" | "starting" | "recording" | "sending";

const recorderType = () => {
  if (typeof MediaRecorder === "undefined") return undefined;
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((type) =>
    MediaRecorder.isTypeSupported(type)
  );
};

type MicButtonProps = {
  /** Receives the transcript. The page puts it in a text field for the learner to check. */
  onTranscript: (text: string) => void;
  disabled?: boolean;
  className?: string;
};

export const MicButton = ({ onTranscript, disabled, className }: MicButtonProps) => {
  const voice = useVoice();
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const holding = useRef(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  const release = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      holding.current = false;
      const active = recorder.current;
      if (active && active.state !== "inactive") {
        active.onstop = null;
        active.stop();
      }
      release();
    };
  }, [release]);

  const send = useCallback(
    async (blob: Blob) => {
      setPhase("sending");
      try {
        const response = await fetch("/api/voice/transcribe", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": blob.type || "audio/webm" },
          body: blob,
        });
        const data = (await response.json().catch(() => null)) as
          | { text?: string; error?: string; unavailable?: boolean }
          | null;
        if (!alive.current) return;
        if (!response.ok) {
          if (data?.unavailable || response.status === 503) markVoiceAway();
          setMessage(data?.error ?? "The recording could not be turned into text.");
        } else if (!data?.text) {
          setMessage("Nothing was heard. Hold the button and speak, then let go.");
        } else {
          setMessage(null);
          onTranscript(data.text);
        }
      } catch {
        if (alive.current) setMessage("The server could not be reached. Check the connection.");
      } finally {
        if (alive.current) setPhase("idle");
      }
    },
    [onTranscript]
  );

  const stop = useCallback(() => {
    holding.current = false;
    const active = recorder.current;
    if (active && active.state === "recording") active.stop();
  }, []);

  const start = useCallback(async () => {
    if (phase !== "idle" || disabled) return;
    holding.current = true;
    setMessage(null);
    setPhase("starting");
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      if (!alive.current) return media.getTracks().forEach((track) => track.stop());
      stream.current = media;
      const type = recorderType();
      const active = new MediaRecorder(media, type ? { mimeType: type } : undefined);
      recorder.current = active;
      chunks.current = [];
      active.ondataavailable = (event) => {
        if (event.data.size) chunks.current.push(event.data);
      };
      active.onstop = () => {
        const elapsed = Date.now() - startedAt.current;
        const blob = new Blob(chunks.current, { type: active.mimeType || type || "audio/webm" });
        release();
        recorder.current = null;
        if (!alive.current) return;
        if (elapsed < MIN_MS || blob.size < 1200) {
          setPhase("idle");
          setMessage("Hold the button while you speak, then let go.");
          return;
        }
        void send(blob);
      };
      startedAt.current = Date.now();
      active.start();
      setPhase("recording");
      timer.current = setTimeout(stop, MAX_SECONDS * 1000);
      // Let go while the microphone was still starting.
      if (!holding.current) stop();
    } catch (error) {
      release();
      if (!alive.current) return;
      setPhase("idle");
      setMessage(
        error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError")
          ? "The microphone is blocked for this site. Allow it in the browser's site settings."
          : "No microphone could be started."
      );
    }
  }, [disabled, phase, release, send, stop]);

  if (!voice.canListen) return null;

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // A pointer that is no longer active cannot be captured; releasing still ends the talk.
    }
    void start();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    // Enter here must not also check the answer (footer shortcut).
    event.stopPropagation();
    if ((event.key === " " || event.key === "Enter") && !event.repeat) {
      event.preventDefault();
      void start();
    }
  };

  const recording = phase === "recording" || phase === "starting";

  return (
    <div className={cn("flex flex-col items-center gap-1", className)}>
      <button
        type="button"
        disabled={disabled || phase === "sending"}
        onPointerDown={onPointerDown}
        onPointerUp={stop}
        onPointerCancel={stop}
        onLostPointerCapture={stop}
        onContextMenu={(event) => event.preventDefault()}
        onKeyDown={onKeyDown}
        onKeyUp={(event) => {
          if (event.key === " " || event.key === "Enter") stop();
        }}
        onBlur={stop}
        aria-label="Hold to speak your question"
        aria-pressed={recording}
        title="Hold to speak"
        className={cn(
          "flex h-10 w-10 shrink-0 touch-none select-none items-center justify-center rounded-lg border-2 [-webkit-touch-callout:none]",
          recording
            ? "border-rose-400 bg-rose-500 text-white motion-safe:animate-pulse"
            : "border-slate-200 bg-white text-sky-600 hover:bg-sky-50 disabled:opacity-50"
        )}
      >
        {phase === "sending" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
      </button>
      <span aria-live="polite" className="max-w-[12rem] text-center text-[11px] leading-tight text-neutral-500">
        {phase === "recording"
          ? "Listening. Let go to finish."
          : phase === "sending"
            ? "Turning it into text..."
            : (message ?? "")}
      </span>
    </div>
  );
};
