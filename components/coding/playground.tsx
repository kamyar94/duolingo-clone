"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { Copy, FilePlus2, FolderOpen, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  copySnippet,
  createSnippet,
  deleteSnippet,
  getSnippet,
  renameSnippet,
  saveSnippet,
} from "@/actions/code-snippets";
import { Button } from "@/components/ui/button";
import {
  CODE_LANGUAGES,
  isCodeLanguage,
  LANGUAGE_IDS,
  languageInfo,
  STARTERS,
  WEB_STARTER,
  type CodeLanguage,
} from "@/lib/coding/languages";
import { runsOnServer, serverRunnerAvailable } from "@/lib/coding/runner";
import { snippetFileNames, type SnippetFiles } from "@/lib/coding/snippets";
import { cn } from "@/lib/utils";

import { CodeEditor } from "./code-editor";
import { ConsolePanel } from "./console-panel";
import { reportTitle, RunControls } from "./exercise-utils";
import { ServerNotice } from "./task-panel";
import { useCodeRun } from "./use-code-run";
import type { WebFiles, WebPreviewHandle } from "./web-preview";
import { WebWorkspace, type AppliedScript, type WebTab } from "./web-workspace";
import { Workbench } from "./workbench";

export type SnippetSummary = {
  id: number;
  name: string;
  language: string;
  updatedAt: Date | string;
};

type Program = {
  id: number | null;
  name: string;
  language: CodeLanguage;
  files: SnippetFiles;
};

const AUTOSAVE_MS = 1500;

const starterFiles = (language: CodeLanguage): SnippetFiles =>
  language === "web"
    ? { ...WEB_STARTER }
    : { [languageInfo(language).file]: STARTERS[language] ?? "" };

const newProgram = (language: CodeLanguage): Program => ({
  id: null,
  name: `Untitled ${languageInfo(language).label} program`,
  language,
  files: starterFiles(language),
});

const toWeb = (files: SnippetFiles): WebFiles => ({
  html: files["index.html"] ?? "",
  css: files["style.css"] ?? "",
  js: files["script.js"] ?? "",
});

const WEB_FILE: Record<WebTab, string> = { html: "index.html", css: "style.css", js: "script.js" };

// The playground (section 4.1): the lesson editor for any supported language, with no task and
// no grading, and programs saved to the account by name.
export const Playground = ({ initialSnippets }: { initialSnippets: SnippetSummary[] }) => {
  const [snippets, setSnippets] = useState(initialSnippets);
  const [program, setProgram] = useState<Program>(() => newProgram("python"));
  const [dirty, setDirty] = useState(false);
  const [stdin, setStdin] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [applied, setApplied] = useState<AppliedScript>({ js: WEB_STARTER["script.js"], run: 0 });
  const [pending, startTransition] = useTransition();
  const runner = useCodeRun();
  const preview = useRef<WebPreviewHandle>(null);
  const latest = useRef(program);

  useEffect(() => {
    latest.current = program;
  }, [program]);

  const touch = (id: number, name?: string) =>
    setSnippets((previous) => {
      const found = previous.find((item) => item.id === id);
      const updated: SnippetSummary = {
        id,
        name: name ?? found?.name ?? "",
        language: found?.language ?? latest.current.language,
        updatedAt: new Date(),
      };
      return [updated, ...previous.filter((item) => item.id !== id)];
    });

  const save = useCallback(async () => {
    const current = latest.current;
    if (current.id === null) {
      const created = await createSnippet(current.name, current.language, current.files);
      if ("error" in created) {
        toast.error(created.error);
        return;
      }
      setProgram((previous) => ({ ...previous, id: created.id, name: created.name }));
      setSnippets((previous) => [
        { id: created.id, name: created.name, language: current.language, updatedAt: new Date() },
        ...previous,
      ]);
    } else {
      const saved = await saveSnippet(current.id, current.files);
      if ("error" in saved) {
        toast.error(saved.error);
        return;
      }
    }
    setDirty(false);
  }, []);

  // Saved programs save themselves a moment after each change.
  useEffect(() => {
    if (!dirty || program.id === null) return;
    const timer = setTimeout(() => {
      void save().then(() => program.id !== null && touch(program.id));
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [dirty, program.files, program.id, save]);

  const setFile = (name: string, text: string) => {
    setProgram((previous) => ({ ...previous, files: { ...previous.files, [name]: text } }));
    setDirty(true);
  };

  const open = (id: number) =>
    startTransition(async () => {
      if (dirty && program.id !== null) await save();
      const row = await getSnippet(id);
      if (!row || !isCodeLanguage(row.language)) {
        toast.error("This program could not be opened.");
        return;
      }
      const files = (row.files ?? {}) as SnippetFiles;
      setProgram({ id: row.id, name: row.name, language: row.language, files });
      if (row.language === "web") setApplied({ js: files["script.js"] ?? "", run: 0 });
      setDirty(false);
      runner.reset();
    });

  const create = (language: CodeLanguage) => {
    setProgram(newProgram(language));
    if (language === "web") setApplied({ js: WEB_STARTER["script.js"], run: 0 });
    setDirty(false);
    runner.reset();
  };

  const rename = (name: string) => {
    setProgram((previous) => ({ ...previous, name }));
    if (program.id === null) return;
    const id = program.id;
    startTransition(async () => {
      const result = await renameSnippet(id, name);
      if ("error" in result) toast.error(result.error);
      else touch(id, result.name);
    });
  };

  const copy = () => {
    if (program.id === null) return;
    const id = program.id;
    startTransition(async () => {
      const result = await copySnippet(id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setSnippets((previous) => [
        { id: result.id, name: result.name, language: program.language, updatedAt: new Date() },
        ...previous,
      ]);
      setProgram((previous) => ({ ...previous, id: result.id, name: result.name }));
      toast.success(`Saved as ${result.name}.`);
    });
  };

  const remove = () => {
    if (program.id === null) return;
    if (!window.confirm(`Delete ${program.name}? This cannot be undone.`)) return;
    const id = program.id;
    startTransition(async () => {
      await deleteSnippet(id);
      setSnippets((previous) => previous.filter((item) => item.id !== id));
      create(program.language);
    });
  };

  const language = program.language;
  const onServer = runsOnServer(language) && !serverRunnerAvailable();
  const file = snippetFileNames(language)[0];

  const programs = (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="block text-xs font-bold uppercase tracking-wide text-slate-500" htmlFor="program-name">
          Program
        </label>
        <input
          id="program-name"
          key={program.id ?? `new-${program.language}`}
          defaultValue={program.name}
          maxLength={80}
          onBlur={(event) => {
            if (event.target.value.trim() && event.target.value !== program.name) rename(event.target.value);
          }}
          className="w-full rounded-xl border-2 border-slate-200 px-3 py-2 text-sm font-bold text-neutral-700 focus:border-sky-300 focus:outline-none"
        />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => startTransition(save)} disabled={pending}>
            <Save className="mr-2 h-4 w-4" /> {program.id === null ? "Save" : dirty ? "Save" : "Saved"}
          </Button>
          <Button size="sm" variant="ghost" onClick={copy} disabled={pending || program.id === null}>
            <Copy className="mr-2 h-4 w-4" /> Copy
          </Button>
          <Button size="sm" variant="ghost" onClick={remove} disabled={pending || program.id === null}>
            <Trash2 className="mr-2 h-4 w-4" /> Delete
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <label className="block text-xs font-bold uppercase tracking-wide text-slate-500" htmlFor="new-program">
          New program
        </label>
        <div className="flex gap-2">
          <select
            id="new-program"
            className="min-w-0 flex-1 rounded-xl border-2 border-slate-200 bg-white px-2 py-2 text-sm"
            defaultValue=""
            onChange={(event) => {
              if (isCodeLanguage(event.target.value)) create(event.target.value);
              event.target.value = "";
            }}
          >
            <option value="" disabled>
              Choose a language…
            </option>
            {LANGUAGE_IDS.map((id) => (
              <option key={id} value={id}>
                {CODE_LANGUAGES[id].label}
                {runsOnServer(id) ? " (server)" : ""}
              </option>
            ))}
          </select>
          <FilePlus2 className="mt-2.5 h-5 w-5 shrink-0 text-slate-400" aria-hidden />
        </div>
      </div>

      {language !== "web" && language !== "sql" && !onServer && (
        <div className="space-y-2">
          <label className="block text-xs font-bold uppercase tracking-wide text-slate-500" htmlFor="stdin">
            Input for input()
          </label>
          <textarea
            id="stdin"
            value={stdin}
            onChange={(event) => setStdin(event.target.value)}
            rows={3}
            spellCheck={false}
            className="w-full rounded-xl border-2 border-slate-200 p-2 font-mono text-xs focus:border-sky-300 focus:outline-none"
            placeholder="One line per input() call"
          />
        </div>
      )}

      {onServer && <ServerNotice language={language} />}

      <details open className="group">
        <summary className="flex cursor-pointer items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
          <FolderOpen className="h-4 w-4" /> My programs ({snippets.length})
        </summary>
        <ul className="mt-2 max-h-72 space-y-1 overflow-auto">
          {snippets.length === 0 && <li className="text-sm text-slate-400">Nothing saved yet.</li>}
          {snippets.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => open(item.id)}
                disabled={pending}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-100",
                  item.id === program.id && "bg-sky-50 font-bold text-sky-700"
                )}
              >
                <span className="truncate">{item.name}</span>
                <span className="shrink-0 text-xs text-slate-400">
                  {isCodeLanguage(item.language) ? CODE_LANGUAGES[item.language].label : item.language}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );

  if (language === "web")
    return (
      <WebWorkspace
        key={program.id ?? "new-web"}
        files={toWeb(program.files)}
        onChange={(tab, text) => setFile(WEB_FILE[tab], text)}
        previewRef={preview}
        runner={runner}
        applied={applied}
        onApply={setApplied}
        task={programs}
        sheetOpen={sheetOpen}
        onSheetOpenChange={setSheetOpen}
      />
    );

  return (
    <Workbench
      task={programs}
      toolbar={
        <>
          <RunControls
            busy={runner.busy}
            disabled={onServer}
            onRun={() => {
              setSheetOpen(true);
              void runner.run({ language, code: program.files[file] ?? "", stdin });
            }}
            onStop={runner.stop}
          />
          <span className="ml-auto text-xs text-slate-400">
            {languageInfo(language).label} · {file}
          </span>
        </>
      }
      editor={
        <CodeEditor
          key={`${program.id ?? "new"}-${language}`}
          value={program.files[file] ?? ""}
          onChange={(text) => setFile(file, text)}
          mode={language}
          diagnostics={runner.diagnostics}
          fileName={file}
          label={`${languageInfo(language).label} code`}
          className="h-full"
        />
      }
      output={<ConsolePanel lines={runner.lines} busy={runner.busy} />}
      outputTitle={reportTitle(null, runner.busy)}
      outputOpen={sheetOpen}
      onOutputOpenChange={setSheetOpen}
    />
  );
};
