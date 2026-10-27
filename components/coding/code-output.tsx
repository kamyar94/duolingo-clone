"use client";

import { useEffect, useMemo } from "react";

import type { ExerciseProps } from "@/components/exercises/types";
import { seededShuffle } from "@/lib/coding/chips";
import { languageInfo } from "@/lib/coding/languages";
import { runsOnServer, serverRunnerAvailable } from "@/lib/coding/runner";
import { matchOutput } from "@/lib/coding/tests";
import type { CodeOutputPayload } from "@/lib/coding/types";
import { cn } from "@/lib/utils";

import { CodeEditor } from "./code-editor";
import { ConsolePanel } from "./console-panel";
import { BrokenExercise, languageOf, payloadOf, RunControls } from "./exercise-utils";
import { LanguageBadge } from "./task-panel";
import { isString, useDraft } from "./use-draft";
import { useCodeRun } from "./use-code-run";

// CODE_OUTPUT: predict what a program prints, by choosing or by typing. Running the program would
// give the answer away, so Run unlocks once the answer is checked.
export const CodeOutputExercise = ({ challenge, status, disabled, setCheck }: ExerciseProps) => {
  const payload = payloadOf<CodeOutputPayload>(challenge.payload);
  const language = languageOf(payload);
  const options = challenge.challengeOptions;
  const expected = payload.expect ?? options.find((option) => option.correct)?.text ?? "";
  const choices = useMemo(
    () =>
      payload.choices ??
      (options.length ? seededShuffle(options.map((option) => option.text), challenge.id) : null),
    [payload.choices, options, challenge.id]
  );
  const mode = payload.match ?? "normalized";

  const [answer, setAnswer] = useDraft(challenge.id, "", isString);
  const runner = useCodeRun();
  const answered = status !== "none";

  useEffect(() => {
    if (!language || !answer.trim()) {
      setCheck(null);
      return;
    }
    setCheck(() => ({ correct: matchOutput(answer, expected, mode) }));
  }, [answer, expected, mode, language, setCheck]);

  if (!language) return <BrokenExercise what="its payload names no supported language." />;
  const canRun = !(runsOnServer(language) && !serverRunnerAvailable());

  return (
    <div className="space-y-4">
      <LanguageBadge language={language} />
      <CodeEditor
        value={payload.code ?? ""}
        mode={language === "web" ? "html" : language}
        readOnly
        label={`${languageInfo(language).label} program`}
      />

      {choices ? (
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Output">
          {choices.map((choice) => {
            const selected = answer === choice;
            return (
              <button
                key={choice}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={disabled || answered}
                onClick={() => setAnswer(choice)}
                className={cn(
                  "rounded-xl border-2 border-b-4 p-3 text-left hover:bg-black/5 disabled:pointer-events-none",
                  selected && "border-sky-300 bg-sky-100",
                  selected && status === "correct" && "border-green-300 bg-green-100",
                  selected && status === "wrong" && "border-rose-300 bg-rose-100"
                )}
              >
                <pre className="whitespace-pre-wrap font-mono text-sm text-neutral-700">{choice}</pre>
              </button>
            );
          })}
        </div>
      ) : (
        <label className="block">
          <span className="mb-1 block text-sm font-bold text-neutral-600">
            What does the program print?
          </span>
          <textarea
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            disabled={disabled || answered}
            rows={Math.min(8, Math.max(2, expected.split("\n").length + 1))}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className="w-full rounded-xl border-2 border-slate-200 p-3 font-mono text-sm focus:border-sky-300 focus:outline-none"
          />
        </label>
      )}

      {answered && canRun && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <RunControls
              busy={runner.busy}
              runLabel="Run it"
              onRun={() =>
                void runner.run({
                  language,
                  code: payload.code ?? "",
                  stdin: payload.stdin,
                  setup: payload.setup,
                  timeLimitMs: payload.timeLimitMs,
                })
              }
              onStop={runner.stop}
            />
          </div>
          {(runner.lines.length > 0 || runner.busy) && (
            <ConsolePanel lines={runner.lines} busy={runner.busy} className="max-h-60" />
          )}
        </div>
      )}
    </div>
  );
};
