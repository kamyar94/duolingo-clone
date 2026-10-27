"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import { browserRunner, runProgram } from "@/lib/coding/browser-runner";
import { checkProgram, type CheckOptions } from "@/lib/coding/check";
import type { LineDiagnostic } from "@/lib/coding/editor/setup";
import { serverRunner } from "@/lib/coding/runner";
import type {
  CheckReport,
  RunError,
  RunEvent,
  RunRequest,
  RunResult,
} from "@/lib/coding/types";

export type ConsoleLine = {
  stream: RunEvent["stream"] | "error";
  text: string;
};

const MAX_LINES = 2000;

const addEvent = (lines: ConsoleLine[], event: ConsoleLine) => {
  const last = lines.at(-1);
  // Chunks of the same stream join until a line ends, so the console stays small.
  if (last && last.stream === event.stream && !last.text.endsWith("\n"))
    return [...lines.slice(0, -1), { ...last, text: last.text + event.text }];
  const next = [...lines, event];
  return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
};

const describeEnd = (result: RunResult): ConsoleLine | null => {
  if (result.status === "timeout")
    return { stream: "error", text: "The program took too long and was stopped." };
  if (result.status === "cancelled") return { stream: "info", text: "Stopped." };
  if (result.error)
    return {
      stream: "error",
      text: result.error.line ? `Line ${result.error.line}: ${result.error.message}` : result.error.message,
    };
  return null;
};

/** Running and checking programs from a component, with a console fed while the program runs. */
export const useCodeRun = () => {
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const [busy, setBusy] = useState<false | "run" | "check">(false);
  const [report, setReport] = useState<CheckReport | null>(null);
  const [error, setError] = useState<RunError | null>(null);
  const generation = useRef(0);

  const onEvent = useCallback((event: RunEvent) => {
    setLines((previous) => addEvent(previous, event));
  }, []);

  const run = useCallback(
    async (request: RunRequest) => {
      const mine = ++generation.current;
      setBusy("run");
      setLines([]);
      setReport(null);
      setError(null);
      const result = await runProgram(request, (event) => {
        if (generation.current === mine) onEvent(event);
      });
      if (generation.current === mine) {
        const end = describeEnd(result);
        if (end) setLines((previous) => addEvent(previous, end));
        else if (!result.stdout && !result.stderr && !result.sets?.length)
          setLines((previous) =>
            previous.some((line) => line.stream !== "info")
              ? previous
              : addEvent(previous, { stream: "info", text: "The program printed nothing." })
          );
        setError(result.error ?? null);
        setBusy(false);
      }
      return result;
    },
    [onEvent]
  );

  const check = useCallback(
    async (options: Omit<CheckOptions, "onEvent">) => {
      const mine = ++generation.current;
      setBusy("check");
      setLines([]);
      setReport(null);
      setError(null);
      let result: CheckReport;
      try {
        result = await checkProgram(runProgram, {
          ...options,
          onEvent: (event) => {
            if (generation.current === mine) onEvent(event);
          },
        });
      } catch (failure) {
        result = {
          outcomes: [],
          passed: 0,
          total: 0,
          allPassed: false,
          unavailable: failure instanceof Error ? failure.message : String(failure),
        };
      }
      if (generation.current === mine) {
        setReport(result);
        setError(result.error ?? null);
        if (result.unavailable)
          setLines((previous) => addEvent(previous, { stream: "error", text: result.unavailable! }));
        setBusy(false);
      }
      return result;
    },
    [onEvent]
  );

  const stop = useCallback(() => {
    browserRunner.cancel?.();
    serverRunner.cancel?.();
  }, []);

  const reset = useCallback(() => {
    generation.current++;
    setLines([]);
    setReport(null);
    setError(null);
    setBusy(false);
  }, []);

  const showReport = useCallback((next: CheckReport | null) => setReport(next), []);

  const diagnostics = useMemo(() => diagnosticsFor(error, report), [error, report]);

  return { lines, busy, report, error, diagnostics, run, check, stop, reset, showReport, setLines };
};

/** Line markers in the editor: the run's error, then failing tests that point at a line. */
export const diagnosticsFor = (
  error: RunError | null,
  report: CheckReport | null
): LineDiagnostic[] => {
  const items: LineDiagnostic[] = [];
  if (error?.line) items.push({ line: error.line, message: error.message, severity: "error" });
  for (const outcome of report?.outcomes ?? []) {
    if (outcome.passed || !outcome.line || outcome.line === error?.line) continue;
    items.push({
      line: outcome.line,
      severity: "warning",
      message: outcome.visible
        ? `${outcome.name}: ${outcome.message ?? "failed"}`
        : `${outcome.name} (hidden) failed`,
    });
  }
  return items;
};
