"use client";

// Graphs, figures, tables and notes in author mode. The palette adds graph items (Mafs) and
// geometry or diagram shapes (SVG) together with the step that draws them; a click on the
// preview places the selected item or shape. Tables and notes are edited as text.
import { useState, type ReactNode } from "react";

import { Plus, Trash2 } from "lucide-react";

import { elementIds, uniqueId } from "@/lib/math/solution/authoring";
import { termIds } from "@/lib/math/solution/terms";
import type {
  Figure,
  Graph,
  GraphItem,
  Point2,
  Shape,
  ShapeRef,
  SolutionScript,
} from "@/lib/math/solution/types";
import { SCRIPT_COLORS } from "@/lib/math/solution/types";
import { cn } from "@/lib/utils";

import { FigureView } from "../solution/figure-view";
import { GraphView } from "../solution/graph-view";

import { Field, NumberInput, Panel, PointInput, Select, SmallButton, TextInput, type Edit } from "./fields";

type Picked = { element: string; part: string } | null;

const round = (value: number) => Math.round(value * 100) / 100;
const full = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, 1]));

const GRAPH_PALETTE: { label: string; make: (graph: Graph, id: string) => GraphItem | null }[] = [
  { label: "Function", make: (_g, id) => ({ id, type: "function", fn: "x", color: "blue" }) },
  { label: "Point", make: (g, id) => ({ id, type: "point", at: [round((g.view.x[0] + g.view.x[1]) / 2), round((g.view.y[0] + g.view.y[1]) / 2)], color: "orange" }) },
  {
    label: "Moving point",
    make: (g, id) => {
      const fn = g.items.find((item) => item.type === "function");
      return fn ? { id, type: "point", along: fn.id, from: round(g.view.x[0]), to: round(g.view.x[1]), color: "orange" } : null;
    },
  },
  {
    label: "Area",
    make: (g, id) => {
      const fn = g.items.find((item) => item.type === "function");
      return fn ? { id, type: "area", of: fn.id, from: Math.max(0, round(g.view.x[0])), to: round(g.view.x[1] / 2), color: "green" } : null;
    },
  },
  { label: "Vector", make: (_g, id) => ({ id, type: "vector", from: [0, 0], to: [1, 1], color: "purple" }) },
  { label: "Segment", make: (_g, id) => ({ id, type: "segment", from: [0, 0], to: [1, 1], color: "gray", dashed: true }) },
];

const SHAPE_PALETTE: { label: string; group: "Geometry" | "Diagram"; make: (f: Figure, id: string) => Shape }[] = [
  { label: "Point", group: "Geometry", make: (f, id) => ({ id, type: "point", at: [f.width / 2, f.height / 2], label: id }) },
  { label: "Segment", group: "Geometry", make: (f, id) => ({ id, type: "segment", from: [f.width * 0.2, f.height * 0.8], to: [f.width * 0.8, f.height * 0.8] }) },
  { label: "Polygon", group: "Geometry", make: (f, id) => ({ id, type: "polygon", points: [[f.width * 0.2, f.height * 0.8], [f.width * 0.8, f.height * 0.8], [f.width * 0.5, f.height * 0.2]] }) },
  { label: "Circle", group: "Geometry", make: (f, id) => ({ id, type: "circle", center: [f.width / 2, f.height / 2], r: Math.round(Math.min(f.width, f.height) / 4) }) },
  { label: "Angle", group: "Geometry", make: (f, id) => ({ id, type: "angle", at: [f.width * 0.2, f.height * 0.8], from: [f.width * 0.8, f.height * 0.8], to: [f.width * 0.5, f.height * 0.2] }) },
  { label: "Right angle", group: "Geometry", make: (f, id) => ({ id, type: "angle", at: [f.width * 0.8, f.height * 0.8], from: [f.width * 0.2, f.height * 0.8], to: [f.width * 0.8, f.height * 0.2], right: true }) },
  { label: "Label", group: "Geometry", make: (f, id) => ({ id, type: "text", at: [f.width / 2, f.height / 2], text: "label" }) },
  { label: "Arrow", group: "Diagram", make: (f, id) => ({ id, type: "arrow", from: [f.width * 0.3, f.height / 2], to: [f.width * 0.7, f.height / 2], color: "red", label: "F" }) },
  { label: "Box", group: "Diagram", make: (f, id) => ({ id, type: "rect", at: [f.width * 0.35, f.height * 0.35], size: [f.width * 0.3, f.height * 0.3], color: "gray", label: "m" }) },
  { label: "Number line", group: "Diagram", make: (f, id) => ({ id, type: "numberLine", from: [f.width * 0.05, f.height / 2], to: [f.width * 0.95, f.height / 2], min: 0, max: 10, step: 1 }) },
];

const colorOptions = SCRIPT_COLORS.map((color) => ({ value: color }));

/** A figure point: the id of a point shape, or coordinates. */
const RefInput = ({ figure, value, onChange }: { figure: Figure; value: ShapeRef; onChange: (value: ShapeRef) => void }) => {
  const points = figure.shapes.filter((shape) => shape.type === "point").map((shape) => ({ value: shape.id }));
  return (
    <div className="flex gap-1">
      <Select
        value={typeof value === "string" ? value : ""}
        options={points}
        empty="(x, y)"
        onChange={(id) => onChange(id || [0, 0])}
        className="w-24 shrink-0"
      />
      {Array.isArray(value) && <PointInput value={value} onChange={onChange} />}
    </div>
  );
};

/** Text form of a list of figure points: "A, B, 10 20". */
const refsToText = (refs: ShapeRef[]) => refs.map((ref) => (Array.isArray(ref) ? ref.join(" ") : ref)).join(", ");
const textToRefs = (text: string): ShapeRef[] =>
  text
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => {
      const numbers = token.split(/\s+/).map(Number);
      return numbers.length === 2 && numbers.every(Number.isFinite) ? ([numbers[0], numbers[1]] as Point2) : token;
    });

const ItemFields = ({ graph, item, change }: { graph: Graph; item: GraphItem; change: (patch: Partial<GraphItem>) => void }) => {
  const functions = graph.items.filter((other) => other.type === "function").map((other) => ({ value: other.id }));
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {item.type === "function" && (
        <>
          <Field label="y =" className="col-span-2">
            <TextInput mono value={item.fn} onChange={(fn) => change({ fn } as Partial<GraphItem>)} />
          </Field>
          <Field label="Drawn from x">
            <NumberInput value={item.domain?.[0]} onChange={(x) => change({ domain: [x, item.domain?.[1] ?? graph.view.x[1]] } as Partial<GraphItem>)} />
          </Field>
          <Field label="to x">
            <NumberInput value={item.domain?.[1]} onChange={(x) => change({ domain: [item.domain?.[0] ?? graph.view.x[0], x] } as Partial<GraphItem>)} />
          </Field>
        </>
      )}
      {item.type === "point" && !item.along && (
        <Field label="At (x, y)" className="col-span-2">
          <PointInput value={item.at} onChange={(at) => change({ at } as Partial<GraphItem>)} />
        </Field>
      )}
      {item.type === "point" && item.along && (
        <>
          <Field label="Along">
            <Select value={item.along} options={functions} onChange={(along) => change({ along } as Partial<GraphItem>)} />
          </Field>
          <Field label="From x">
            <NumberInput value={item.from} onChange={(from) => change({ from } as Partial<GraphItem>)} />
          </Field>
          <Field label="To x">
            <NumberInput value={item.to} onChange={(to) => change({ to } as Partial<GraphItem>)} />
          </Field>
        </>
      )}
      {item.type === "area" && (
        <>
          <Field label="Under">
            <Select value={item.of} options={functions} onChange={(of) => change({ of } as Partial<GraphItem>)} />
          </Field>
          <Field label="From x">
            <NumberInput value={item.from} onChange={(from) => change({ from } as Partial<GraphItem>)} />
          </Field>
          <Field label="To x">
            <NumberInput value={item.to} onChange={(to) => change({ to } as Partial<GraphItem>)} />
          </Field>
        </>
      )}
      {(item.type === "vector" || item.type === "segment") && (
        <>
          <Field label="From (x, y)">
            <PointInput value={item.from} onChange={(from) => change({ from } as Partial<GraphItem>)} />
          </Field>
          <Field label="To (x, y)">
            <PointInput value={item.to} onChange={(to) => change({ to } as Partial<GraphItem>)} />
          </Field>
        </>
      )}
      <Field label="Colour">
        <Select value={item.color} options={colorOptions} empty="default" onChange={(color) => change({ color: color || undefined } as Partial<GraphItem>)} />
      </Field>
      <Field label="Label">
        <TextInput value={item.label ?? ""} onChange={(label) => change({ label: label || undefined } as Partial<GraphItem>)} />
      </Field>
    </div>
  );
};

const ShapeFields = ({ figure, shape, change }: { figure: Figure; shape: Shape; change: (patch: Partial<Shape>) => void }) => {
  const patch = (value: Record<string, unknown>) => change(value as Partial<Shape>);
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {(shape.type === "point" || shape.type === "text" || shape.type === "rect") && (
        <Field label="At (x, y)">
          <PointInput value={shape.at} onChange={(at) => patch({ at })} />
        </Field>
      )}
      {shape.type === "rect" && (
        <Field label="Size (w, h)">
          <PointInput value={shape.size} onChange={(size) => patch({ size })} />
        </Field>
      )}
      {shape.type === "text" && (
        <Field label="Text">
          <TextInput value={shape.text} onChange={(text) => patch({ text })} />
        </Field>
      )}
      {(shape.type === "segment" || shape.type === "arrow" || shape.type === "angle") && (
        <>
          {shape.type === "angle" && (
            <Field label="Vertex">
              <RefInput figure={figure} value={shape.at} onChange={(at) => patch({ at })} />
            </Field>
          )}
          <Field label="From">
            <RefInput figure={figure} value={shape.from} onChange={(from) => patch({ from })} />
          </Field>
          <Field label="To">
            <RefInput figure={figure} value={shape.to} onChange={(to) => patch({ to })} />
          </Field>
        </>
      )}
      {shape.type === "polygon" && (
        <Field label="Points (ids or x y, by commas)" className="col-span-2">
          <TextInput mono value={refsToText(shape.points)} onChange={(text) => patch({ points: textToRefs(text) })} />
        </Field>
      )}
      {shape.type === "circle" && (
        <>
          <Field label="Centre">
            <RefInput figure={figure} value={shape.center} onChange={(center) => patch({ center })} />
          </Field>
          <Field label="Radius">
            <NumberInput value={shape.r} onChange={(r) => patch({ r })} />
          </Field>
        </>
      )}
      {shape.type === "numberLine" && (
        <>
          <Field label="From (x, y)">
            <PointInput value={shape.from} onChange={(from) => patch({ from })} />
          </Field>
          <Field label="To (x, y)">
            <PointInput value={shape.to} onChange={(to) => patch({ to })} />
          </Field>
          <Field label="Min, max, step">
            <div className="flex gap-1">
              <NumberInput value={shape.min} onChange={(min) => patch({ min })} />
              <NumberInput value={shape.max} onChange={(max) => patch({ max })} />
              <NumberInput value={shape.step} onChange={(step) => patch({ step })} />
            </div>
          </Field>
        </>
      )}
      {(shape.type === "angle" || shape.type === "polygon" || shape.type === "segment") && (
        <label className="flex items-center gap-1 self-end text-xs text-neutral-700">
          <input
            type="checkbox"
            checked={shape.type === "angle" ? !!shape.right : shape.type === "polygon" ? !!shape.fill : !!shape.dashed}
            onChange={(event) =>
              patch({ [shape.type === "angle" ? "right" : shape.type === "polygon" ? "fill" : "dashed"]: event.target.checked || undefined })
            }
          />
          {shape.type === "angle" ? "Right angle" : shape.type === "polygon" ? "Filled" : "Dashed"}
        </label>
      )}
      <Field label="Colour">
        <Select value={shape.color} options={colorOptions} empty="default" onChange={(color) => patch({ color: color || undefined })} />
      </Field>
      {shape.type !== "text" && (
        <Field label="Label">
          <TextInput value={shape.label ?? ""} onChange={(label) => patch({ label: label || undefined })} />
        </Field>
      )}
    </div>
  );
};

/** Removes keys set to undefined, so the script stays clean JSON. */
const assignClean = (target: Record<string, unknown>, patch: Record<string, unknown>) => {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete target[key];
    else target[key] = value;
  }
};

export const VisualsEditor = ({ script, edit }: { script: SolutionScript; edit: Edit }) => {
  const [picked, setPicked] = useState<Picked>(null);
  const [end, setEnd] = useState<0 | 1>(0);

  const addGraph = () =>
    edit((draft) => {
      draft.graphs.push({ id: uniqueId("graph", elementIds(draft)), view: { x: [-1, 5], y: [-1, 5] }, items: [] });
    });
  const addFigure = () =>
    edit((draft) => {
      draft.figures.push({ id: uniqueId("figure", elementIds(draft)), width: 320, height: 240, shapes: [] });
    });

  const addItem = (g: number, make: (graph: Graph, id: string) => GraphItem | null) => {
    const graph = script.graphs[g];
    const id = uniqueId("item", new Set(graph.items.map((item) => item.id)));
    const item = make(graph, id);
    if (!item) return;
    edit((draft) => {
      draft.graphs[g].items.push(item);
      draft.steps.push({ kind: "Plot", graph: graph.id, items: [id], duration: 3 });
    });
    setPicked({ element: graph.id, part: id });
    setEnd(0);
  };

  const addShape = (f: number, make: (figure: Figure, id: string) => Shape) => {
    const figure = script.figures[f];
    const id = uniqueId("shape", new Set(figure.shapes.map((shape) => shape.id)));
    const shape = make(figure, id);
    edit((draft) => {
      draft.figures[f].shapes.push(shape);
      draft.steps.push({ kind: "Construct", figure: figure.id, shapes: [id], duration: 2.5 });
    });
    setPicked({ element: figure.id, part: id });
    setEnd(0);
  };

  // A click on a preview places the selected item or shape.
  const placeInGraph = (g: number, point: Point2) => {
    const graph = script.graphs[g];
    if (!picked || picked.element !== graph.id) return;
    const p: Point2 = [round(point[0]), round(point[1])];
    edit((draft) => {
      const item = draft.graphs[g].items.find((i) => i.id === picked.part) as Record<string, unknown> | undefined;
      if (!item) return;
      if (item.type === "point" && !item.along) item.at = p;
      else if (item.type === "point") item.to = p[0];
      else if (item.type === "area") item[end ? "to" : "from"] = p[0];
      else if (item.type === "vector" || item.type === "segment") item[end ? "to" : "from"] = p;
    });
    setEnd(end ? 0 : 1);
  };

  const placeInFigure = (f: number, point: Point2) => {
    const figure = script.figures[f];
    if (!picked || picked.element !== figure.id) return;
    edit((draft) => {
      const shape = draft.figures[f].shapes.find((s) => s.id === picked.part) as Record<string, unknown> | undefined;
      if (!shape) return;
      switch (shape.type) {
        case "point":
        case "text":
        case "rect":
        case "angle":
          shape.at = point;
          break;
        case "circle":
          shape.center = point;
          break;
        case "polygon":
          shape.points = [...((shape.points as ShapeRef[]) ?? []), point];
          break;
        default:
          shape[end ? "to" : "from"] = point;
      }
    });
    setEnd(end ? 0 : 1);
  };

  const partRow = (element: string, part: string, label: string, onDelete: () => void, fields: ReactNode) => {
    const active = picked?.element === element && picked.part === part;
    return (
      <div key={part} className={cn("rounded-lg border-2 p-2", active ? "border-sky-300 bg-sky-50/50" : "border-slate-100")}>
        <div className="mb-1 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              setPicked(active ? null : { element, part });
              setEnd(0);
            }}
            className="text-left text-xs font-bold text-neutral-700"
          >
            {label} <span className="font-mono font-normal text-neutral-500">{part}</span>
            <span className="ml-2 font-normal text-sky-600">{active ? "click the preview to place it" : "select to place"}</span>
          </button>
          <button type="button" aria-label={`Delete ${part}`} className="text-rose-500" onClick={onDelete}>
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
        {fields}
      </div>
    );
  };

  const elementOptions = [...elementIds(script)].filter((id) => !script.notes.some((note) => note.id === id)).map((id) => ({ value: id }));
  const partOptions = (element: string) => {
    const equation = script.equations.find((e) => e.id === element);
    if (equation) return [...new Set(equation.states.flatMap((state) => termIds(state.latex)))].map((id) => ({ value: id }));
    const graph = script.graphs.find((g) => g.id === element);
    if (graph) return graph.items.map((item) => ({ value: item.id }));
    const figure = script.figures.find((f) => f.id === element);
    if (figure) return figure.shapes.map((shape) => ({ value: shape.id }));
    const table = script.tables.find((t) => t.id === element);
    if (table) return table.rows.map((_, r) => ({ value: String(r), label: `row ${r + 1}` }));
    return [];
  };

  return (
    <div className="space-y-3">
      {script.graphs.map((graph, g) => (
        <Panel
          key={graph.id}
          title={`Graph ${graph.id}`}
          actions={
            <SmallButton
              tone="danger"
              onClick={() =>
                edit((draft) => {
                  draft.graphs.splice(g, 1);
                  draft.steps = draft.steps.filter((step) => !(step.kind === "Plot" && step.graph === graph.id));
                })
              }
            >
              <Trash2 className="h-3 w-3" /> Graph
            </SmallButton>
          }
        >
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Field label="x from, to">
              <PointInput value={graph.view.x} onChange={(x) => edit((draft) => void (draft.graphs[g].view.x = x))} />
            </Field>
            <Field label="y from, to">
              <PointInput value={graph.view.y} onChange={(y) => edit((draft) => void (draft.graphs[g].view.y = y))} />
            </Field>
            <Field label="Height">
              <NumberInput value={graph.height ?? 260} onChange={(height) => edit((draft) => void (draft.graphs[g].height = height))} />
            </Field>
          </div>
          <div className="flex flex-wrap gap-1">
            {GRAPH_PALETTE.map((entry) => (
              <SmallButton key={entry.label} onClick={() => addItem(g, entry.make)}>
                <Plus className="h-3 w-3" /> {entry.label}
              </SmallButton>
            ))}
          </div>
          <div className="rounded-lg border border-slate-100">
            <GraphView graph={graph} parts={full(graph.items.map((item) => item.id))} onPick={(point) => placeInGraph(g, point)} />
          </div>
          {graph.items.map((item, k) =>
            partRow(
              graph.id,
              item.id,
              item.type,
              () =>
                edit((draft) => {
                  draft.graphs[g].items.splice(k, 1);
                  for (const step of draft.steps) if (step.kind === "Plot" && step.graph === graph.id) step.items = step.items.filter((id) => id !== item.id);
                  draft.steps = draft.steps.filter((step) => !(step.kind === "Plot" && step.items.length === 0));
                }),
              <ItemFields graph={graph} item={item} change={(patch) => edit((draft) => assignClean(draft.graphs[g].items[k] as Record<string, unknown>, patch as Record<string, unknown>))} />
            )
          )}
        </Panel>
      ))}

      {script.figures.map((figure, f) => (
        <Panel
          key={figure.id}
          title={`Figure ${figure.id}`}
          actions={
            <SmallButton
              tone="danger"
              onClick={() =>
                edit((draft) => {
                  draft.figures.splice(f, 1);
                  draft.steps = draft.steps.filter((step) => !(step.kind === "Construct" && step.figure === figure.id));
                })
              }
            >
              <Trash2 className="h-3 w-3" /> Figure
            </SmallButton>
          }
        >
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Field label="Width, height">
              <PointInput value={[figure.width, figure.height]} onChange={([width, height]) => edit((draft) => Object.assign(draft.figures[f], { width, height }))} />
            </Field>
          </div>
          {(["Geometry", "Diagram"] as const).map((group) => (
            <div key={group} className="flex flex-wrap items-center gap-1">
              <span className="w-16 text-xs font-bold text-neutral-500">{group}</span>
              {SHAPE_PALETTE.filter((entry) => entry.group === group).map((entry) => (
                <SmallButton key={entry.label} onClick={() => addShape(f, entry.make)}>
                  <Plus className="h-3 w-3" /> {entry.label}
                </SmallButton>
              ))}
            </div>
          ))}
          <div className="rounded-lg border border-slate-100 p-1">
            <FigureView figure={figure} parts={full(figure.shapes.map((shape) => shape.id))} onPick={(point) => placeInFigure(f, point)} />
          </div>
          {figure.shapes.map((shape, k) =>
            partRow(
              figure.id,
              shape.id,
              shape.type,
              () =>
                edit((draft) => {
                  draft.figures[f].shapes.splice(k, 1);
                  for (const step of draft.steps)
                    if (step.kind === "Construct" && step.figure === figure.id && step.shapes) step.shapes = step.shapes.filter((id) => id !== shape.id);
                  draft.steps = draft.steps.filter((step) => !(step.kind === "Construct" && step.figure === figure.id && !step.shapes?.length));
                }),
              <ShapeFields figure={figure} shape={shape} change={(patch) => edit((draft) => assignClean(draft.figures[f].shapes[k] as Record<string, unknown>, patch as Record<string, unknown>))} />
            )
          )}
        </Panel>
      ))}

      {script.tables.map((table, t) => (
        <Panel
          key={table.id}
          title={`Table ${table.id}`}
          actions={
            <SmallButton
              tone="danger"
              onClick={() =>
                edit((draft) => {
                  draft.tables.splice(t, 1);
                  draft.steps = draft.steps.filter((step) => !(step.kind === "Construct" && step.table === table.id));
                })
              }
            >
              <Trash2 className="h-3 w-3" /> Table
            </SmallButton>
          }
        >
          <Field label="Header (cells separated by |)">
            <TextInput
              value={(table.header ?? []).join(" | ")}
              onChange={(text) =>
                edit((draft) => {
                  const cells = text.split("|").map((cell) => cell.trim());
                  if (text.trim()) draft.tables[t].header = cells;
                  else delete draft.tables[t].header;
                })
              }
            />
          </Field>
          <Field label="Rows (one per line, cells separated by |)">
            <textarea
              value={table.rows.map((row) => row.join(" | ")).join("\n")}
              rows={Math.max(3, table.rows.length + 1)}
              onChange={(event) =>
                edit((draft) => {
                  draft.tables[t].rows = event.target.value.split("\n").map((line) => line.split("|").map((cell) => cell.trim()));
                })
              }
              className="w-full rounded-lg border-2 border-slate-200 px-2 py-1 font-mono text-xs"
            />
          </Field>
        </Panel>
      ))}

      {script.notes.length > 0 && (
        <Panel title="Notes">
          {script.notes.map((note, n) => (
            <div key={note.id} className="grid grid-cols-1 gap-2 border-t border-slate-100 pt-2 sm:grid-cols-[1fr_8rem_8rem_auto]">
              <Field label={`Note ${note.id}`}>
                <TextInput value={note.text} onChange={(text) => edit((draft) => void (draft.notes[n].text = text))} />
              </Field>
              <Field label="Points at">
                <Select
                  value={note.target?.element}
                  options={elementOptions}
                  empty="nothing"
                  onChange={(element) =>
                    edit((draft) => {
                      if (element) draft.notes[n].target = { element };
                      else delete draft.notes[n].target;
                    })
                  }
                />
              </Field>
              <Field label="Part">
                <Select
                  value={note.target?.part}
                  options={note.target ? partOptions(note.target.element) : []}
                  empty="the whole"
                  onChange={(part) =>
                    edit((draft) => {
                      const target = draft.notes[n].target;
                      if (!target) return;
                      if (part) target.part = part;
                      else delete target.part;
                    })
                  }
                />
              </Field>
              <button
                type="button"
                aria-label={`Delete note ${note.id}`}
                className="self-end pb-2 text-rose-500"
                onClick={() =>
                  edit((draft) => {
                    draft.notes.splice(n, 1);
                    for (const step of draft.steps) if (step.kind === "Annotate") step.notes = step.notes.filter((id) => id !== note.id);
                    draft.steps = draft.steps.filter((step) => !(step.kind === "Annotate" && step.notes.length === 0));
                  })
                }
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </Panel>
      )}

      <div className="flex flex-wrap gap-1">
        <SmallButton tone="primary" onClick={addGraph}>
          <Plus className="h-3 w-3" /> Graph
        </SmallButton>
        <SmallButton tone="primary" onClick={addFigure}>
          <Plus className="h-3 w-3" /> Figure or diagram
        </SmallButton>
        <SmallButton
          tone="primary"
          onClick={() =>
            edit((draft) => {
              const id = uniqueId("table", elementIds(draft));
              draft.tables.push({ id, header: ["x", "y"], rows: [["0", "0"], ["1", "1"]] });
              draft.steps.push({ kind: "Construct", table: id, rows: [0, 1], duration: 2.5 });
            })
          }
        >
          <Plus className="h-3 w-3" /> Table
        </SmallButton>
        <SmallButton
          tone="primary"
          onClick={() =>
            edit((draft) => {
              const id = uniqueId("note", elementIds(draft));
              draft.notes.push({ id, text: "A short note." });
              draft.steps.push({ kind: "Annotate", notes: [id], duration: 2.5 });
            })
          }
        >
          <Plus className="h-3 w-3" /> Note
        </SmallButton>
      </div>
    </div>
  );
};
