"use client";

import { useCallback, useMemo, useState, type ReactNode, type RefObject } from "react";

import { cn } from "@/lib/utils";

import { CodeEditor, type LineDiagnostic } from "./code-editor";
import { ConsolePanel } from "./console-panel";
import { reportTitle, RunControls } from "./exercise-utils";
import type { useCodeRun } from "./use-code-run";
import { WebPreview, type WebFiles, type WebPreviewHandle } from "./web-preview";
import { Workbench } from "./workbench";

export type WebTab = "html" | "css" | "js";

const TABS: { tab: WebTab; label: string; mode: "html" | "css" | "javascript"; file: string }[] = [
  { tab: "html", label: "HTML", mode: "html", file: "index.html" },
  { tab: "css", label: "CSS", mode: "css", file: "style.css" },
  { tab: "js", label: "JavaScript", mode: "javascript", file: "script.js" },
];

export type AppliedScript = { js: string; run: number };

/** What the preview shows: the HTML and CSS as typed, the JavaScript as last applied. */
export const previewFilesFor = (files: WebFiles, applied: AppliedScript): WebFiles => ({
  html: applied.run ? `${files.html}\n<!-- run ${applied.run} -->` : files.html,
  css: files.css,
  js: applied.js,
});

type WebWorkspaceProps = {
  files: WebFiles;
  onChange: (tab: WebTab, text: string) => void;
  onReset?: () => void;
  editable?: WebTab[];
  disabled?: boolean;
  previewRef: RefObject<WebPreviewHandle | null>;
  runner: ReturnType<typeof useCodeRun>;
  /** The JavaScript the preview runs: applied with Run (and Check), not on every key. */
  applied: AppliedScript;
  onApply: (applied: AppliedScript) => void;
  task?: ReactNode;
  sheetOpen: boolean;
  onSheetOpenChange: (open: boolean) => void;
  sheetOffset?: string;
};

// The web editor shared by WEB_LIVE and the playground: three tabs, a live preview of HTML and
// CSS that re-renders shortly after typing stops, and the page's console. JavaScript runs when
// the learner presses Run, so a half-typed loop cannot lock up the page.
export const WebWorkspace = ({
  files,
  onChange,
  onReset,
  editable = ["html", "css", "js"],
  disabled,
  previewRef,
  runner,
  applied,
  onApply,
  task,
  sheetOpen,
  onSheetOpenChange,
  sheetOffset,
}: WebWorkspaceProps) => {
  const [tab, setTab] = useState<WebTab>(editable[0] ?? "html");
  const [jsErrors, setJsErrors] = useState<LineDiagnostic[]>([]);
  const { setLines } = runner;
  const current = TABS.find((entry) => entry.tab === tab)!;

  const previewFiles = useMemo(() => previewFilesFor(files, applied), [files, applied]);

  const onConsole = useCallback(
    (stream: "stdout" | "stderr", text: string) =>
      setLines((previous) => [...previous, { stream, text }].slice(-500)),
    [setLines]
  );
  const onError = useCallback(
    (message: string, line: number) => {
      setLines((previous) => [
        ...previous,
        { stream: "error", text: line ? `script.js line ${line}: ${message}` : message },
      ]);
      if (line) setJsErrors((previous) => [...previous, { line, message }].slice(-20));
    },
    [setLines]
  );
  const onReload = useCallback(() => {
    setLines([]);
    setJsErrors([]);
  }, [setLines]);

  const output = (
    <div className="flex h-full min-h-[320px] flex-col gap-2">
      <WebPreview
        ref={previewRef}
        files={previewFiles}
        onConsole={onConsole}
        onError={onError}
        onReload={onReload}
        className="min-h-[180px] flex-1"
      />
      {(runner.lines.length > 0 || runner.report) && (
        <ConsolePanel lines={runner.lines} report={runner.report} className="max-h-48 shrink-0" />
      )}
    </div>
  );

  return (
    <Workbench
      task={task}
      toolbar={
        <>
          <RunControls
            busy={false}
            runLabel="Run"
            onRun={() => {
              onApply({ js: files.js, run: applied.run + 1 });
              onSheetOpenChange(true);
            }}
            onReset={onReset}
            disabled={disabled}
          />
          <div role="tablist" aria-label="Files" className="ml-auto flex gap-1">
            {TABS.map((entry) => (
              <button
                key={entry.tab}
                type="button"
                role="tab"
                aria-selected={tab === entry.tab}
                onClick={() => setTab(entry.tab)}
                data-exercise-keys
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-wide",
                  tab === entry.tab ? "bg-sky-100 text-sky-700" : "text-slate-500 hover:bg-slate-100"
                )}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </>
      }
      editor={
        <CodeEditor
          key={tab}
          value={files[tab]}
          onChange={(text) => onChange(tab, text)}
          mode={current.mode}
          readOnly={!editable.includes(tab) || disabled}
          diagnostics={tab === "js" ? jsErrors : undefined}
          fileName={current.file}
          label={`${current.label} of the page`}
          className="h-full"
        />
      }
      output={output}
      outputTitle={runner.report ? reportTitle(runner.report, false) : "Preview"}
      outputOpen={sheetOpen}
      onOutputOpenChange={onSheetOpenChange}
      sheetOffset={sheetOffset}
    />
  );
};
