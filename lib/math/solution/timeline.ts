// The timeline of a solution script. compileTimeline lays the steps out in time; frameAt
// computes the whole state of the scene at any position, from scratch, so scrubbing backwards
// or forwards always gives exactly the state the script describes (section 5.5). Nothing here
// touches the DOM: the player turns a frame into styles, and the tests read frames directly.
import { normalizeLatex, stripTerms, termIds, termPairs } from "./terms";
import type { SolutionScript, Step, StepKind, TermLink } from "./types";

/** Seconds of motion at the start of each kind of step; the rest of the step holds still. */
export const MOTION: Record<StepKind, number> = {
  Extract: 1.4,
  Relate: 1.2,
  Substitute: 1.4,
  Transform: 1.2,
  Plot: 2,
  Construct: 1.2,
  Annotate: 0.8,
  Answer: 1,
};

export type TimedStep = {
  index: number;
  step: Step;
  start: number;
  end: number;
  /** Seconds of motion, at most the step's duration. */
  motion: number;
  /** For Relate, Transform and Substitute: the equation and the states before and after. */
  equation?: string;
  from?: string;
  to?: string;
  /** Terms that move from `from` to `to`. */
  pairs?: TermLink[];
};

export type Timeline = {
  script: SolutionScript;
  steps: TimedStep[];
  total: number;
};

export type Flight = {
  key: string;
  /** "span" lifts question text into a given card; "symbol" and "value" fly a given into a term. */
  kind: "span" | "symbol" | "value";
  given: string;
  from: { span: string } | { given: string };
  to: { given: string } | { equation: string; state: string; term: string };
  progress: number;
};

export type EquationFrame = {
  /** The state shown, or the state a transition starts from. */
  state: string;
  transition: { from: string; to: string; progress: number; pairs: TermLink[] } | null;
  /** Terms of the target state hidden until a given lands in them. */
  hidden: string[];
  box: { term: string | null; progress: number } | null;
};

export type Frame = {
  time: number;
  /** The step playing (the last one that started). */
  step: number;
  /** Motion progress of that step, 0 to 1. */
  progress: number;
  narration: string | null;
  /** Opacity of givens, equations, graphs, figures, tables and notes, by id. */
  opacity: Record<string, number>;
  spans: Record<string, { active: number; extracted: boolean }>;
  flights: Flight[];
  equations: Record<string, EquationFrame>;
  /** Drawing progress of graph items, figure shapes and table rows ("0", "1"...), by element. */
  parts: Record<string, Record<string, number>>;
  answer: { progress: number; text: string | null; equation: string | null; term: string | null } | null;
};

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

/** Smooth start and end. */
export const ease = (t: number) => {
  const x = clamp(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};

const stateLatex = (script: SolutionScript, equation: string, state: string) =>
  script.equations.find((e) => e.id === equation)?.states.find((s) => s.id === state)?.latex ?? "";

export const compileTimeline = (input: SolutionScript): Timeline => {
  // Validated scripts have every list; fill them in for anything else.
  const script: SolutionScript = {
    ...input,
    question: input.question ?? [],
    givens: input.givens ?? [],
    equations: input.equations ?? [],
    graphs: input.graphs ?? [],
    figures: input.figures ?? [],
    tables: input.tables ?? [],
    notes: input.notes ?? [],
    steps: input.steps ?? [],
  };
  const steps: TimedStep[] = [];
  const shown = new Map<string, string>();
  let lastEquation: string | undefined;
  let at = 0;
  script.steps.forEach((step, index) => {
    const timed: TimedStep = {
      index,
      step,
      start: at,
      end: at + step.duration,
      motion: Math.max(0.05, Math.min(step.duration, MOTION[step.kind])),
    };
    at = timed.end;
    if (step.kind === "Relate") {
      const equation = script.equations.find((e) => e.id === step.equation);
      const state = step.state ?? equation?.states[0]?.id;
      if (equation && state) {
        timed.equation = equation.id;
        timed.to = state;
        shown.set(equation.id, state);
        lastEquation = equation.id;
      }
    } else if (step.kind === "Transform" || step.kind === "Substitute") {
      const from = shown.get(step.equation);
      timed.equation = step.equation;
      timed.from = from;
      timed.to = step.to;
      timed.pairs = from
        ? termPairs(stateLatex(script, step.equation, from), stateLatex(script, step.equation, step.to), {
            links: step.links,
            unlinks: step.unlinks,
            exclude: step.kind === "Substitute" ? step.pairs.map((pair) => pair.term) : [],
          })
        : [];
      shown.set(step.equation, step.to);
      lastEquation = step.equation;
    } else if (step.kind === "Answer") {
      timed.equation = step.equation ?? lastEquation;
      if (timed.equation) timed.to = shown.get(timed.equation);
    }
    steps.push(timed);
  });
  return { script, steps, total: at };
};

const emptyFrame = (script: SolutionScript, time: number): Frame => {
  const frame: Frame = {
    time,
    step: 0,
    progress: 0,
    narration: null,
    opacity: {},
    spans: {},
    flights: [],
    equations: {},
    parts: {},
    answer: null,
  };
  for (const span of script.question) if (span.id) frame.spans[span.id] = { active: 0, extracted: false };
  for (const element of [...script.givens, ...script.graphs, ...script.figures, ...script.tables, ...script.notes])
    frame.opacity[element.id] = 0;
  for (const equation of script.equations) {
    frame.opacity[equation.id] = 0;
    frame.equations[equation.id] = {
      state: equation.states[0]?.id ?? "",
      transition: null,
      hidden: [],
      box: null,
    };
  }
  for (const graph of script.graphs) frame.parts[graph.id] = {};
  for (const figure of script.figures) frame.parts[figure.id] = {};
  for (const table of script.tables) frame.parts[table.id] = {};
  return frame;
};

const show = (frame: Frame, id: string, amount: number) => {
  frame.opacity[id] = Math.max(frame.opacity[id] ?? 0, clamp(amount));
};

/** Progress of entry k of n drawn one after another within one step. */
const staggered = (p: number, k: number, n: number) => clamp(p * n - k);

const applyStep = (frame: Frame, timed: TimedStep, p: number, script: SolutionScript) => {
  const { step } = timed;
  const e = ease(p);
  switch (step.kind) {
    case "Extract": {
      const given = script.givens.find((g) => g.id === step.given);
      if (!given) break;
      const span = given.span && frame.spans[given.span] ? given.span : null;
      if (span) {
        const state = frame.spans[span];
        const active = p < 0.3 ? p / 0.3 : p <= 0.8 ? 1 : (1 - p) / 0.2;
        state.active = Math.max(state.active, clamp(active));
        if (p >= 0.3) state.extracted = true;
        const flight = clamp((p - 0.3) / 0.6);
        if (flight > 0 && flight < 1)
          frame.flights.push({
            key: `${timed.index}-${given.id}`,
            kind: "span",
            given: given.id,
            from: { span },
            to: { given: given.id },
            progress: ease(flight),
          });
        show(frame, given.id, (p - 0.85) / 0.15);
      } else show(frame, given.id, e);
      break;
    }
    case "Relate": {
      if (!timed.equation || !timed.to) break;
      const eq = frame.equations[timed.equation];
      eq.state = timed.to;
      eq.transition = null;
      eq.hidden = [];
      eq.box = null;
      show(frame, timed.equation, p / 0.35);
      const ids = new Set(termIds(stateLatex(script, timed.equation, timed.to)));
      for (const given of step.givens ?? []) {
        show(frame, given, p / 0.3);
        if (!ids.has(given)) continue;
        const flight = clamp((p - 0.3) / 0.6);
        if (flight < 1) eq.hidden.push(given);
        if (flight > 0 && flight < 1)
          frame.flights.push({
            key: `${timed.index}-${given}`,
            kind: "symbol",
            given,
            from: { given },
            to: { equation: timed.equation, state: timed.to, term: given },
            progress: ease(flight),
          });
      }
      break;
    }
    case "Transform":
    case "Substitute": {
      if (!timed.equation || !timed.to) break;
      const eq = frame.equations[timed.equation];
      eq.box = null;
      eq.hidden = [];
      if (!timed.from || p >= 1) {
        eq.state = timed.to;
        eq.transition = null;
      } else {
        eq.state = timed.from;
        eq.transition = { from: timed.from, to: timed.to, progress: e, pairs: timed.pairs ?? [] };
      }
      if (step.kind === "Substitute")
        for (const pair of step.pairs) {
          show(frame, pair.given, p / 0.2);
          const flight = clamp((p - 0.15) / 0.75);
          if (flight < 1) eq.hidden.push(pair.term);
          if (flight > 0 && flight < 1)
            frame.flights.push({
              key: `${timed.index}-${pair.given}-${pair.term}`,
              kind: "value",
              given: pair.given,
              from: { given: pair.given },
              to: { equation: timed.equation, state: timed.to, term: pair.term },
              progress: ease(flight),
            });
        }
      break;
    }
    case "Plot": {
      show(frame, step.graph, p / 0.25);
      const parts = (frame.parts[step.graph] ??= {});
      step.items.forEach((item, k) => {
        parts[item] = Math.max(parts[item] ?? 0, ease(staggered(p, k, step.items.length)));
      });
      break;
    }
    case "Construct": {
      const id = step.figure ?? step.table;
      if (!id) break;
      show(frame, id, p / 0.25);
      const parts = (frame.parts[id] ??= {});
      const list = step.figure ? (step.shapes ?? []) : (step.rows ?? []).map(String);
      list.forEach((part, k) => {
        parts[part] = Math.max(parts[part] ?? 0, ease(staggered(p, k, list.length)));
      });
      break;
    }
    case "Annotate":
      for (const note of step.notes) show(frame, note, e);
      break;
    case "Answer": {
      const term = step.term ?? null;
      if (timed.equation) frame.equations[timed.equation].box = { term, progress: e };
      frame.answer = { progress: e, text: step.text ?? null, equation: timed.equation ?? null, term };
      if (step.span && frame.spans[step.span])
        frame.spans[step.span].active = Math.max(frame.spans[step.span].active, e);
      break;
    }
  }
  for (const id of step.hide ?? []) frame.opacity[id] = Math.min(frame.opacity[id] ?? 0, 1 - e);
};

/** The whole scene at a time in seconds (clamped to the timeline). */
export const frameAt = (timeline: Timeline, time: number): Frame => {
  const t = clamp(Number.isFinite(time) ? time : 0, 0, timeline.total);
  const frame = emptyFrame(timeline.script, t);
  for (const timed of timeline.steps) {
    if (timed.start > t) break;
    const p = clamp((t - timed.start) / timed.motion);
    applyStep(frame, timed, p, timeline.script);
    frame.step = timed.index;
    frame.progress = p;
  }
  frame.narration = timeline.steps[frame.step]?.step.narration ?? null;
  return frame;
};

/** The step that is playing at a time. */
export const stepAt = (timeline: Timeline, time: number) => {
  let index = 0;
  for (const timed of timeline.steps) if (timed.start <= time) index = timed.index;
  return index;
};

/** Steps that show an equation state, in order: where a learner's lines can be compared. */
export const equationSteps = (timeline: Timeline) =>
  timeline.steps.filter(
    (timed) =>
      (timed.step.kind === "Relate" || timed.step.kind === "Transform" || timed.step.kind === "Substitute") &&
      timed.equation &&
      timed.to
  );

/**
 * The step to open at when grading found a wrong line: the step whose equation state matches
 * the corrected line, else the step that shows the n-th equation line of the solution, else
 * the first step.
 */
export const stepForWrongLine = (
  timeline: Timeline,
  line: number,
  correctedLine?: string | null
): number => {
  const candidates = equationSteps(timeline);
  if (!candidates.length || !(line > 0)) return 0;
  if (correctedLine?.trim()) {
    const wanted = normalizeLatex(correctedLine);
    const wantedRight = wanted.split("=").pop() ?? wanted;
    const match =
      candidates.find((timed) => normalizeLatex(stateLatex(timeline.script, timed.equation!, timed.to!)) === wanted) ??
      candidates.find((timed) => {
        const state = normalizeLatex(stateLatex(timeline.script, timed.equation!, timed.to!));
        return wantedRight.length > 0 && state.split("=").pop() === wantedRight && state.includes("=") === wanted.includes("=");
      });
    if (match) return match.index;
  }
  return candidates[Math.min(line, candidates.length) - 1].index;
};

/** The equation line a step shows, without tags, for the comparison with a learner's line. */
export const lineShownAt = (timeline: Timeline, index: number): string | null => {
  const timed = timeline.steps[index];
  if (!timed?.equation || !timed.to) return null;
  return stripTerms(stateLatex(timeline.script, timed.equation, timed.to));
};
