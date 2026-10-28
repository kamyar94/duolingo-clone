"use client";

import { useCallback, useEffect, useState, type KeyboardEvent } from "react";

import {
  ChallengeExplanation,
  ChallengeHint,
} from "@/app/lesson/challenge-notes";
import { cn } from "@/lib/utils";

import type {
  ExerciseCheck,
  ExerciseEntry,
  ExerciseProps,
  ExerciseResult,
  ExerciseStatus,
  LessonChallenge,
} from "./types";

type ExerciseHostProps = {
  entry: ExerciseEntry;
  challenge: LessonChallenge;
  status: ExerciseStatus;
  disabled: boolean;
  setCheck: (check: ExerciseCheck | null) => void;
  onResult: (result: ExerciseResult) => void;
  onRetry: () => void;
};

// Enter checks the answer anywhere in a lesson (footer shortcut). Inside an editor, a text
// field or a math field it must type a new line instead, so it does not reach the footer.
const EDITABLE =
  "input, textarea, select, [contenteditable=''], [contenteditable='true'], math-field, [data-exercise-keys]";

const keepTypingKeys = (event: KeyboardEvent<HTMLDivElement>) => {
  const target = event.target as HTMLElement | null;
  if (event.key === "Enter" && target?.closest?.(EDITABLE))
    event.stopPropagation();
};

// Lays out one coding or math exercise in the lesson: heading, hint, the exercise itself and,
// once checked, the explanation. Mounted with key={challenge.id}, so every challenge starts fresh.
export const ExerciseHost = ({
  entry,
  challenge,
  status,
  disabled,
  setCheck,
  onResult,
  onRetry,
}: ExerciseHostProps) => {
  const Exercise = entry.component;
  const wide = entry.layout === "wide";
  const title = entry.title ? entry.title(challenge) : challenge.question;

  // A check registered by this exercise must not outlive it.
  useEffect(() => () => setCheck(null), [setCheck]);

  const reportResult = useCallback<ExerciseProps["reportResult"]>(
    (result) => {
      if (status === "none" && !disabled) onResult(result);
    },
    [status, disabled, onResult]
  );

  const retry = useCallback(() => {
    if (status === "wrong" && !disabled) onRetry();
  }, [status, disabled, onRetry]);

  // Once shown, the explanation stays while the learner changes the answer after a retry.
  const [shown, setShown] = useState<"correct" | "wrong" | null>(null);
  if (status !== "none" && shown !== status) setShown(status);

  // The lesson column scrolls on its own, so the footer stays in view above an on-screen
  // keyboard.
  return (
    <div className="min-h-0 flex-1 overflow-y-auto" onKeyDown={keepTypingKeys}>
      <div className="flex min-h-full items-center justify-center">
        <div
          className={cn(
            "flex w-full flex-col gap-y-8 px-6",
            wide
              ? "max-w-[1140px] lg:px-10"
              : "lg:min-h-[350px] lg:w-[600px] lg:gap-y-12 lg:px-0"
          )}
        >
          {title && (
            <h1 className="text-center text-lg font-bold text-neutral-700 lg:text-start lg:text-3xl">
              {title}
            </h1>
          )}

          <div>
            {challenge.hint && (
              <ChallengeHint hint={challenge.hint} answered={status !== "none"} />
            )}

            <Exercise
              challenge={challenge}
              status={status}
              disabled={disabled}
              practice={challenge.completed}
              setCheck={setCheck}
              reportResult={reportResult}
              retry={retry}
            />

            {shown && challenge.explanation && (
              <ChallengeExplanation
                explanation={challenge.explanation}
                status={shown}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
