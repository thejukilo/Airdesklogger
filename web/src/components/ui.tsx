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
      <span className={`mb-1 block text-[11px] font-semibold uppercase text-slate-500 ${mono ? "font-mono tracking-wider" : "tracking-wide"}`}>{label}</span>
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
      <span className={`mb-1 block text-[11px] font-semibold uppercase text-slate-500 ${mono ? "font-mono tracking-wider" : "tracking-wide"}`}>{label}</span>
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

/** Outer titled panel: a single header bar with an optional right-aligned note,
 * then a flush body. Used for the record, endorsements and recent entries. */
export function Panel({ title, badge, right, children }: { title: string; badge?: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
      <div className="flex min-h-[2.5rem] flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-slate-200 bg-slate-50 px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-semibold uppercase tracking-wider text-slate-600">{title}</span>
          {badge}
        </div>
        {right != null && <span className="text-[11px] text-slate-400">{right}</span>}
      </div>
      {children}
    </div>
  );
}

/** Lightweight inline subheading inside a panel column (not a full header bar). */
export function SubHead({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{children}</span>
      {right}
    </div>
  );
}

/** Small pill badge, e.g. the green "Matched in fleet" / "Cross-country" markers. */
export function Pill({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "green" | "blue" }) {
  const styles =
    tone === "green" ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : tone === "blue" ? "border-brand-200 bg-brand-50 text-brand-700"
    : "border-slate-200 bg-slate-100 text-slate-600";
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ${styles}`}>
      {children}
    </span>
  );
}

/** Compact labelled stepper for small counts (landings, inflations): [−][ n ][+]. */
export function NumberStepperField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      {label && <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>}
      <span className="inline-flex h-[2.25rem] items-stretch overflow-hidden rounded-md border border-slate-200 bg-white">
        <button type="button" aria-label={`${label}: decrease`} onClick={() => onChange(Math.max(0, value - 1))} className="w-8 border-r border-slate-200 bg-slate-50 text-lg font-semibold leading-none text-slate-600 hover:bg-slate-100">−</button>
        <input
          type="number"
          min={0}
          inputMode="numeric"
          value={value || ""}
          onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
          className="w-10 border-0 bg-transparent text-center font-mono text-sm font-semibold outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <button type="button" aria-label={`${label}: increase`} onClick={() => onChange(value + 1)} className="w-8 border-l border-slate-200 bg-slate-50 text-lg font-semibold leading-none text-slate-600 hover:bg-slate-100">+</button>
      </span>
    </label>
  );
}
