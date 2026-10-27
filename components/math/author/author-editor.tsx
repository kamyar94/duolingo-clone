"use client";

// Author mode for animated solutions (docs/DESIGN-coding-and-math.md, section 5.6). An admin
// edits a problem's script in tabs (question and givens, equations, visuals, steps, JSON),
// sees it play in the preview beside the editor, drafts a first script with the AI, and saves
// it as a new version; earlier versions stay and can be loaded again.
import { useEffect, useMemo, useRef, useState } from "react";

import dynamic from "next/dynamic";
import { LoaderCircle, Save, Sparkles, TriangleAlert } from "lucide-react";

import { emptyScript } from "@/lib/math/solution/authoring";
import type { SolutionScript, SolutionVersionInfo } from "@/lib/math/solution/types";
import { validateSolutionScript } from "@/lib/math/solution/validate";
import { cn } from "@/lib/utils";

import { MathText } from "../math-text";
import { draftSolutionWithAi, fetchSolution, saveSolutionVersion, SolutionApiError } from "../solution/api";

import { EquationEditor } from "./equation-editor";
import { SmallButton, type Edit } from "./fields";
import { QuestionEditor } from "./question-editor";
import { StepsEditor } from "./steps-editor";
import { VisualsEditor } from "./visuals-editor";

const SolutionPlayer = dynamic(() => import("../solution/player").then((module) => module.SolutionPlayer), {
  ssr: false,
  loading: () => <p className="py-10 text-center text-sm text-neutral-400">Loading the preview...</p>,
});

export type AuthorProblem = {
  id: number;
  question: string;
  statement: string;
  answer: string;
  solution: string[];
};

type AuthorEditorProps = {
  problem: AuthorProblem;
  initial: { version: number; script: SolutionScript } | null;
  versions: SolutionVersionInfo[];
};

const TABS = ["Question", "Equations", "Visuals", "Steps", "JSON"] as const;
type Tab = (typeof TABS)[number];

export const AuthorEditor = ({ problem, initial, versions: initialVersions }: AuthorEditorProps) => {
  const [script, setScript] = useState<SolutionScript>(
    () => initial?.script ?? emptyScript(problem.statement, problem.question.slice(0, 80))
  );
  const scriptRef = useRef(script);
  const [versions, setVersions] = useState(initialVersions);
  const [baseVersion, setBaseVersion] = useState<number | null>(initialVersions[0]?.version ?? null);
  const [loadedVersion, setLoadedVersion] = useState<number | null>(initial?.version ?? null);
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<Tab>("Question");
  const [busy, setBusy] = useState<"save" | "draft" | "load" | null>(null);
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string; problems?: string[] } | null>(null);
  const [conflict, setConflict] = useState(false);
  const [preview, setPreview] = useState({ key: 0, step: 0 });
  const [json, setJson] = useState("");

  const edit: Edit = (change) => {
    const next = structuredClone(scriptRef.current);
    change(next);
    scriptRef.current = next;
    setScript(next);
    setDirty(true);
  };

  const replace = (next: SolutionScript, dirtyAfter: boolean) => {
    scriptRef.current = next;
    setScript(next);
    setDirty(dirtyAfter);
    setPreview((current) => ({ key: current.key + 1, step: 0 }));
  };

  const checked = useMemo(() => validateSolutionScript(script), [script]);
  // The preview keeps playing the last valid script while the current one has problems.
  const [lastValid, setLastValid] = useState<SolutionScript | null>(checked.script);
  if (checked.script && checked.script !== lastValid) setLastValid(checked.script);

  // Leaving with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const showTab = (next: Tab) => {
    if (next === "JSON") setJson(JSON.stringify(scriptRef.current, null, 2));
    setTab(next);
  };

  const save = async (force = false) => {
    if (!checked.script) return;
    setBusy("save");
    setMessage(null);
    try {
      const saved = await saveSolutionVersion({ challengeId: problem.id, script: checked.script, baseVersion, force });
      setVersions(saved.versions);
      setBaseVersion(saved.version);
      setLoadedVersion(saved.version);
      setDirty(false);
      setConflict(false);
      setMessage({ tone: "info", text: `Saved as version ${saved.version}. Earlier versions stay available.` });
    } catch (error) {
      const failure = error instanceof SolutionApiError ? error : null;
      setConflict(failure?.status === 409 && /saved after/.test(failure.message));
      setMessage({ tone: "error", text: failure?.message ?? "The script could not be saved.", problems: failure?.problems });
    } finally {
      setBusy(null);
    }
  };

  const draft = async () => {
    if (dirty && !window.confirm("Replace the script in the editor with an AI draft? Unsaved changes are lost.")) return;
    setBusy("draft");
    setMessage(null);
    try {
      const result = await draftSolutionWithAi(problem.id);
      replace(result.script, true);
      setLoadedVersion(null);
      setMessage({ tone: "info", text: `A draft from ${result.provider} (${result.model}). Check every step, then save it.` });
    } catch (error) {
      const failure = error instanceof SolutionApiError ? error : null;
      setMessage({ tone: "error", text: failure?.message ?? "No draft came back.", problems: failure?.problems });
    } finally {
      setBusy(null);
    }
  };

  const load = async (version: number) => {
    if (dirty && !window.confirm(`Load version ${version}? Unsaved changes are lost.`)) return;
    setBusy("load");
    setMessage(null);
    try {
      const loaded = await fetchSolution(problem.id, version);
      replace(loaded.script, false);
      setLoadedVersion(version);
      if (loaded.versions) {
        setVersions(loaded.versions);
        setBaseVersion(loaded.versions[0]?.version ?? null);
      }
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof SolutionApiError ? error.message : "That version could not be loaded." });
    } finally {
      setBusy(null);
    }
  };

  const applyJson = () => {
    try {
      const parsed = JSON.parse(json) as SolutionScript;
      edit((draftScript) => {
        for (const key of Object.keys(draftScript)) delete (draftScript as Record<string, unknown>)[key];
        Object.assign(draftScript, parsed);
      });
      setMessage({ tone: "info", text: "The JSON was applied." });
    } catch {
      setMessage({ tone: "error", text: "That is not valid JSON." });
    }
  };

  const next = (versions[0]?.version ?? 0) + 1;

  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-xl border-2 border-slate-200 bg-white p-3">
        <MathText text={problem.statement} className="text-sm text-neutral-700" />
        <p className="text-xs text-neutral-500">
          Expected answer: <span className="font-mono">{problem.answer}</span>
          {problem.solution.length > 0 && <> · Reference solution: <span className="font-mono">{problem.solution.join("  |  ")}</span></>}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-xs font-bold text-neutral-500">
          Version
          <select
            value={loadedVersion ?? ""}
            onChange={(event) => event.target.value && void load(Number(event.target.value))}
            className="rounded-lg border-2 border-slate-200 px-1 py-1 text-sm font-normal"
            disabled={busy !== null}
          >
            <option value="">{loadedVersion === null ? "unsaved" : ""}</option>
            {versions.map((version) => (
              <option key={version.version} value={version.version}>
                {version.version} · {new Date(version.createdAt).toLocaleString()}
                {version.author ? ` · ${version.author}` : ""}
              </option>
            ))}
          </select>
        </label>
        {dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
        <div className="ml-auto flex flex-wrap gap-2">
          <SmallButton onClick={draft} disabled={busy !== null} title="Ask your own AI provider for a first script">
            {busy === "draft" ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            Draft with AI
          </SmallButton>
          <SmallButton tone="primary" onClick={() => save(false)} disabled={busy !== null || !checked.script}>
            {busy === "save" ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            Save as version {next}
          </SmallButton>
        </div>
      </div>

      {message && (
        <div className={cn("rounded-lg px-3 py-2 text-sm", message.tone === "error" ? "bg-rose-50 text-rose-700" : "bg-sky-50 text-sky-800")}>
          <p>{message.text}</p>
          {conflict && (
            <button type="button" className="mt-1 text-xs font-bold underline" onClick={() => save(true)}>
              Save anyway as version {next}
            </button>
          )}
          {message.problems && message.problems.length > 0 && (
            <ul className="mt-1 list-disc pl-5 font-mono text-xs">
              {message.problems.slice(0, 12).map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!checked.script && (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <p className="flex items-center gap-1 font-bold">
            <TriangleAlert className="h-3.5 w-3.5" /> {checked.problems.length} problem{checked.problems.length === 1 ? "" : "s"} to fix before saving
          </p>
          <ul className="mt-1 list-disc pl-5 font-mono">
            {checked.problems.slice(0, 8).map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="min-w-0 space-y-3">
          <div role="tablist" className="flex flex-wrap gap-1">
            {TABS.map((name) => (
              <button
                key={name}
                type="button"
                role="tab"
                aria-selected={tab === name}
                onClick={() => showTab(name)}
                className={cn(
                  "rounded-lg px-3 py-1 text-sm font-bold",
                  tab === name ? "bg-sky-100 text-sky-700" : "text-neutral-500 hover:bg-slate-100"
                )}
              >
                {name}
              </button>
            ))}
          </div>
          {tab === "Question" && <QuestionEditor script={script} edit={edit} statement={problem.statement} />}
          {tab === "Equations" && <EquationEditor script={script} edit={edit} />}
          {tab === "Visuals" && <VisualsEditor script={script} edit={edit} />}
          {tab === "Steps" && (
            <StepsEditor
              script={script}
              edit={edit}
              onPreview={(step) => setPreview((current) => ({ key: current.key + 1, step }))}
            />
          )}
          {tab === "JSON" && (
            <div className="space-y-2">
              <textarea
                value={json}
                onChange={(event) => setJson(event.target.value)}
                spellCheck={false}
                rows={28}
                className="w-full rounded-lg border-2 border-slate-200 p-2 font-mono text-xs"
              />
              <SmallButton tone="primary" onClick={applyJson}>
                Apply the JSON
              </SmallButton>
            </div>
          )}
        </div>
        <div className="min-w-0 xl:sticky xl:top-4 xl:self-start">
          <div className="rounded-xl border-2 border-slate-200 bg-white p-3">
            <h3 className="mb-2 text-sm font-bold text-neutral-700">Preview</h3>
            {lastValid ? (
              <SolutionPlayer
                key={preview.key}
                script={lastValid}
                start={{ step: preview.step }}
                narration={{ kind: "preview" }}
              />
            ) : (
              <p className="py-8 text-center text-sm text-neutral-400">The preview starts once the script has no problems.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuthorEditor;
