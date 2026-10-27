"use client";

// Pieces of the voice section of the settings page (components/settings/ai-settings.tsx): the
// state of the voice server, the per-device switch for the browser's own voice, a sample button
// and the list of voice names the text field suggests.
import { useId, useState } from "react";

import { LoaderCircle, Play } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { ReadAloudError } from "./read-aloud";
import { browserCanSpeak, markVoiceAway, refreshVoice, setBrowserFallback, useVoice } from "./voice-store";

/** Voices that ship with Kokoro; the field accepts any name the voice server knows. */
export const KOKORO_VOICES = [
  "af_heart", "af_bella", "af_nicole", "af_sarah", "af_sky", "af_alloy", "af_nova",
  "am_adam", "am_michael", "am_eric", "am_liam", "bf_emma", "bf_isabella", "bf_alice",
  "bm_george", "bm_lewis", "bm_daniel",
];

export const VoiceNames = ({ id }: { id: string }) => (
  <datalist id={id}>
    {KOKORO_VOICES.map((name) => (
      <option key={name} value={name} />
    ))}
  </datalist>
);

/** One sentence about whether the voice server answers right now. */
export const VoiceStatusLine = () => {
  const voice = useVoice();
  // useVoice only fills the store after the first answer; the settings page asks again on every visit.
  const text = !voice.loaded
    ? "Checking the voice server..."
    : !voice.configured
      ? "This server has no voice server set up, so only the browser's own voice is available."
      : voice.speech && voice.transcription
        ? "The voice server is reachable. Reading aloud and spoken questions are available."
        : voice.speech
          ? "The voice server is reachable, but spoken questions are not available right now."
          : "The voice server is away right now (the workstation may be off or asleep). Text and subtitles still work.";
  return (
    <p className="flex items-center gap-2 text-sm text-neutral-600" aria-live="polite">
      <span
        className={`inline-block h-2.5 w-2.5 rounded-full ${
          voice.loaded && voice.configured && voice.speech ? "bg-green-500" : "bg-neutral-300"
        }`}
        aria-hidden
      />
      {text}
      <button type="button" onClick={() => void refreshVoice(true)} className="font-bold text-sky-600 hover:underline">
        Check again
      </button>
    </p>
  );
};

/** The choice, kept in this browser only, to read aloud with the browser's voice when the server is away. */
export const BrowserFallbackToggle = () => {
  const voice = useVoice();
  const id = useId();
  if (typeof window !== "undefined" && !browserCanSpeak()) return null;
  return (
    <label htmlFor={id} className="flex items-center gap-x-3 text-neutral-700">
      <input
        id={id}
        type="checkbox"
        checked={voice.browserFallback}
        onChange={(event) => setBrowserFallback(event.target.checked)}
        className="h-5 w-5 accent-green-500"
      />
      <span>
        Use this browser&apos;s own voice to read aloud when the voice server is away
        <span className="block text-xs text-neutral-500">Saved on this device only. The browser&apos;s voice sounds different on each device.</span>
      </span>
    </label>
  );
};

/** Plays a short sentence in the voice and speed currently set in the form. */
export const VoiceSampleButton = ({ voice: name, speed }: { voice: string; speed: number }) => {
  const [busy, setBusy] = useState(false);
  const state = useVoice();
  const play = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/voice/speech", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: "Time equals distance divided by speed.",
          ...(name.trim() ? { voice: name.trim() } : {}),
          speed,
        }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string; unavailable?: boolean } | null;
        if (data?.unavailable) markVoiceAway();
        throw new ReadAloudError(data?.error ?? "The sample could not be played.");
      }
      const url = URL.createObjectURL(await response.blob());
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch (error) {
      toast.error(error instanceof ReadAloudError ? error.message : "The sample could not be played.");
    } finally {
      setBusy(false);
    }
  };
  if (!state.loaded || !state.speech) return null;
  return (
    <Button type="button" variant="secondary" onClick={play} disabled={busy}>
      {busy ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
      Play a sample
    </Button>
  );
};
