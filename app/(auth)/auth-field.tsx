import type { InputHTMLAttributes } from "react";

type AuthFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
};

export const AuthField = ({ label, ...props }: AuthFieldProps) => {
  return (
    <label className="flex w-full flex-col gap-y-1">
      <span className="text-sm font-bold text-neutral-600">{label}</span>
      <input
        className="w-full rounded-xl border-2 border-slate-200 px-4 py-3 text-base text-neutral-700 outline-none focus:border-sky-400"
        {...props}
      />
    </label>
  );
};
