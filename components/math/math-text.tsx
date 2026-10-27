"use client";

// Text with math between dollar signs, rendered with KaTeX. KaTeX runs with trust off and
// without \htmlClass or \htmlId, so LaTeX from course files, learners and AI replies cannot add
// links, classes or ids to the page (docs/DESIGN-coding-and-math.md, section 5.5).
import "katex/dist/katex.min.css";

import { Fragment, useMemo } from "react";

import katex from "katex";

import { splitMathText } from "@/lib/math/latex";
import { cn } from "@/lib/utils";

const render = (latex: string, displayMode: boolean) => {
  try {
    return katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      trust: false,
      strict: "ignore",
      maxSize: 20,
      maxExpand: 200,
      output: "htmlAndMathml",
    });
  } catch {
    return null;
  }
};

type MathFormulaProps = { latex: string; display?: boolean; className?: string };

/** One formula. Falls back to the LaTeX source when KaTeX cannot render it. */
export const MathFormula = ({ latex, display = false, className }: MathFormulaProps) => {
  const html = useMemo(() => render(latex, display), [latex, display]);
  if (html === null) return <code className={className}>{latex}</code>;
  return (
    <span
      className={cn(display ? "block overflow-x-auto py-1" : "inline", className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

type MathTextProps = { text: string; className?: string };

/** A paragraph of text with $inline$ and $$display$$ math; blank lines start a new paragraph. */
export const MathText = ({ text, className }: MathTextProps) => {
  const paragraphs = useMemo(
    () => text.split(/\n\s*\n/).map((paragraph) => splitMathText(paragraph)),
    [text]
  );
  return (
    <div className={cn("space-y-2", className)}>
      {paragraphs.map((segments, n) => (
        <p key={n} className="whitespace-pre-line">
          {segments.map((segment, k) => (
            <Fragment key={k}>
              {segment.kind === "text" ? (
                segment.value
              ) : (
                <MathFormula latex={segment.value} display={segment.display} />
              )}
            </Fragment>
          ))}
        </p>
      ))}
    </div>
  );
};
