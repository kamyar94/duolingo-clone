"use client";

import { useEffect } from "react";

import { ArrowDown, ArrowUp, IndentDecrease, IndentIncrease, X } from "lucide-react";

import type { ExerciseProps } from "@/components/exercises/types";
import {
  assembleLines,
  checkOrder,
  indentUnit,
  learnerSetsIndent,
  orderPieces,
  type OrderPiece,
} from "@/lib/coding/chips";
import { runsOnServer, serverRunnerAvailable } from "@/lib/coding/runner";
import type { CodeOrderPayload } from "@/lib/coding/types";
import { cn } from "@/lib/utils";

import { ChipButton } from "./chip-button";
import { ConsolePanel } from "./console-panel";
import { BrokenExercise, languageOf, payloadOf, RunControls, testsOf } from "./exercise-utils";
import { LanguageBadge, ServerNotice } from "./task-panel";
import { useDraft } from "./use-draft";
import { useCodeRun } from "./use-code-run";

type Placed = { id: number; indent: number };

const isPlacedList = (value: unknown): value is Placed[] =>
  Array.isArray(value) &&
  value.every(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      Number.isInteger((item as Placed).id) &&
      Number.isInteger((item as Placed).indent)
  );

const opensBlock = (text: string) => /[:{[(]\s*$/.test(text);

// CODE_ORDER: put shuffled lines in order by tapping them, setting their indentation where it
// matters (Python). With tests the assembled program must pass them; without, it must match.
export const CodeOrderExercise = ({ challenge, status, disabled, setCheck }: ExerciseProps) => {
  const payload = payloadOf<CodeOrderPayload>(challenge.payload);
  const language = languageOf(payload);
  const lines = Array.isArray(payload.lines)
    ? payload.lines.filter((line) => typeof line === "string")
    : [];
  const indents = learnerSetsIndent(language ?? "", payload.indent);
  const pieces = orderPieces(lines, payload.distractors, indents, challenge.id);
  const byId = new Map(pieces.map((piece) => [piece.id, piece]));
  const unit = indentUnit(lines);
  const tests = testsOf(payload);

  const [placed, setPlaced] = useDraft<Placed[]>(
    challenge.id,
    [],
    (value): value is Placed[] => isPlacedList(value) && value.every((item) => byId.has(item.id))
  );
  const runner = useCodeRun();
  const { check } = runner;
  const answered = status !== "none";
  const locked = disabled || answered;
  const onServer = language ? runsOnServer(language) && !serverRunnerAvailable() : false;

  const placedPieces = placed
    .map((item) => {
      const piece = byId.get(item.id);
      return piece ? { ...piece, indent: item.indent } : null;
    })
    .filter((piece): piece is OrderPiece => piece !== null);
  const pool = pieces.filter((piece) => !placed.some((item) => item.id === piece.id));
  const program = assembleLines(placedPieces, unit);

  const add = (piece: OrderPiece) => {
    if (locked) return;
    setPlaced((previous) => {
      const last = previous.at(-1);
      const lastText = last ? (byId.get(last.id)?.text ?? "") : "";
      const indent = indents
        ? last
          ? last.indent + (opensBlock(lastText) ? 1 : 0)
          : 0
        : piece.indent;
      return [...previous, { id: piece.id, indent }];
    });
  };

  const update = (index: number, change: (list: Placed[]) => Placed[]) => {
    if (locked || index < 0) return;
    setPlaced((previous) => change([...previous]));
  };

  useEffect(() => {
    if (!language || placed.length === 0 || (onServer && tests.length)) {
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
    else setCheck(() => ({ correct: checkOrder(placedPieces, lines) }));
    // tests and payload come from the challenge, which does not change while mounted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [program, language, onServer, setCheck, check]);

  if (!language) return <BrokenExercise what="its payload names no supported language." />;
  if (lines.length < 2) return <BrokenExercise what="it has fewer than two lines." />;

  const iconButton =
    "flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30";

  return (
    <div className="space-y-4">
      <LanguageBadge language={language} />

      <ol
        className={cn(
          "min-h-24 space-y-1 rounded-xl border-2 border-slate-200 bg-white p-2",
          status === "correct" && "border-green-300",
          status === "wrong" && "border-rose-300"
        )}
        aria-label="Your program"
      >
        {placedPieces.length === 0 && (
          <li className="p-2 text-sm text-slate-400">Tap the lines below in the right order.</li>
        )}
        {placedPieces.map((piece, index) => (
          <li key={piece.id} className="flex items-center gap-1">
            <button
              type="button"
              disabled={locked}
              onClick={() => update(index, (list) => list.filter((_, i) => i !== index))}
              data-exercise-keys
              aria-label={`Remove ${piece.text}`}
              className="flex min-h-9 min-w-0 flex-1 items-center rounded-lg bg-slate-50 px-2 text-left font-mono text-sm text-neutral-800 hover:bg-slate-100"
            >
              <span
                aria-hidden
                className="shrink-0 border-l border-dashed border-slate-300"
                style={{ width: `${piece.indent * 2}ch` }}
              />
              <span className="truncate whitespace-pre">{piece.text}</span>
              <X className="ml-auto h-3.5 w-3.5 shrink-0 text-slate-300" />
            </button>
            {indents && (
              <>
                <button
                  type="button"
                  className={iconButton}
                  disabled={locked || piece.indent === 0}
                  onClick={() =>
                    update(index, (list) =>
                      list.map((item, i) => (i === index ? { ...item, indent: Math.max(0, item.indent - 1) } : item))
                    )
                  }
                  aria-label={`Outdent ${piece.text}`}
                  data-exercise-keys
                >
                  <IndentDecrease className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className={iconButton}
                  disabled={locked || piece.indent >= 8}
                  onClick={() =>
                    update(index, (list) =>
                      list.map((item, i) => (i === index ? { ...item, indent: item.indent + 1 } : item))
                    )
                  }
                  aria-label={`Indent ${piece.text}`}
                  data-exercise-keys
                >
                  <IndentIncrease className="h-4 w-4" />
                </button>
              </>
            )}
            <button
              type="button"
              className={iconButton}
              disabled={locked || index === 0}
              onClick={() =>
                update(index, (list) => {
                  [list[index - 1], list[index]] = [list[index], list[index - 1]];
                  return list;
                })
              }
              aria-label={`Move ${piece.text} up`}
              data-exercise-keys
            >
              <ArrowUp className="h-4 w-4" />
            </button>
            <button
              type="button"
              className={iconButton}
              disabled={locked || index === placedPieces.length - 1}
              onClick={() =>
                update(index, (list) => {
                  [list[index + 1], list[index]] = [list[index], list[index + 1]];
                  return list;
                })
              }
              aria-label={`Move ${piece.text} down`}
              data-exercise-keys
            >
              <ArrowDown className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ol>

      {pool.length > 0 && (
        <div className="flex flex-col gap-2" aria-label="Lines to place">
          {pool.map((piece) => (
            <ChipButton
              key={piece.id}
              disabled={locked}
              onClick={() => add(piece)}
              label={`Add ${piece.text}`}
              className="whitespace-pre"
            >
              {" ".repeat(indents ? 0 : piece.indent * unit.replace("\t", "    ").length)}
              {piece.text}
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
              disabled={placed.length === 0}
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
