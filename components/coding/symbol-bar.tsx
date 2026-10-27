"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { IndentDecrease, IndentIncrease, Undo2 } from "lucide-react";
import { useMedia } from "react-use";

import type { EditorMode } from "@/lib/coding/languages";

const COMMON = ["(", ")", "{", "}", "[", "]", '"', "'", ":", ";", "=", "+", "-", "*", "/", "<", ">", ".", ",", "_"];
const EXTRA: Partial<Record<EditorMode, string[]>> = {
  python: ["#", "%", "!"],
  javascript: ["=>", "`", "$", "!", "&", "|"],
  typescript: ["=>", "`", "$", "!", "&", "|"],
  sql: ["*", "%", "!"],
  html: ["</", "/>", "#"],
  css: ["#", "%", "!"],
};

type SymbolBarProps = {
  mode: EditorMode;
  onInsert: (text: string) => void;
  onCommand: (command: "undo" | "indent" | "outdent") => void;
};

/** How far the on-screen keyboard pushes into the layout viewport. */
const useKeyboardInset = () => {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () =>
      setInset(Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop));
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);
  return inset;
};

// Brackets, quotes, operators, tab and undo above the on-screen keyboard of phones and tablets
// (section 4.2). Buttons keep the editor focused, so the keyboard stays open.
export const SymbolBar = ({ mode, onInsert, onCommand }: SymbolBarProps) => {
  const touch = useMedia("(pointer: coarse)", false);
  const inset = useKeyboardInset();
  if (!touch) return null;

  const keep = (event: React.PointerEvent | React.MouseEvent) => event.preventDefault();
  const symbols = [...COMMON, ...(EXTRA[mode] ?? [])];
  const button =
    "flex h-10 min-w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white px-2 font-mono text-base text-neutral-700 active:bg-sky-100";

  return createPortal(
    <div
      role="toolbar"
      aria-label="Symbols"
      className="fixed inset-x-0 z-[60] flex gap-1 overflow-x-auto border-t border-slate-200 bg-slate-100 px-2 py-1.5"
      style={{ bottom: inset }}
      onPointerDown={keep}
      onMouseDown={keep}
    >
      <button type="button" className={button} aria-label="Indent" onClick={() => onCommand("indent")}>
        <IndentIncrease className="h-4 w-4" />
      </button>
      <button type="button" className={button} aria-label="Outdent" onClick={() => onCommand("outdent")}>
        <IndentDecrease className="h-4 w-4" />
      </button>
      <button type="button" className={button} aria-label="Undo" onClick={() => onCommand("undo")}>
        <Undo2 className="h-4 w-4" />
      </button>
      {symbols.map((symbol) => (
        <button
          key={symbol}
          type="button"
          className={button}
          aria-label={`Insert ${symbol}`}
          onClick={() => onInsert(symbol)}
        >
          {symbol}
        </button>
      ))}
    </div>,
    document.body
  );
};
