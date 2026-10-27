"use client";

// The timeline driver of the solution player. It only moves a clock: requestAnimationFrame
// advances the time while playing, and dragging or a key sets it. Everything on screen is
// computed from that time by frameAt (lib/math/solution/timeline.ts), so there are no running
// animations to stop or catch up with.
import { useCallback, useEffect, useRef, useState } from "react";

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export const usePlayback = (total: number, stepStarts: number[], initialTime = 0) => {
  const [time, setTimeState] = useState(() => Math.min(Math.max(initialTime, 0), total));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const timeRef = useRef(time);
  const speedRef = useRef(speed);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  const seek = useCallback(
    (value: number) => {
      const next = Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), total);
      timeRef.current = next;
      setTimeState(next);
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
      const next = Math.min(total, timeRef.current + dt * speedRef.current);
      timeRef.current = next;
      setTimeState(next);
      if (next >= total) {
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

  return { time, playing, speed, setSpeed, seek, play, pause, toggle, nextStep, previousStep };
};
