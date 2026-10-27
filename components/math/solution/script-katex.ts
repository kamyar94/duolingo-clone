// KaTeX for solution scripts. Equation states tag their terms as \term{id}{...}, a macro that
// becomes \htmlClass{lt-term lt-term-id}{...}, so the player can find each term in the output
// and follow it from one state to the next. KaTeX's trust option is enabled here, and only
// here, for \htmlClass and \htmlId with the class and id names the player itself uses; every
// other trusted command stays off. LaTeX from learners and from AI replies is rendered by
// components/math/math-text.tsx, which keeps trust off (docs/DESIGN-coding-and-math.md 5.5).
import katex from "katex";

const TERM_CLASS = /^lt-term lt-term-[A-Za-z][A-Za-z0-9_-]{0,39}$/;
const TERM_ID = /^lt-[A-Za-z][A-Za-z0-9_-]{0,60}$/;

type TrustContext = { command: string; class?: string; id?: string };

const trust = (context: TrustContext) =>
  (context.command === "\\htmlClass" && TERM_CLASS.test(context.class ?? "")) ||
  (context.command === "\\htmlId" && TERM_ID.test(context.id ?? ""));

const cache = new Map<string, string>();

/**
 * Renders a script's LaTeX with the term macro. Returns HTML, or the source in a code element
 * when KaTeX cannot read it (throwOnError is off, so that is rare).
 */
export const renderScriptLatex = (latex: string, display = true): string => {
  const key = `${display ? "d" : "i"}${latex}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let html: string;
  try {
    html = katex.renderToString(latex, {
      displayMode: display,
      throwOnError: false,
      output: "html",
      trust,
      // The html commands are reported under "htmlExtension"; allow them, warn about the rest.
      strict: (code: string) => (code === "htmlExtension" ? "ignore" : "warn"),
      // A fresh object each time: KaTeX writes \gdef definitions into it.
      macros: { "\\term": "\\htmlClass{lt-term lt-term-#1}{#2}" },
      maxSize: 20,
      maxExpand: 300,
    });
  } catch {
    html = `<code>${latex.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)}</code>`;
  }
  if (cache.size > 500) cache.clear();
  cache.set(key, html);
  return html;
};

/** The term id of an element rendered from \term{id}{...}, or null. */
export const termIdOf = (element: Element): string | null => {
  for (const name of element.classList)
    if (name.startsWith("lt-term-")) return name.slice("lt-term-".length);
  return null;
};
