"use client";

// A MATH challenge (docs/DESIGN-coding-and-math.md, sections 5.1 to 5.4): the statement with
// KaTeX math and an optional figure, the ink canvas, and an answer box. Check (the footer
// button or Submit here) first has the handwriting read into LaTeX lines, which the learner can
// correct; the next Check grades them. The result goes back to the lesson, which applies
// hearts and points as for any other exercise.
//
// Layouts: on a phone in portrait the statement folds into a bar and the tools sit under the
// canvas; on a tablet in landscape and on a desktop the statement and the canvas sit side by
// side; on a tablet in portrait they stack. On a desktop every tool has a key.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Link from "next/link";
import { ChevronDown, ChevronUp, LoaderCircle, PenLine, ScanText } from "lucide-react";

import type { ExerciseProps, ExerciseResult } from "@/components/exercises/types";
import { Button } from "@/components/ui/button";
import { answerPart } from "@/lib/math/latex";
import { sameStrokes } from "@/lib/math/strokes";
import type {
  ClientMathPayload,
  GivenAnswer,
  GradeResult,
  RecognizedLine,
  StoredStroke,
} from "@/lib/math/types";
import { cn } from "@/lib/utils";

import { grade, MathApiError, recognize } from "./api";
import { AnswerBox } from "./answer-box";
import { GradePanel } from "./grade-panel";
import { useInkDocument } from "./ink/document";
import { renderStrokesToPng } from "./ink/render";
import { InkCanvas, type InkCanvasHandle, type InkTool, type TouchMode } from "./ink-canvas";
import { INK_COLORS, InkToolbar } from "./ink-toolbar";
import { MathText } from "./math-text";
import { RecognizedLines } from "./recognized-lines";
import { useMathDraft, type AnswerState } from "./use-math-draft";

type Stage = "write" | "review";

type Reading = {
  attemptId: number | null;
  strokes: StoredStroke[];
  lines: RecognizedLine[];
  reused: boolean;
};

type Problem = { message: string; aiError?: string; offerTyping?: boolean };

const SHORTCUT_TOOLS: Record<string, InkTool> = {
  p: "pen",
  h: "highlighter",
  e: "eraser",
  l: "lasso",
  s: "space",
};

const isTyping = (target: EventTarget | null) =>
  !!(target as HTMLElement | null)?.closest?.(
    "input, textarea, select, [contenteditable=''], [contenteditable='true'], math-field"
  );

const readPayload = (payload: unknown): ClientMathPayload => {
  const value = payload as ClientMathPayload | null;
  return value && typeof value === "object" && value.answer
    ? value
    : { answer: { kind: "freeform" } };
};

export const MathExercise = ({
  challenge,
  status,
  disabled,
  setCheck,
  reportResult,
  retry,
}: ExerciseProps) => {
  const payload = useMemo(() => readPayload(challenge.payload), [challenge.payload]);
  const statement = payload.statement ?? challenge.question;
  const kind = payload.answer.kind;

  const doc = useInkDocument();
  const canvas = useRef<InkCanvasHandle>(null);
  const [tool, setTool] = useState<InkTool>("pen");
  const [color, setColor] = useState<string>(INK_COLORS[0].value);
  const [width, setWidth] = useState(3.5);
  const [touchMode, setTouchMode] = useState<TouchMode>("auto");
  const [penSeen, setPenSeen] = useState(false);
  const [selectionCount, setSelectionCount] = useState(0);
  const [statementOpen, setStatementOpen] = useState(false);

  const [answer, setAnswer] = useState<AnswerState>({
    mode: kind === "freeform" ? "last-line" : "type",
    latex: "",
    choices: [],
  });
  const [requestedStage, setStage] = useState<Stage>("write");
  const [reading, setReading] = useState<Reading | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [busy, setBusy] = useState<"reading" | "grading" | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [result, setResult] = useState<GradeResult | null>(null);
  const [gradedLines, setGradedLines] = useState<string[]>([]);

  const content = useMemo(() => ({ strokes: doc.strokes, answer }), [doc.strokes, answer]);
  const { load } = doc;
  const draft = useMathDraft(challenge.id, content, (saved) => {
    load(saved.strokes);
    setAnswer(saved.answer);
  });

  const locked = status === "correct";
  const penStrokes = doc.strokes.some((stroke) => stroke.k === "p");
  // Changing the writing after it was read goes back to the writing stage.
  const readingIsCurrent = useMemo(
    () => !!reading && sameStrokes(reading.strokes, doc.strokes),
    [reading, doc.strokes]
  );
  const stage: Stage = requestedStage === "review" && readingIsCurrent ? "review" : "write";
  const workLines = useMemo(() => lines.map((line) => line.trim()).filter(Boolean), [lines]);
  const lastLine = stage === "review" ? (workLines[workLines.length - 1] ?? null) : null;

  const givenAnswer = useMemo((): GivenAnswer | null => {
    if (kind === "choice")
      return answer.choices.length ? { kind: "choice", choices: answer.choices } : null;
    if (answer.mode === "last-line")
      return lastLine ? { kind: "latex", latex: answerPart(lastLine) } : null;
    return answer.latex.trim() ? { kind: "latex", latex: answer.latex } : null;
  }, [kind, answer, lastLine]);

  // Retry after a wrong answer: back to the canvas with everything kept. Changing the work
  // after a wrong answer retries by itself and keeps the stage, so the next Check grades the
  // new answer.
  const work = useMemo(() => ({ strokes: doc.strokes, answer, lines }), [doc.strokes, answer, lines]);
  const [wrongWork, setWrongWork] = useState<typeof work | null>(null);
  const [seenStatus, setSeenStatus] = useState(status);
  if (seenStatus !== status) {
    setSeenStatus(status);
    // Unchanged work means the footer's Retry; changed work means a retry by editing.
    if (status === "none" && work === wrongWork) setStage("write");
    setWrongWork(status === "wrong" ? work : null);
  }
  useEffect(() => {
    if (status === "wrong" && wrongWork && work !== wrongWork) retry();
  }, [retry, status, work, wrongWork]);

  const describe = (error: unknown): Problem => {
    if (error instanceof MathApiError)
      return { message: error.message, aiError: error.aiError };
    return { message: "Something went wrong. Please try again." };
  };

  const runGrade = useCallback(
    async (attemptId: number | null, gradeLines: string[]): Promise<ExerciseResult | null> => {
      if (!givenAnswer && kind !== "freeform") {
        setProblem({
          message:
            kind === "choice"
              ? "Pick an answer first."
              : "Give your final answer: type it, or use the last line of your writing.",
        });
        return null;
      }
      setBusy("grading");
      try {
        const graded = await grade({
          challengeId: challenge.id,
          attemptId,
          lines: gradeLines,
          answer: givenAnswer,
        });
        setResult(graded);
        setGradedLines(gradeLines);
        if (graded.correct) void draft.clear();
        return { correct: graded.correct };
      } catch (error) {
        setProblem(describe(error));
        return null;
      } finally {
        setBusy(null);
      }
    },
    [challenge.id, draft, givenAnswer, kind]
  );

  const runCheck = useCallback(async (): Promise<ExerciseResult | null> => {
    if (busy || status !== "none") return null;
    setProblem(null);

    if (stage === "review") return runGrade(reading?.attemptId ?? null, workLines);

    if (!penStrokes) {
      if (kind === "freeform" || answer.mode === "last-line") {
        setProblem({ message: "Write your solution on the canvas first." });
        return null;
      }
      return runGrade(null, []);
    }

    // The same writing was read already: no new request.
    if (readingIsCurrent) {
      setStage("review");
      return null;
    }

    const image = renderStrokesToPng(doc.strokes);
    if (!image) {
      setProblem({ message: "The writing could not be turned into a picture." });
      return null;
    }
    setBusy("reading");
    try {
      const read = await recognize({
        challengeId: challenge.id,
        image: image.base64,
        strokes: doc.strokes,
      });
      setReading({
        attemptId: read.attemptId,
        strokes: doc.strokes,
        lines: read.lines,
        reused: read.reused,
      });
      setLines(read.lines.length ? read.lines.map((line) => line.latex) : [""]);
      setStage("review");
    } catch (error) {
      setProblem({ ...describe(error), offerTyping: true });
    } finally {
      setBusy(null);
    }
    return null;
  }, [
    answer.mode,
    busy,
    challenge.id,
    doc.strokes,
    kind,
    penStrokes,
    reading,
    readingIsCurrent,
    runGrade,
    stage,
    status,
    workLines,
  ]);

  const ready =
    !busy &&
    !disabled &&
    status === "none" &&
    (stage === "review" || penStrokes || (!!givenAnswer && answer.mode === "type"));

  useEffect(() => {
    setCheck(ready ? runCheck : null);
  }, [ready, runCheck, setCheck]);

  const submit = async () => {
    const outcome = await runCheck();
    if (outcome) reportResult(outcome);
  };

  // Recognition failed: the learner can type the lines instead.
  const typeInstead = () => {
    setReading({ attemptId: null, strokes: doc.strokes, lines: [], reused: false });
    setLines((current) => (current.length ? current : [""]));
    setProblem(null);
    setStage("review");
  };

  // Keyboard shortcuts on a desktop.
  const { undo, redo, commit } = doc;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) || locked) return;
      const key = event.key.toLowerCase();
      const mod = event.ctrlKey || event.metaKey;
      if (mod && key === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && key === "y") {
        event.preventDefault();
        redo();
        return;
      }
      if (mod || event.altKey) return;
      if (SHORTCUT_TOOLS[key]) {
        setTool(SHORTCUT_TOOLS[key]);
        return;
      }
      if (key === "+" || key === "=") canvas.current?.zoomBy(1.25);
      else if (key === "-") canvas.current?.zoomBy(1 / 1.25);
      else if (key === "0") canvas.current?.resetView();
      else if (key === "delete" || key === "backspace") canvas.current?.deleteSelection();
      else if (key === "escape") canvas.current?.clearSelection();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [locked, redo, undo]);

  const confidences = reading?.lines.map((line) => line.confidence) ?? [];
  const wrongLine =
    result?.analysis && stage === "review" ? result.analysis.firstWrongLine : 0;
  const stale = !!result && status === "none";

  return (
    <div className="flex flex-col gap-4 md:landscape:flex-row md:landscape:items-start">
      {/* Statement: a folding bar on a phone in portrait, a column beside the canvas otherwise. */}
      <section
        aria-label="Problem"
        className="rounded-xl border-2 border-slate-200 bg-white px-4 py-3 text-neutral-700 md:landscape:sticky md:landscape:top-4 md:landscape:w-[36%] md:landscape:max-w-[420px] md:landscape:shrink-0"
      >
        <div
          className={cn(
            "relative",
            !statementOpen &&
              "max-md:portrait:max-h-[4.5rem] max-md:portrait:overflow-hidden"
          )}
        >
          <MathText text={statement} className="text-base lg:text-xl" />
          {payload.figure && (
            <figure className="mt-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={payload.figure.src}
                alt={payload.figure.alt}
                style={payload.figure.width ? { width: payload.figure.width } : undefined}
                className="mx-auto h-auto max-w-full"
              />
              {payload.figure.caption && (
                <figcaption className="mt-1 text-center text-sm text-neutral-500">
                  <MathText text={payload.figure.caption} />
                </figcaption>
              )}
            </figure>
          )}
          {!statementOpen && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 hidden h-6 bg-gradient-to-t from-white max-md:portrait:block" />
          )}
        </div>
        <button
          type="button"
          onClick={() => setStatementOpen((open) => !open)}
          className="mt-1 hidden items-center gap-1 text-xs font-bold text-sky-500 max-md:portrait:flex"
        >
          {statementOpen ? (
            <>
              <ChevronUp className="h-4 w-4" /> Less
            </>
          ) : (
            <>
              <ChevronDown className="h-4 w-4" /> The whole problem
            </>
          )}
        </button>
      </section>

      {/* Work: canvas and tools, the answer, the read lines and the result. */}
      <section aria-label="Your work" className="flex min-w-0 flex-1 flex-col gap-3">
        <InkToolbar
          className="order-2 md:order-1"
          tool={tool}
          onTool={setTool}
          color={color}
          onColor={setColor}
          width={width}
          onWidth={setWidth}
          canUndo={doc.canUndo}
          canRedo={doc.canRedo}
          onUndo={undo}
          onRedo={redo}
          onClear={() => commit([])}
          onZoom={(factor) => canvas.current?.zoomBy(factor)}
          onResetView={() => canvas.current?.resetView()}
          selectionCount={selectionCount}
          onDeleteSelection={() => canvas.current?.deleteSelection()}
          penSeen={penSeen}
          touchMode={touchMode}
          onTouchMode={setTouchMode}
          disabled={locked}
        />
        <InkCanvas
          ref={canvas}
          className="order-1 h-[52dvh] min-h-[280px] md:order-2 md:h-[58vh] md:landscape:h-[calc(100dvh-300px)] lg:h-[min(64vh,760px)]"
          doc={doc}
          tool={tool}
          color={color}
          width={width}
          touchMode={touchMode}
          readOnly={locked}
          onPenSeen={() => setPenSeen(true)}
          onSelectionChange={setSelectionCount}
        />
        <div className="order-3 -mt-2 flex justify-between gap-2 text-xs text-neutral-400">
          <Link href="/pen-check" target="_blank" className="hover:text-sky-500 hover:underline">
            Pen check
          </Link>
          <span aria-live="polite">
            {draft.status === "saving"
              ? "Saving..."
              : draft.status === "saved"
                ? "Saved"
                : draft.status === "offline"
                  ? "Saved on this device"
                  : ""}
          </span>
        </div>

        <div className="order-4 space-y-3">
          {stage === "review" && (
            <section className="space-y-2 rounded-xl border-2 border-slate-200 bg-white px-3 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-bold text-neutral-600">
                  {reading?.lines.length ? "This is what was read" : "Your lines"}
                </h2>
                <button
                  type="button"
                  onClick={() => setStage("write")}
                  className="flex items-center gap-1 text-xs font-bold text-sky-500 hover:underline"
                >
                  <PenLine className="h-3.5 w-3.5" /> Back to writing
                </button>
              </div>
              <p className="text-xs text-neutral-500">
                {reading?.reused
                  ? "Read before, so no new AI call was made. "
                  : ""}
                Fix any misread symbol; corrections cost no AI call. Lines marked check were
                hard to read.
              </p>
              <RecognizedLines
                lines={lines}
                confidences={confidences}
                onChange={setLines}
                readOnly={locked}
                wrongLine={wrongLine}
              />
            </section>
          )}

          <AnswerBox
            spec={payload.answer}
            answer={answer}
            onChange={setAnswer}
            lastLine={lastLine}
            readOnly={locked}
          />

          {problem && (
            <div className="space-y-2 rounded-xl border-2 border-amber-200 bg-amber-50 px-4 py-3 text-sm text-neutral-700">
              <p>{problem.message}</p>
              <div className="flex flex-wrap gap-3">
                {(problem.aiError === "no-key" || problem.aiError === "auth") && (
                  <Link href="/settings/ai" className="font-bold text-sky-600 hover:underline">
                    Open the AI settings
                  </Link>
                )}
                {problem.offerTyping && (
                  <button
                    type="button"
                    onClick={typeInstead}
                    className="font-bold text-sky-600 hover:underline"
                  >
                    Type the lines instead
                  </button>
                )}
              </div>
            </div>
          )}

          {status === "none" && (
            <div className="flex justify-end">
              <Button
                variant="primary"
                onClick={() => void submit()}
                disabled={!ready}
                className="gap-2"
              >
                {busy ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : stage === "write" && penStrokes ? (
                  <ScanText className="h-4 w-4" />
                ) : null}
                {busy === "reading"
                  ? "Reading..."
                  : busy === "grading"
                    ? "Checking..."
                    : stage === "write" && penStrokes
                      ? "Submit"
                      : "Check my answer"}
              </Button>
            </div>
          )}

          {result && (
            <GradePanel
              key={result.attemptId}
              challengeId={challenge.id}
              result={result}
              lines={gradedLines}
              stale={stale}
              onResult={setResult}
            />
          )}
        </div>
      </section>
    </div>
  );
};
