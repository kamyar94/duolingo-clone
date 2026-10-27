"use client";

// The animated solution player (docs/DESIGN-coding-and-math.md, section 5.5): the stage, a
// timeline with a draggable handle and step markers, play and pause, step buttons, speed,
// subtitles for the narration and keyboard shortcuts (space, arrow keys, Home, End). Every
// frame is computed from the script and the time; nothing runs on its own.
import "katex/dist/katex.min.css";

import { useMemo, useRef, type KeyboardEvent, type PointerEvent } from "react";

import { Pause, Play, SkipBack, SkipForward } from "lucide-react";

import { compileTimeline, frameAt, lineShownAt } from "@/lib/math/solution/timeline";
import type { SolutionScript } from "@/lib/math/solution/types";
import { cn } from "@/lib/utils";

import { MathFormula } from "../math-text";

import { Stage } from "./stage";
import { SPEEDS, usePlayback } from "./use-playback";

export type PlayerStart = {
  /** The step to open at. */
  step: number;
  /** The learner's line that went wrong, shown beside the correct one. */
  learnerLine?: string | null;
  lineNumber?: number;
};

type SolutionPlayerProps = {
  script: SolutionScript;
  start?: PlayerStart | null;
  className?: string;
};

const clock = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export const SolutionPlayer = ({ script, start, className }: SolutionPlayerProps) => {
  const timeline = useMemo(() => compileTimeline(script), [script]);
  const starts = useMemo(() => timeline.steps.map((step) => step.start), [timeline]);
  const startStep = Math.min(Math.max(start?.step ?? 0, 0), Math.max(0, timeline.steps.length - 1));
  const playback = usePlayback(timeline.total, starts, starts[startStep] ?? 0);
  const { time, playing, speed } = playback;
  const frame = useMemo(() => frameAt(timeline, time), [timeline, time]);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<{ resume: boolean } | null>(null);

  const correctLine = start?.learnerLine ? lineShownAt(timeline, startStep) : null;

  const seekToPointer = (event: PointerEvent) => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const f = rect.width ? (event.clientX - rect.left) / rect.width : 0;
    playback.seek(f * timeline.total);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.target instanceof HTMLSelectElement) return;
    const keys: Record<string, () => void> = {
      " ": playback.toggle,
      ArrowRight: playback.nextStep,
      ArrowLeft: playback.previousStep,
      Home: () => playback.seek(0),
      End: () => playback.seek(timeline.total),
    };
    const action = keys[event.key];
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    action();
  };

  return (
    <div
      className={cn("space-y-3 outline-none", className)}
      tabIndex={0}
      data-exercise-keys
      onKeyDown={onKeyDown}
      aria-label="Animated solution. Space plays or pauses, the arrow keys move between steps."
    >
      {start?.learnerLine && (
        <div className="grid gap-2 rounded-xl border-2 border-rose-100 bg-rose-50/60 px-3 py-2 text-sm sm:grid-cols-2">
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-rose-600">
              Your line{start.lineNumber ? ` ${start.lineNumber}` : ""}
            </div>
            <MathFormula latex={start.learnerLine} className="text-base" />
          </div>
          {correctLine && (
            <div>
              <div className="text-xs font-bold uppercase tracking-wide text-green-700">The solution at this step</div>
              <MathFormula latex={correctLine} className="text-base" />
            </div>
          )}
        </div>
      )}

      <Stage timeline={timeline} frame={frame} />

      <p aria-live="polite" className="min-h-[2.75rem] rounded-xl bg-neutral-800 px-4 py-2 text-center text-sm text-white lg:text-base">
        {frame.narration ?? "\u00a0"}
      </p>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={playback.previousStep}
          aria-label="Previous step"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-neutral-600 hover:bg-slate-100"
        >
          <SkipBack className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={playback.toggle}
          aria-label={playing ? "Pause" : "Play"}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-500 text-white hover:bg-sky-600"
        >
          {playing ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
        </button>
        <button
          type="button"
          onClick={playback.nextStep}
          aria-label="Next step"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-neutral-600 hover:bg-slate-100"
        >
          <SkipForward className="h-4 w-4" />
        </button>

        <div
          ref={trackRef}
          role="slider"
          tabIndex={-1}
          aria-label="Position in the solution"
          aria-valuemin={0}
          aria-valuemax={Math.round(timeline.total)}
          aria-valuenow={Math.round(time)}
          aria-valuetext={`${clock(time)} of ${clock(timeline.total)}, step ${frame.step + 1} of ${timeline.steps.length}`}
          className="relative h-8 flex-1 cursor-pointer touch-none select-none"
          onPointerDown={(event) => {
            try {
              event.currentTarget.setPointerCapture(event.pointerId);
            } catch {
              // Pointers that are no longer active cannot be captured; dragging still works inside.
            }
            dragging.current = { resume: playing };
            playback.pause();
            seekToPointer(event);
          }}
          onPointerMove={(event) => {
            if (dragging.current) seekToPointer(event);
          }}
          onPointerUp={() => {
            if (dragging.current?.resume) playback.play();
            dragging.current = null;
          }}
          onPointerCancel={() => {
            dragging.current = null;
          }}
        >
          <div className="absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-slate-200" />
          <div
            className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-sky-400"
            style={{ width: `${timeline.total ? (time / timeline.total) * 100 : 0}%` }}
          />
          {timeline.steps.map((timed) => (
            <div
              key={timed.index}
              title={`${timed.index + 1}. ${timed.step.kind}`}
              className={cn(
                "absolute top-1/2 h-3 w-0.5 -translate-y-1/2 rounded",
                timed.start <= time ? "bg-sky-600" : "bg-slate-400"
              )}
              style={{ left: `${timeline.total ? (timed.start / timeline.total) * 100 : 0}%` }}
            />
          ))}
          <div
            className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-sky-500 shadow"
            style={{ left: `${timeline.total ? (time / timeline.total) * 100 : 0}%` }}
          />
        </div>

        <span className="hidden w-[5.5rem] shrink-0 text-right text-xs tabular-nums text-neutral-500 sm:inline">
          {clock(time)} / {clock(timeline.total)}
        </span>
        <label className="shrink-0">
          <span className="sr-only">Speed</span>
          <select
            value={speed}
            onChange={(event) => playback.setSpeed(Number(event.target.value))}
            className="rounded-lg border-2 border-slate-200 bg-white px-1 py-1 text-xs"
          >
            {SPEEDS.map((value) => (
              <option key={value} value={value}>
                {value}x
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-right text-xs text-neutral-400">
        Step {frame.step + 1} of {timeline.steps.length}
      </p>
    </div>
  );
};

export default SolutionPlayer;
