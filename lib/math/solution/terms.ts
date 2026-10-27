// Tagged terms of equation states. A state's LaTeX tags terms as \term{id}{...}; the same id in
// two consecutive states means the term persists and moves to its new place. This file reads
// and writes those tags: it finds them, strips them, tags a newly typed state automatically by
// matching identical subexpressions of the state before, and lists the pairs of terms the
// player moves between two states (same id, identical content, or linked by hand).
//
// Pure string work without dependencies, shared by the player, the author mode and the
// validator.
import type { TermLink } from "./types";

export const TERM_ID = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;

export type TermInfo = {
  id: string;
  /** The LaTeX inside the tag, nested tags included. */
  body: string;
  /** Range of the whole \term{id}{body} in the source. */
  start: number;
  end: number;
  /** Range of the body in the source. */
  bodyStart: number;
  bodyEnd: number;
  /** The id of the enclosing term, or null at the top. */
  parent: string | null;
};

/** The index after the brace group that starts at `open` (a "{"), or -1 when it is not closed. */
const closeOf = (latex: string, open: number) => {
  let depth = 0;
  for (let i = open; i < latex.length; i++) {
    const char = latex[i];
    if (char === "\\") {
      i += 1; // skip the escaped character (\{, \}, \\)
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
};

const skipSpaces = (latex: string, at: number) => {
  while (at < latex.length && /\s/.test(latex[at])) at += 1;
  return at;
};

/** Every \term{id}{body} in a state, in source order, with problems found on the way. */
export const parseTerms = (latex: string): { terms: TermInfo[]; problems: string[] } => {
  const terms: TermInfo[] = [];
  const problems: string[] = [];
  const pattern = /\\term(?![A-Za-z])/g;
  for (let match = pattern.exec(latex); match; match = pattern.exec(latex)) {
    const start = match.index;
    // An escaped backslash before \term (\\term) is a line break followed by "term".
    let backslashes = 0;
    for (let i = start - 1; i >= 0 && latex[i] === "\\"; i--) backslashes += 1;
    if (backslashes % 2 === 1) continue;

    const idOpen = skipSpaces(latex, start + 5);
    if (latex[idOpen] !== "{") {
      problems.push("\\term needs an id in braces, then the term in braces.");
      continue;
    }
    const idClose = closeOf(latex, idOpen);
    if (idClose < 0) {
      problems.push("A \\term id has no closing brace.");
      continue;
    }
    const id = latex.slice(idOpen + 1, idClose - 1).trim();
    const bodyOpen = skipSpaces(latex, idClose);
    if (latex[bodyOpen] !== "{") {
      problems.push(`\\term{${id}} needs the term in braces after the id.`);
      continue;
    }
    const end = closeOf(latex, bodyOpen);
    if (end < 0) {
      problems.push(`\\term{${id}} is not closed.`);
      continue;
    }
    if (!TERM_ID.test(id))
      problems.push(
        `Term id "${id}" must start with a letter and use letters, digits, _ or - (at most 40).`
      );
    terms.push({
      id,
      body: latex.slice(bodyOpen + 1, end - 1),
      start,
      end,
      bodyStart: bodyOpen + 1,
      bodyEnd: end - 1,
      parent: null,
    });
  }
  for (const term of terms) {
    let parent: TermInfo | null = null;
    for (const other of terms)
      if (other !== term && other.bodyStart <= term.start && term.end <= other.bodyEnd)
        if (!parent || other.bodyStart > parent.bodyStart) parent = other;
    term.parent = parent?.id ?? null;
  }
  const seen = new Set<string>();
  for (const term of terms) {
    if (seen.has(term.id)) problems.push(`Term id "${term.id}" is used twice in one state.`);
    seen.add(term.id);
  }
  return { terms, problems };
};

/** The state's LaTeX without the tags, as a learner would write it. */
export const stripTerms = (latex: string): string => {
  const { terms } = parseTerms(latex);
  if (!terms.length) return latex;
  const cuts: [number, number][] = [];
  for (const term of terms) {
    cuts.push([term.start, term.bodyStart], [term.bodyEnd, term.end]);
  }
  cuts.sort((a, b) => a[0] - b[0]);
  let out = "";
  let at = 0;
  for (const [from, to] of cuts) {
    if (from < at) continue;
    out += latex.slice(at, from);
    at = to;
  }
  return out + latex.slice(at);
};

export const termIds = (latex: string) => parseTerms(latex).terms.map((term) => term.id);

/** LaTeX reduced for comparison: no tags, spaces, thin spaces, \left or \right. */
export const normalizeLatex = (latex: string): string =>
  stripTerms(latex)
    .replace(/\\(left|right)(?![A-Za-z])/g, "")
    .replace(/\\[dt]frac(?![A-Za-z])/g, "\\frac")
    .replace(/\\[,;:! ]/g, "")
    .replace(/~/g, "")
    .replace(/\\(cdot|times)(?![A-Za-z])/g, "\\$1 ")
    .replace(/\s+/g, "")
    .trim();

// ---- A small LaTeX reader for automatic tagging ----

type LatexNode =
  | { kind: "char"; char: string; start: number; end: number }
  | { kind: "group"; start: number; end: number; children: LatexNode[] }
  | { kind: "cmd"; name: string; start: number; end: number; args: LatexNode[] };

const ARITY: Record<string, number> = {
  "\\frac": 2,
  "\\dfrac": 2,
  "\\tfrac": 2,
  "\\binom": 2,
  "\\sqrt": 1,
  "\\vec": 1,
  "\\hat": 1,
  "\\bar": 1,
  "\\overline": 1,
  "\\underline": 1,
  "\\dot": 1,
  "\\ddot": 1,
  "\\mathrm": 1,
  "\\text": 1,
  "\\textrm": 1,
  "\\mathbf": 1,
  "\\mathit": 1,
  "\\operatorname": 1,
  "\\left": 1,
  "\\right": 1,
  "\\term": 2,
};

/** Commands whose argument is words or units, never terms of their own. */
const TEXT_COMMANDS = new Set(["\\mathrm", "\\text", "\\textrm", "\\operatorname", "\\mathit"]);

const GREEK = new Set(
  "alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi varpi rho sigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Phi Psi Omega ell"
    .split(" ")
    .map((name) => `\\${name}`)
);

const SPACING = new Set(["\\,", "\\;", "\\:", "\\ ", "\\!", "~"]);

const readNodes = (latex: string, from: number, to: number): LatexNode[] => {
  const nodes: LatexNode[] = [];
  let i = from;
  const readOne = (): LatexNode | null => {
    i = skipSpaces(latex, i);
    if (i >= to) return null;
    const char = latex[i];
    if (char === "{") {
      const end = Math.min(closeOf(latex, i), to);
      const close = end < 0 ? to : end;
      const node: LatexNode = {
        kind: "group",
        start: i,
        end: close,
        children: readNodes(latex, i + 1, Math.max(i + 1, close - 1)),
      };
      i = close;
      return node;
    }
    if (char === "\\") {
      const word = /^\\([A-Za-z]+|.)/.exec(latex.slice(i, to));
      const name = word ? word[0] : "\\";
      const start = i;
      i += name.length;
      const args: LatexNode[] = [];
      if (name === "\\sqrt") {
        const at = skipSpaces(latex, i);
        if (latex[at] === "[") {
          const close = latex.indexOf("]", at);
          if (close > 0 && close < to) i = close + 1;
        }
      }
      for (let n = 0; n < (ARITY[name] ?? 0); n++) {
        const arg = readOne();
        if (!arg) break;
        args.push(arg);
      }
      return { kind: "cmd", name, start, end: i, args };
    }
    i += 1;
    return { kind: "char", char, start: i - 1, end: i };
  };
  for (let node = readOne(); node; node = readOne()) nodes.push(node);
  return nodes;
};

type Candidate = { start: number; end: number; kind: "atom" | "unit"; id?: string };

const isLetter = (node: LatexNode) =>
  (node.kind === "char" && /[A-Za-z]/.test(node.char)) ||
  (node.kind === "cmd" && GREEK.has(node.name));
const isDigit = (node: LatexNode | undefined) =>
  !!node && node.kind === "char" && /[0-9.]/.test(node.char);
const isScriptMark = (node: LatexNode | undefined, mark: "_" | "^") =>
  !!node && node.kind === "char" && node.char === mark;
const isSpacing = (node: LatexNode | undefined) =>
  !!node &&
  ((node.kind === "cmd" && SPACING.has(node.name)) || (node.kind === "char" && node.char === "~"));
const isUnitCommand = (node: LatexNode | undefined) =>
  !!node && node.kind === "cmd" && (node.name === "\\mathrm" || node.name === "\\text");

/** Turns a piece of LaTeX into a readable id such as "v_0", "n120" or "alpha". */
const idFor = (source: string) => {
  if (source.trim() === "=") return "eq";
  let id = source
    .replace(/\\(mathrm|text)\{([^}]*)\}/g, "$2")
    .replace(/\\[,;:! ]|~/g, "")
    .replace(/\\/g, "")
    .replace(/[{}]/g, "")
    .replace(/[^A-Za-z0-9_]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!id) id = "t";
  if (!/^[A-Za-z]/.test(id)) id = `n${id}`;
  return id.slice(0, 32);
};

/**
 * Candidate ranges of a sequence of nodes: every contiguous run (to match the terms of the
 * state before) and the atoms that get tags of their own (letters with subscripts, numbers
 * with their units, the equals sign).
 */
const MAX_RUN = 40;

const collect = (latex: string, nodes: LatexNode[], out: Candidate[], inScript: boolean) => {
  const isMark = (node: LatexNode | undefined) =>
    isScriptMark(node, "_") || isScriptMark(node, "^");
  // Contiguous runs, for matching. A run never starts or ends on a script mark and never
  // splits a letter from its subscript.
  for (let a = 0; a < nodes.length; a++) {
    if (isMark(nodes[a]) || isMark(nodes[a - 1])) continue;
    for (let b = a; b < Math.min(nodes.length, a + MAX_RUN); b++) {
      if (isMark(nodes[b]) || isScriptMark(nodes[b + 1], "_")) continue;
      out.push({ start: nodes[a].start, end: nodes[b].end, kind: "unit" });
    }
  }

  for (let k = 0; k < nodes.length; k++) {
    const node = nodes[k];
    // Script arguments are matched but never tagged on their own.
    const scripted = inScript || isMark(nodes[k - 1]);
    if (!scripted && isLetter(node)) {
      // A letter with its subscript and primes is one atom: v_0, x'.
      let end = node.end;
      let next = k + 1;
      if (isScriptMark(nodes[next], "_") && nodes[next + 1]) {
        end = nodes[next + 1].end;
        next += 2;
      }
      while (nodes[next]?.kind === "char" && (nodes[next] as { char: string }).char === "'") {
        end = nodes[next].end;
        next += 1;
      }
      out.push({ start: node.start, end, kind: "atom", id: idFor(latex.slice(node.start, end)) });
    } else if (!scripted && isDigit(node) && !isDigit(nodes[k - 1])) {
      let last = k;
      while (isDigit(nodes[last + 1])) last += 1;
      // A number with its unit, such as 120\,\mathrm{m}, is one quantity.
      let unit = last + 1;
      while (isSpacing(nodes[unit])) unit += 1;
      const end = isUnitCommand(nodes[unit]) ? nodes[unit].end : nodes[last].end;
      out.push({ start: node.start, end, kind: "atom", id: idFor(latex.slice(node.start, end)) });
      if (end !== nodes[last].end) out.push({ start: node.start, end, kind: "unit" });
    } else if (!scripted && node.kind === "char" && node.char === "=") {
      out.push({ start: node.start, end: node.end, kind: "atom", id: "eq" });
    }
    // Look inside groups and command arguments.
    if (node.kind === "group") collect(latex, node.children, out, scripted);
    if (node.kind === "cmd" && !TEXT_COMMANDS.has(node.name))
      for (const arg of node.args)
        collect(latex, arg.kind === "group" ? arg.children : [arg], out, scripted);
  }
};

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) =>
  a.start < b.end && b.start < a.end;
const nests = (inner: { start: number; end: number }, outer: { start: number; end: number }) =>
  outer.start <= inner.start && inner.end <= outer.end;

type Claim = { start: number; end: number; id: string };

const canClaim = (claims: Claim[], range: { start: number; end: number }) =>
  claims.every(
    (claim) =>
      !overlaps(claim, range) ||
      ((nests(range, claim) || nests(claim, range)) &&
        !(claim.start === range.start && claim.end === range.end))
  );

const wrap = (latex: string, claims: Claim[]) => {
  type Mark = { at: number; text: string; order: number };
  const marks: Mark[] = [];
  for (const claim of claims) {
    const scripted = /[_^]\s*$/.test(latex.slice(0, claim.start));
    const length = claim.end - claim.start;
    // Openings: outer (longer) first; closings: inner (shorter) first.
    marks.push({ at: claim.start, text: `${scripted ? "{" : ""}\\term{${claim.id}}{`, order: -length });
    marks.push({ at: claim.end, text: `}${scripted ? "}" : ""}`, order: length });
  }
  marks.sort((a, b) => a.at - b.at || (a.text.startsWith("}") ? -1 : 1) - (b.text.startsWith("}") ? -1 : 1) || a.order - b.order);
  let out = "";
  let at = 0;
  for (const mark of marks) {
    out += latex.slice(at, mark.at) + mark.text;
    at = mark.at;
  }
  return out + latex.slice(at);
};

/**
 * Tags a state typed without tags. Subexpressions identical to a term of the previous state
 * get that term's id (longest terms first); the remaining letters, numbers with units and the
 * equals sign get new ids that do not collide with the previous state's.
 */
export const autoTag = (raw: string, previous?: string | null): string => {
  const source = stripTerms(raw);
  const nodes = readNodes(source, 0, source.length);
  const candidates: Candidate[] = [];
  collect(source, nodes, candidates, false);

  const claims: Claim[] = [];
  const used = new Set<string>();
  const previousTerms = previous ? parseTerms(previous).terms : [];
  const reserved = new Set(previousTerms.map((term) => term.id));

  const normalized = candidates.map((candidate) =>
    normalizeLatex(source.slice(candidate.start, candidate.end))
  );
  const byLength = [...previousTerms].sort(
    (a, b) => normalizeLatex(b.body).length - normalizeLatex(a.body).length
  );
  for (const term of byLength) {
    const body = normalizeLatex(term.body);
    if (!body || used.has(term.id)) continue;
    const match = candidates.find(
      (candidate, n) => normalized[n] === body && canClaim(claims, candidate)
    );
    if (match) {
      claims.push({ start: match.start, end: match.end, id: term.id });
      used.add(term.id);
    }
  }

  for (const candidate of candidates) {
    if (candidate.kind !== "atom" || !candidate.id) continue;
    if (claims.some((claim) => claim.start === candidate.start && claim.end === candidate.end))
      continue;
    if (!canClaim(claims, candidate)) continue;
    // An atom inside a claimed term moves with it; it needs no tag of its own unless the
    // previous state tagged it.
    if (claims.some((claim) => nests(candidate, claim))) continue;
    let id = candidate.id;
    for (let n = 2; used.has(id) || reserved.has(id); n++) id = `${candidate.id}-${n}`;
    claims.push({ start: candidate.start, end: candidate.end, id });
    used.add(id);
  }
  return wrap(source, claims);
};

/**
 * The pairs of terms [idInA, idInB] that move from state a to state b: the same id in both,
 * then terms with identical content, then the links made by hand. Unlinks remove automatic
 * pairs; terms listed in `exclude` (filled by a given in a Substitute step) never pair.
 */
export const termPairs = (
  a: string,
  b: string,
  options: { links?: TermLink[]; unlinks?: TermLink[]; exclude?: string[] } = {}
): TermLink[] => {
  const aTerms = parseTerms(a).terms;
  const bTerms = parseTerms(b).terms;
  const aIds = new Set(aTerms.map((term) => term.id));
  const bIds = new Set(bTerms.map((term) => term.id));
  const exclude = new Set(options.exclude ?? []);
  const unlinked = (pair: TermLink) =>
    (options.unlinks ?? []).some(([from, to]) => from === pair[0] && to === pair[1]);

  const pairs: TermLink[] = [];
  const pairedA = new Set<string>();
  const pairedB = new Set<string>();
  const add = (pair: TermLink) => {
    pairs.push(pair);
    pairedA.add(pair[0]);
    pairedB.add(pair[1]);
  };

  for (const term of bTerms)
    if (aIds.has(term.id) && !exclude.has(term.id) && !unlinked([term.id, term.id]))
      add([term.id, term.id]);

  for (const bTerm of bTerms) {
    if (pairedB.has(bTerm.id) || exclude.has(bTerm.id)) continue;
    const body = normalizeLatex(bTerm.body);
    if (!body) continue;
    const aTerm = aTerms.find(
      (term) =>
        !pairedA.has(term.id) &&
        !bIds.has(term.id) &&
        normalizeLatex(term.body) === body &&
        !unlinked([term.id, bTerm.id])
    );
    if (aTerm) add([aTerm.id, bTerm.id]);
  }

  for (const [from, to] of options.links ?? []) {
    if (!aIds.has(from) || !bIds.has(to) || exclude.has(to)) continue;
    // A hand link replaces whatever the target was paired with.
    const existing = pairs.findIndex((pair) => pair[1] === to);
    if (existing >= 0) pairs.splice(existing, 1);
    if (!pairs.some((pair) => pair[0] === from && pair[1] === to)) add([from, to]);
  }
  return pairs;
};

/** The term of a state whose content is the given value (with or without its unit). */
export const termForValue = (
  stateLatex: string,
  value: number | string,
  unit?: string
): string | null => {
  const { terms } = parseTerms(stateLatex);
  const plain = normalizeLatex(String(value));
  const withUnit = unit ? normalizeLatex(`${value}\\mathrm{${unit}}`) : null;
  const found =
    (withUnit && terms.find((term) => normalizeLatex(term.body) === withUnit)) ||
    terms.find((term) => normalizeLatex(term.body) === plain);
  return found?.id ?? null;
};
