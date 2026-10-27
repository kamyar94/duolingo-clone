"use client";

import { useCallback, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useMedia } from "react-use";

import { cn } from "@/lib/utils";

/** Desktop and tablet in landscape get the split view; portrait tablets and phones stack. */
export const SPLIT_QUERY = "(min-width: 1024px), (min-width: 768px) and (orientation: landscape)";

export const useSplitLayout = () => useMedia(SPLIT_QUERY, false);

type DividerProps = {
  orientation: "vertical" | "horizontal";
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  label: string;
};

/** A draggable divider; value is the share (0 to 1) of the space before it. */
const Divider = ({ orientation, value, min, max, onChange, label }: DividerProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const vertical = orientation === "vertical";

  const move = (clientX: number, clientY: number) => {
    const container = ref.current?.parentElement?.getBoundingClientRect();
    if (!container) return;
    const share = vertical
      ? (clientX - container.left) / container.width
      : (clientY - container.top) / container.height;
    onChange(Math.min(max, Math.max(min, share)));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.1 : 0.02;
    const less = vertical ? "ArrowLeft" : "ArrowUp";
    const more = vertical ? "ArrowRight" : "ArrowDown";
    if (event.key === less) onChange(Math.max(min, value - step));
    else if (event.key === more) onChange(Math.min(max, value + step));
    else return;
    event.preventDefault();
  };

  return (
    <div
      ref={ref}
      role="separator"
      aria-orientation={vertical ? "vertical" : "horizontal"}
      aria-label={label}
      aria-valuenow={Math.round(value * 100)}
      aria-valuemin={Math.round(min * 100)}
      aria-valuemax={Math.round(max * 100)}
      tabIndex={0}
      data-exercise-keys
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          move(event.clientX, event.clientY);
      }}
      className={cn(
        "group flex shrink-0 touch-none items-center justify-center focus-visible:outline-none",
        vertical ? "w-4 cursor-col-resize" : "h-4 cursor-row-resize"
      )}
    >
      <span
        className={cn(
          "rounded-full bg-slate-200 transition-colors group-hover:bg-sky-300 group-focus-visible:bg-sky-400",
          vertical ? "h-12 w-1" : "h-1 w-12"
        )}
      />
    </div>
  );
};

type BottomSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  children: ReactNode;
  /** Distance from the bottom of the window, to stay above the lesson footer. */
  offset?: string;
};

/** Output on phones and portrait tablets: a sheet from the bottom that leaves the page usable. */
export const BottomSheet = ({
  open,
  onOpenChange,
  title,
  children,
  offset = "0px",
}: BottomSheetProps) => (
  <div
    className={cn(
      "fixed inset-x-0 z-40 flex flex-col rounded-t-2xl border-t-2 border-slate-200 bg-white shadow-[0_-8px_24px_rgba(0,0,0,0.08)] transition-[max-height] duration-300",
      open ? "max-h-[65vh]" : "max-h-12"
    )}
    style={{ bottom: offset }}
    role="region"
    aria-label="Output"
  >
    <button
      type="button"
      className="flex h-12 shrink-0 items-center justify-between px-4 text-sm font-bold text-neutral-700"
      onClick={() => onOpenChange(!open)}
      aria-expanded={open}
    >
      <span className="truncate">{title}</span>
      {open ? <ChevronDown className="h-5 w-5" /> : <ChevronUp className="h-5 w-5" />}
    </button>
    <div className={cn("min-h-0 flex-1 overflow-auto px-4 pb-4", !open && "hidden")}>{children}</div>
  </div>
);

type WorkbenchProps = {
  task: ReactNode;
  toolbar: ReactNode;
  editor: ReactNode;
  output: ReactNode;
  outputTitle: ReactNode;
  outputOpen: boolean;
  onOutputOpenChange: (open: boolean) => void;
  /** Height of the editor on phones (CSS length). */
  phoneEditorHeight?: string;
  /** Space below the output sheet on phones (the lesson footer). */
  sheetOffset?: string;
};

// The coding layout of section 4.2. Split view: task on the left, editor in the middle with the
// output below it, both dividers draggable. Stacked: task, editor, and the output in a sheet.
export const Workbench = ({
  task,
  toolbar,
  editor,
  output,
  outputTitle,
  outputOpen,
  onOutputOpenChange,
  phoneEditorHeight = "min(55vh, 460px)",
  sheetOffset,
}: WorkbenchProps) => {
  const split = useSplitLayout();
  const [taskShare, setTaskShare] = useState(0.32);
  const [editorShare, setEditorShare] = useState(0.62);
  const setTask = useCallback((value: number) => setTaskShare(value), []);
  const setEditor = useCallback((value: number) => setEditorShare(value), []);

  if (split)
    return (
      <div className="flex h-[min(70vh,760px)] min-h-[420px] w-full">
        <aside
          className="min-w-0 overflow-auto pr-2"
          style={{ flexBasis: `${taskShare * 100}%`, flexShrink: 0 }}
        >
          {task}
        </aside>
        <Divider
          orientation="vertical"
          value={taskShare}
          min={0.18}
          max={0.55}
          onChange={setTask}
          label="Resize the task panel"
        />
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="mb-2 flex flex-wrap items-center gap-2">{toolbar}</div>
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0" style={{ flexBasis: `${editorShare * 100}%`, flexShrink: 0 }}>
              {editor}
            </div>
            <Divider
              orientation="horizontal"
              value={editorShare}
              min={0.25}
              max={0.85}
              onChange={setEditor}
              label="Resize the editor and the output"
            />
            <div className="min-h-0 flex-1 rounded-xl border-2 border-slate-200 p-3">{output}</div>
          </div>
        </section>
      </div>
    );

  return (
    <div className="flex w-full flex-col gap-3 pb-16">
      <div>{task}</div>
      <div className="flex flex-wrap items-center gap-2">{toolbar}</div>
      <div style={{ height: phoneEditorHeight }}>{editor}</div>
      <BottomSheet
        open={outputOpen}
        onOpenChange={onOutputOpenChange}
        title={outputTitle}
        offset={sheetOffset}
      >
        {output}
      </BottomSheet>
    </div>
  );
};
