// The animated solution script (docs/DESIGN-coding-and-math.md, section 5.5): a JSON document
// that lists the elements of a scene (question spans, givens, equations, graphs, figures,
// tables and notes) and the steps that change them. The player in components/math/solution
// draws every frame from the script and the timeline position.
//
// Plain types and constants only: the course import script (bundled with esbuild), the server
// and client components all read this file.

/** The format of a script. A later format adds a number here and a converter in validate.ts. */
export const SCRIPT_FORMAT = 1;

export const STEP_KINDS = [
  "Extract",
  "Relate",
  "Substitute",
  "Transform",
  "Plot",
  "Construct",
  "Annotate",
  "Answer",
] as const;
export type StepKind = (typeof STEP_KINDS)[number];

/** Colours a script may use; the player maps them to its own palette. */
export const SCRIPT_COLORS = ["blue", "red", "green", "orange", "purple", "gray"] as const;
export type ScriptColor = (typeof SCRIPT_COLORS)[number];

export type Point2 = [number, number];

/** A piece of the question text. Spans with an id can light up and be lifted into a given. */
export type QuestionSpan = {
  id?: string;
  /** Text with math between dollar signs, as in course files. */
  text: string;
};

/** A named quantity taken from the question, such as the speed v = 12 m/s. */
export type Given = {
  id: string;
  /** LaTeX of the symbol, for example "v" or "v_0". */
  symbol: string;
  /** A number, or LaTeX such as "\\frac{1}{2}". */
  value: number | string;
  /** Plain unit text such as "m/s", "kg" or "m/s^2". */
  unit?: string;
  /** The id of the question span the given comes from. */
  span?: string;
  /** A word or two shown on the card, for example "speed". */
  label?: string;
};

/**
 * One form of an equation. Terms are tagged as \term{id}{...}, so the same term can be
 * followed from one state to the next. The player turns \term into KaTeX's \htmlClass.
 */
export type EquationState = { id: string; latex: string };

export type Equation = { id: string; states: EquationState[] };

export const GRAPH_ITEM_TYPES = ["function", "point", "area", "vector", "segment"] as const;
export type GraphItemType = (typeof GRAPH_ITEM_TYPES)[number];

type GraphItemBase = { id: string; color?: ScriptColor; label?: string };

export type GraphItem =
  | (GraphItemBase & {
      type: "function";
      /** y as a function of x, such as "0.5*x^2" or "sin(x)" (see expr.ts). */
      fn: string;
      /** Where the curve is drawn; default the whole view. */
      domain?: [number, number];
    })
  | (GraphItemBase & {
      type: "point";
      /** A fixed point. */
      at?: Point2;
      /** A point that moves along this function item from x = from to x = to. */
      along?: string;
      from?: number;
      to?: number;
    })
  | (GraphItemBase & {
      type: "area";
      /** The function item whose area down to the x axis fills. */
      of: string;
      from: number;
      to: number;
    })
  | (GraphItemBase & { type: "vector"; from: Point2; to: Point2 })
  | (GraphItemBase & { type: "segment"; from: Point2; to: Point2; dashed?: boolean });

export type Graph = {
  id: string;
  view: { x: [number, number]; y: [number, number] };
  /** Height in CSS pixels, default 260. */
  height?: number;
  items: GraphItem[];
};

export const SHAPE_TYPES = [
  "point",
  "segment",
  "arrow",
  "polygon",
  "circle",
  "angle",
  "rect",
  "text",
  "numberLine",
] as const;
export type ShapeType = (typeof SHAPE_TYPES)[number];

/** A point of a figure: the id of a point shape, or coordinates in the figure's units. */
export type ShapeRef = string | Point2;

type ShapeBase = { id: string; color?: ScriptColor; label?: string };

/** Geometry and diagram primitives, drawn as SVG with y pointing down. */
export type Shape =
  | (ShapeBase & { type: "point"; at: Point2 })
  | (ShapeBase & { type: "segment"; from: ShapeRef; to: ShapeRef; dashed?: boolean })
  | (ShapeBase & { type: "arrow"; from: ShapeRef; to: ShapeRef })
  | (ShapeBase & { type: "polygon"; points: ShapeRef[]; fill?: boolean })
  | (ShapeBase & { type: "circle"; center: ShapeRef; r: number })
  | (ShapeBase & {
      type: "angle";
      at: ShapeRef;
      from: ShapeRef;
      to: ShapeRef;
      r?: number;
      /** Draw the square mark of a right angle. */
      right?: boolean;
    })
  | (ShapeBase & { type: "rect"; at: Point2; size: Point2 })
  | (ShapeBase & { type: "text"; at: Point2; text: string })
  | (ShapeBase & {
      type: "numberLine";
      from: Point2;
      to: Point2;
      min: number;
      max: number;
      step: number;
    });

export type Figure = {
  id: string;
  /** The figure's coordinate box (the SVG viewBox is 0 0 width height). */
  width: number;
  height: number;
  shapes: Shape[];
};

export type Table = { id: string; header?: string[]; rows: string[][] };

/** What a note points at: an element id, and a term, item, shape or row of it. */
export type NoteTarget = { element: string; part?: string };

export type Note = { id: string; text: string; target?: NoteTarget };

/** Pairs of term ids [from, to] linked or unlinked by hand between two states. */
export type TermLink = [string, string];

type StepBase = {
  id?: string;
  /** Seconds, including the motion at the start of the step. */
  duration: number;
  /** Text read out or shown as a subtitle while the step plays. */
  narration?: string;
  /** Elements that fade out during this step. */
  hide?: string[];
};

export type ExtractStep = StepBase & { kind: "Extract"; given: string };
export type RelateStep = StepBase & {
  kind: "Relate";
  equation: string;
  /** The state shown; default the first. */
  state?: string;
  /** Givens whose symbols fly into the term with the same id. */
  givens?: string[];
};
export type TransformStep = StepBase & {
  kind: "Transform";
  equation: string;
  to: string;
  links?: TermLink[];
  /** Automatic pairs [from, to] that should not be followed. */
  unlinks?: TermLink[];
};
export type SubstituteStep = StepBase & {
  kind: "Substitute";
  equation: string;
  to: string;
  /** Each given's value flies into the named term of the new state. */
  pairs: { given: string; term: string }[];
  links?: TermLink[];
  unlinks?: TermLink[];
};
export type PlotStep = StepBase & { kind: "Plot"; graph: string; items: string[] };
export type ConstructStep = StepBase & {
  kind: "Construct";
  /** A figure gains shapes... */
  figure?: string;
  shapes?: string[];
  /** ...or a table gains rows (indexes from 0). */
  table?: string;
  rows?: number[];
};
export type AnnotateStep = StepBase & { kind: "Annotate"; notes: string[] };
export type AnswerStep = StepBase & {
  kind: "Answer";
  /** The equation whose current state holds the result; default the last one shown. */
  equation?: string;
  /** The term that is boxed; default the whole equation. */
  term?: string;
  /** A sentence that checks the result against the question. */
  text?: string;
  /** The question span that asks for the result. */
  span?: string;
};

export type Step =
  | ExtractStep
  | RelateStep
  | TransformStep
  | SubstituteStep
  | PlotStep
  | ConstructStep
  | AnnotateStep
  | AnswerStep;

export type SolutionScript = {
  format: typeof SCRIPT_FORMAT;
  title?: string;
  question: QuestionSpan[];
  givens: Given[];
  equations: Equation[];
  graphs: Graph[];
  figures: Figure[];
  tables: Table[];
  notes: Note[];
  steps: Step[];
};

/** A stored version of a problem's solution, as the routes return it. */
export type SolutionVersion = {
  version: number;
  script: SolutionScript;
  createdAt: string;
  author: string | null;
};

export type SolutionVersionInfo = Omit<SolutionVersion, "script">;
