import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  SelectHTMLAttributes,
  ReactNode,
} from "react";

export function Card({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-card">{children}</div>;
}

export function Button({
  children,
  variant = "primary",
  ...props
}: { children: ReactNode; variant?: "primary" | "ghost" } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-md px-3.5 py-1.5 text-sm font-semibold transition-colors disabled:opacity-50";
  const styles =
    variant === "primary"
      ? "bg-brand-600 text-white shadow-sm hover:bg-brand-700"
      : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50";
  return (
    <button {...props} className={`${base} ${styles} ${props.className ?? ""}`}>
      {children}
    </button>
  );
}

// Compact, instrument-panel field: an uppercase micro-label over a tight input.
// `mono` renders the value in the monospace face, for data (times, codes, regs).
export function Field({
  label,
  hint,
  mono,
  ...props
}: { label: string; hint?: string; mono?: boolean } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <input
        {...props}
        // min-height keeps empty native date/time inputs from collapsing on iOS.
        className={`block min-h-[2.25rem] w-full appearance-none rounded-md border border-slate-200 bg-white px-2.5 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500 ${
          mono ? "font-mono tracking-wide" : ""
        }`}
      />
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function Select({
  label,
  children,
  mono,
  ...props
}: { label: string; children: ReactNode; mono?: boolean } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <select
        {...props}
        className={`min-h-[2.25rem] w-full rounded-md border border-slate-200 bg-white px-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 ${
          mono ? "font-mono" : ""
        }`}
      >
        {children}
      </select>
    </label>
  );
}

export function Alert({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      {children}
    </div>
  );
}
