// Fill-in-the-blank and line-order exercises (CODE_FILL, CODE_ORDER): splitting templates,
// building the chips, assembling the learner's program and checking it without tests.

const isWordChar = (char: string | undefined) => !!char && /[\w$]/.test(char);

/**
 * The text around the blanks; a template with n blanks gives n + 1 parts. A blank is three
 * underscores that are not part of a longer word (so __init__ and ____ are not blanks).
 * Written without a lookbehind pattern, which older Safari versions cannot parse.
 */
export const splitTemplate = (template: string) => {
  const parts: string[] = [];
  let start = 0;
  let at = template.indexOf("___");
  while (at !== -1) {
    if (!isWordChar(template[at - 1]) && !isWordChar(template[at + 3])) {
      parts.push(template.slice(start, at));
      start = at + 3;
      at = template.indexOf("___", start);
    } else at = template.indexOf("___", at + 1);
  }
  parts.push(template.slice(start));
  return parts;
};

export const countBlanks = (template: string) => splitTemplate(template).length - 1;

export const fillTemplate = (template: string, values: (string | null | undefined)[]) =>
  splitTemplate(template).reduce(
    (program, part, i) => (i === 0 ? part : program + (values[i - 1] ?? "") + part),
    ""
  );

export const acceptedAnswers = (answer: string | string[] | undefined) =>
  (Array.isArray(answer) ? answer : answer === undefined ? [] : [answer]).map((a) => a.trim());

/** Whether each blank holds one of its accepted answers (spaces at the ends ignored). */
export const checkBlanks = (
  values: (string | null | undefined)[],
  answers: (string | string[])[]
) =>
  answers.map((answer, i) => acceptedAnswers(answer).includes((values[i] ?? "").trim()));

/** A small deterministic generator, so the server render and the browser shuffle alike. */
const random = (seed: number) => {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
};

export const seededShuffle = <T>(items: readonly T[], seed: number): T[] => {
  const next = random(seed);
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  // A shuffle that leaves everything in place gives the answer away.
  if (result.length > 1 && result.every((item, i) => item === items[i]))
    result.push(result.shift()!);
  return result;
};

export type Chip = { id: number; text: string };

/** One chip per blank (its first accepted answer) plus the distractors, shuffled. */
export const fillChips = (
  answers: (string | string[])[] | undefined,
  distractors: string[] | undefined,
  seed: number
): Chip[] => {
  const texts = [
    ...(answers ?? []).map((answer) => acceptedAnswers(answer)[0] ?? ""),
    ...(distractors ?? []),
  ].filter((text) => text !== "");
  return seededShuffle(texts, seed).map((text, id) => ({ id, text }));
};

// ---- line order ----

export type OrderPiece = { id: number; text: string; indent: number };

/** Indentation width of a program, guessed from its lines (2 or 4 spaces, or one tab). */
export const indentUnit = (lines: string[]) => {
  if (lines.some((line) => line.startsWith("\t"))) return "\t";
  const widths = lines
    .map((line) => /^ */.exec(line)![0].length)
    .filter((width) => width > 0);
  if (!widths.length) return "    ";
  const smallest = Math.min(...widths);
  return " ".repeat(smallest >= 4 ? 4 : smallest);
};

export const indentLevel = (line: string, unit: string) => {
  const lead = /^[ \t]*/.exec(line)![0].replace(/\t/g, unit === "\t" ? "\t" : "    ");
  if (unit === "\t") return lead.length;
  return Math.round(lead.length / unit.length);
};

/**
 * The pieces the learner orders: every line and distractor, shuffled. When the learner sets the
 * indentation, pieces lose theirs (indent 0); otherwise each keeps its own level.
 */
export const orderPieces = (
  lines: string[],
  distractors: string[] | undefined,
  learnerIndents: boolean,
  seed: number
): OrderPiece[] => {
  const unit = indentUnit(lines);
  const all = [...lines, ...(distractors ?? [])].filter((line) => line.trim() !== "");
  return seededShuffle(all, seed).map((line, id) => ({
    id,
    text: line.trim(),
    indent: learnerIndents ? 0 : indentLevel(line, unit),
  }));
};

export const assembleLines = (
  placed: { text: string; indent: number }[],
  unit: string
) => placed.map((piece) => unit.repeat(Math.max(0, piece.indent)) + piece.text).join("\n") + "\n";

/**
 * Whether the placed lines form the program: same lines (blank lines ignored) in the same
 * order, each at the same indentation level. Identical lines are interchangeable.
 */
export const checkOrder = (
  placed: { text: string; indent: number }[],
  lines: string[]
) => {
  const unit = indentUnit(lines);
  const expected = lines
    .filter((line) => line.trim() !== "")
    .map((line) => ({ text: line.trim(), indent: indentLevel(line, unit) }));
  if (placed.length !== expected.length) return false;
  const base = Math.min(...placed.map((piece) => piece.indent), Infinity);
  const expectedBase = Math.min(...expected.map((piece) => piece.indent), Infinity);
  return placed.every(
    (piece, i) =>
      piece.text.trim() === expected[i].text &&
      piece.indent - base === expected[i].indent - expectedBase
  );
};

/** Python needs the learner to indent; other languages keep the given indentation. */
export const learnerSetsIndent = (language: string, indent?: boolean) =>
  indent ?? language === "python";
