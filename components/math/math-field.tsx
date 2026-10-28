"use client";

// A MathLive field (https://github.com/arnog/mathlive) as a React component. MathLive defines
// the <math-field> element in the browser only, so it is imported on first use. Its fonts are
// KaTeX's, which the page already has through katex.min.css, so MathLive loads no fonts and
// plays no sounds of its own. On touch devices it opens its virtual math keyboard.
import "katex/dist/katex.min.css";

import { createElement, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

type MathfieldLike = HTMLElement & { value: string; readOnly?: boolean };

/** Sets the LaTeX of a field when it differs (setting it moves the caret to the end). */
const writeValue = (field: MathfieldLike, value: string) => {
  if (field.value !== value) field.value = value;
};

type CloseWatcherLike = { destroy: () => void; onclose: (() => void) | null };
type CloseWatcherConstructor = new () => CloseWatcherLike;

/** Marks the history entry that stands for an open keyboard. */
const KEYBOARD_ENTRY = "lingoMathKeyboard";

// MathLive's keyboard is part of the page, not the phone's own keyboard, so the phone's Back
// button would leave the lesson while it is open. A close watcher makes Back close it first;
// browsers without one get a history entry for the open keyboard instead. Opening the
// keyboard also scrolls the field into view above it.
const watchKeyboard = () => {
  const keyboard = window.mathVirtualKeyboard;
  const Watcher = (window as unknown as { CloseWatcher?: CloseWatcherConstructor }).CloseWatcher;
  let watcher: CloseWatcherLike | null = null;
  let entry = false;
  let leaving = false;

  const close = () => {
    keyboard.hide();
    (document.activeElement as HTMLElement | null)?.blur?.();
  };

  keyboard.addEventListener("virtual-keyboard-toggle", () => {
    if (keyboard.visible) {
      requestAnimationFrame(() =>
        (document.activeElement as HTMLElement | null)?.scrollIntoView?.({ block: "nearest" })
      );
      if (Watcher) {
        if (watcher) return;
        watcher = new Watcher();
        watcher.onclose = () => {
          watcher = null;
          close();
        };
      } else if (!entry) {
        window.history.pushState({ ...window.history.state, [KEYBOARD_ENTRY]: true }, "");
        entry = true;
      }
      return;
    }
    watcher?.destroy();
    watcher = null;
    if (!entry) return;
    entry = false;
    // Only take back the entry while it is still the current one (not after a navigation).
    if (window.history.state?.[KEYBOARD_ENTRY]) {
      leaving = true;
      window.history.back();
    }
  });

  if (!Watcher)
    window.addEventListener("popstate", () => {
      if (leaving) {
        leaving = false;
        return;
      }
      if (!entry) return;
      entry = false;
      close();
    });
};

let loading: Promise<void> | null = null;

const loadMathLive = () =>
  (loading ??= import("mathlive").then(({ MathfieldElement }) => {
    MathfieldElement.fontsDirectory = null;
    MathfieldElement.soundsDirectory = null;
    watchKeyboard();
  }));

type MathFieldProps = {
  value: string;
  onChange?: (latex: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  label: string;
  className?: string;
};

export const MathField = ({
  value,
  onChange,
  readOnly = false,
  placeholder,
  label,
  className,
}: MathFieldProps) => {
  const [field, setField] = useState<MathfieldLike | null>(null);
  const [ready, setReady] = useState(false);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    let active = true;
    loadMathLive()
      .then(() => active && setReady(true))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  // Keep the field in step with the value (corrections, a restored draft), without moving
  // the caret while the learner types.
  useEffect(() => {
    if (field) writeValue(field, value);
  }, [field, value]);

  useEffect(() => {
    if (!field) return;
    const onInput = () => onChangeRef.current?.(field.value);
    field.addEventListener("input", onInput);
    return () => field.removeEventListener("input", onInput);
  }, [field]);

  if (!ready)
    return (
      <div
        className={cn(
          "min-h-[44px] rounded-xl border-2 border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-500",
          className
        )}
        aria-label={label}
      >
        {value || placeholder}
      </div>
    );

  return createElement("math-field", {
    ref: setField,
    "aria-label": label,
    "read-only": readOnly ? "" : undefined,
    "math-virtual-keyboard-policy": "auto",
    placeholder,
    className: cn(
      "block w-full min-h-[44px] rounded-xl border-2 border-slate-200 bg-white px-2 py-1 text-lg focus-within:border-sky-400",
      readOnly && "bg-slate-50",
      className
    ),
  });
};
