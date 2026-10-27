"use client";

// Small form controls of author mode.
import type { ReactNode } from "react";

import type { SolutionScript } from "@/lib/math/solution/types";
import { cn } from "@/lib/utils";

const inputClass =
  "w-full rounded-lg border-2 border-slate-200 bg-white px-2 py-1 text-sm focus:border-sky-400 focus:outline-none";

export const Field = ({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) => (
  <label className={cn("block min-w-0 text-xs font-bold text-neutral-500", className)}>
    {label}
    <div className="mt-0.5 font-normal text-neutral-800">{children}</div>
  </label>
);

export const TextInput = ({
  value,
  onChange,
  placeholder,
  className,
  mono,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  mono?: boolean;
}) => (
  <input
    type="text"
    value={value}
    placeholder={placeholder}
    onChange={(event) => onChange(event.target.value)}
    className={cn(inputClass, mono && "font-mono text-xs", className)}
  />
);

/** A number field that commits when it loses focus or on Enter, so typing "-" or "1." works. */
export const NumberInput = ({
  value,
  onChange,
  step = "any",
  className,
}: {
  value: number | undefined;
  onChange: (value: number) => void;
  step?: number | "any";
  className?: string;
}) => (
  <input
    key={String(value)}
    type="number"
    inputMode="decimal"
    step={step}
    defaultValue={value ?? ""}
    onBlur={(event) => {
      const n = Number(event.target.value);
      if (event.target.value.trim() !== "" && Number.isFinite(n) && n !== value) onChange(n);
    }}
    onKeyDown={(event) => {
      if (event.key === "Enter") (event.target as HTMLInputElement).blur();
    }}
    className={cn(inputClass, "tabular-nums", className)}
  />
);

export const PointInput = ({
  value,
  onChange,
}: {
  value: [number, number] | undefined;
  onChange: (value: [number, number]) => void;
}) => (
  <div className="flex gap-1">
    <NumberInput value={value?.[0]} onChange={(x) => onChange([x, value?.[1] ?? 0])} />
    <NumberInput value={value?.[1]} onChange={(y) => onChange([value?.[0] ?? 0, y])} />
  </div>
);

export const Select = ({
  value,
  options,
  onChange,
  empty,
  className,
}: {
  value: string | undefined;
  options: { value: string; label?: string }[];
  onChange: (value: string) => void;
  /** Label of a "nothing chosen" entry; omit to require a choice. */
  empty?: string;
  className?: string;
}) => (
  <select
    value={value ?? ""}
    onChange={(event) => onChange(event.target.value)}
    className={cn(inputClass, "py-1", className)}
  >
    {(empty !== undefined || !options.some((option) => option.value === value)) && (
      <option value="">{empty ?? "Choose..."}</option>
    )}
    {options.map((option) => (
      <option key={option.value} value={option.value}>
        {option.label ?? option.value}
      </option>
    ))}
  </select>
);

/** Checkboxes for a list of ids, kept in the order of the options. */
export const Checklist = ({
  value,
  options,
  onChange,
}: {
  value: string[];
  options: { value: string; label?: string }[];
  onChange: (value: string[]) => void;
}) => (
  <div className="flex flex-wrap gap-x-3 gap-y-1">
    {options.length === 0 && <span className="text-xs text-neutral-400">Nothing to choose yet.</span>}
    {options.map((option) => (
      <label key={option.value} className="flex items-center gap-1 text-xs font-normal text-neutral-700">
        <input
          type="checkbox"
          checked={value.includes(option.value)}
          onChange={(event) =>
            onChange(
              options
                .map((o) => o.value)
                .filter((id) => (id === option.value ? event.target.checked : value.includes(id)))
            )
          }
        />
        {option.label ?? option.value}
      </label>
    ))}
  </div>
);

export const SmallButton = ({
  children,
  onClick,
  tone = "plain",
  disabled,
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  tone?: "plain" | "primary" | "danger";
  disabled?: boolean;
  title?: string;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={title}
    className={cn(
      "inline-flex items-center gap-1 rounded-lg border-2 px-2 py-1 text-xs font-bold disabled:opacity-40",
      tone === "primary" && "border-sky-400 bg-sky-400 text-white hover:bg-sky-500",
      tone === "plain" && "border-slate-200 bg-white text-neutral-700 hover:bg-slate-50",
      tone === "danger" && "border-rose-200 bg-white text-rose-600 hover:bg-rose-50"
    )}
  >
    {children}
  </button>
);

export const Panel = ({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) => (
  <section className="space-y-2 rounded-xl border-2 border-slate-200 bg-white p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-bold text-neutral-700">{title}</h3>
      {actions && <div className="flex flex-wrap gap-1">{actions}</div>}
    </div>
    {children}
  </section>
);

/** Changes the script: the callback receives a copy it may change in place. */
export type Edit = (change: (script: SolutionScript) => void) => void;
