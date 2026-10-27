// The drawing as a list of immutable strokes with undo and redo. Every tool turns into one
// commit, so one undo takes back one pen stroke, one eraser sweep, one lasso move or one
// inserted space.
import { useCallback, useMemo, useReducer } from "react";

import { translateStroke } from "@/lib/math/strokes";
import type { StoredStroke } from "@/lib/math/types";

export const HISTORY_LIMIT = 200;

export type InkDocState = {
  strokes: StoredStroke[];
  past: StoredStroke[][];
  future: StoredStroke[][];
};

export type InkAction =
  | { type: "commit"; strokes: StoredStroke[] }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "load"; strokes: StoredStroke[] };

export const inkReducer = (state: InkDocState, action: InkAction): InkDocState => {
  switch (action.type) {
    case "commit":
      if (action.strokes === state.strokes) return state;
      return {
        strokes: action.strokes,
        past: [...state.past, state.strokes].slice(-HISTORY_LIMIT),
        future: [],
      };
    case "undo": {
      const previous = state.past[state.past.length - 1];
      if (!previous) return state;
      return {
        strokes: previous,
        past: state.past.slice(0, -1),
        future: [state.strokes, ...state.future],
      };
    }
    case "redo": {
      const [next, ...future] = state.future;
      if (!next) return state;
      return { strokes: next, past: [...state.past, state.strokes], future };
    }
    case "load":
      return { strokes: action.strokes, past: [], future: [] };
  }
};

// ---- Edits, as pure functions from strokes to strokes ----

export const addStroke = (strokes: StoredStroke[], stroke: StoredStroke) => [...strokes, stroke];

export const removeStrokes = (strokes: StoredStroke[], ids: Set<string>) =>
  ids.size ? strokes.filter((stroke) => !ids.has(stroke.i)) : strokes;

export const moveStrokes = (strokes: StoredStroke[], ids: Set<string>, dx: number, dy: number) =>
  ids.size && (dx || dy)
    ? strokes.map((stroke) => (ids.has(stroke.i) ? translateStroke(stroke, dx, dy) : stroke))
    : strokes;

let counter = 0;
/** A short id that is unique within one drawing. */
export const newStrokeId = () =>
  `${Date.now().toString(36)}${(counter++ % 1296).toString(36).padStart(2, "0")}`;

export const useInkDocument = (initial: StoredStroke[] = []) => {
  const [state, dispatch] = useReducer(inkReducer, {
    strokes: initial,
    past: [],
    future: [],
  });
  const commit = useCallback(
    (strokes: StoredStroke[]) => dispatch({ type: "commit", strokes }),
    []
  );
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const redo = useCallback(() => dispatch({ type: "redo" }), []);
  const load = useCallback(
    (strokes: StoredStroke[]) => dispatch({ type: "load", strokes }),
    []
  );
  return useMemo(
    () => ({
      strokes: state.strokes,
      canUndo: state.past.length > 0,
      canRedo: state.future.length > 0,
      commit,
      undo,
      redo,
      load,
    }),
    [state, commit, undo, redo, load]
  );
};

export type InkDocument = ReturnType<typeof useInkDocument>;
