"use client";

import { useEffect, useRef } from "react";

import { CheckCircle2, EyeOff, Loader2, XCircle } from "lucide-react";

import type { CheckReport, TestOutcome } from "@/lib/coding/types";
import { cn } from "@/lib/utils";

import type { ConsoleLine } from "./use-code-run";

const STREAM_CLASS: Record<ConsoleLine["stream"], string> = {
  stdout: "text-neutral-800",
  stderr: "text-rose-600",
  info: "italic text-slate-500",
  error: "font-semibold text-rose-600",
};

const Outcome = ({ outcome }: { outcome: TestOutcome }) => (
  <li
    className={cn(
      "rounded-lg border px-3 py-2",
      outcome.passed ? "border-green-200 bg-green-50" : "border-rose-200 bg-rose-50"
    )}
  >
    <div className="flex items-center gap-2 text-sm font-bold">
      {outcome.passed ? (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
      ) : (
        <XCircle className="h-4 w-4 shrink-0 text-rose-600" />
      )}
      <span className="text-neutral-700">{outcome.name}</span>
      {!outcome.visible && (
        <span className="ml-auto flex items-center gap-1 text-xs font-normal text-slate-500">
          <EyeOff className="h-3 w-3" /> hidden
        </span>
      )}
      {outcome.visible && outcome.line && !outcome.passed && (
        <span className="ml-auto text-xs font-normal text-slate-500">line {outcome.line}</span>
      )}
    </div>
    {outcome.visible && !outcome.passed && (
      <div className="mt-2 space-y-2 text-xs">
        {outcome.message && <p className="text-rose-700">{outcome.message}</p>}
        {(outcome.expected !== undefined || outcome.actual !== undefined) && (
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <p className="mb-1 font-semibold text-slate-500">Expected</p>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-white p-2 font-mono text-neutral-800">
                {outcome.expected ?? ""}
              </pre>
            </div>
            <div>
              <p className="mb-1 font-semibold text-slate-500">Actual</p>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-white p-2 font-mono text-neutral-800">
                {outcome.actual ?? ""}
              </pre>
            </div>
          </div>
        )}
      </div>
    )}
  </li>
);

export const TestReport = ({ report }: { report: CheckReport }) => {
  if (report.unavailable) return null;
  return (
    <div className="space-y-2">
      <p
        className={cn(
          "text-sm font-bold",
          report.allPassed ? "text-green-600" : "text-rose-600"
        )}
      >
        {report.total === 0
          ? "No tests ran."
          : `${report.passed} of ${report.total} ${report.total === 1 ? "test" : "tests"} passed`}
      </p>
      <ul className="space-y-2">
        {report.outcomes.map((outcome) => (
          <Outcome key={outcome.index} outcome={outcome} />
        ))}
      </ul>
    </div>
  );
};

type ConsolePanelProps = {
  lines: ConsoleLine[];
  report?: CheckReport | null;
  busy?: false | "run" | "check";
  className?: string;
  emptyText?: string;
};

// Program output (streamed while it runs), errors with their line, and test results.
export const ConsolePanel = ({
  lines,
  report,
  busy,
  className,
  emptyText = "Run the program to see its output here.",
}: ConsolePanelProps) => {
  const box = useRef<HTMLDivElement>(null);
  // Follow the output as it streams, without scrolling the page itself.
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [lines]);

  return (
    <div
      ref={box}
      className={cn("flex h-full flex-col gap-3 overflow-auto", className)}
      aria-live="polite"
    >
      {busy && (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          {busy === "check" ? "Checking…" : "Running…"}
        </p>
      )}
      {lines.length > 0 ? (
        <pre className="whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 font-mono text-[13px] leading-relaxed">
          {lines.map((line, i) => (
            <span key={i} className={cn("block", STREAM_CLASS[line.stream])}>
              {line.text.replace(/\n$/, "")}
            </span>
          ))}
        </pre>
      ) : (
        !busy && !report && <p className="text-sm text-slate-400">{emptyText}</p>
      )}
      {report && <TestReport report={report} />}
    </div>
  );
};
