"use client";

import { Play, RotateCcw, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { isCodeLanguage, type CodeLanguage } from "@/lib/coding/languages";
import type { CheckReport, CodeTest } from "@/lib/coding/types";

/** The payload of a challenge as a partial object of the expected shape (never trusted fully). */
export const payloadOf = <T extends object>(payload: unknown): Partial<T> =>
  typeof payload === "object" && payload !== null && !Array.isArray(payload)
    ? (payload as Partial<T>)
    : {};

export const languageOf = (payload: { language?: unknown }): CodeLanguage | null =>
  isCodeLanguage(payload.language) && payload.language !== "web" ? payload.language : null;

export const testsOf = (payload: { tests?: unknown }): CodeTest[] =>
  Array.isArray(payload.tests)
    ? payload.tests.filter(
        (test): test is CodeTest => typeof test === "object" && test !== null && !Array.isArray(test)
      )
    : [];

/** Space the lesson footer takes below the exercise on phones and portrait tablets. */
export const LESSON_FOOTER = "100px";

export const BrokenExercise = ({ what }: { what: string }) => (
  <p className="rounded-xl border-2 border-dashed border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
    This exercise cannot be shown: {what}
  </p>
);

type RunControlsProps = {
  busy: false | "run" | "check";
  onRun: () => void;
  onStop?: () => void;
  onReset?: () => void;
  runLabel?: string;
  disabled?: boolean;
};

export const RunControls = ({
  busy,
  onRun,
  onStop,
  onReset,
  runLabel = "Run",
  disabled,
}: RunControlsProps) => (
  <>
    {busy && onStop ? (
      <Button variant="dangerOutline" size="sm" onClick={onStop} data-exercise-keys>
        <Square className="mr-2 h-4 w-4" /> Stop
      </Button>
    ) : (
      <Button
        variant="primary"
        size="sm"
        onClick={onRun}
        disabled={disabled || !!busy}
        data-exercise-keys
      >
        <Play className="mr-2 h-4 w-4" /> {runLabel}
      </Button>
    )}
    {onReset && (
      <Button variant="ghost" size="sm" onClick={onReset} disabled={!!busy} data-exercise-keys>
        <RotateCcw className="mr-2 h-4 w-4" /> Reset
      </Button>
    )}
  </>
);

export const reportTitle = (report: CheckReport | null, busy: false | "run" | "check") =>
  busy === "check"
    ? "Checking…"
    : busy === "run"
      ? "Running…"
      : report && !report.unavailable
        ? `Output · ${report.passed} of ${report.total} tests passed`
        : "Output";
