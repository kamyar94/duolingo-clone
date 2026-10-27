"use client";

import { useEffect, useRef, useState } from "react";

import type { EditorView } from "@codemirror/view";

import type { LineDiagnostic } from "@/lib/coding/editor/setup";
import type { EditorMode } from "@/lib/coding/languages";
import { cn } from "@/lib/utils";

import { SymbolBar } from "./symbol-bar";

type EditorModule = typeof import("@/lib/coding/editor/setup");

type CodeEditorProps = {
  value: string;
  onChange?: (value: string) => void;
  mode: EditorMode;
  readOnly?: boolean;
  /** Errors and test failures shown on their lines. */
  diagnostics?: LineDiagnostic[];
  fileName?: string;
  label?: string;
  placeholder?: string;
  className?: string;
};

export type { LineDiagnostic };

// CodeMirror 6 with the coding lessons' setup (lib/coding/editor/setup.ts). The editor code loads
// after the page; until then (and on the server) the program shows as plain text.
export const CodeEditor = ({
  value,
  onChange,
  mode,
  readOnly = false,
  diagnostics,
  fileName,
  label,
  placeholder,
  className,
}: CodeEditorProps) => {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const editor = useRef<EditorModule | null>(null);
  const onChangeRef = useRef(onChange);
  const initial = useRef({ value, readOnly, label, placeholder, fileName });
  const [ready, setReady] = useState(false);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    initial.current = { value, readOnly, label, placeholder, fileName };
  });

  useEffect(() => {
    let cancelled = false;
    let created: EditorView | null = null;
    import("@/lib/coding/editor/setup")
      .then(async (module) => {
        if (cancelled || !host.current) return;
        editor.current = module;
        const options = initial.current;
        created = await module.createEditor(host.current, {
          doc: options.value,
          mode,
          readOnly: options.readOnly,
          fileName: options.fileName,
          label: options.label,
          placeholderText: options.placeholder,
          onChange: (doc) => onChangeRef.current?.(doc),
          onFocusChange: setFocused,
        });
        if (cancelled) {
          created.destroy();
          return;
        }
        view.current = created;
        setReady(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      created?.destroy();
      view.current = null;
      setReady(false);
    };
  }, [mode]);

  useEffect(() => {
    if (ready && view.current && editor.current) editor.current.replaceDoc(view.current, value);
  }, [value, ready]);

  useEffect(() => {
    if (ready && view.current && editor.current) editor.current.setReadOnly(view.current, readOnly);
  }, [readOnly, ready]);

  useEffect(() => {
    if (ready && view.current && editor.current)
      editor.current.setLineDiagnostics(view.current, diagnostics ?? []);
  }, [diagnostics, ready]);

  return (
    <div
      className={cn(
        "relative min-h-[120px] overflow-hidden rounded-xl border-2 border-slate-200 bg-white text-left",
        className
      )}
      data-exercise-keys
    >
      {!ready && (
        <pre
          aria-label={label ?? "Code"}
          className="h-full overflow-auto whitespace-pre p-3 pl-12 font-mono text-[14px] leading-[1.55] text-neutral-700"
        >
          {value || placeholder}
        </pre>
      )}
      <div ref={host} className={cn("h-full", !ready && "hidden")} />
      {ready && focused && !readOnly && (
        <SymbolBar
          mode={mode}
          onInsert={(text) => view.current && editor.current?.insertText(view.current, text)}
          onCommand={(command) =>
            view.current && editor.current?.editorCommand(view.current, command)
          }
        />
      )}
    </div>
  );
};
