"use client";

// The timeline driver of the solution player. It only moves a clock: requestAnimationFrame
// advances the time while playing, and dragging or a key sets it. Everything on screen is
// computed from that time by frameAt (lib/math/solution/timeline.ts), so there are no running
// animations to stop or catch up with. Narration (components/voice/narration.ts) follows the
// clock and may hold it, through holdRef, just before the end of a step whose spoken clip is
// still playing.
import { useCallback, useEffect, useRef, useState } from "react";

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

/**
 * One tick of the clock: the time after `dt` seconds at `speed`, never past `total` and never
 * past `hold` (a time the narration keeps the clock from leaving while a clip is being said;
 * a clock that is already past it stays where it is). `done` is true when the end is reached
 * and nothing holds the clock back.
 */
export const advanceClock = (
  current: number,
  dt: number,
  speed: number,
  total: number,
  hold: number | null
) => {
  let next = Math.min(total, current + dt * speed);
  const held = hold !== null && next > hold;
  if (held) next = Math.max(current, hold);
  return { time: next, held, done: next >= total && !held };
};

export const usePlayback = (total: number, stepStarts: number[], initialTime = 0) => {
  const [time, setTimeState] = useState(() => Math.min(Math.max(initialTime, 0), total));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const timeRef = useRef(time);
  const speedRef = useRef(speed);
  /** Counts jumps (dragging, step buttons, keys), so narration can tell them from playing on. */
  const [seekEpoch, setSeekEpoch] = useState(0);
  /** While set, the clock does not run past this time. */
  const holdRef = useRef<number | null>(null);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  const seek = useCallback(
    (value: number) => {
      const next = Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), total);
      timeRef.current = next;
      setTimeState(next);
      setSeekEpoch((epoch) => epoch + 1);
    },
    [total]
  );

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      // A hidden tab pauses requestAnimationFrame; never jump more than a tenth of a second.
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      const step = advanceClock(timeRef.current, dt, speedRef.current, total, holdRef.current);
      if (step.time !== timeRef.current) {
        timeRef.current = step.time;
        setTimeState(step.time);
      }
      if (step.done) {
        setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, total]);

  const play = useCallback(() => {
    if (timeRef.current >= total - 1e-6) seek(0);
    setPlaying(true);
  }, [seek, total]);
  const pause = useCallback(() => setPlaying(false), []);
  const toggle = useCallback(() => (playing ? pause() : play()), [pause, play, playing]);

  const currentStep = useCallback(() => {
    let index = 0;
    stepStarts.forEach((start, k) => {
      if (start <= timeRef.current + 1e-6) index = k;
    });
    return index;
  }, [stepStarts]);

  /** Jumps to the start of the next step. */
  const nextStep = useCallback(() => {
    const index = currentStep();
    seek(index + 1 < stepStarts.length ? stepStarts[index + 1] : total);
  }, [currentStep, seek, stepStarts, total]);

  /** Jumps to the start of this step, or of the step before when already near its start. */
  const previousStep = useCallback(() => {
    const index = currentStep();
    const start = stepStarts[index] ?? 0;
    seek(timeRef.current - start > 0.4 || index === 0 ? start : stepStarts[index - 1]);
  }, [currentStep, seek, stepStarts]);

  return { time, playing, speed, setSpeed, seek, seekEpoch, holdRef, play, pause, toggle, nextStep, previousStep };
};
