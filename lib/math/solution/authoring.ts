// Pure helpers of author mode (section 5.6): a selection in the question becomes a span and a
// given, equation states typed without tags are tagged by matching the state before, hand
// links between terms are toggled, and new elements get unique ids. Kept apart from the React
// editor so they can be tested.
import { autoTag, stripTerms, termPairs } from "./terms";
import { SCRIPT_FORMAT, type QuestionSpan, type SolutionScript, type Step, type TermLink } from "./types";

/** A new script for a problem that has none yet. */
export const emptyScript = (statement: string, title?: string): SolutionScript => ({
  format: SCRIPT_FORMAT,
  ...(title ? { title: title.slice(0, 200) } : {}),
  question: [{ text: statement }],
  givens: [],
  equations: [],
  graphs: [],
  figures: [],
  tables: [],
  notes: [],
  steps: [],
});

/** Every id used by an element of the script (spans, givens, equations, visuals, notes). */
export const elementIds = (script: SolutionScript) => {
  const ids = new Set<string>();
  for (const span of script.question) if (span.id) ids.add(span.id);
  for (const list of [script.givens, script.equations, script.graphs, script.figures, script.tables, script.notes])
    for (const entry of list ?? []) ids.add(entry.id);
  return ids;
};

/** A readable id that is not in `taken`: base, base-2, base-3... */
export const uniqueId = (base: string, taken: Set<string>) => {
  let clean = base
    .replace(/\\/g, "")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!/^[A-Za-z]/.test(clean)) clean = `x${clean}`;
  clean = clean.slice(0, 32) || "x";
  let id = clean;
  for (let n = 2; taken.has(id); n++) id = `${clean}-${n}`;
  return id;
};

/** Ranges of the formulas in a text: $...$, $$...$$, \(...\) and \[...\]. */
export const mathRanges = (text: string) => {
  const ranges: { start: number; end: number }[] = [];
  const BACKSLASH = String.fromCharCode(92);
  let i = 0;
  while (i < text.length) {
    if (text[i] === BACKSLASH && text[i + 1] === "$") {
      i += 2;
      continue;
    }
    const pair: [string, string] | null = text.startsWith("$$", i)
      ? ["$$", "$$"]
      : text.startsWith(`${BACKSLASH}[`, i)
        ? [`${BACKSLASH}[`, `${BACKSLASH}]`]
        : text.startsWith(`${BACKSLASH}(`, i)
          ? [`${BACKSLASH}(`, `${BACKSLASH})`]
          : text[i] === "$"
            ? ["$", "$"]
            : null;
    if (!pair) {
      i += 1;
      continue;
    }
    let close = text.indexOf(pair[1], i + pair[0].length);
    while (close > 0 && pair[1] === "$" && text[close - 1] === BACKSLASH)
      close = text.indexOf("$", close + 1);
    if (close < 0) break;
    ranges.push({ start: i, end: close + pair[1].length });
    i = close + pair[1].length;
  }
  return ranges;
};

/**
 * Splits span `index` so that the characters from `start` to `end` become a span of their own
 * with an id. A selection that cuts into $math$ grows to the whole formula; surrounding spaces
 * stay outside. Returns the new spans and the id, or null when the selection is empty.
 */
export const splitSpan = (
  spans: QuestionSpan[],
  index: number,
  start: number,
  end: number,
  taken: Set<string>,
  base = "q"
): { spans: QuestionSpan[]; id: string } | null => {
  const span = spans[index];
  if (!span) return null;
  let from = Math.max(0, Math.min(start, end));
  let to = Math.min(span.text.length, Math.max(start, end));
  for (const range of mathRanges(span.text)) {
    if (from > range.start && from < range.end) from = range.start;
    if (to > range.start && to < range.end) to = range.end;
  }
  while (from < to && /\s/.test(span.text[from])) from += 1;
  while (to > from && /\s/.test(span.text[to - 1])) to -= 1;
  if (from >= to) return null;
  // The whole of a span that already has an id: use it as it is.
  if (from === 0 && to === span.text.length && span.id) return { spans, id: span.id };

  const id = uniqueId(base, taken);
  const pieces: QuestionSpan[] = [];
  if (from > 0) pieces.push({ text: span.text.slice(0, from) });
  pieces.push({ id, text: span.text.slice(from, to) });
  if (to < span.text.length) pieces.push({ text: span.text.slice(to) });
  return { spans: [...spans.slice(0, index), ...pieces, ...spans.slice(index + 1)], id };
};

/** Joins neighbouring spans without ids, after spans were removed or split. */
export const mergePlainSpans = (spans: QuestionSpan[]) => {
  const out: QuestionSpan[] = [];
  for (const span of spans) {
    const last = out[out.length - 1];
    if (last && !last.id && !span.id) last.text += span.text;
    else out.push({ ...span });
  }
  return out;
};

const UNIT_WORDS: Record<string, string> = {
  second: "s",
  seconds: "s",
  sec: "s",
  metre: "m",
  metres: "m",
  meter: "m",
  meters: "m",
  minute: "min",
  minutes: "min",
  hour: "h",
  hours: "h",
  kilogram: "kg",
  kilograms: "kg",
  gram: "g",
  grams: "g",
  newton: "N",
  newtons: "N",
  degree: "deg",
  degrees: "deg",
  kilometre: "km",
  kilometres: "km",
  kilometer: "km",
  kilometers: "km",
};

const UNIT_TEXT = /^([A-Za-z]{1,3}(\/[A-Za-z]{1,3})?(\^\d)?|°|%)$/;

/** A value and unit from selected question text: "$120\,\mathrm{m}$", "3 seconds", "12 m/s". */
export const parseQuantity = (text: string): { value: number; unit?: string } | null => {
  const plain = text
    .replace(/\$/g, " ")
    .replace(/\\[,;:! ]/g, " ")
    .replace(/\\(mathrm|text)\{([^}]*)\}/g, " $2 ")
    .replace(/\s+/g, " ")
    .trim();
  const match = /(-?\d+(?:[.,]\d+)?)\s*([A-Za-z°%][A-Za-z0-9/^°%]*)?/.exec(plain);
  if (!match) return null;
  const value = Number(match[1].replace(",", "."));
  const word = match[2];
  const unit = word ? (UNIT_WORDS[word.toLowerCase()] ?? (UNIT_TEXT.test(word) ? word : undefined)) : undefined;
  return unit ? { value, unit } : { value };
};

const SYMBOLS: Record<string, string> = {
  m: "d",
  km: "d",
  s: "t",
  min: "t",
  h: "t",
  "m/s": "v",
  "km/h": "v",
  "m/s^2": "a",
  kg: "m",
  g: "m",
  N: "F",
  J: "E",
  W: "P",
  deg: "\\alpha",
};

/** A symbol to suggest for a quantity with this unit. */
export const suggestSymbol = (unit: string | undefined) => (unit && SYMBOLS[unit]) || "x";

/**
 * Tags state `index` of an equation from what the author typed, then re-tags the states after
 * it, each by matching the state before. Returns the new LaTeX of every state.
 */
export const retagStates = (latex: string[], index: number, typed: string): string[] => {
  const out = [...latex];
  out[index] = autoTag(typed, index > 0 ? out[index - 1] : null);
  for (let k = index + 1; k < out.length; k++) out[k] = autoTag(stripTerms(out[k]), out[k - 1]);
  return out;
};

/**
 * Links or unlinks two terms by hand on the step that moves state a to state b. A pair that
 * was linked by hand is removed; an automatic pair is unlinked; anything else is linked.
 */
export const toggleLink = (
  step: { links?: TermLink[]; unlinks?: TermLink[] },
  a: string,
  b: string,
  stateA: string,
  stateB: string,
  exclude: string[] = []
): { links?: TermLink[]; unlinks?: TermLink[] } => {
  const links = [...(step.links ?? [])];
  const unlinks = [...(step.unlinks ?? [])];
  const same = (pair: TermLink) => pair[0] === a && pair[1] === b;
  const linked = links.findIndex(same);
  if (linked >= 0) links.splice(linked, 1);
  else {
    const unlinked = unlinks.findIndex(same);
    if (unlinked >= 0) unlinks.splice(unlinked, 1);
    else if (termPairs(stateA, stateB, { exclude, unlinks }).some(same)) unlinks.push([a, b]);
    else links.push([a, b]);
  }
  return { links: links.length ? links : undefined, unlinks: unlinks.length ? unlinks : undefined };
};

/** The state an equation shows just before step `index` (null when it is not shown yet). */
export const stateBefore = (script: SolutionScript, index: number, equation: string): string | null => {
  let state: string | null = null;
  for (const step of script.steps.slice(0, index)) {
    if (step.kind === "Relate" && step.equation === equation)
      state = step.state ?? script.equations.find((e) => e.id === equation)?.states[0]?.id ?? null;
    if ((step.kind === "Transform" || step.kind === "Substitute") && step.equation === equation)
      state = step.to;
  }
  return state;
};

/** The index of the step that moves an equation into a state, or -1. */
export const stepInto = (script: SolutionScript, equation: string, state: string) =>
  script.steps.findIndex(
    (step) =>
      (step.kind === "Transform" || step.kind === "Substitute") &&
      step.equation === equation &&
      step.to === state
  );

/** A fresh step of a kind, filled with the first fitting elements of the script. */
export const newStep = (script: SolutionScript, kind: Step["kind"]): Step => {
  const equation = script.equations[script.equations.length - 1];
  const base = { duration: 3 };
  switch (kind) {
    case "Extract":
      return { ...base, kind, given: script.givens[0]?.id ?? "" };
    case "Relate":
      return { ...base, kind, equation: equation?.id ?? "", state: equation?.states[0]?.id };
    case "Transform":
      return {
        ...base,
        kind,
        equation: equation?.id ?? "",
        to: equation?.states[1]?.id ?? equation?.states[0]?.id ?? "",
      };
    case "Substitute":
      return { ...base, kind, equation: equation?.id ?? "", to: equation?.states[1]?.id ?? "", pairs: [] };
    case "Plot":
      return {
        ...base,
        kind,
        graph: script.graphs[0]?.id ?? "",
        items: script.graphs[0]?.items.map((item) => item.id).slice(0, 1) ?? [],
      };
    case "Construct":
      return {
        ...base,
        kind,
        figure: script.figures[0]?.id ?? "",
        shapes: script.figures[0]?.shapes.map((shape) => shape.id).slice(0, 1) ?? [],
      };
    case "Annotate":
      return { ...base, kind, notes: script.notes.map((note) => note.id).slice(0, 1) };
    case "Answer":
      return { ...base, kind };
  }
};
