// CodeMirror 6 for the coding lessons and the playground (sections 4.2 and 4.3). Loaded lazily by
// components/coding/code-editor.tsx, so lessons without code never download the editor. Each
// language package is its own chunk as well.
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completeAnyWord,
  completeFromList,
  completionKeymap,
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentLess,
  indentMore,
  indentWithTab,
  undo,
} from "@codemirror/commands";
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  indentUnit,
  StreamLanguage,
  syntaxHighlighting,
  type StreamParser,
} from "@codemirror/language";
import { lintGutter, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder,
} from "@codemirror/view";

import { pythonCompletions, tsCompletions } from "../browser-runner";
import type { EditorMode } from "../languages";
import type { CompletionItem } from "../workers/protocol";

import { KEYWORDS, SNIPPETS } from "./keywords";

const legacy = (parser: StreamParser<unknown>) => StreamLanguage.define(parser);

/** The language support of an editor mode, loaded on demand. */
const loadMode = async (mode: EditorMode): Promise<Extension> => {
  switch (mode) {
    case "javascript":
      return (await import("@codemirror/lang-javascript")).javascript();
    case "typescript":
      return (await import("@codemirror/lang-javascript")).javascript({ typescript: true });
    case "python":
      return (await import("@codemirror/lang-python")).python();
    case "sql": {
      const { sql, SQLite } = await import("@codemirror/lang-sql");
      return sql({ dialect: SQLite, upperCaseKeywords: true });
    }
    case "html":
      return (await import("@codemirror/lang-html")).html();
    case "css":
      return (await import("@codemirror/lang-css")).css();
    case "csharp":
    case "java":
    case "kotlin":
    case "c":
    case "cpp": {
      const clike = await import("@codemirror/legacy-modes/mode/clike");
      return legacy(clike[mode] as StreamParser<unknown>);
    }
    case "go":
      return legacy((await import("@codemirror/legacy-modes/mode/go")).go as StreamParser<unknown>);
    case "rust":
      return legacy(
        (await import("@codemirror/legacy-modes/mode/rust")).rust as StreamParser<unknown>
      );
    case "ruby":
      return legacy(
        (await import("@codemirror/legacy-modes/mode/ruby")).ruby as StreamParser<unknown>
      );
    case "bash":
      return legacy(
        (await import("@codemirror/legacy-modes/mode/shell")).shell as StreamParser<unknown>
      );
    case "perl":
      return legacy(
        (await import("@codemirror/legacy-modes/mode/perl")).perl as StreamParser<unknown>
      );
    case "lua":
      return legacy((await import("@codemirror/legacy-modes/mode/lua")).lua as StreamParser<unknown>);
    case "php":
      return legacy((await import("./php-mode")).phpMode());
  }
};

const COMPLETION_TYPES = new Set([
  "class",
  "constant",
  "enum",
  "function",
  "interface",
  "keyword",
  "method",
  "namespace",
  "property",
  "text",
  "type",
  "variable",
]);

const toCompletion = (item: CompletionItem, boost = 0): Completion => {
  const type =
    item.type === "statement" || item.type === "module"
      ? "namespace"
      : item.type === "instance" || item.type === "param"
        ? "variable"
        : item.type;
  return {
    label: item.label,
    type: type && COMPLETION_TYPES.has(type) ? type : "text",
    boost,
  };
};

/**
 * Tier 2 asks a language service, which is large: it runs after a dot (member access) or when
 * the learner asks for completion (Ctrl+Space), not on every letter.
 */
const wantsService = (context: CompletionContext) => {
  const before = context.state.sliceDoc(Math.max(0, context.pos - 80), context.pos);
  return context.explicit || /\.[\w$]*$/.test(before);
};

const serviceSource =
  (mode: EditorMode, fileName: string): CompletionSource =>
  async (context): Promise<CompletionResult | null> => {
    if (!wantsService(context)) return null;
    const word = context.matchBefore(/[\w$]*/);
    const code = context.state.doc.toString();
    let items: CompletionItem[] = [];
    if (mode === "python") {
      const line = context.state.doc.lineAt(context.pos);
      items = await pythonCompletions(code, line.number, context.pos - line.from);
    } else items = await tsCompletions(code, context.pos, fileName);
    if (context.aborted || !items.length) return null;
    return {
      from: word ? word.from : context.pos,
      options: items.map((item) => toCompletion(item, 1)),
      validFor: /^[\w$]*$/,
    };
  };

const tierOne = (mode: EditorMode): Extension[] => {
  const extra: CompletionSource[] = [completeAnyWord];
  const keywords = KEYWORDS[mode];
  const snippets = SNIPPETS[mode];
  if (keywords || snippets)
    extra.push(
      completeFromList([
        ...(keywords ?? []).map((label) => ({ label, type: "keyword" })),
        ...(snippets ?? []).map(([label, template]) =>
          snippetCompletion(template, { label, type: "text", detail: "snippet" })
        ),
      ])
    );
  return extra.map((source) => EditorState.languageData.of(() => [{ autocomplete: source }]));
};

const theme = EditorView.theme({
  "&": { fontSize: "14px", height: "100%", backgroundColor: "#ffffff" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily:
      "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', 'Courier New', monospace",
    lineHeight: "1.55",
  },
  ".cm-content": { paddingBottom: "8px" },
  ".cm-gutters": { backgroundColor: "#f8fafc", borderRight: "1px solid #e2e8f0", color: "#94a3b8" },
  ".cm-activeLine": { backgroundColor: "#f0f9ff" },
  ".cm-activeLineGutter": { backgroundColor: "#e0f2fe" },
  ".cm-tooltip-autocomplete ul li[aria-selected]": { backgroundColor: "#0ea5e9" },
});

export type EditorOptions = {
  doc: string;
  mode: EditorMode;
  readOnly?: boolean;
  /** File name the TypeScript service uses (main.js, main.ts). */
  fileName?: string;
  placeholderText?: string;
  label?: string;
  onChange?: (doc: string) => void;
  onFocusChange?: (focused: boolean) => void;
};

const readOnlyCompartment = new Compartment();

export const createEditor = async (parent: HTMLElement, options: EditorOptions) => {
  const language = await loadMode(options.mode);
  const service =
    options.mode === "javascript" || options.mode === "typescript" || options.mode === "python"
      ? [
          EditorState.languageData.of(() => [
            {
              autocomplete: serviceSource(
                options.mode,
                options.fileName ?? (options.mode === "typescript" ? "main.ts" : "main.js")
              ),
            },
          ]),
        ]
      : [];
  const unit = options.mode === "python" || options.mode === "csharp" || options.mode === "java" ? "    " : "  ";
  return new EditorView({
    parent,
    state: EditorState.create({
      doc: options.doc,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        history(),
        drawSelection(),
        indentOnInput(),
        indentUnit.of(unit),
        EditorState.tabSize.of(4),
        bracketMatching(),
        closeBrackets(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        autocompletion({ activateOnTyping: true, maxRenderedOptions: 60 }),
        lintGutter(),
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...completionKeymap,
          indentWithTab,
        ]),
        language,
        ...tierOne(options.mode),
        ...service,
        readOnlyCompartment.of([
          EditorState.readOnly.of(!!options.readOnly),
          EditorView.editable.of(!options.readOnly),
        ]),
        options.placeholderText ? placeholder(options.placeholderText) : [],
        EditorView.contentAttributes.of({
          "aria-label": options.label ?? "Code editor",
          autocapitalize: "off",
          autocorrect: "off",
          spellcheck: "false",
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) options.onChange?.(update.state.doc.toString());
          if (update.focusChanged) options.onFocusChange?.(update.view.hasFocus);
        }),
        theme,
      ],
    }),
  });
};

export const setReadOnly = (view: EditorView, readOnly: boolean) =>
  view.dispatch({
    effects: readOnlyCompartment.reconfigure([
      EditorState.readOnly.of(readOnly),
      EditorView.editable.of(!readOnly),
    ]),
  });

export const replaceDoc = (view: EditorView, doc: string) => {
  if (view.state.doc.toString() === doc) return;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: doc } });
};

export type LineDiagnostic = {
  line: number;
  message: string;
  severity?: "error" | "warning" | "info";
};

/** Shows errors and test failures on the lines they belong to. */
export const setLineDiagnostics = (view: EditorView, items: LineDiagnostic[]) => {
  const doc = view.state.doc;
  const diagnostics: Diagnostic[] = items
    .filter((item) => item.line >= 1 && item.line <= doc.lines)
    .map((item) => {
      const line = doc.line(item.line);
      const indent = /^\s*/.exec(line.text)![0].length;
      return {
        from: Math.min(line.from + indent, line.to),
        to: line.to,
        severity: item.severity ?? "error",
        message: item.message,
      };
    });
  view.dispatch(setDiagnostics(view.state, diagnostics));
};

// ---- the phone symbol bar ----

export const insertText = (view: EditorView, text: string) => {
  view.dispatch(view.state.replaceSelection(text), { scrollIntoView: true, userEvent: "input.type" });
  view.focus();
};

export const editorCommand = (view: EditorView, command: "undo" | "indent" | "outdent") => {
  if (command === "undo") undo(view);
  else if (command === "indent") indentMore(view);
  else indentLess(view);
  view.focus();
};
