"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ExerciseProps } from "@/components/exercises/types";
import { checkBlanks, fillChips, fillTemplate, splitTemplate } from "@/lib/coding/chips";
import { runsOnServer, serverRunnerAvailable } from "@/lib/coding/runner";
import type { CodeFillPayload } from "@/lib/coding/types";
import { cn } from "@/lib/utils";

import { ChipButton } from "./chip-button";
import { ConsolePanel } from "./console-panel";
import { BrokenExercise, languageOf, payloadOf, RunControls, testsOf } from "./exercise-utils";
import { LanguageBadge, ServerNotice } from "./task-panel";
import { isStringList, useDraft } from "./use-draft";
import { useCodeRun } from "./use-code-run";

// CODE_FILL: complete the blanks of a program by tapping chips or typing. With tests the
// completed program must pass them; without, each blank must hold an accepted answer.
export const CodeFillExercise = ({ challenge, status, disabled, setCheck }: ExerciseProps) => {
  const payload = payloadOf<CodeFillPayload>(challenge.payload);
  const language = languageOf(payload);
  const template = payload.template ?? "";
  const parts = splitTemplate(template);
  const blanks = parts.length - 1;
  const chips = fillChips(payload.answers, payload.distractors, challenge.id);
  const tests = testsOf(payload);

  const empty = Array.from({ length: blanks }, () => "");
  const [values, setValues] = useDraft(
    challenge.id,
    empty,
    (value): value is string[] => isStringList(value) && value.length === blanks
  );
  const [active, setActive] = useState<number | null>(null);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const runner = useCodeRun();
  const { check } = runner;
  const answered = status !== "none";
  const locked = disabled || answered;
  const onServer = language ? runsOnServer(language) && !serverRunnerAvailable() : false;

  const program = fillTemplate(template, values);
  const complete = values.length === blanks && values.every((value) => value.trim() !== "");
  const [wrongBlanks, setWrongBlanks] = useState<boolean[] | null>(null);

  // Chips already placed in a blank are dimmed; tapping one again takes it back out.
  const placedCounts = new Map<string, number>();
  for (const value of values) placedCounts.set(value, (placedCounts.get(value) ?? 0) + 1);
  const usedChip = new Set<number>();
  for (const chip of chips) {
    const left = placedCounts.get(chip.text) ?? 0;
    if (left > 0) {
      usedChip.add(chip.id);
      placedCounts.set(chip.text, left - 1);
    }
  }

  const setBlank = useCallback(
    (index: number, text: string) => {
      setWrongBlanks(null);
      setValues((previous) => previous.map((value, i) => (i === index ? text : value)));
    },
    [setValues]
  );

  const tapChip = (chip: { id: number; text: string }) => {
    if (locked) return;
    if (usedChip.has(chip.id)) {
      const at = values.lastIndexOf(chip.text);
      if (at >= 0) setBlank(at, "");
      return;
    }
    const target =
      active !== null && values[active] === "" ? active : values.findIndex((value) => value === "");
    const index = target >= 0 ? target : (active ?? -1);
    if (index < 0) return;
    setBlank(index, chip.text);
    const next = values.findIndex((value, i) => value === "" && i !== index);
    setActive(next >= 0 ? next : null);
  };

  useEffect(() => {
    if (!language || !complete || (onServer && tests.length)) {
      setCheck(null);
      return;
    }
    if (tests.length)
      setCheck(async () => {
        const report = await check({
          language,
          code: program,
          tests,
          setup: payload.setup,
          timeLimitMs: payload.timeLimitMs,
        });
        if (report.unavailable) return null;
        return { correct: report.allPassed };
      });
    else
      setCheck(() => {
        const results = checkBlanks(values, payload.answers ?? []);
        setWrongBlanks(results.map((ok) => !ok));
        return { correct: results.every(Boolean) };
      });
    // tests and payload come from the challenge, which does not change while mounted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [program, complete, language, onServer, setCheck, check]);

  if (!language) return <BrokenExercise what="its payload names no supported language." />;
  if (blanks === 0) return <BrokenExercise what="its template has no blanks." />;

  return (
    <div className="space-y-4">
      <LanguageBadge language={language} />
      <pre
        className="overflow-x-auto whitespace-pre rounded-xl border-2 border-slate-200 bg-white p-3 font-mono text-sm leading-8 text-neutral-800"
        aria-label="Program with blanks"
      >
        {parts.map((part, i) => (
          <span key={i}>
            {part}
            {i < blanks && (
              <input
                ref={(element) => {
                  inputs.current[i] = element;
                }}
                value={values[i] ?? ""}
                onChange={(event) => setBlank(i, event.target.value)}
                onFocus={() => setActive(i)}
                disabled={locked}
                aria-label={`Blank ${i + 1}`}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                autoComplete="off"
                size={Math.max(3, (values[i] ?? "").length + 1)}
                className={cn(
                  "mx-0.5 rounded-md border-2 border-dashed border-sky-300 bg-sky-50 px-1 py-0.5 font-mono text-sm text-neutral-800 focus:border-solid focus:border-sky-400 focus:outline-none",
                  active === i && "border-solid border-sky-400",
                  (values[i] ?? "") !== "" && "border-solid border-slate-300 bg-white",
                  wrongBlanks?.[i] && status === "wrong" && "border-rose-400 bg-rose-50",
                  status === "correct" && "border-green-400 bg-green-50"
                )}
              />
            )}
          </span>
        ))}
      </pre>

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Chips">
          {chips.map((chip) => (
            <ChipButton
              key={chip.id}
              used={usedChip.has(chip.id)}
              disabled={locked}
              onClick={() => tapChip(chip)}
              label={usedChip.has(chip.id) ? `Take back ${chip.text}` : `Place ${chip.text}`}
            >
              {chip.text}
            </ChipButton>
          ))}
        </div>
      )}

      {onServer ? (
        <ServerNotice language={language} />
      ) : (
        <div className="space-y-2">
          <div className="flex gap-2">
            <RunControls
              busy={runner.busy}
              disabled={!complete}
              onRun={() =>
                void runner.run({
                  language,
                  code: program,
                  setup: payload.setup,
                  timeLimitMs: payload.timeLimitMs,
                })
              }
              onStop={runner.stop}
            />
          </div>
          {(runner.lines.length > 0 || runner.busy || runner.report) && (
            <ConsolePanel
              lines={runner.lines}
              report={runner.report}
              busy={runner.busy}
              className="max-h-72"
            />
          )}
        </div>
      )}
    </div>
  );
};
