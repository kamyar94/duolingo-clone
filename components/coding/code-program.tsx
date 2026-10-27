"use client";

import { useEffect, useState } from "react";

import type { ExerciseProps } from "@/components/exercises/types";
import { languageInfo, STARTERS } from "@/lib/coding/languages";
import { runsOnServer, serverRunnerAvailable } from "@/lib/coding/runner";
import type { CodeReadPayload, CodeWritePayload } from "@/lib/coding/types";

import { CodeEditor } from "./code-editor";
import { ConsolePanel } from "./console-panel";
import {
  BrokenExercise,
  LESSON_FOOTER,
  languageOf,
  payloadOf,
  reportTitle,
  RunControls,
  testsOf,
} from "./exercise-utils";
import { ServerNotice, TaskPanel } from "./task-panel";
import { isString, useDraft } from "./use-draft";
import { useCodeRun } from "./use-code-run";
import { Workbench } from "./workbench";

type Payload = CodeReadPayload & CodeWritePayload;

// CODE_READ (run and change a sample, not graded), CODE_WRITE (write a program or function) and
// CODE_FIX (repair a given program). Run is always free; Check runs the visible and hidden tests
// and reports through the lesson, which applies hearts and points.
export const CodeProgramExercise = ({ challenge, status, disabled, setCheck }: ExerciseProps) => {
  const payload = payloadOf<Payload>(challenge.payload);
  const language = languageOf(payload);
  const reading = challenge.type === "CODE_READ";
  const initialCode =
    (reading ? payload.code : payload.starter) ?? (language ? (STARTERS[language] ?? "") : "");
  const tests = testsOf(payload);
  const editable = !reading || payload.editable !== false;

  const [code, setCode] = useDraft(challenge.id, initialCode, isString);
  const runner = useCodeRun();
  const { check, run } = runner;
  const [sheetOpen, setSheetOpen] = useState(false);
  const onServer = language ? runsOnServer(language) && !serverRunnerAvailable() : false;
  const answered = status !== "none";

  const runCode = () => {
    if (!language) return;
    setSheetOpen(true);
    void run({
      language,
      code,
      stdin: payload.stdin,
      setup: payload.setup,
      timeLimitMs: payload.timeLimitMs,
    });
  };

  // What the footer's Check runs. Re-registered whenever the code changes (no stale closures).
  useEffect(() => {
    if (!language) {
      setCheck(null);
      return;
    }
    if (reading) {
      setCheck(() => ({ correct: true }));
      return;
    }
    if (onServer || tests.length === 0) {
      setCheck(null);
      return;
    }
    setCheck(async () => {
      setSheetOpen(true);
      const report = await check({
        language,
        code,
        tests,
        setup: payload.setup,
        timeLimitMs: payload.timeLimitMs,
      });
      // A runtime that could not load is not the learner's mistake: no grade.
      if (report.unavailable) return null;
      return { correct: report.allPassed };
    });
    // tests and payload fields come from the challenge, which does not change while mounted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, language, reading, onServer, setCheck, check]);

  if (!language) return <BrokenExercise what="its payload names no supported language." />;

  const task = (
    <TaskPanel
      question={challenge.question}
      language={language}
      text={payload.text}
      tests={reading ? undefined : tests}
    >
      {onServer && <ServerNotice language={language} />}
    </TaskPanel>
  );

  return (
    <Workbench
      task={task}
      toolbar={
        <>
          <RunControls
            busy={runner.busy}
            onRun={runCode}
            onStop={runner.stop}
            onReset={editable ? () => setCode(initialCode) : undefined}
            disabled={onServer || disabled}
          />
          <span className="ml-auto text-xs text-slate-400">{languageInfo(language).file}</span>
        </>
      }
      editor={
        <CodeEditor
          value={code}
          onChange={setCode}
          mode={language === "web" ? "html" : language}
          readOnly={!editable || (answered && status === "correct")}
          diagnostics={runner.diagnostics}
          fileName={languageInfo(language).file}
          label={`${languageInfo(language).label} code`}
          className="h-full"
        />
      }
      output={<ConsolePanel lines={runner.lines} report={runner.report} busy={runner.busy} />}
      outputTitle={reportTitle(runner.report, runner.busy)}
      outputOpen={sheetOpen}
      onOutputOpenChange={setSheetOpen}
      sheetOffset={LESSON_FOOTER}
    />
  );
};
