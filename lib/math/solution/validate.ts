// The schema check of solution scripts. Every script is checked here before it is stored (course
// import and update, the author's save) and before an AI draft is shown. The result is either a
// clean script with every list present, or a list of problems as short sentences with the path
// of the field, such as "steps[2].to: no state "s4" in equation "eq1"."
//
// No dependencies beyond this folder, so the course import script can bundle it.
import { expressionProblem } from "./expr";
import { parseTerms, TERM_ID } from "./terms";
import {
  GRAPH_ITEM_TYPES,
  SCRIPT_COLORS,
  SCRIPT_FORMAT,
  SHAPE_TYPES,
  STEP_KINDS,
  type SolutionScript,
  type StepKind,
} from "./types";

export const SCRIPT_LIMITS = {
  bytes: 200 * 1024,
  spans: 200,
  text: 2000,
  givens: 40,
  equations: 20,
  states: 30,
  latex: 1500,
  graphs: 10,
  items: 40,
  figures: 10,
  shapes: 200,
  tables: 10,
  rows: 50,
  cells: 12,
  cell: 300,
  notes: 50,
  note: 500,
  steps: 200,
  narration: 1000,
  minDuration: 0.2,
  maxDuration: 60,
  totalDuration: 900,
} as const;

/** Commands that could add links, classes, styles or pictures to the page. */
const UNSAFE_LATEX =
  /\\(htmlClass|htmlId|htmlStyle|htmlData|href|url|includegraphics)(?![A-Za-z])/;

type Rec = Record<string, unknown>;

const isRecord = (value: unknown): value is Rec =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isPoint = (value: unknown): value is [number, number] =>
  Array.isArray(value) && value.length === 2 && value.every(isNumber);

const isId = (value: unknown): value is string => typeof value === "string" && TERM_ID.test(value);

const STEP_KEYS: Record<StepKind, string[]> = {
  Extract: ["given"],
  Relate: ["equation", "state", "givens"],
  Substitute: ["equation", "to", "pairs", "links", "unlinks"],
  Transform: ["equation", "to", "links", "unlinks"],
  Plot: ["graph", "items"],
  Construct: ["figure", "shapes", "table", "rows"],
  Annotate: ["notes"],
  Answer: ["equation", "term", "text", "span"],
};
const STEP_BASE_KEYS = ["id", "kind", "duration", "narration", "hide"];

const ITEM_KEYS: Record<string, string[]> = {
  function: ["fn", "domain"],
  point: ["at", "along", "from", "to"],
  area: ["of", "from", "to"],
  vector: ["from", "to"],
  segment: ["from", "to", "dashed"],
};
const SHAPE_KEYS: Record<string, string[]> = {
  point: ["at"],
  segment: ["from", "to", "dashed"],
  arrow: ["from", "to"],
  polygon: ["points", "fill"],
  circle: ["center", "r"],
  angle: ["at", "from", "to", "r", "right"],
  rect: ["at", "size"],
  text: ["at", "text"],
  numberLine: ["from", "to", "min", "max", "step"],
};

/**
 * Checks a script. Returns the script with every list present when it is valid, otherwise
 * null and the problems.
 */
export const validateSolutionScript = (
  value: unknown
): { script: SolutionScript | null; problems: string[] } => {
  const problems: string[] = [];
  const add = (path: string, message: string) => {
    if (problems.length < 100) problems.push(path ? `${path}: ${message}` : message);
  };

  if (!isRecord(value)) return { script: null, problems: ["The script must be a JSON object."] };
  let size = 0;
  try {
    size = new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return { script: null, problems: ["The script must be plain JSON."] };
  }
  if (size > SCRIPT_LIMITS.bytes)
    return {
      script: null,
      problems: [`The script is ${Math.ceil(size / 1024)} KB; the limit is 200 KB.`],
    };

  const known = (record: Rec, keys: string[], path: string) => {
    for (const key of Object.keys(record))
      if (!keys.includes(key)) add(path, `${key} is not a known field.`);
  };
  const text = (input: unknown, path: string, max: number, required = true): string | undefined => {
    if (input === undefined && !required) return undefined;
    if (typeof input !== "string" || (required && !input.trim()) || input.length > max) {
      add(path, `must be text of up to ${max} characters.`);
      return undefined;
    }
    if (UNSAFE_LATEX.test(input))
      add(path, "must not use \\htmlClass, \\htmlId, \\href or similar commands.");
    return input;
  };
  const list = (input: unknown, path: string, max: number): unknown[] => {
    if (input === undefined) return [];
    if (!Array.isArray(input)) {
      add(path, "must be a list.");
      return [];
    }
    if (input.length > max) add(path, `may hold at most ${max} entries.`);
    return input.slice(0, max);
  };
  const color = (input: unknown, path: string) => {
    if (input !== undefined && !(SCRIPT_COLORS as readonly unknown[]).includes(input))
      add(path, `must be one of ${SCRIPT_COLORS.join(", ")}.`);
  };

  known(
    value,
    ["format", "title", "question", "givens", "equations", "graphs", "figures", "tables", "notes", "steps"],
    ""
  );
  if (value.format !== SCRIPT_FORMAT) add("format", `must be ${SCRIPT_FORMAT}.`);
  text(value.title, "title", 200, false);

  // Every element has an id that is unique across the script, so notes can point at it.
  const elementKind = new Map<string, string>();
  const claimId = (id: unknown, path: string, kind: string) => {
    if (!isId(id)) {
      add(path, "must be an id: a letter, then letters, digits, _ or - (at most 40).");
      return false;
    }
    if (elementKind.has(id)) {
      add(path, `id "${id}" is used twice.`);
      return false;
    }
    elementKind.set(id, kind);
    return true;
  };

  // ---- Question ----
  const spans = list(value.question, "question", SCRIPT_LIMITS.spans);
  if (!Array.isArray(value.question) || spans.length === 0)
    add("question", "must be a list of text spans with the question.");
  spans.forEach((span, n) => {
    const path = `question[${n}]`;
    if (!isRecord(span)) return add(path, "must be an object with text.");
    known(span, ["id", "text"], path);
    if (span.id !== undefined) claimId(span.id, `${path}.id`, "span");
    if (typeof span.text !== "string" || !span.text || span.text.length > SCRIPT_LIMITS.text)
      add(`${path}.text`, `must be text of up to ${SCRIPT_LIMITS.text} characters.`);
    else {
      text(span.text, `${path}.text`, SCRIPT_LIMITS.text);
      const dollars = (span.text.replace(/\\\$/g, "").match(/\$/g) ?? []).length;
      if (dollars % 2) add(`${path}.text`, "has an unclosed $ (math must not cross spans).");
    }
  });

  // ---- Givens ----
  const givens = list(value.givens, "givens", SCRIPT_LIMITS.givens);
  const givenIds = new Set<string>();
  givens.forEach((given, n) => {
    const path = `givens[${n}]`;
    if (!isRecord(given)) return add(path, "must be an object.");
    known(given, ["id", "symbol", "value", "unit", "span", "label"], path);
    if (claimId(given.id, `${path}.id`, "given")) givenIds.add(given.id as string);
    text(given.symbol, `${path}.symbol`, 200);
    if (!isNumber(given.value)) text(given.value, `${path}.value`, 200);
    if (
      given.unit !== undefined &&
      !(typeof given.unit === "string" && /^[A-Za-z0-9°%/*^().\-\s]{1,30}$/.test(given.unit))
    )
      add(`${path}.unit`, 'must be a unit such as "m/s", "kg" or "m/s^2".');
    text(given.label, `${path}.label`, 60, false);
  });

  // ---- Equations ----
  const equations = list(value.equations, "equations", SCRIPT_LIMITS.equations);
  const stateTerms = new Map<string, Map<string, Set<string>>>();
  equations.forEach((equation, n) => {
    const path = `equations[${n}]`;
    if (!isRecord(equation)) return add(path, "must be an object with states.");
    known(equation, ["id", "states"], path);
    const ok = claimId(equation.id, `${path}.id`, "equation");
    const states = list(equation.states, `${path}.states`, SCRIPT_LIMITS.states);
    if (!states.length) add(`${path}.states`, "needs at least one state.");
    const terms = new Map<string, Set<string>>();
    states.forEach((state, k) => {
      const at = `${path}.states[${k}]`;
      if (!isRecord(state)) return add(at, "must be an object with id and latex.");
      known(state, ["id", "latex"], at);
      if (!isId(state.id)) add(`${at}.id`, "must be an id.");
      else if (terms.has(state.id)) add(`${at}.id`, `state "${state.id}" is used twice.`);
      const latex = text(state.latex, `${at}.latex`, SCRIPT_LIMITS.latex);
      if (latex !== undefined && isId(state.id)) {
        const parsed = parseTerms(latex);
        for (const problem of parsed.problems) add(`${at}.latex`, problem);
        terms.set(state.id, new Set(parsed.terms.map((term) => term.id)));
      }
    });
    if (ok) stateTerms.set(equation.id as string, terms);
  });

  // ---- Graphs ----
  const graphs = list(value.graphs, "graphs", SCRIPT_LIMITS.graphs);
  const graphItems = new Map<string, Map<string, string>>();
  graphs.forEach((graph, n) => {
    const path = `graphs[${n}]`;
    if (!isRecord(graph)) return add(path, "must be an object.");
    known(graph, ["id", "view", "height", "items"], path);
    const ok = claimId(graph.id, `${path}.id`, "graph");
    const view = graph.view;
    const range = (input: unknown) => isPoint(input) && input[0] < input[1];
    if (!isRecord(view) || !range(view.x) || !range(view.y))
      add(`${path}.view`, "must be { x: [min, max], y: [min, max] } with min below max.");
    else known(view, ["x", "y"], `${path}.view`);
    if (graph.height !== undefined && !(isNumber(graph.height) && graph.height >= 120 && graph.height <= 800))
      add(`${path}.height`, "must be a number of pixels from 120 to 800.");
    const items = new Map<string, string>();
    const entries = list(graph.items, `${path}.items`, SCRIPT_LIMITS.items);
    entries.forEach((item, k) => {
      const at = `${path}.items[${k}]`;
      if (!isRecord(item)) return add(at, "must be an object.");
      if (!(GRAPH_ITEM_TYPES as readonly unknown[]).includes(item.type))
        return add(`${at}.type`, `must be one of ${GRAPH_ITEM_TYPES.join(", ")}.`);
      const type = item.type as string;
      known(item, ["id", "type", "color", "label", ...ITEM_KEYS[type]], at);
      if (!isId(item.id)) add(`${at}.id`, "must be an id.");
      else if (items.has(item.id)) add(`${at}.id`, `item "${item.id}" is used twice.`);
      else items.set(item.id, type);
      color(item.color, `${at}.color`);
      text(item.label, `${at}.label`, 200, false);
    });
    // Second pass: references between items of the same graph.
    entries.forEach((item, k) => {
      if (!isRecord(item)) return;
      const at = `${path}.items[${k}]`;
      const fnRef = (ref: unknown, field: string) => {
        if (typeof ref !== "string" || items.get(ref) !== "function")
          add(`${at}.${field}`, "must be the id of a function item of this graph.");
      };
      switch (item.type) {
        case "function": {
          const problem =
            typeof item.fn === "string" ? expressionProblem(item.fn) : "The function is missing.";
          if (problem) add(`${at}.fn`, problem);
          if (item.domain !== undefined && !(isPoint(item.domain) && item.domain[0] < item.domain[1]))
            add(`${at}.domain`, "must be [from, to] with from below to.");
          break;
        }
        case "point":
          if (item.along !== undefined) {
            fnRef(item.along, "along");
            if (!isNumber(item.from) || !isNumber(item.to))
              add(at, "a point along a function needs numbers from and to.");
          } else if (!isPoint(item.at)) add(`${at}.at`, "must be [x, y].");
          break;
        case "area":
          fnRef(item.of, "of");
          if (!isNumber(item.from) || !isNumber(item.to) || item.from >= item.to)
            add(at, "an area needs numbers from and to, with from below to.");
          break;
        case "vector":
        case "segment":
          if (!isPoint(item.from) || !isPoint(item.to)) add(at, "needs from and to as [x, y].");
          if (item.dashed !== undefined && typeof item.dashed !== "boolean")
            add(`${at}.dashed`, "must be true or false.");
          break;
      }
    });
    if (ok) graphItems.set(graph.id as string, items);
  });

  // ---- Figures ----
  const figures = list(value.figures, "figures", SCRIPT_LIMITS.figures);
  const figureShapes = new Map<string, Map<string, string>>();
  figures.forEach((figure, n) => {
    const path = `figures[${n}]`;
    if (!isRecord(figure)) return add(path, "must be an object.");
    known(figure, ["id", "width", "height", "shapes"], path);
    const ok = claimId(figure.id, `${path}.id`, "figure");
    for (const key of ["width", "height"] as const)
      if (!(isNumber(figure[key]) && figure[key] >= 10 && figure[key] <= 2000))
        add(`${path}.${key}`, "must be a number from 10 to 2000.");
    const shapes = new Map<string, string>();
    const entries = list(figure.shapes, `${path}.shapes`, SCRIPT_LIMITS.shapes);
    entries.forEach((shape, k) => {
      const at = `${path}.shapes[${k}]`;
      if (!isRecord(shape)) return add(at, "must be an object.");
      if (!(SHAPE_TYPES as readonly unknown[]).includes(shape.type))
        return add(`${at}.type`, `must be one of ${SHAPE_TYPES.join(", ")}.`);
      known(shape, ["id", "type", "color", "label", ...SHAPE_KEYS[shape.type as string]], at);
      if (!isId(shape.id)) add(`${at}.id`, "must be an id.");
      else if (shapes.has(shape.id)) add(`${at}.id`, `shape "${shape.id}" is used twice.`);
      else shapes.set(shape.id, shape.type as string);
      color(shape.color, `${at}.color`);
      text(shape.label, `${at}.label`, 200, false);
    });
    entries.forEach((shape, k) => {
      if (!isRecord(shape)) return;
      const at = `${path}.shapes[${k}]`;
      const ref = (input: unknown, field: string) => {
        if (isPoint(input)) return;
        if (typeof input === "string" && shapes.get(input) === "point") return;
        add(`${at}.${field}`, "must be [x, y] or the id of a point shape of this figure.");
      };
      switch (shape.type) {
        case "point":
          if (!isPoint(shape.at)) add(`${at}.at`, "must be [x, y].");
          break;
        case "segment":
        case "arrow":
          ref(shape.from, "from");
          ref(shape.to, "to");
          break;
        case "polygon": {
          const points = Array.isArray(shape.points) ? shape.points : [];
          if (points.length < 2 || points.length > 50)
            add(`${at}.points`, "must be a list of 2 to 50 points.");
          points.forEach((point, p) => ref(point, `points[${p}]`));
          break;
        }
        case "circle":
          ref(shape.center, "center");
          if (!(isNumber(shape.r) && shape.r > 0)) add(`${at}.r`, "must be a number above 0.");
          break;
        case "angle":
          ref(shape.at, "at");
          ref(shape.from, "from");
          ref(shape.to, "to");
          if (shape.r !== undefined && !(isNumber(shape.r) && shape.r > 0))
            add(`${at}.r`, "must be a number above 0.");
          break;
        case "rect":
          if (!isPoint(shape.at)) add(`${at}.at`, "must be [x, y].");
          if (!isPoint(shape.size) || shape.size[0] <= 0 || shape.size[1] <= 0)
            add(`${at}.size`, "must be [width, height] above 0.");
          break;
        case "text":
          if (!isPoint(shape.at)) add(`${at}.at`, "must be [x, y].");
          text(shape.text, `${at}.text`, 300);
          break;
        case "numberLine":
          if (!isPoint(shape.from) || !isPoint(shape.to)) add(at, "needs from and to as [x, y].");
          if (
            !isNumber(shape.min) ||
            !isNumber(shape.max) ||
            !isNumber(shape.step) ||
            shape.min >= shape.max ||
            shape.step <= 0 ||
            (shape.max - shape.min) / shape.step > 100
          )
            add(at, "needs min below max and a step above 0 (at most 100 ticks).");
          break;
      }
      for (const key of ["dashed", "fill", "right"])
        if (shape[key] !== undefined && typeof shape[key] !== "boolean")
          add(`${at}.${key}`, "must be true or false.");
    });
    if (ok) figureShapes.set(figure.id as string, shapes);
  });

  // ---- Tables ----
  const tables = list(value.tables, "tables", SCRIPT_LIMITS.tables);
  const tableRows = new Map<string, number>();
  tables.forEach((table, n) => {
    const path = `tables[${n}]`;
    if (!isRecord(table)) return add(path, "must be an object.");
    known(table, ["id", "header", "rows"], path);
    const ok = claimId(table.id, `${path}.id`, "table");
    const cellList = (input: unknown, at: string) => {
      const cells = list(input, at, SCRIPT_LIMITS.cells);
      cells.forEach((cell, c) => text(cell, `${at}[${c}]`, SCRIPT_LIMITS.cell, false));
      return cells.length;
    };
    if (table.header !== undefined) cellList(table.header, `${path}.header`);
    const rows = list(table.rows, `${path}.rows`, SCRIPT_LIMITS.rows);
    if (!rows.length) add(`${path}.rows`, "needs at least one row.");
    rows.forEach((row, r) => cellList(row, `${path}.rows[${r}]`));
    if (ok) tableRows.set(table.id as string, rows.length);
  });

  // ---- Notes ----
  const notes = list(value.notes, "notes", SCRIPT_LIMITS.notes);
  const noteIds = new Set<string>();
  notes.forEach((note, n) => {
    const path = `notes[${n}]`;
    if (!isRecord(note)) return add(path, "must be an object.");
    known(note, ["id", "text", "target"], path);
    if (claimId(note.id, `${path}.id`, "note")) noteIds.add(note.id as string);
    text(note.text, `${path}.text`, SCRIPT_LIMITS.note);
  });
  // Targets are checked once every element is known.
  notes.forEach((note, n) => {
    if (!isRecord(note) || note.target === undefined) return;
    const path = `notes[${n}].target`;
    const target = note.target;
    if (!isRecord(target) || typeof target.element !== "string")
      return add(path, "must be { element, part? }.");
    known(target, ["element", "part"], path);
    const kind = elementKind.get(target.element);
    if (!kind || kind === "note") return add(`${path}.element`, `no element "${target.element}".`);
    if (target.part === undefined) return;
    if (typeof target.part !== "string") return add(`${path}.part`, "must be text.");
    const part = target.part;
    const found =
      kind === "equation"
        ? [...(stateTerms.get(target.element)?.values() ?? [])].some((ids) => ids.has(part))
        : kind === "graph"
          ? graphItems.get(target.element)?.has(part)
          : kind === "figure"
            ? figureShapes.get(target.element)?.has(part)
            : kind === "table"
              ? /^\d+$/.test(part) && Number(part) < (tableRows.get(target.element) ?? 0)
              : false;
    if (!found) add(`${path}.part`, `"${part}" is not a part of "${target.element}".`);
  });

  // ---- Steps ----
  const steps = list(value.steps, "steps", SCRIPT_LIMITS.steps);
  if (!Array.isArray(value.steps) || !steps.length) add("steps", "needs at least one step.");
  const stepIds = new Set<string>();
  const current = new Map<string, string>(); // equation id to the state shown
  let lastEquation: string | null = null;
  let total = 0;

  const termsOf = (equation: string, state: string) => stateTerms.get(equation)?.get(state);
  const checkLinks = (input: unknown, path: string, from: Set<string> | undefined, to: Set<string> | undefined) => {
    list(input, path, 200).forEach((link, k) => {
      if (!Array.isArray(link) || link.length !== 2 || !link.every((id) => typeof id === "string"))
        return add(`${path}[${k}]`, "must be a pair of term ids [from, to].");
      if (from && !from.has(link[0])) add(`${path}[${k}]`, `no term "${link[0]}" in the state before.`);
      if (to && !to.has(link[1])) add(`${path}[${k}]`, `no term "${link[1]}" in the new state.`);
    });
  };

  steps.forEach((step, n) => {
    const path = `steps[${n}]`;
    if (!isRecord(step)) return add(path, "must be an object with a kind.");
    if (!(STEP_KINDS as readonly unknown[]).includes(step.kind))
      return add(`${path}.kind`, `must be one of ${STEP_KINDS.join(", ")}.`);
    const kind = step.kind as StepKind;
    known(step, [...STEP_BASE_KEYS, ...STEP_KEYS[kind]], path);
    if (step.id !== undefined) {
      if (!isId(step.id)) add(`${path}.id`, "must be an id.");
      else if (stepIds.has(step.id)) add(`${path}.id`, `step id "${step.id}" is used twice.`);
      else stepIds.add(step.id);
    }
    if (
      !isNumber(step.duration) ||
      step.duration < SCRIPT_LIMITS.minDuration ||
      step.duration > SCRIPT_LIMITS.maxDuration
    )
      add(`${path}.duration`, `must be seconds from ${SCRIPT_LIMITS.minDuration} to ${SCRIPT_LIMITS.maxDuration}.`);
    else total += step.duration;
    text(step.narration, `${path}.narration`, SCRIPT_LIMITS.narration, false);
    list(step.hide, `${path}.hide`, 50).forEach((id, k) => {
      if (typeof id !== "string" || !elementKind.has(id)) add(`${path}.hide[${k}]`, "must be an element id.");
    });

    const equationRef = (field = "equation") => {
      const id = step[field];
      if (typeof id !== "string" || !stateTerms.has(id)) {
        add(`${path}.${field}`, "must be the id of an equation.");
        return null;
      }
      return id;
    };
    const givenRef = (id: unknown, at: string) => {
      if (typeof id !== "string" || !givenIds.has(id)) add(at, "must be the id of a given.");
    };

    switch (kind) {
      case "Extract":
        givenRef(step.given, `${path}.given`);
        break;
      case "Relate": {
        const equation = equationRef();
        if (!equation) break;
        const states = stateTerms.get(equation)!;
        const state = step.state ?? [...states.keys()][0];
        if (typeof state !== "string" || !states.has(state)) {
          add(`${path}.state`, `no state "${String(state)}" in equation "${equation}".`);
          break;
        }
        list(step.givens, `${path}.givens`, 40).forEach((id, k) => givenRef(id, `${path}.givens[${k}]`));
        current.set(equation, state);
        lastEquation = equation;
        break;
      }
      case "Transform":
      case "Substitute": {
        const equation = equationRef();
        if (!equation) break;
        const from = current.get(equation);
        if (!from) add(`${path}.equation`, `equation "${equation}" must be shown by a Relate step first.`);
        if (typeof step.to !== "string" || !stateTerms.get(equation)!.has(step.to)) {
          add(`${path}.to`, `no state "${String(step.to)}" in equation "${equation}".`);
          break;
        }
        const fromTerms = from ? termsOf(equation, from) : undefined;
        const toTerms = termsOf(equation, step.to);
        checkLinks(step.links, `${path}.links`, fromTerms, toTerms);
        checkLinks(step.unlinks, `${path}.unlinks`, undefined, undefined);
        if (kind === "Substitute") {
          const pairs = list(step.pairs, `${path}.pairs`, 40);
          if (!pairs.length) add(`${path}.pairs`, "needs at least one { given, term } pair.");
          pairs.forEach((pair, k) => {
            const at = `${path}.pairs[${k}]`;
            if (!isRecord(pair)) return add(at, "must be { given, term }.");
            known(pair, ["given", "term"], at);
            givenRef(pair.given, `${at}.given`);
            if (typeof pair.term !== "string" || !toTerms?.has(pair.term))
              add(`${at}.term`, `no term "${String(pair.term)}" in state "${step.to}".`);
          });
        }
        current.set(equation, step.to);
        lastEquation = equation;
        break;
      }
      case "Plot": {
        const items = typeof step.graph === "string" ? graphItems.get(step.graph) : undefined;
        if (!items) {
          add(`${path}.graph`, "must be the id of a graph.");
          break;
        }
        const ids = list(step.items, `${path}.items`, SCRIPT_LIMITS.items);
        if (!ids.length) add(`${path}.items`, "needs at least one item.");
        ids.forEach((id, k) => {
          if (typeof id !== "string" || !items.has(id))
            add(`${path}.items[${k}]`, `no item "${String(id)}" in graph "${step.graph}".`);
        });
        break;
      }
      case "Construct": {
        if ((step.figure === undefined) === (step.table === undefined)) {
          add(path, "needs a figure with shapes, or a table with rows.");
          break;
        }
        if (step.figure !== undefined) {
          const shapes = typeof step.figure === "string" ? figureShapes.get(step.figure) : undefined;
          if (!shapes) {
            add(`${path}.figure`, "must be the id of a figure.");
            break;
          }
          const ids = list(step.shapes, `${path}.shapes`, SCRIPT_LIMITS.shapes);
          if (!ids.length) add(`${path}.shapes`, "needs at least one shape.");
          ids.forEach((id, k) => {
            if (typeof id !== "string" || !shapes.has(id))
              add(`${path}.shapes[${k}]`, `no shape "${String(id)}" in figure "${step.figure}".`);
          });
          if (step.rows !== undefined) add(`${path}.rows`, "belongs to a table step.");
        } else {
          const count = typeof step.table === "string" ? tableRows.get(step.table) : undefined;
          if (count === undefined) {
            add(`${path}.table`, "must be the id of a table.");
            break;
          }
          const rows = list(step.rows, `${path}.rows`, SCRIPT_LIMITS.rows);
          if (!rows.length) add(`${path}.rows`, "needs at least one row index.");
          rows.forEach((row, k) => {
            if (!(Number.isInteger(row) && (row as number) >= 0 && (row as number) < count))
              add(`${path}.rows[${k}]`, `must be a row index from 0 to ${count - 1}.`);
          });
          if (step.shapes !== undefined) add(`${path}.shapes`, "belongs to a figure step.");
        }
        break;
      }
      case "Annotate": {
        const ids = list(step.notes, `${path}.notes`, SCRIPT_LIMITS.notes);
        if (!ids.length) add(`${path}.notes`, "needs at least one note.");
        ids.forEach((id, k) => {
          if (typeof id !== "string" || !noteIds.has(id)) add(`${path}.notes[${k}]`, "must be the id of a note.");
        });
        break;
      }
      case "Answer": {
        const equation = step.equation === undefined ? lastEquation : equationRef();
        if (step.equation !== undefined && equation && !current.has(equation))
          add(`${path}.equation`, `equation "${equation}" is not shown yet.`);
        if (step.term !== undefined) {
          const state = equation ? current.get(equation) : undefined;
          const ids = equation && state ? termsOf(equation, state) : undefined;
          if (typeof step.term !== "string" || !ids?.has(step.term))
            add(`${path}.term`, `no term "${String(step.term)}" in the equation shown.`);
        }
        text(step.text, `${path}.text`, 500, false);
        if (step.span !== undefined && elementKind.get(step.span as string) !== "span")
          add(`${path}.span`, "must be the id of a question span.");
        break;
      }
    }
  });
  if (total > SCRIPT_LIMITS.totalDuration)
    add("steps", `last ${Math.round(total)} seconds together; the limit is ${SCRIPT_LIMITS.totalDuration}.`);

  if (problems.length) return { script: null, problems };
  const script: SolutionScript = {
    format: SCRIPT_FORMAT,
    question: value.question as SolutionScript["question"],
    givens: (value.givens ?? []) as SolutionScript["givens"],
    equations: (value.equations ?? []) as SolutionScript["equations"],
    graphs: (value.graphs ?? []) as SolutionScript["graphs"],
    figures: (value.figures ?? []) as SolutionScript["figures"],
    tables: (value.tables ?? []) as SolutionScript["tables"],
    notes: (value.notes ?? []) as SolutionScript["notes"],
    steps: value.steps as SolutionScript["steps"],
  };
  if (typeof value.title === "string") script.title = value.title;
  return { script: structuredClone(script), problems: [] };
};

/** True when the value is a valid script. */
export const isSolutionScript = (value: unknown): value is SolutionScript =>
  validateSolutionScript(value).problems.length === 0;
