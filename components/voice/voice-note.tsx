"use client";

// The short note that stands in for the voice controls when voice is on for the account but the
// voice server (the workstation) cannot be reached. It renders nothing otherwise.
import { VolumeX } from "lucide-react";

import { cn } from "@/lib/utils";

import { useVoice } from "./voice-store";

export const VoiceNote = ({ className }: { className?: string }) => {
  const voice = useVoice();
  if (!voice.away) return null;
  return (
    <span
      className={cn("inline-flex items-center gap-1 text-xs text-neutral-400", className)}
      title="The voice server is not reachable right now. Text and subtitles still work."
    >
      <VolumeX className="h-3.5 w-3.5" />
      Voice is away
    </span>
  );
};
