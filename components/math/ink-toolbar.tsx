"use client";

// Tools of the ink canvas. On a phone the bar sits under the canvas within thumb reach; on a
// tablet and a desktop above it, where every tool also has a keyboard shortcut (see
// useInkShortcuts in math-exercise.tsx).
import type { ComponentType } from "react";

import {
  BetweenHorizontalStart,
  Eraser,
  Hand,
  Highlighter,
  LassoSelect,
  Pen,
  Redo2,
  Scan,
  Trash2,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import { cn } from "@/lib/utils";

import type { InkTool, TouchMode } from "./ink-canvas";

export const INK_COLORS = [
  { value: "#1f2937", name: "Black" },
  { value: "#2563eb", name: "Blue" },
  { value: "#dc2626", name: "Red" },
] as const;

export const INK_WIDTHS = [
  { value: 2, name: "Thin" },
  { value: 3.5, name: "Medium" },
  { value: 6, name: "Thick" },
] as const;

const TOOLS: { tool: InkTool; label: string; key: string; icon: ComponentType<{ className?: string }> }[] = [
  { tool: "pen", label: "Pen", key: "P", icon: Pen },
  { tool: "highlighter", label: "Highlighter", key: "H", icon: Highlighter },
  { tool: "eraser", label: "Eraser (whole strokes)", key: "E", icon: Eraser },
  { tool: "lasso", label: "Lasso: select and move", key: "L", icon: LassoSelect },
  { tool: "space", label: "Insert space: drag down", key: "S", icon: BetweenHorizontalStart },
];

type ToolButtonProps = {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
};

const ToolButton = ({ label, active, disabled, onClick, children }: ToolButtonProps) => (
  <button
    type="button"
    title={label}
    aria-label={label}
    aria-pressed={active}
    disabled={disabled}
    onClick={onClick}
    className={cn(
      "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-40",
      active && "bg-sky-100 text-sky-600 ring-2 ring-sky-300 hover:bg-sky-100"
    )}
  >
    {children}
  </button>
);

type InkToolbarProps = {
  tool: InkTool;
  onTool: (tool: InkTool) => void;
  color: string;
  onColor: (color: string) => void;
  width: number;
  onWidth: (width: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  onZoom: (factor: number) => void;
  onResetView: () => void;
  selectionCount: number;
  onDeleteSelection: () => void;
  penSeen: boolean;
  touchMode: TouchMode;
  onTouchMode: (mode: TouchMode) => void;
  disabled?: boolean;
  className?: string;
};

export const InkToolbar = ({
  tool,
  onTool,
  color,
  onColor,
  width,
  onWidth,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onClear,
  onZoom,
  onResetView,
  selectionCount,
  onDeleteSelection,
  penSeen,
  touchMode,
  onTouchMode,
  disabled,
  className,
}: InkToolbarProps) => {
  const fingersDraw = touchMode === "draw" || (touchMode === "auto" && !penSeen);
  return (
    <div
      role="toolbar"
      aria-label="Writing tools"
      className={cn(
        "flex items-center gap-1 overflow-x-auto rounded-xl border-2 border-slate-200 bg-white p-1 md:flex-wrap md:overflow-visible",
        className
      )}
    >
      {TOOLS.map(({ tool: value, label, key, icon: Icon }) => (
        <ToolButton
          key={value}
          label={`${label} (${key})`}
          active={tool === value}
          disabled={disabled}
          onClick={() => onTool(value)}
        >
          <Icon className="h-5 w-5" />
        </ToolButton>
      ))}

      {(tool === "pen" || tool === "highlighter") && (
        <div className="flex shrink-0 items-center gap-1 border-l-2 border-slate-100 pl-1">
          {tool === "pen" &&
            INK_COLORS.map(({ value, name }) => (
              <button
                key={value}
                type="button"
                title={`${name} ink`}
                aria-label={`${name} ink`}
                aria-pressed={color === value}
                onClick={() => onColor(value)}
                className={cn(
                  "h-7 w-7 shrink-0 rounded-full border-2 border-white ring-2 ring-transparent",
                  color === value && "ring-sky-400"
                )}
                style={{ backgroundColor: value }}
              />
            ))}
          {INK_WIDTHS.map(({ value, name }) => (
            <ToolButton
              key={value}
              label={`${name} line`}
              active={width === value}
              onClick={() => onWidth(value)}
            >
              <span
                className="block rounded-full bg-slate-600"
                style={{ width: value * 2 + 2, height: value * 2 + 2 }}
              />
            </ToolButton>
          ))}
        </div>
      )}

      {selectionCount > 0 && (
        <ToolButton label="Delete the selection (Delete)" onClick={onDeleteSelection}>
          <X className="h-5 w-5 text-rose-500" />
        </ToolButton>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-1 border-l-2 border-slate-100 pl-1">
        <ToolButton label="Undo (Ctrl+Z)" disabled={disabled || !canUndo} onClick={onUndo}>
          <Undo2 className="h-5 w-5" />
        </ToolButton>
        <ToolButton label="Redo (Ctrl+Shift+Z)" disabled={disabled || !canRedo} onClick={onRedo}>
          <Redo2 className="h-5 w-5" />
        </ToolButton>
        <ToolButton label="Zoom out (-)" onClick={() => onZoom(1 / 1.25)}>
          <ZoomOut className="h-5 w-5" />
        </ToolButton>
        <ToolButton label="Zoom in (+)" onClick={() => onZoom(1.25)}>
          <ZoomIn className="h-5 w-5" />
        </ToolButton>
        <ToolButton label="Fit the page width (0)" onClick={onResetView}>
          <Scan className="h-5 w-5" />
        </ToolButton>
        {penSeen && (
          <ToolButton
            label={fingersDraw ? "Fingers draw; tap to make them scroll" : "Fingers scroll; tap to make them draw"}
            active={fingersDraw}
            onClick={() => onTouchMode(fingersDraw ? "navigate" : "draw")}
          >
            <Hand className="h-5 w-5" />
          </ToolButton>
        )}
        <ToolButton label="Clear the page" disabled={disabled} onClick={onClear}>
          <Trash2 className="h-5 w-5" />
        </ToolButton>
      </div>
    </div>
  );
};
