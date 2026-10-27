// "Draft with AI" (section 5.6): what the author's provider is asked for and how its reply
// becomes a solution script. The reply follows DRAFT_SCHEMA, a flat form of the script that
// meets the strictest provider rules (every object closed, every property required, no null,
// no length or range keywords): unused text fields are "", unused numbers 0, unused lists [].
// draftToScript turns it into a script, tags untagged states, and the caller validates the
// result before an author sees it.
//
// No Next.js or database imports.
import { autoTag, parseTerms, termForValue } from "./terms";
import {
  GRAPH_ITEM_TYPES,
  SCRIPT_COLORS,
  SCRIPT_FORMAT,
  SHAPE_TYPES,
  STEP_KINDS,
  type GraphItem,
  type Point2,
  type ScriptColor,
  type Shape,
  type ShapeRef,
  type SolutionScript,
  type Step,
} from "./types";

const str = (description?: string) =>
  description ? { type: "string", description } : { type: "string" };
const num = (description?: string) =>
  description ? { type: "number", description } : { type: "number" };
const object = (properties: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const array = (items: unknown, description?: string) =>
  description ? { type: "array", items, description } : { type: "array", items };

export const DRAFT_SCHEMA = object({
  title: str("A short title of the solution."),
  question: array(
    object({
      id: str('An id for a span that a given comes from, or "" for plain text.'),
      text: str("A piece of the question, word for word; together the pieces give the whole question."),
    })
  ),
  givens: array(
    object({
      id: str("Id, usually the symbol, such as d or v_0."),
      symbol: str("LaTeX of the symbol."),
      value: str("The value as a number or LaTeX, without the unit."),
      unit: str('Unit such as m/s, or "".'),
      span: str('Id of the question span it comes from, or "".'),
      label: str('One or two words, such as speed, or "".'),
    })
  ),
  equations: array(
    object({
      id: str(),
      states: array(
        object({
          id: str(),
          latex: str("LaTeX with every term tagged as \\term{id}{...}."),
        })
      ),
    })
  ),
  graphs: array(
    object({
      id: str(),
      xMin: num(),
      xMax: num(),
      yMin: num(),
      yMax: num(),
      items: array(
        object({
          id: str(),
          type: { type: "string", enum: [...GRAPH_ITEM_TYPES] },
          fn: str('For a function: y in terms of x, such as 0.5*x^2 or sin(x). Otherwise "".'),
          ref: str('For a point moving along a function or an area under it: the function item id. Otherwise "".'),
          x: num(),
          y: num(),
          x2: num(),
          y2: num(),
          from: num(),
          to: num(),
          dashed: { type: "boolean" },
          color: { type: "string", enum: [...SCRIPT_COLORS] },
          label: str(),
        })
      ),
    })
  ),
  figures: array(
    object({
      id: str(),
      width: num(),
      height: num(),
      shapes: array(
        object({
          id: str(),
          type: { type: "string", enum: [...SHAPE_TYPES] },
          points: array(
            object({
              ref: str('The id of a point shape, or "" to use x and y.'),
              x: num(),
              y: num(),
            })
          ),
          r: num(),
          min: num(),
          max: num(),
          step: num(),
          text: str(),
          flag: { type: "boolean", description: "dashed, filled, or a right angle mark." },
          color: { type: "string", enum: [...SCRIPT_COLORS] },
          label: str(),
        })
      ),
    })
  ),
  tables: array(
    object({
      id: str(),
      header: array(str()),
      rows: array(object({ cells: array(str()) })),
    })
  ),
  notes: array(
    object({
      id: str(),
      text: str(),
      element: str('The id of what the note points at, or "".'),
      part: str('A term, item or shape id of that element, or "".'),
    })
  ),
  steps: array(
    object({
      kind: { type: "string", enum: [...STEP_KINDS] },
      duration: num("Seconds, 2 to 6."),
      narration: str(),
      target: str("The given, equation, graph, figure or table the step works on."),
      state: str("Relate: the state shown. Transform and Substitute: the new state."),
      givens: array(str()),
      parts: array(str()),
      pairs: array(object({ given: str(), term: str() })),
      links: array(object({ from: str(), to: str() })),
      term: str(),
      text: str(),
      span: str(),
    })
  ),
});

export const DRAFT_SYSTEM = [
  "You write animated step-by-step solutions for math and physics problems as JSON.",
  "The question is split into spans whose texts together give the whole question word for word; give an id to each span that holds a given number or the asked quantity, with math between $ signs as in the question.",
  "Givens are named quantities from the question. Equations have states; every state is LaTeX in which each term is tagged as \\term{id}{...}.",
  "A term keeps its id in the next state when it is the same term, so it moves there in the animation; new terms get new ids; ids are letters, digits, _ or -, starting with a letter, unique within a state.",
  "Tag the symbol of a given with the given's id, for example \\term{d}{d}. Tag numbers with their units as one term, for example \\term{dv}{120\\,\\mathrm{m}}.",
  "Step kinds and their fields:",
  "Extract (target = a given id) lifts a given out of the question.",
  "Relate (target = equation, state, givens = givens whose symbols fly into the terms with the same id) shows an equation.",
  "Transform (target = equation, state = the new state) turns the current state into the next one.",
  "Substitute (target = equation, state = the new state, pairs = which given fills which term of the new state) puts values in.",
  "Plot (target = graph, parts = item ids) draws graph items. Graph items: function (fn in x, from and to as the drawn range, or 0 and 0 for the whole view), point (x, y, or ref = a function id with from and to to move along it), area (ref = function id, from, to), vector and segment (x, y to x2, y2).",
  "Construct (target = figure, parts = shape ids; or target = table, parts = row numbers from 0) adds to a figure or a table. Figures use SVG coordinates with y pointing down; shapes take their points from the points list: point (1 point), segment and arrow (2), polygon (2 or more), circle (center, r), angle (vertex, then one point on each side; flag = right angle), rect (corner, then width and height as x and y), text (1 point and text), numberLine (2 points, min, max, step).",
  "Annotate (parts = note ids) shows notes; a note may point at an element and a part of it.",
  "Answer (target = equation, term = the result term, text = a sentence that checks the result against the question, span = the asked span) boxes the result.",
  "Use only the elements a step needs. Write short narration in plain words for each step. Keep units in the equations. Never use \\htmlClass, \\htmlId or \\href.",
].join(" ");

export type DraftInput = {
  question: string;
  statement: string;
  answer: string;
  solution: string[];
};

export const draftPrompt = (input: DraftInput) =>
  [
    "The problem as shown to learners:",
    input.statement.trim(),
    "",
    `The expected answer: ${input.answer}`,
    input.solution.length ? `The reference solution, line by line:\n${input.solution.join("\n")}` : "",
    "",
    "Write the animated solution. Split the question into spans exactly as written above.",
  ]
    .filter((line) => line !== null)
    .join("\n");

// ---- From the flat reply to a script ----

type Rec = Record<string, unknown>;
const rec = (value: unknown): Rec =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Rec) : {};
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const number = (value: unknown, fallback = 0) => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const colorOf = (value: unknown): ScriptColor | undefined =>
  (SCRIPT_COLORS as readonly unknown[]).includes(value) ? (value as ScriptColor) : undefined;
const optional = <T extends Rec>(entry: T): T => {
  for (const key of Object.keys(entry)) if (entry[key] === undefined || entry[key] === "") delete entry[key];
  return entry;
};

const toItem = (raw: Rec): GraphItem => {
  const base = { id: text(raw.id), color: colorOf(raw.color), label: text(raw.label) || undefined };
  const from = number(raw.from);
  const to = number(raw.to);
  switch (raw.type) {
    case "function":
      return optional({ ...base, type: "function" as const, fn: text(raw.fn), domain: from < to ? ([from, to] as [number, number]) : undefined });
    case "point":
      return text(raw.ref)
        ? optional({ ...base, type: "point" as const, along: text(raw.ref), from, to })
        : optional({ ...base, type: "point" as const, at: [number(raw.x), number(raw.y)] as Point2 });
    case "area":
      return optional({ ...base, type: "area" as const, of: text(raw.ref), from, to });
    case "vector":
      return optional({ ...base, type: "vector" as const, from: [number(raw.x), number(raw.y)] as Point2, to: [number(raw.x2), number(raw.y2)] as Point2 });
    default:
      return optional({
        ...base,
        type: "segment" as const,
        from: [number(raw.x), number(raw.y)] as Point2,
        to: [number(raw.x2), number(raw.y2)] as Point2,
        dashed: raw.dashed === true ? true : undefined,
      });
  }
};

const toShape = (raw: Rec): Shape => {
  const points: ShapeRef[] = arr(raw.points).map((point) => {
    const p = rec(point);
    return text(p.ref) || ([number(p.x), number(p.y)] as Point2);
  });
  const xy = (k: number): Point2 => {
    const point = points[k];
    return Array.isArray(point) ? point : [0, 0];
  };
  const ref = (k: number): ShapeRef => points[k] ?? [0, 0];
  const base = { id: text(raw.id), color: colorOf(raw.color), label: text(raw.label) || undefined };
  const flag = raw.flag === true ? true : undefined;
  switch (raw.type) {
    case "point":
      return optional({ ...base, type: "point" as const, at: xy(0) });
    case "arrow":
      return optional({ ...base, type: "arrow" as const, from: ref(0), to: ref(1) });
    case "polygon":
      return optional({ ...base, type: "polygon" as const, points, fill: flag });
    case "circle":
      return optional({ ...base, type: "circle" as const, center: ref(0), r: number(raw.r, 10) });
    case "angle":
      return optional({ ...base, type: "angle" as const, at: ref(0), from: ref(1), to: ref(2), r: number(raw.r) > 0 ? number(raw.r) : undefined, right: flag });
    case "rect":
      return optional({ ...base, type: "rect" as const, at: xy(0), size: xy(1) });
    case "text":
      return optional({ ...base, type: "text" as const, at: xy(0), text: text(raw.text) || base.label || "?" , label: undefined });
    case "numberLine":
      return optional({ ...base, type: "numberLine" as const, from: xy(0), to: xy(1), min: number(raw.min), max: number(raw.max), step: number(raw.step, 1) });
    default:
      return optional({ ...base, type: "segment" as const, from: ref(0), to: ref(1), dashed: flag });
  }
};

const clampDuration = (value: unknown) => Math.min(20, Math.max(1, number(value, 3)));

/** Turns a draft reply into a script (not yet validated). */
export const draftToScript = (json: unknown): SolutionScript => {
  const draft = rec(json);
  const script: SolutionScript = {
    format: SCRIPT_FORMAT,
    question: arr(draft.question)
      .map((span) => rec(span))
      .filter((span) => typeof span.text === "string" && span.text)
      .map((span) => optional({ id: text(span.id) || undefined, text: span.text as string })),
    givens: arr(draft.givens).map((g) => {
      const given = rec(g);
      const value = text(given.value);
      return optional({
        id: text(given.id),
        symbol: text(given.symbol) || text(given.id),
        value: value !== "" && Number.isFinite(Number(value)) ? Number(value) : value,
        unit: text(given.unit) || undefined,
        span: text(given.span) || undefined,
        label: text(given.label) || undefined,
      });
    }),
    equations: arr(draft.equations).map((e) => {
      const equation = rec(e);
      let previous: string | null = null;
      return {
        id: text(equation.id),
        states: arr(equation.states).map((s) => {
          const state = rec(s);
          let latex = text(state.latex);
          // A state without tags is tagged by matching the state before.
          if (latex && !parseTerms(latex).terms.length) latex = autoTag(latex, previous);
          previous = latex;
          return { id: text(state.id), latex };
        }),
      };
    }),
    graphs: arr(draft.graphs).map((g) => {
      const graph = rec(g);
      return {
        id: text(graph.id),
        view: { x: [number(graph.xMin), number(graph.xMax)], y: [number(graph.yMin), number(graph.yMax)] },
        items: arr(graph.items).map((item) => toItem(rec(item))),
      };
    }),
    figures: arr(draft.figures).map((f) => {
      const figure = rec(f);
      return {
        id: text(figure.id),
        width: number(figure.width, 300),
        height: number(figure.height, 200),
        shapes: arr(figure.shapes).map((shape) => toShape(rec(shape))),
      };
    }),
    tables: arr(draft.tables).map((t) => {
      const table = rec(t);
      const header = arr(table.header).map(text);
      return optional({
        id: text(table.id),
        header: header.length ? header : undefined,
        rows: arr(table.rows).map((row) => arr(rec(row).cells).map(text)),
      });
    }),
    notes: arr(draft.notes).map((n) => {
      const note = rec(n);
      const element = text(note.element);
      return optional({
        id: text(note.id),
        text: text(note.text),
        target: element ? optional({ element, part: text(note.part) || undefined }) : undefined,
      });
    }),
    steps: [],
  };
  const title = text(draft.title);
  if (title) script.title = title.slice(0, 200);

  const stateLatex = (equation: string, state: string) =>
    script.equations.find((e) => e.id === equation)?.states.find((s) => s.id === state)?.latex ?? "";

  for (const s of arr(draft.steps)) {
    const raw = rec(s);
    const base = {
      duration: clampDuration(raw.duration),
      narration: text(raw.narration) || undefined,
    };
    const target = text(raw.target);
    const state = text(raw.state);
    const parts = arr(raw.parts).map(text).filter(Boolean);
    const links = arr(raw.links)
      .map((link) => [text(rec(link).from), text(rec(link).to)] as [string, string])
      .filter(([from, to]) => from && to);
    let step: Step | null = null;
    switch (raw.kind) {
      case "Extract":
        step = { ...base, kind: "Extract", given: target };
        break;
      case "Relate":
        step = { ...base, kind: "Relate", equation: target, state: state || undefined, givens: arr(raw.givens).map(text).filter(Boolean) };
        break;
      case "Transform":
        step = { ...base, kind: "Transform", equation: target, to: state, links: links.length ? links : undefined };
        break;
      case "Substitute": {
        let pairs = arr(raw.pairs)
          .map((pair) => ({ given: text(rec(pair).given), term: text(rec(pair).term) }))
          .filter((pair) => pair.given && pair.term);
        if (!pairs.length) {
          // Find the terms that hold the givens' values.
          const latex = stateLatex(target, state);
          pairs = script.givens
            .map((given) => ({ given: given.id, term: termForValue(latex, given.value, given.unit) ?? "" }))
            .filter((pair) => pair.term);
        }
        step = { ...base, kind: "Substitute", equation: target, to: state, pairs, links: links.length ? links : undefined };
        break;
      }
      case "Plot":
        step = { ...base, kind: "Plot", graph: target, items: parts };
        break;
      case "Construct":
        step = script.tables.some((table) => table.id === target)
          ? { ...base, kind: "Construct", table: target, rows: parts.map(Number).filter(Number.isInteger) }
          : { ...base, kind: "Construct", figure: target, shapes: parts };
        break;
      case "Annotate":
        step = { ...base, kind: "Annotate", notes: parts };
        break;
      case "Answer":
        step = optional({
          ...base,
          kind: "Answer" as const,
          equation: target || undefined,
          term: text(raw.term) || undefined,
          text: text(raw.text) || undefined,
          span: text(raw.span) || undefined,
        });
        break;
    }
    if (step) script.steps.push(optional(step as unknown as Rec) as unknown as Step);
  }
  return script;
};
