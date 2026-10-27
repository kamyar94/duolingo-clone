// Small LaTeX helpers shared by the browser and the server: text with math between dollar signs,
// normalised lines for fingerprints, and the answer part of a line such as "t = 10\,s".
// No dependencies, so the lesson bundle stays small.

export type TextSegment = { kind: "text" | "math"; value: string; display: boolean };

/**
 * Splits text into plain parts and math parts. Math is written between $...$ or \(...\) inline,
 * and between $$...$$ or \[...\] as a display block. \$ is a literal dollar sign.
 */
export const splitMathText = (text: string): TextSegment[] => {
  const segments: TextSegment[] = [];
  let plain = "";
  const pushPlain = () => {
    if (plain) segments.push({ kind: "text", value: plain, display: false });
    plain = "";
  };

  let i = 0;
  while (i < text.length) {
    if (text.startsWith("\\$", i)) {
      plain += "$";
      i += 2;
      continue;
    }
    const opener = text.startsWith("$$", i)
      ? { open: "$$", close: "$$", display: true }
      : text.startsWith("\\[", i)
        ? { open: "\\[", close: "\\]", display: true }
        : text.startsWith("\\(", i)
          ? { open: "\\(", close: "\\)", display: false }
          : text[i] === "$"
            ? { open: "$", close: "$", display: false }
            : null;
    if (opener) {
      let end = i + opener.open.length;
      // Find the closing delimiter that is not escaped.
      while (end < text.length) {
        const at = text.indexOf(opener.close, end);
        if (at === -1) {
          end = -1;
          break;
        }
        if (text[at - 1] === "\\" && opener.close === "$") {
          end = at + 1;
          continue;
        }
        end = at;
        break;
      }
      if (end > i) {
        const value = text.slice(i + opener.open.length, end).trim();
        pushPlain();
        if (value) segments.push({ kind: "math", value, display: opener.display });
        i = end + opener.close.length;
        continue;
      }
    }
    plain += text[i];
    i += 1;
  }
  pushPlain();
  return segments;
};

/** Removes surrounding $...$, $$...$$, \(...\) or \[...\] from a line of LaTeX. */
export const stripMathDelimiters = (latex: string) => {
  let line = latex.trim();
  for (const [open, close] of [
    ["$$", "$$"],
    ["\\[", "\\]"],
    ["\\(", "\\)"],
    ["$", "$"],
  ] as const) {
    if (line.length > open.length + close.length && line.startsWith(open) && line.endsWith(close)) {
      line = line.slice(open.length, line.length - close.length).trim();
      break;
    }
  }
  return line;
};

const SPACING = /\\(?:,|;|:|!|>|\s|quad\b|qquad\b|thinspace\b|medspace\b|thickspace\b|enspace\b)/g;

/**
 * One line of LaTeX in a canonical spelling, so that the same work written with different
 * spacing or synonyms gives the same fingerprint. Meaning is kept: only spacing, \left and
 * \right, display fraction variants and multiplication-sign synonyms are unified.
 */
export const normalizeLatexLine = (latex: string) => {
  let line = stripMathDelimiters(latex);
  line = line
    .replace(SPACING, " ")
    .replace(/\\(?:left|right|big|Big|bigg|Bigg)(?![a-zA-Z])/g, "")
    .replace(/\\[dt]frac(?![a-zA-Z])/g, "\\frac")
    .replace(/\\times(?![a-zA-Z])/g, "\\cdot")
    .replace(/\\displaystyle(?![a-zA-Z])/g, "")
    .replace(/\\operatorname\{([a-z]+)\}/g, "\\$1");

  // Drop whitespace, except one space after a command name that a letter follows (\pi r).
  let out = "";
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (/\s/.test(ch)) {
      const before = out.match(/\\[a-zA-Z]+$/);
      let j = i;
      while (j < line.length && /\s/.test(line[j])) j += 1;
      if (before && /[a-zA-Z]/.test(line[j] ?? "")) out += " ";
      i = j - 1;
      continue;
    }
    out += ch;
  }
  return out;
};

/** Normalised, non-empty lines. */
export const normalizeLatexLines = (lines: string[]) =>
  lines.map(normalizeLatexLine).filter((line) => line.length > 0);

/**
 * The part of a line that holds the result: after the last top-level "=" or "\approx", so that
 * "t = \frac{d}{v} = 10\,s" answers "10\,s". Braces are respected.
 */
export const answerPart = (latex: string) => {
  const line = stripMathDelimiters(latex);
  let depth = 0;
  let cut = -1;
  let skip = 0;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "\\" && line[i + 1] === "{") {
      i += 1;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") depth = Math.max(0, depth - 1);
    else if (depth === 0 && ch === "=") {
      cut = i;
      skip = 1;
    } else if (depth === 0 && line.startsWith("\\approx", i)) {
      cut = i;
      skip = "\\approx".length;
    }
  }
  return cut === -1 ? line : line.slice(cut + skip).trim();
};
