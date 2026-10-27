"use client";

// A small speaker button that reads a text aloud (hints, explanations, answers to follow-up
// questions). It shows only when the account has voice turned on and something can read: the
// voice server, or the browser's own voice when this device allows it. When voice is on but the
// server cannot be reached, a short note takes the button's place.
import { useId } from "react";

import { LoaderCircle, Square, Volume2 } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

import { readAloud, ReadAloudError, stopReadAloud, useReadAloudPhase } from "./read-aloud";
import { useVoice } from "./voice-store";
import { VoiceNote } from "./voice-note";

type PlayButtonProps = {
  text: string;
  /** What the button reads, for screen readers, for example "the hint". */
  what?: string;
  className?: string;
  /** Show the short "voice is away" note when voice is on but cannot be reached. */
  note?: boolean;
};

export const PlayButton = ({ text, what = "this text", className, note = true }: PlayButtonProps) => {
  const id = useId();
  const voice = useVoice();
  const phase = useReadAloudPhase(id);

  if (!voice.canSpeak) return note && voice.away ? <VoiceNote /> : null;

  const busy = phase !== "idle";
  const toggle = async () => {
    if (busy) return stopReadAloud();
    try {
      await readAloud(id, text);
    } catch (error) {
      toast.error(error instanceof ReadAloudError ? error.message : "The text could not be read aloud.");
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      // Enter here plays the sound only, it does not also check the answer (footer shortcut).
      onKeyDown={(event) => event.stopPropagation()}
      aria-label={busy ? `Stop reading ${what}` : `Read ${what} aloud`}
      title={busy ? "Stop" : "Read aloud"}
      className={cn(
        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sky-600 hover:bg-sky-100",
        className
      )}
    >
      {phase === "loading" ? (
        <LoaderCircle className="h-4 w-4 animate-spin" />
      ) : phase === "playing" ? (
        <Square className="h-3.5 w-3.5 fill-current" />
      ) : (
        <Volume2 className="h-4 w-4" />
      )}
    </button>
  );
};
