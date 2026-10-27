"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type ChipButtonProps = {
  children: ReactNode;
  onClick: () => void;
  used?: boolean;
  disabled?: boolean;
  label?: string;
  className?: string;
};

/** A tappable code token or line, the way fill and order exercises are solved on every device. */
export const ChipButton = ({ children, onClick, used, disabled, label, className }: ChipButtonProps) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    aria-pressed={used}
    data-exercise-keys
    className={cn(
      "min-h-10 rounded-xl border-2 border-b-4 border-slate-200 bg-white px-3 py-1.5 text-left font-mono text-sm text-neutral-700 transition-colors hover:bg-slate-50 active:border-b-2 disabled:pointer-events-none disabled:opacity-60",
      used && "border-dashed bg-slate-100 text-slate-400",
      className
    )}
  >
    {children}
  </button>
);
