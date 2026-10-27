"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ExerciseProps } from "@/components/exercises/types";
import { webCheckOutcomes } from "@/lib/coding/sandbox";
import { summarize } from "@/lib/coding/tests";
import type { WebCheck, WebLivePayload } from "@/lib/coding/types";

import {
  previewFilesFor,
  WebWorkspace,
  type AppliedScript,
  type WebTab,
} from "./web-workspace";
import { useCodeRun } from "./use-code-run";
import { useDraft } from "./use-draft";
import type { WebFiles, WebPreviewHandle } from "./web-preview";
import { LESSON_FOOTER, payloadOf } from "./exercise-utils";
import { Prose } from "./task-panel";

const isWebFiles = (value: unknown): value is WebFiles =>
  typeof value === "object" &&
  value !== null &&
  ["html", "css", "js"].every((key) => typeof (value as Record<string, unknown>)[key] === "string");

const describeCheck = (check: WebCheck) => {
  if (check.name) return check.name;
  const parts = [check.selector];
  if (typeof check.count === "number") parts.push(`${check.count} element(s)`);
  if (check.text !== undefined) parts.push(`text "${check.text}"`);
  for (const [key, value] of Object.entries(check.style ?? {})) parts.push(`${key}: ${value}`);
  for (const [key, value] of Object.entries(check.attr ?? {})) parts.push(`${key}="${value}"`);
  return parts.join(", ");
};

// WEB_LIVE: edit HTML, CSS and JavaScript with a live preview; Check runs selector checks on the
// rendered page.
export const WebLiveExercise = ({ challenge, status, disabled, setCheck }: ExerciseProps) => {
  const payload = payloadOf<WebLivePayload>(challenge.payload);
  const initial: WebFiles = { html: payload.html ?? "", css: payload.css ?? "", js: payload.js ?? "" };
  const checks = Array.isArray(payload.checks) ? payload.checks : [];
  const editable = (payload.editable ?? ["html", "css", "js"]) as WebTab[];

  const [files, setFiles] = useDraft(challenge.id, initial, isWebFiles);
  const runner = useCodeRun();
  const { showReport } = runner;
  const preview = useRef<WebPreviewHandle>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [applied, setApplied] = useState<AppliedScript>({ js: initial.js, run: 0 });
  const answered = status !== "none";

  // Check applies the current JavaScript, then runs the checks on exactly that page.
  const runChecks = useCallback(async () => {
    setSheetOpen(true);
    const next = { js: files.js, run: applied.run + 1 };
    setApplied(next);
    const results = (await preview.current?.check(checks, previewFilesFor(files, next))) ?? [];
    const report = summarize(webCheckOutcomes(checks, results));
    showReport(report);
    return report;
    // checks come from the challenge, which does not change while mounted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, applied.run, showReport]);

  useEffect(() => {
    if (!checks.length) {
      setCheck(null);
      return;
    }
    setCheck(async () => ({ correct: (await runChecks()).allPassed }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runChecks, setCheck]);

  const visible = checks.filter((check) => check.visible !== false);
  const hidden = checks.length - visible.length;

  return (
    <WebWorkspace
      files={files}
      onChange={(tab, text) => setFiles((previous) => ({ ...previous, [tab]: text }))}
      onReset={() => setFiles(initial)}
      editable={answered && status === "correct" ? [] : editable}
      disabled={disabled}
      previewRef={preview}
      runner={runner}
      applied={applied}
      onApply={setApplied}
      sheetOpen={sheetOpen}
      onSheetOpenChange={setSheetOpen}
      sheetOffset={LESSON_FOOTER}
      task={
        <div className="space-y-4">
          <span className="inline-flex items-center rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-sky-700">
            HTML, CSS and JavaScript
          </span>
          <h1 className="text-lg font-bold text-neutral-700 lg:text-2xl">{challenge.question}</h1>
          <Prose text="Change the page until it passes the checks. The preview updates as you type; press Run to apply your JavaScript." />
          {checks.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Checks</p>
              <ul className="space-y-1.5">
                {visible.map((check, i) => (
                  <li key={i} className="rounded-lg bg-slate-50 px-2.5 py-1.5 font-mono text-xs text-neutral-700">
                    {describeCheck(check)}
                  </li>
                ))}
              </ul>
              {hidden > 0 && (
                <p className="text-xs text-slate-500">
                  and {hidden} hidden {hidden === 1 ? "check" : "checks"}
                </p>
              )}
            </div>
          )}
        </div>
      }
    />
  );
};
