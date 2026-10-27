import { Server } from "lucide-react";

import { languageInfo, type CodeLanguage } from "@/lib/coding/languages";
import type { CodeTest } from "@/lib/coding/types";

/** Paragraphs separated by blank lines; `code` spans in backticks. */
export const Prose = ({ text }: { text: string }) => (
  <div className="space-y-3">
    {text
      .split(/\n\s*\n/)
      .filter((paragraph) => paragraph.trim())
      .map((paragraph, i) => (
        <p key={i} className="whitespace-pre-line text-sm leading-relaxed text-neutral-700 lg:text-base">
          {paragraph.split(/(`[^`]+`)/).map((part, j) =>
            part.startsWith("`") && part.endsWith("`") && part.length > 1 ? (
              <code key={j} className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.9em]">
                {part.slice(1, -1)}
              </code>
            ) : (
              part
            )
          )}
        </p>
      ))}
  </div>
);

export const LanguageBadge = ({ language }: { language: CodeLanguage }) => (
  <span className="inline-flex items-center rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-sky-700">
    {languageInfo(language).label}
  </span>
);

export const ServerNotice = ({ language }: { language: CodeLanguage }) => (
  <div className="flex items-start gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm text-neutral-600">
    <Server className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
    <p>
      {languageInfo(language).label} programs run on the server, and the server runner is not
      available yet. You can still write and save your program.
    </p>
  </div>
);

/** The visible tests, so the learner knows what is checked. */
export const VisibleTests = ({ tests }: { tests: CodeTest[] }) => {
  const shown = tests.filter((test) => test.visible !== false);
  const hidden = tests.length - shown.length;
  if (!tests.length) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Tests</p>
      <ul className="space-y-1.5">
        {shown.map((test, i) => (
          <li key={i} className="rounded-lg bg-slate-50 px-2.5 py-1.5 font-mono text-xs text-neutral-700">
            {test.call !== undefined ? (
              <>
                {test.call} <span className="text-slate-400">→</span> {test.expect}
              </>
            ) : test.query !== undefined ? (
              <>{test.name ?? test.query}</>
            ) : test.rows !== undefined ? (
              <>{test.name ?? `${test.rows.length} row(s) expected`}</>
            ) : (
              <>
                {test.stdin ? (
                  <>
                    input <span className="text-slate-500">{JSON.stringify(test.stdin)}</span>{" "}
                  </>
                ) : null}
                <span className="text-slate-400">prints</span> {JSON.stringify(test.expect ?? "")}
              </>
            )}
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <p className="text-xs text-slate-500">
          and {hidden} hidden {hidden === 1 ? "test" : "tests"}
        </p>
      )}
    </div>
  );
};

type TaskPanelProps = {
  question: string;
  language: CodeLanguage;
  text?: string;
  tests?: CodeTest[];
  children?: React.ReactNode;
};

export const TaskPanel = ({ question, language, text, tests, children }: TaskPanelProps) => (
  <div className="space-y-4">
    <LanguageBadge language={language} />
    <h1 className="text-lg font-bold text-neutral-700 lg:text-2xl">{question}</h1>
    {text && <Prose text={text} />}
    {tests && <VisibleTests tests={tests} />}
    {children}
  </div>
);
