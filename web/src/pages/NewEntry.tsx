import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import * as api from "../api";
import { Button, Field, Select } from "../components/ui";
import { SEVERE_SKEW_MS, useClockSkew } from "../lib/clockSkew";
import { spansTwilight, zonedWallClockToUtc } from "../lib/twilight";
import { CATEGORY_LABELS } from "../labels";
import { ATTR_SPEC, type AttrCategory, type AttrGroup, type AttrItem } from "../lib/attributesSpec";
import { SimulatorSession } from "./SimulatorSession";

// The new-entry category chooser: the four flight categories plus the simulator
// session, which has its own form.
const ENTRY_CATEGORIES = ["AEROPLANE", "HELICOPTER", "SAILPLANE", "BALLOON"] as const;

/** A titled card that groups related fields, so the form reads as sections.
 * A light header bar carries the section name; the body holds the fields. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <div className="flex h-9 items-center border-b border-slate-200 bg-slate-50 px-3 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
        {title}
      </div>
      <div className="space-y-3 p-3">{children}</div>
    </section>
  );
}

/** Outer titled panel: a single header bar with an optional right-aligned note,
 * then a flush body. Used for the main record, endorsements and recent entries. */
function Panel({ title, badge, right, children }: { title: string; badge?: ReactNode; right?: ReactNode; children: ReactNode }) {
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
function SubHead({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{children}</span>
      {right}
    </div>
  );
}

/** Small pill badge, e.g. the green "Matched in fleet" / "Cross-country" markers. */
function Pill({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "green" | "blue" }) {
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

/** 24-hour HH:MM clock-time input (no native AM/PM picker). Four typed digits
 * get an automatic colon; the stored value stays the plain "HH:MM" string. */
function TimeField({ label, value, onChange, action }: { label: string; value: string; onChange: (v: string) => void; action?: ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex h-4 items-center justify-between gap-2">
        <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</span>
        {action}
      </div>
      <input
        aria-label={label}
        inputMode="numeric"
        maxLength={5}
        placeholder="HH:MM"
        value={value}
        onChange={(e) => {
          let c = e.target.value.replace(/[^0-9:]/g, "");
          if (c.length === 4 && !c.includes(":")) c = `${c.slice(0, 2)}:${c.slice(2)}`;
          onChange(c);
        }}
        className="block min-h-[2.25rem] w-full rounded-md border border-slate-200 bg-white px-2.5 text-center text-sm font-mono tracking-wider outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
      />
    </div>
  );
}

/** A small uppercase quick-action link, e.g. NOW / +1h on a time field. */
function MiniLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="text-[10px] font-bold uppercase tracking-wide text-brand-600 hover:underline">
      {children}
    </button>
  );
}

/** "a"/"an" for a category label, so the prominent messages read correctly. */
const indefinite = (label: string) => (/^[aeiou]/i.test(label) ? "an" : "a");

/** One pill in the category chooser at the top of the page. */
function CategoryTab({
  active,
  disabled,
  label,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`rounded px-3.5 py-1.5 text-sm font-medium transition ${
        disabled
          ? "cursor-not-allowed text-slate-400"
          : active
            ? "bg-brand-600 text-white shadow-sm"
            : "text-slate-600 hover:bg-white hover:text-slate-900"
      }`}
    >
      {label}
    </button>
  );
}

/** A small "i" badge that reveals a styled note on hover or focus. */
/* ────────────────────────── Attributes section ────────────────────────── */

function specGroupItems(g: AttrGroup): AttrItem[] {
  return [...(g.items ?? []), ...(g.subs ?? []).flatMap((s) => s.items)];
}

function specForCategory(category: string): AttrGroup[] {
  return ATTR_SPEC[(category as AttrCategory)]?.groups ?? [];
}

function visibleKeysForCategory(category: string): Set<string> {
  const out = new Set<string>();
  for (const g of specForCategory(category)) for (const it of specGroupItems(g)) out.add(it.key);
  return out;
}

function AttrStepper({ value, onChange, max }: { value: number; onChange: (v: number) => void; max?: number }) {
  return (
    <span className="inline-flex h-[28px] items-stretch border border-slate-400 bg-white">
      <button type="button" onClick={() => onChange(Math.max(0, value - 1))} className="w-7 border-r border-slate-400 bg-slate-100 text-base font-bold text-slate-700 hover:bg-slate-200">−</button>
      <input
        type="number"
        inputMode="numeric"
        value={value || ""}
        onChange={(e) => {
          const n = Math.max(0, Number(e.target.value) || 0);
          onChange(max !== undefined ? Math.min(max, n) : n);
        }}
        className="w-10 border-0 bg-transparent text-center text-sm font-semibold outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <button type="button" onClick={() => onChange((max !== undefined ? Math.min(max, value + 1) : value + 1))} className="w-7 border-l border-slate-400 bg-slate-100 text-base font-bold text-slate-700 hover:bg-slate-200">+</button>
    </span>
  );
}

// Compact labelled stepper for small counts (landings, inflations): [−][ n ][+].
function NumberStepperField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
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

function AttrSeg<T extends string>({ value, onChange, options }: { value: T | undefined; onChange: (v: T) => void; options: ReadonlyArray<{ value: string; label: string }> }) {
  return (
    <span className="inline-flex h-[28px] items-stretch border border-slate-400 bg-white">
      {options.map((opt, i) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value as T)}
            className={`px-2.5 text-xs font-semibold ${i > 0 ? "border-l border-slate-300" : ""} ${active ? "bg-brand-600 text-white" : "bg-white text-slate-700 hover:bg-slate-100"}`}
          >
            {opt.label}
          </button>
        );
      })}
    </span>
  );
}

function AttrTimeInput({ value, onChange, placeholder = "HH:MM" }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      type="text"
      inputMode="numeric"
      value={value}
      onChange={(e) => onChange(autoFormatHHMM(e.target.value))}
      placeholder={placeholder}
      className="h-[28px] w-[72px] border border-slate-400 bg-white px-2 text-center text-sm font-semibold tabular-nums outline-none"
    />
  );
}

function AttrTextInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="block h-[28px] w-full max-w-md border border-slate-400 bg-white px-2 text-sm outline-none placeholder:italic placeholder:text-slate-400"
    />
  );
}

interface AttributesSectionProps {
  category: string;
  attributes: string[];
  details: api.AttributeDetails;
  launchMethod: string;
  balloonFlightType: string;
  seriesTimeHHMM: string;
  seriesExceeds: boolean;
  computedBlockMinutes: number;
  onToggleAttr: (key: string) => void;
  onSetDetail: <K extends keyof api.AttributeDetails>(field: K, value: api.AttributeDetails[K]) => void;
  onSetSeries: (v: string) => void;
  onSetLaunch: (v: string) => void;
  onSetBalloonType: (v: string) => void;
}

function AttributesSection(p: AttributesSectionProps) {
  const groups = specForCategory(p.category);
  if (groups.length === 0) return null;
  const ctx = { launchMethod: p.launchMethod, balloonFlightType: p.balloonFlightType, seriesTimeHHMM: p.seriesTimeHHMM };

  const isOn = (item: AttrItem) => {
    if (item.entryToggle) {
      const v = item.entryToggle.field === "balloonFlightType" ? p.balloonFlightType : "";
      return v === item.entryToggle.whenValue;
    }
    return p.attributes.includes(item.key);
  };
  const toggle = (item: AttrItem) => {
    if (item.entryToggle && item.entryToggle.field === "balloonFlightType") {
      p.onSetBalloonType(isOn(item) ? "FREE" : item.entryToggle.whenValue);
      return;
    }
    p.onToggleAttr(item.key);
  };

  // Flatten the category spec into labelled rows: one per top-level group, or
  // one per sub-group when a group is subdivided.
  const rows = groups.flatMap((g) =>
    g.subs ? g.subs.map((s) => ({ label: s.title, items: s.items })) : [{ label: g.title, items: g.items ?? [] }],
  );
  const active = rows.flatMap((r) => r.items).filter(isOn);

  return (
    <Panel
      title="Attributes & endorsements"
      badge={<Pill tone={active.length > 0 ? "blue" : "slate"}>{active.length} active</Pill>}
      right="Click to tag"
    >
      <div className="space-y-3 p-4">
        {active.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {active.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => toggle(item)}
                title="Remove"
                className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 py-1 pl-3 pr-2 text-xs font-medium text-brand-700 hover:bg-brand-100"
              >
                {item.label}
                <span aria-hidden="true" className="text-brand-400">×</span>
              </button>
            ))}
          </div>
        )}
        <div className="divide-y divide-slate-100 rounded-md border border-slate-200">
          {rows.map((row) => (
            <div key={row.label} className="flex flex-col gap-1.5 px-3 py-2.5 sm:flex-row sm:items-start sm:gap-3">
              <div className="shrink-0 pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 sm:w-40">{row.label}</div>
              <div className="min-w-0 flex-1">
                <ChipRow
                  items={row.items}
                  isOn={isOn}
                  toggle={toggle}
                  details={p.details}
                  ctx={ctx}
                  computedBlockMinutes={p.computedBlockMinutes}
                  seriesExceeds={p.seriesExceeds}
                  onSetDetail={p.onSetDetail}
                  onSetSeries={p.onSetSeries}
                  onSetLaunch={p.onSetLaunch}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

function ChipRow({
  items, isOn, toggle, details, ctx, computedBlockMinutes, seriesExceeds, onSetDetail, onSetSeries, onSetLaunch,
}: {
  items: AttrItem[];
  isOn: (it: AttrItem) => boolean;
  toggle: (it: AttrItem) => void;
  details: api.AttributeDetails;
  ctx: { launchMethod: string; balloonFlightType: string; seriesTimeHHMM: string };
  computedBlockMinutes: number;
  seriesExceeds: boolean;
  onSetDetail: <K extends keyof api.AttributeDetails>(field: K, value: api.AttributeDetails[K]) => void;
  onSetSeries: (v: string) => void;
  onSetLaunch: (v: string) => void;
}) {
  const activeWithInput = items.filter((it) => isOn(it) && it.input);
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => {
          const on = isOn(item);
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => toggle(item)}
              aria-pressed={on}
              title={item.note}
              className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                on
                  ? "border-brand-600 bg-brand-600 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:border-brand-300 hover:bg-brand-50"
              }`}
            >
              <span aria-hidden="true" className={on ? "text-white/70" : "text-slate-400"}>{on ? "✓" : "+"}</span>
              {item.label}
            </button>
          );
        })}
      </div>
      {activeWithInput.length > 0 && (
        <div className="mt-2 space-y-1.5 border-l-2 border-brand-200 pl-3">
          {activeWithInput.map((item) => (
            <div key={item.key} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-xs font-medium text-slate-500">{item.label}:</span>
              {renderInput(item, details, ctx, computedBlockMinutes, seriesExceeds, onSetDetail, onSetSeries, onSetLaunch)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function renderInput(
  item: AttrItem,
  details: api.AttributeDetails,
  ctx: { launchMethod: string; balloonFlightType: string; seriesTimeHHMM: string },
  computedBlockMinutes: number,
  seriesExceeds: boolean,
  onSetDetail: <K extends keyof api.AttributeDetails>(field: K, value: api.AttributeDetails[K]) => void,
  onSetSeries: (v: string) => void,
  onSetLaunch: (v: string) => void,
): ReactNode {
  const input = item.input!;
  if (input.kind === "count") {
    const value = (details as Record<string, unknown>)[input.field] as number | undefined;
    return (
      <>
        <AttrStepper value={value ?? 0} onChange={(v) => onSetDetail(input.field as keyof api.AttributeDetails, v as api.AttributeDetails[keyof api.AttributeDetails])} />
        <span className="text-xs text-slate-500">{input.unit}</span>
      </>
    );
  }
  if (input.kind === "time") {
    if (input.entryField) {
      // series-of-flights reduced total time
      return (
        <>
          <AttrTimeInput value={ctx.seriesTimeHHMM} onChange={onSetSeries} />
          <span className={`text-xs ${seriesExceeds ? "text-rose-600" : "text-slate-500"}`}>
            {seriesExceeds
              ? `Cannot exceed calculated ${fmtHHMM(computedBlockMinutes)}.`
              : `reduced total time (calc. ${fmtHHMM(computedBlockMinutes) || "—"})`}
          </span>
        </>
      );
    }
    const minutes = (details as Record<string, unknown>)[input.field] as number | undefined;
    return (
      <>
        <AttrTimeInput
          value={minutes ? fmtHHMM(minutes) : ""}
          onChange={(v) => {
            const mins = parseHHMM(v);
            onSetDetail(input.field as keyof api.AttributeDetails, mins as api.AttributeDetails[keyof api.AttributeDetails]);
          }}
        />
        <span className="text-xs text-slate-500">{input.label}</span>
      </>
    );
  }
  if (input.kind === "segment") {
    if (input.entryField && input.field === "launchMethod") {
      return <AttrSeg value={ctx.launchMethod} onChange={onSetLaunch} options={input.options} />;
    }
    const v = (details as Record<string, unknown>)[input.field] as string | undefined;
    return (
      <AttrSeg
        value={v}
        onChange={(nv) => onSetDetail(input.field as keyof api.AttributeDetails, nv as api.AttributeDetails[keyof api.AttributeDetails])}
        options={input.options}
      />
    );
  }
  if (input.kind === "text") {
    const v = (details as Record<string, unknown>)[input.field] as string | undefined;
    return (
      <AttrTextInput
        value={v ?? ""}
        onChange={(nv) => onSetDetail(input.field as keyof api.AttributeDetails, nv as api.AttributeDetails[keyof api.AttributeDetails])}
        placeholder={input.placeholder ?? "Comment"}
      />
    );
  }
  return null;
}

/**
 * Times are entered as a date plus block-off and block-on times. The pilot
 * chooses UTC or local. UTC is sent with a Z; local is sent as a bare wall-clock
 * value and the server converts it using the aerodrome's timezone (FOCA 2.2.7),
 * always storing UTC. A block-on time at or before block-off rolls to the next
 * day.
 */
type TimeMode = "utc" | "local";

/**
 * UTC times are sent with a Z suffix. Local times are sent as a bare wall-clock
 * value with no zone: the server converts them using the aerodrome's own
 * timezone (from the ICAO code), not this device's timezone.
 */
function toSubmitTime(dateTime: string, mode: TimeMode): string {
  return mode === "utc" ? `${dateTime}:00Z` : `${dateTime}:00`;
}

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** "H:MM"/"HH:MM" to minutes, or 0 when not a valid duration. */
function parseHHMM(s: string): number {
  const m = /^(\d{1,2}):([0-5]?\d)$/.exec(s.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}
function fmtHHMM(min: number): string {
  const n = Math.max(0, Math.round(min));
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
}
/** Insert the colon as the user types: "0540" -> "05:40", "1240" -> "12:40". */
function autoFormatHHMM(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 4);
  return d.length <= 2 ? d : `${d.slice(0, d.length - 2)}:${d.slice(d.length - 2)}`;
}

function blockMinutes(date: string, start: string, end: string): number {
  const s = new Date(`${date}T${start}:00Z`).getTime();
  let e = new Date(`${date}T${end}:00Z`).getTime();
  if (e <= s) e += 86_400_000;
  return Math.round((e - s) / 60_000);
}

/** Debounced ICAO lookup that sets a friendly airport name. Returns a cleanup. */
function resolveAirport(code: string, setName: (n: string | null) => void): () => void {
  if (code.length !== 4) {
    setName(null);
    return () => {};
  }
  const t = setTimeout(async () => {
    try {
      const { airports } = await api.searchAirports(code);
      const exact = airports.find((a) => a.icao === code);
      setName(exact ? exact.name : "Unknown ICAO code");
    } catch {
      setName(null);
    }
  }, 400);
  return () => clearTimeout(t);
}

/**
 * Pilot function as one choice. The five primary capacities map straight to the
 * domain `primary`; the instructor/examiner choices map to `primary` plus an
 * `instructorPosition` (Part-FCL: instructor on the pilot seat, jump seat,
 * supervising, or as examiner). Jump-seat time is not loggable as PIC, so it
 * maps to co-pilot. Safety pilot is kept only so an older entry still loads.
 */
type FnOption = {
  key: string;
  label: string;
  primary: "PIC" | "PICUS" | "SPIC" | "CO_PILOT" | "CRUISE_RELIEF" | "DUAL" | "SAFETY_PILOT";
  instructorPosition?: "PILOT_SEAT" | "JUMP_SEAT" | "SUPERVISING" | "EXAMINER";
};

const POWERED_FUNCTIONS: FnOption[] = [
  { key: "PIC", label: "PIC (pilot in command)", primary: "PIC" },
  { key: "PICUS", label: "PICUS (PIC under supervision)", primary: "PICUS" },
  { key: "SPIC", label: "SPIC (student PIC)", primary: "SPIC" },
  { key: "CO_PILOT", label: "Co-pilot (COPI)", primary: "CO_PILOT" },
  { key: "CRUISE_RELIEF", label: "Cruise-relief co-pilot", primary: "CRUISE_RELIEF" },
  { key: "DUAL", label: "Dual", primary: "DUAL" },
  { key: "FI_PILOT_SEAT", label: "Instructor (pilot seat)", primary: "PIC", instructorPosition: "PILOT_SEAT" },
  { key: "FI_JUMP_SEAT", label: "Instructor (jump seat)", primary: "CO_PILOT", instructorPosition: "JUMP_SEAT" },
  { key: "FI_SUPERVISING", label: "Supervising instructor", primary: "PIC", instructorPosition: "SUPERVISING" },
  { key: "FE_EXAMINER", label: "Examiner", primary: "PIC", instructorPosition: "EXAMINER" },
];
// Sailplanes use PIC, dual and the instructor/examiner functions (instructor
// time is logged via these, not a separate field). Balloons stay simple.
const SAILPLANE_FUNCTIONS: FnOption[] = [
  { key: "PIC", label: "PIC (pilot in command)", primary: "PIC" },
  { key: "DUAL", label: "Dual", primary: "DUAL" },
  { key: "FI_PILOT_SEAT", label: "Instructor (pilot seat)", primary: "PIC", instructorPosition: "PILOT_SEAT" },
  { key: "FI_JUMP_SEAT", label: "Instructor (jump seat)", primary: "CO_PILOT", instructorPosition: "JUMP_SEAT" },
  { key: "FI_SUPERVISING", label: "Supervising instructor", primary: "PIC", instructorPosition: "SUPERVISING" },
  { key: "FE_EXAMINER", label: "Examiner", primary: "PIC", instructorPosition: "EXAMINER" },
];
const BALLOON_FUNCTIONS: FnOption[] = [
  { key: "PIC", label: "PIC (pilot in command)", primary: "PIC" },
  { key: "DUAL", label: "Dual", primary: "DUAL" },
];
const LEGACY_FUNCTIONS: FnOption[] = [{ key: "SAFETY_PILOT", label: "Safety pilot", primary: "SAFETY_PILOT" }];
const ALL_FUNCTIONS: FnOption[] = [...POWERED_FUNCTIONS, ...LEGACY_FUNCTIONS];

function functionsForCategory(category: string): FnOption[] {
  if (category === "SAILPLANE") return SAILPLANE_FUNCTIONS;
  if (category === "BALLOON") return BALLOON_FUNCTIONS;
  return POWERED_FUNCTIONS;
}

function resolveFunction(key: string): FnOption {
  return ALL_FUNCTIONS.find((o) => o.key === key) ?? POWERED_FUNCTIONS[0]!;
}
/** Reverse-map a stored entry (primary + instructor position) to a single key. */
function functionKey(primary?: string, instructorPosition?: string): string {
  if (instructorPosition) {
    const m = ALL_FUNCTIONS.find((o) => o.instructorPosition === instructorPosition);
    if (m) return m.key;
  }
  return ALL_FUNCTIONS.find((o) => !o.instructorPosition && o.primary === primary)?.key ?? "PIC";
}

const empty = {
  date: "",
  blockStart: "",
  blockEnd: "",
  registration: "",
  makeModelVariant: "",
  engineClass: "SE",
  category: "AEROPLANE",
  multiPilot: false,
  crewSize: 2,
  departurePlace: "",
  arrivalPlace: "",
  departurePlaceName: "",
  arrivalPlaceName: "",
  pilotFunction: "PIC",
  tookControl: false,
  operatingRole: "",
  flightRules: "VFR",
  ifrTime: "",
  launchMethod: "",
  balloonFlightType: "",
  balloonGroup: "",
  inflations: 1,
  seriesTime: "",
  landings: 1,
  // Separate day/night counts, used when the flight crosses civil twilight at
  // the arrival aerodrome. When the form is in the single-input mode these
  // are not read; on submit `landings` is what the server sees.
  dayLandings: 1,
  nightLandings: 0,
  picName: "SELF",
  remarks: "",
  attributes: [] as string[],
  attrDetails: {} as api.AttributeDetails,
};

/** Reverse-map a stored entry's content into the form fields, for editing. */
function fromContent(c: api.EntryContent): typeof empty {
  const cols = c.columns;
  const t = (iso: string | undefined) => (iso && iso.length >= 16 ? iso.slice(11, 16) : "");
  return {
    date: cols?.date ?? "",
    blockStart: t(cols?.departureTime),
    blockEnd: t(cols?.arrivalTime),
    registration: c.aircraft?.registration ?? "",
    makeModelVariant: c.aircraft?.makeModelVariant ?? "",
    engineClass: c.aircraft?.engineClass ?? ((cols?.multiEngine ?? 0) > 0 ? "ME" : "SE"),
    category: c.aircraft?.category ?? cols?.category ?? "AEROPLANE",
    multiPilot: c.aircraft?.multiPilot ?? ((cols?.multiPilot ?? 0) > 0),
    crewSize: cols?.crewSize ?? 2,
    departurePlace: cols?.departurePlace ?? "",
    arrivalPlace: cols?.arrivalPlace ?? "",
    departurePlaceName: cols?.departurePlaceName ?? "",
    arrivalPlaceName: cols?.arrivalPlaceName ?? "",
    pilotFunction: functionKey(c.function?.primary, c.columns?.instructorPosition),
    tookControl: c.function?.tookControl ?? false,
    operatingRole: cols?.operatingRole ?? "",
    flightRules: (cols?.attributes ?? []).includes("yz_flight")
      ? "MIXED"
      : (cols?.ifr ?? 0) > 0 ? "IFR" : "VFR",
    ifrTime: cols?.ifr ? fmtHHMM(cols.ifr) : "",
    launchMethod: cols?.launchMethod ?? "",
    balloonFlightType: cols?.balloonFlightType ?? "",
    balloonGroup: c.aircraft?.balloonGroup ?? "",
    inflations: cols?.inflations ?? 1,
    seriesTime: cols?.flightTimeMinutes ? fmtHHMM(cols.flightTimeMinutes) : "",
    landings: (cols?.dayLandings ?? 0) + (cols?.nightLandings ?? 0),
    dayLandings: cols?.dayLandings ?? 0,
    nightLandings: cols?.nightLandings ?? 0,
    picName: c.picName ?? "SELF",
    remarks: c.remarks ?? "",
    attributes: migrateLegacyAttributes(cols?.attributes ?? [], cols?.attributeDetails),
    attrDetails: migrateLegacyDetails(cols?.attributes ?? [], cols?.attributeDetails),
  };
}

/**
 * Older entries stored a single HESLO (or HEC) operation as `heslo` plus
 * `hesloLevel` + `hoistCycles`. The new model has one attribute per level
 * (`heslo_1` ... `heslo_4` and `hec_1`, `hec_2`) carrying its own cycle count.
 * Migrate on read so old entries open in the new UI without surprises.
 */
function migrateLegacyAttributes(attrs: string[], d?: api.AttributeDetails): string[] {
  if (!d) return [...attrs];
  const out = new Set(attrs);
  if (out.has("heslo") && d.hesloLevel) {
    out.delete("heslo");
    out.add(`heslo_${d.hesloLevel}`);
  }
  if (out.has("hec") && d.hecLevel) {
    out.delete("hec");
    out.add(`hec_${d.hecLevel}`);
  }
  return Array.from(out);
}

function migrateLegacyDetails(attrs: string[], d?: api.AttributeDetails): api.AttributeDetails {
  const out: api.AttributeDetails = { ...(d ?? {}) };
  if (attrs.includes("heslo") && d?.hesloLevel) {
    const k = `heslo${d.hesloLevel}Cycles` as keyof api.AttributeDetails;
    if (d.hoistCycles && !(out as Record<string, unknown>)[k]) {
      (out as Record<string, unknown>)[k] = d.hoistCycles;
    }
  }
  if (attrs.includes("hec") && d?.hecLevel) {
    const k = `hec${d.hecLevel}Cycles` as keyof api.AttributeDetails;
    if (d.hoistCycles && !(out as Record<string, unknown>)[k]) {
      (out as Record<string, unknown>)[k] = d.hoistCycles;
    }
  }
  delete out.hesloLevel;
  delete out.hecLevel;
  delete out.hoistCycles;
  return out;
}

/** A compact ledger of the pilot's most recent entries, shown under the form. */
function RecentEntries({ entries }: { entries: api.EntryRow[] }) {
  const usable = entries.filter((e) => !e.voided && e.content.columns);
  const rows = usable
    .map((e) => {
      const c = e.content.columns!;
      const landings = (c.dayLandings ?? 0) + (c.nightLandings ?? 0);
      const fn =
        c.pic > 0 ? "PIC"
        : c.dual > 0 ? "DUAL"
        : c.coPilot > 0 ? "CO-PILOT"
        : c.instructor > 0 ? "INSTRUCTOR"
        : "—";
      const rules = c.ifr > 0 ? (c.ifr >= c.total ? "IFR" : "Y/Z") : "VFR";
      return {
        id: e.id,
        date: c.date,
        reg: e.content.aircraft?.registration ?? "—",
        model: e.content.aircraft?.makeModelVariant ?? "—",
        route: `${c.departurePlace || "—"} → ${c.arrivalPlace || "—"}`,
        rules,
        fn,
        landings,
        block: fmtHHMM(c.total) || "00:00",
        dec: (c.total / 60).toFixed(2),
      };
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 5);
  if (rows.length === 0) return null;
  const totalMin = usable.reduce((s, e) => s + (e.content.columns!.total ?? 0), 0);
  return (
    <Panel
      title="Recent logbook entries"
      badge={<Pill>{rows.length} {rows.length === 1 ? "record" : "records"}</Pill>}
      right={<span>Total logged: <span className="font-mono font-semibold text-brand-700">{(totalMin / 60).toFixed(2)} hrs</span></span>}
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-400">
              <th className="px-4 py-2 font-semibold">Date</th>
              <th className="px-3 py-2 font-semibold">Reg</th>
              <th className="px-3 py-2 font-semibold">Model</th>
              <th className="px-3 py-2 font-semibold">Route</th>
              <th className="px-3 py-2 font-semibold">Rules</th>
              <th className="px-3 py-2 font-semibold">Function</th>
              <th className="px-3 py-2 text-right font-semibold">Landings</th>
              <th className="px-3 py-2 text-right font-semibold">Block time</th>
              <th className="px-4 py-2 text-right font-semibold">Dec. hrs</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id} className="text-slate-700">
                <td className="whitespace-nowrap px-4 py-2 font-mono text-xs">{r.date}</td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs font-semibold text-brand-700">{r.reg}</td>
                <td className="whitespace-nowrap px-3 py-2">{r.model}</td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{r.route}</td>
                <td className="px-3 py-2"><span className="inline-flex rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">{r.rules}</span></td>
                <td className="whitespace-nowrap px-3 py-2 text-xs">{r.fn}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{r.landings}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{r.block}</td>
                <td className="px-4 py-2 text-right font-mono font-semibold tabular-nums text-brand-700">{r.dec}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

export function NewEntry() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id: editId } = useParams();
  const editing = Boolean(editId);
  // A wildly wrong system clock would otherwise pre-fill the "now" defaults
  // (today's date, the current time) with junk. We let editing through because
  // those forms load times from the existing entry rather than from new Date().
  const clockSkew = useClockSkew();
  const clockBlocked = !editing && Math.abs(clockSkew) >= SEVERE_SKEW_MS;
  // A simulator session is reached from the same chooser but uses a separate
  // form; an existing flight is never converted into one.
  const [simulator, setSimulator] = useState(!editing && Boolean((location.state as { simulator?: boolean } | null)?.simulator));
  const [f, setF] = useState(empty);
  const [timeMode, setTimeMode] = useState<TimeMode>("utc");
  const [reason, setReason] = useState("");
  const [loadingEntry, setLoadingEntry] = useState(editing);
  const [editLocked, setEditLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [aircraftMsg, setAircraftMsg] = useState<string | null>(null);
  // The categories the looked-up registration may be logged under (more than one
  // for a motor-glider, which is an aeroplane or a sailplane).
  const [regAllowed, setRegAllowed] = useState<string[]>([]);
  const [depName, setDepName] = useState<string | null>(null);
  const [arrName, setArrName] = useState<string | null>(null);
  // The pilot's most recent entries, shown as a ledger strip under the form.
  const [recent, setRecent] = useState<api.EntryRow[]>([]);
  // Set true by the "Save & Next" button just before submit, so a successful
  // save re-opens a fresh form (carrying the aircraft and pilot) instead of
  // navigating away.
  const saveNext = useRef(false);

  function loadRecent() {
    api.listEntries().then((r) => setRecent(r.entries ?? [])).catch(() => {});
  }
  useEffect(() => {
    if (editing || simulator) return;
    loadRecent();
  }, [editing, simulator]);

  useEffect(() => {
    if (!editId) return;
    api
      .getEntry(editId)
      .then((e) => {
        if (e.current?.content) setF(fromContent(e.current.content));
        setEditLocked(Boolean(e.current?.locked));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load the entry."))
      .finally(() => setLoadingEntry(false));
  }, [editId]);

  function set<K extends keyof typeof f>(k: K, v: (typeof f)[K]) {
    setF((prev) => ({ ...prev, [k]: v }));
  }

  function toggleAttr(key: string) {
    setF((prev) => ({
      ...prev,
      attributes: prev.attributes.includes(key)
        ? prev.attributes.filter((a) => a !== key)
        : [...prev.attributes, key],
    }));
  }

  // Swap departure and arrival (place and resolved name) in one tap.
  function swapPlaces() {
    setF((prev) => ({
      ...prev,
      departurePlace: prev.arrivalPlace,
      arrivalPlace: prev.departurePlace,
      departurePlaceName: prev.arrivalPlaceName,
      arrivalPlaceName: prev.departurePlaceName,
    }));
  }
  // Fill block-off with the current clock time (UTC or local, matching the mode).
  function blockOffNow() {
    const d = new Date();
    const local = timeMode === "local";
    const hh = String(local ? d.getHours() : d.getUTCHours()).padStart(2, "0");
    const mm = String(local ? d.getMinutes() : d.getUTCMinutes()).padStart(2, "0");
    set("blockStart", `${hh}:${mm}`);
  }
  // Set block-on to block-off plus a whole number of hours (quick estimate).
  function blockOnPlus(hours: number) {
    if (!f.blockStart) return;
    set("blockEnd", fmtHHMM((parseHHMM(f.blockStart) + hours * 60) % (24 * 60)));
  }

  const has = (key: string) => f.attributes.includes(key);
  const isSeries = has("series_of_flights");

  // Calculated flight time from the block times, used as the ceiling for a
  // series of flights (which may only be logged with a reduced time).
  const computedBlock = f.blockStart && f.blockEnd ? blockMinutes(f.date || "1970-01-01", f.blockStart, f.blockEnd) : 0;

  // The automatically calculated loggable time: the block time with the
  // augmented-crew share (2/3 for three pilots, 1/2 for four) applied. This is
  // the ceiling the pilot may reduce below, either for a series of flights or an
  // augmented-crew operation (FOCA 2.3.5).
  const crewShareLogged =
    f.crewSize === 3 ? Math.round((computedBlock * 2) / 3)
    : f.crewSize === 4 ? Math.round(computedBlock / 2)
    : computedBlock;
  const canReduceTime = isSeries || f.crewSize > 2;

  // Civil-twilight detection: if the flight starts during the day and lands at
  // night (or vice versa) at the arrival aerodrome, the landings field splits
  // into day and night inputs so the pilot can record intermediate landings
  // accurately. arrivalCoords is fetched lazily on each ICAO change.
  const [arrivalAirport, setArrivalAirport] = useState<{
    coords: { latitude: number; longitude: number };
    timezone: string | null;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const icao = f.arrivalPlace.trim().toUpperCase();
    if (icao.length !== 4 || icao === "ZZZZ") { setArrivalAirport(null); return; }
    api.findAirport(icao)
      .then((row) => {
        if (cancelled) return;
        if (row && row.latitude != null && row.longitude != null) {
          setArrivalAirport({
            coords: { latitude: row.latitude, longitude: row.longitude },
            timezone: row.timezone ?? null,
          });
        } else {
          setArrivalAirport(null);
        }
      })
      .catch(() => { if (!cancelled) setArrivalAirport(null); });
    return () => { cancelled = true; };
  }, [f.arrivalPlace]);
  const splitLandings = (() => {
    if (!arrivalAirport) return false;
    if (!f.blockStart || !f.blockEnd || !f.date) return false;
    const arrDate = f.blockEnd > f.blockStart ? f.date : nextDay(f.date);
    // Local-mode entries are wall-clock at the aerodrome; convert through the
    // arrival airport's IANA timezone before classifying. UTC-mode entries are
    // already absolute instants.
    let dep: Date | null;
    let arr: Date | null;
    if (timeMode === "local") {
      if (!arrivalAirport.timezone) return false;
      dep = zonedWallClockToUtc(`${f.date}T${f.blockStart}`, arrivalAirport.timezone);
      arr = zonedWallClockToUtc(`${arrDate}T${f.blockEnd}`, arrivalAirport.timezone);
    } else {
      dep = new Date(`${f.date}T${f.blockStart}:00Z`);
      arr = new Date(`${arrDate}T${f.blockEnd}:00Z`);
    }
    if (!dep || !arr || Number.isNaN(dep.getTime()) || Number.isNaN(arr.getTime())) return false;
    return spansTwilight(dep, arr, arrivalAirport.coords);
  })();
  // Keep day+night in sync with the single-input total when toggling modes.
  useEffect(() => {
    if (splitLandings) {
      // entering split mode: seed from the single total if both sub-fields are empty
      if (f.dayLandings === 0 && f.nightLandings === 0 && f.landings > 0) {
        setF((prev) => ({ ...prev, dayLandings: prev.landings, nightLandings: 0 }));
      }
    } else {
      // leaving split mode: collapse to the single total
      const total = (f.dayLandings || 0) + (f.nightLandings || 0);
      if (total !== f.landings) setF((prev) => ({ ...prev, landings: total }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splitLandings]);
  // The entered series time, in minutes; extending beyond the calculated block
  // time is not allowed and is flagged rather than silently clamped.
  const seriesMinutes = parseHHMM(f.seriesTime);
  const seriesExceeds = canReduceTime && crewShareLogged > 0 && seriesMinutes > crewShareLogged;
  // Prefill the editable logged time (HH:MM) with the calculated time when it is
  // empty; the pilot may then reduce it (series of flights, or augmented crew).
  useEffect(() => {
    if (canReduceTime && crewShareLogged > 0 && parseHHMM(f.seriesTime) === 0) set("seriesTime", fmtHHMM(crewShareLogged));
  }, [canReduceTime, crewShareLogged]);

  // Only the attributes that apply to the chosen category. Sailplanes use a
  // strict whitelist; other categories use the per-attribute restrictions
  // (launch/cloud are sailplane-only, HESLO/HEC helicopter-only).
  // When the category changes, drop any selected attribute that no longer
  // applies, so the entry does not carry (and the server does not reject) one.
  useEffect(() => {
    const visible = visibleKeysForCategory(f.category);
    if (f.attributes.some((k) => !visible.has(k))) {
      setF((prev) => ({ ...prev, attributes: prev.attributes.filter((k) => visible.has(k)) }));
    }
  }, [f.category]);

  function buildAttributeDetails(): api.AttributeDetails | null {
    // Keep only fields whose attribute is currently selected, so unticking a
    // chip cleanly removes its data from the entry.
    const d = { ...f.attrDetails };
    if (!has("mountain_landings")) {
      delete d.mountainLandingGear;
      delete d.mountainLandings;
    }
    if (!has("mountain_landing_official")) delete d.mountainLandingsOfficial;
    if (!has("mountain_landing_2000")) delete d.mountainLandingsAbove2000;
    if (!has("mountain_landing_2700")) delete d.mountainLandingsAbove2700;
    if (!has("hdf")) delete d.hdfTakeoffs;
    if (!has("nvis")) delete d.nvisMinutes;
    if (!has("go_around")) delete d.goArounds;
    if (!has("touch_and_go")) delete d.touchAndGo;
    if (!has("heslo_1")) delete d.heslo1Cycles;
    if (!has("heslo_2")) delete d.heslo2Cycles;
    if (!has("heslo_3")) delete d.heslo3Cycles;
    if (!has("heslo_4")) delete d.heslo4Cycles;
    if (!has("hec_1")) delete d.hec1Cycles;
    if (!has("hec_2")) delete d.hec2Cycles;
    if (!has("hho")) delete d.hhoCycles;
    if (!has("aerobatic_privilege")) delete d.aerobaticLevel;
    if (!has("skill_test")) delete d.skillTestComment;
    if (!has("proficiency_check")) delete d.proficiencyCheckComment;
    if (!has("licence_proficiency_check")) delete d.licenceProficiencyCheckComment;
    if (!has("language_proficiency_check")) delete d.languageProficiencyComment;
    if (!has("aoc")) delete d.aocComment;
    if (!has("demo_flight")) delete d.demoFlightComment;
    return Object.keys(d).length > 0 ? d : null;
  }

  /** Update a nested attribute-detail field. */
  function setDetail<K extends keyof api.AttributeDetails>(field: K, value: api.AttributeDetails[K]) {
    setF((prev) => {
      const next: api.AttributeDetails = { ...prev.attrDetails };
      if (value === undefined || value === "" || value === 0) delete next[field];
      else next[field] = value;
      return { ...prev, attrDetails: next };
    });
  }

  // The model last auto-filled from a lookup, so it can be cleared again if the
  // registration is removed (but a model the pilot typed is left alone).
  const autofilledModel = useRef<string | null>(null);
  // Auto-fill aircraft details a moment after the registration stops changing.
  const reg = f.registration.trim().toUpperCase();
  useEffect(() => {
    if (reg.length < 2) {
      setAircraftMsg(null);
      setRegAllowed([]);
      setF((prev) =>
        prev.makeModelVariant && prev.makeModelVariant === autofilledModel.current
          ? { ...prev, makeModelVariant: "" }
          : prev,
      );
      autofilledModel.current = null;
      return;
    }
    const t = setTimeout(async () => {
      try {
        const { match, subtype, allowedCategories } = await api.lookupAircraft(reg);
        if (match) {
          const known = ["AEROPLANE", "HELICOPTER", "SAILPLANE", "BALLOON"].includes(match.category)
            ? match.category
            : null;
          const allowed = allowedCategories?.length ? allowedCategories : known ? [known] : [];
          setRegAllowed(allowed);
          if (match.model) autofilledModel.current = match.model;
          const detail = subtype ? `${match.model} (${subtype})` : match.model;
          setF((prev) => {
            // Keep the pilot's category when the type already permits it (a
            // motor-glider as aeroplane or sailplane); otherwise set the default.
            const next = allowed.includes(prev.category) ? prev.category : known ?? prev.category;
            const changed = next !== prev.category;
            const dual = allowed.length > 1 ? ` (may also be logged as ${allowed.filter((c) => c !== next).map((c) => CATEGORY_LABELS[c]).join(", ")})` : "";
            setAircraftMsg(
              changed
                ? `${reg} is registered as a ${CATEGORY_LABELS[next]}; category set to match. ${detail}`
                : `Found: ${detail}${dual}`,
            );
            return {
              ...prev,
              makeModelVariant: match.model || prev.makeModelVariant,
              category: next,
              // More than one engine means multi-engine; a known single engine
              // sets single-engine. Leave the choice alone when unknown.
              engineClass:
                typeof match.engineCount === "number"
                  ? match.engineCount > 1
                    ? "ME"
                    : "SE"
                  : prev.engineClass,
              multiPilot: match.multiPilot ?? prev.multiPilot,
              balloonGroup: match.balloonGroup ?? prev.balloonGroup,
            };
          });
        } else {
          setRegAllowed([]);
          setAircraftMsg("Not found; enter the type manually.");
        }
      } catch {
        setAircraftMsg(null);
        setRegAllowed([]);
      }
    }, 600);
    return () => clearTimeout(t);
  }, [reg]);

  // If the registration is known and the chosen category is not one the type
  // allows (a motor-glider permits aeroplane or sailplane), warn and block: the
  // registration is authoritative for the category.
  const categoryMismatch = regAllowed.length > 0 && !regAllowed.includes(f.category);
  const aircraftNotFound = aircraftMsg === "Not found; enter the type manually.";

  // EASA times the flight from first movement (block) for aeroplanes, but from
  // rotor start to rotor stop for helicopters (AMC1 FCL.050 (g)). Balloons log
  // a plain departure and arrival time.
  const timeLabels: { off: string; on: string; total: string } =
    f.category === "HELICOPTER"
      ? { off: "Rotor start", on: "Rotor stop", total: "Total rotor time" }
      : f.category === "BALLOON"
        ? { off: "Departure", on: "Arrival", total: "Total flight time" }
        : f.category === "SAILPLANE"
          ? { off: "Flight start", on: "Flight end", total: "Total flight time" }
          : { off: "Block off", on: "Block on", total: "Total block time" };

  // Show the airport name for entered ICAO codes.
  const dep = f.departurePlace.trim().toUpperCase();
  const arr = f.arrivalPlace.trim().toUpperCase();
  // Balloon places are free text, so no ICAO name lookup for them.
  useEffect(() => {
    if (f.category === "BALLOON") { setDepName(null); return; }
    return resolveAirport(dep, setDepName);
  }, [dep, f.category]);
  useEffect(() => {
    if (f.category === "BALLOON") { setArrName(null); return; }
    return resolveAirport(arr, setArrName);
  }, [arr, f.category]);

  // The date cannot be in the future, so cap the picker at today (device date).
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  // The selected pilot function resolves to a primary capacity plus, for the
  // instructor/examiner choices, a seat position.
  const fn = resolveFunction(f.pilotFunction);
  const isDual = fn.primary === "DUAL";
  const isSafety = fn.primary === "SAFETY_PILOT";

  // On a dual flight the PIC is the instructor, so SELF is not valid: clear it
  // when the function switches to dual so the pilot must type the instructor.
  useEffect(() => {
    if (isDual && f.picName.trim().toUpperCase() === "SELF") set("picName", "");
  }, [isDual]);

  // Balloons and sailplanes are not aeroplane/helicopter: they have no SE/ME or
  // multi-pilot columns and no IFR, but carry their own conditions (launch
  // method for sailplanes, free/tethered for balloons).
  const isSailplane = f.category === "SAILPLANE";
  const isBalloon = f.category === "BALLOON";
  const isPowered = !isSailplane && !isBalloon;
  // Functions offered for the category; keep the current value if it is not in
  // the list (e.g. a legacy safety-pilot entry, or after switching category).
  const baseFunctions = functionsForCategory(f.category);
  const functionOptions = baseFunctions.some((o) => o.key === f.pilotFunction)
    ? baseFunctions
    : [...baseFunctions, resolveFunction(f.pilotFunction)];
  useEffect(() => {
    if (!functionsForCategory(f.category).some((o) => o.key === f.pilotFunction)) set("pilotFunction", "PIC");
    // Balloon places are free text with no aerodrome timezone, so times are UTC.
    if (isBalloon && timeMode === "local") setTimeMode("utc");
  }, [f.category]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (categoryMismatch) {
      setError(`${reg} must be logged as ${indefinite(CATEGORY_LABELS[regAllowed[0]!]!)} ${regAllowed.map((c) => CATEGORY_LABELS[c]).join(" or ")}, not ${indefinite(CATEGORY_LABELS[f.category]!)} ${CATEGORY_LABELS[f.category]}. Correct the category or the registration.`);
      return;
    }
    if (seriesExceeds) {
      setError(`The logged flight time can only be reduced, not raised above the calculated ${fmtHHMM(crewShareLogged)}.`);
      return;
    }
    setBusy(true);
    try {
      const arrivalDate = f.blockEnd > f.blockStart ? f.date : nextDay(f.date);
      const submitBlock = blockMinutes(f.date, f.blockStart, f.blockEnd);
      const ifr = !isPowered
        ? 0
        : f.flightRules === "IFR"
          ? submitBlock
          : f.flightRules === "MIXED"
            ? Math.min(parseHHMM(f.ifrTime), submitBlock)
            : 0;
      const payload = {
        timeZone: timeMode === "local" ? "LOCAL" : "UTC",
        aircraft: {
          makeModelVariant: f.makeModelVariant,
          registration: reg,
          engineClass: f.engineClass as "SE" | "ME",
          multiPilot: f.multiPilot,
          category: f.category,
          ...(isBalloon && f.balloonGroup ? { balloonGroup: f.balloonGroup } : {}),
        },
        legs: [
          {
            departurePlace: isBalloon ? f.departurePlace.trim() : f.departurePlace.toUpperCase(),
            departureTime: toSubmitTime(`${f.date}T${f.blockStart}`, timeMode),
            arrivalPlace: isBalloon ? f.arrivalPlace.trim() : f.arrivalPlace.toUpperCase(),
            arrivalTime: toSubmitTime(`${arrivalDate}T${f.blockEnd}`, timeMode),
            ...(f.departurePlace.toUpperCase() === "ZZZZ" && f.departurePlaceName
              ? { departurePlaceName: f.departurePlaceName }
              : {}),
            ...(f.arrivalPlace.toUpperCase() === "ZZZZ" && f.arrivalPlaceName
              ? { arrivalPlaceName: f.arrivalPlaceName }
              : {}),
          },
        ],
        picName: f.picName,
        landings: splitLandings
          ? { day: Number(f.dayLandings), night: Number(f.nightLandings) }
          : { day: Number(f.landings), night: 0 },
        conditions: { night: 0, ifr },
        function: {
          primary: fn.primary,
          // Instructor time is derived server-side from the seat position.
          instructor: 0,
          ...(fn.instructorPosition ? { instructorPosition: fn.instructorPosition } : {}),
          ...(isSafety ? { tookControl: f.tookControl } : {}),
        },
        ...(isPowered && f.operatingRole ? { operatingRole: f.operatingRole } : {}),
        ...(isSailplane && f.launchMethod ? { launchMethod: f.launchMethod } : {}),
        ...(isBalloon && f.balloonFlightType ? { balloonFlightType: f.balloonFlightType } : {}),
        ...(isBalloon ? { inflations: Number(f.inflations) } : {}),
        // Only send the reduced time when the pilot has lowered it below the
        // calculated block time for a series of flights.
        // Reduced logged time (FOCA 2.3.5): sent only when the pilot lowered it
        // below the calculated value, for a series of flights or an augmented
        // crew. The server treats it as the final logged total.
        ...(canReduceTime && seriesMinutes > 0 && seriesMinutes < crewShareLogged
          ? { flightTimeMinutes: seriesMinutes }
          : {}),
        // Augmented operation: send the crew size only when more than the
        // minimum crew of two flew, so the server applies the FOCA 2.3.4 share
        // (2/3 for three pilots, 1/2 for four). Landings are never scaled.
        ...(isPowered && f.multiPilot && f.crewSize > 2 ? { crewSize: Number(f.crewSize) } : {}),
        ...(f.attributes.length ? { attributes: f.attributes } : {}),
        ...(buildAttributeDetails() ? { attributeDetails: buildAttributeDetails() } : {}),
        remarks: f.remarks,
      };
      if (editing && editId) {
        const amendPayload = reason.trim() ? { ...payload, reason: reason.trim() } : payload;
        await api.amendEntry(editId, amendPayload as never);
        navigate(`/entry/${editId}`);
      } else {
        await api.createEntry(payload as never);
        if (saveNext.current) {
          // Save & Next: keep the aircraft, date and pilot; start the next leg
          // from this flight's arrival. Everything else resets.
          setF((prev) => ({
            ...empty,
            date: prev.date,
            registration: prev.registration,
            makeModelVariant: prev.makeModelVariant,
            engineClass: prev.engineClass,
            category: prev.category,
            multiPilot: prev.multiPilot,
            crewSize: prev.crewSize,
            picName: prev.picName,
            pilotFunction: prev.pilotFunction,
            departurePlace: prev.arrivalPlace,
          }));
          loadRecent();
          window.scrollTo({ top: 0, behavior: "smooth" });
        } else {
          navigate("/");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the entry.");
    } finally {
      setBusy(false);
    }
  }

  if (loadingEntry) {
    return <p className="text-sm text-slate-500">Loading entry...</p>;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-xl font-semibold">
          {editing ? "Edit flight entry" : simulator ? "New simulator session" : "New entry"}
        </h1>
        {!simulator && (
          <div className="hidden items-center gap-2 sm:flex">
            <Button
              type="button"
              variant="ghost"
              onClick={() => navigate(editing && editId ? `/entry/${editId}` : "/")}
            >
              Discard
            </Button>
            {!editing && (
              <Button
                type="submit"
                form="entry-form"
                variant="ghost"
                onClick={() => { saveNext.current = true; }}
                disabled={busy || clockBlocked}
                className="border-brand-300 text-brand-700 hover:bg-brand-50"
              >
                Save &amp; Next
              </Button>
            )}
            <Button
              type="submit"
              form="entry-form"
              onClick={() => { saveNext.current = false; }}
              disabled={busy || clockBlocked}
              title={clockBlocked ? "Your computer's clock is off by more than 30 minutes. Fix it before saving." : undefined}
            >
              {busy ? "Saving..." : editing ? "Save changes" : "Save entry"}
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1">
          {ENTRY_CATEGORIES.map((c) => (
            <CategoryTab
              key={c}
              active={!simulator && f.category === c}
              disabled={regAllowed.length > 0 && !regAllowed.includes(c)}
              label={CATEGORY_LABELS[c]!}
              onClick={() => {
                setSimulator(false);
                set("category", c);
              }}
            />
          ))}
          {!editing && (
            <CategoryTab
              active={simulator}
              disabled={regAllowed.length > 0}
              label="Simulator"
              onClick={() => setSimulator(true)}
            />
          )}
        </div>
      </div>

      {!simulator && categoryMismatch && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
          {reg} must be logged as {indefinite(CATEGORY_LABELS[regAllowed[0]!]!)}{" "}
          {regAllowed.map((c) => CATEGORY_LABELS[c]).join(" or ")}, not {indefinite(CATEGORY_LABELS[f.category]!)}{" "}
          {CATEGORY_LABELS[f.category]}. Choose the highlighted category above.
        </div>
      )}

      {editing && editLocked && (
        <div className="rounded-md border-2 border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-sm">
          <strong className="block">This entry is signed.</strong>
          Saving any change to it removes the sign-off and reopens the entry; the signer will need
          to countersign again. Only edit if you really need to.
        </div>
      )}

      {error && (
        // Fixed at the top so a save error is visible regardless of how far the
        // pilot has scrolled (the Save button is at the bottom of a long form).
        <div className="fixed left-1/2 top-4 z-40 w-[min(36rem,calc(100%-1.5rem))] -translate-x-1/2 rounded-lg border-2 border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-800 shadow-lg">
          <div className="flex items-start gap-3">
            <span className="flex-1">{error}</span>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setError(null)}
              className="rounded px-2 text-red-700 hover:bg-red-100"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {simulator ? (
        <SimulatorSession />
      ) : (
      <form id="entry-form" onSubmit={onSubmit} className="space-y-4">
        {editing && (
          <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
            <Section title="Change">
              <Field
                label="Reason for change (optional)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                hint="Changes more than 48 hours after the entry are recorded in the change history."
              />
            </Section>
          </div>
        )}

        <Panel
          title="Operational flight record"
          right={<span className="font-mono tracking-wide">All timestamps recorded in {timeMode === "local" ? "LOCAL" : "UTC"}</span>}
        >
        <div className="grid grid-cols-1 lg:grid-cols-2 lg:divide-x lg:divide-slate-200">
        {/* ── Left column: aircraft identity + crew station ── */}
        <div className="space-y-5 p-4">
          <div>
            <SubHead right={!simulator && !categoryMismatch && aircraftMsg && !aircraftNotFound ? <Pill tone="green">Matched in fleet</Pill> : undefined}>
              Aircraft &amp; date
            </SubHead>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Date of flight" type="date" max={today} value={f.date} onChange={(e) => set("date", e.target.value)} mono required />
              <div>
                <Field label="Aircraft registration" mono value={f.registration} onChange={(e) => set("registration", e.target.value)} autoCapitalize="characters" autoCorrect="off" spellCheck={false} required />
                {!simulator && !categoryMismatch && aircraftNotFound && (
                  <p className="mt-1 text-xs text-amber-600">{aircraftMsg}</p>
                )}
              </div>
            </div>
            <div className="mt-3">
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Make / model / variant</span>
                {f.makeModelVariant && <span className="truncate text-xs font-medium text-brand-700">{f.makeModelVariant} ({CATEGORY_LABELS[f.category]})</span>}
              </div>
              <input
                aria-label="Make / model / variant"
                value={f.makeModelVariant}
                onChange={(e) => set("makeModelVariant", e.target.value)}
                required
                className="block min-h-[2.25rem] w-full appearance-none rounded-md border border-slate-200 bg-white px-2.5 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {isPowered && (
                <Select label="Engine class" value={f.engineClass} onChange={(e) => set("engineClass", e.target.value)}>
                  <option value="SE">Single-engine</option>
                  <option value="ME">Multi-engine</option>
                </Select>
              )}
              {isPowered && (
                <label className="flex items-end gap-2 pb-2 text-sm">
                  <input
                    type="checkbox"
                    checked={f.multiPilot}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      // Back to a crew of two when multi-pilot is cleared; the
                      // logged time returns to the full block for a series, else
                      // it is hidden and reset.
                      setF((prev) => ({
                        ...prev,
                        multiPilot: checked,
                        crewSize: checked ? prev.crewSize : 2,
                        seriesTime: checked
                          ? prev.seriesTime
                          : prev.attributes.includes("series_of_flights") && computedBlock > 0
                            ? fmtHHMM(computedBlock)
                            : "",
                      }));
                    }}
                  />
                  Multi-pilot operation
                </label>
              )}
              {isPowered && f.multiPilot && (
                <Select
                  label="Operating crew"
                  value={String(f.crewSize)}
                  onChange={(e) => {
                    // Recompute the logged time to the new crew share so the field
                    // tracks the selected crew (it is pre-filled, not left stale).
                    const crew = Number(e.target.value);
                    const share =
                      crew === 3 ? Math.round((computedBlock * 2) / 3)
                      : crew === 4 ? Math.round(computedBlock / 2)
                      : computedBlock;
                    setF((prev) => ({ ...prev, crewSize: crew, seriesTime: computedBlock > 0 ? fmtHHMM(share) : "" }));
                  }}
                >
                  <option value="2">2 pilots (standard — full time)</option>
                  <option value="3">3 pilots (augmented — each logs ⅔)</option>
                  <option value="4">4 pilots (augmented — each logs ½)</option>
                </Select>
              )}
            </div>
          </div>

          <div>
            <SubHead>Crew station &amp; flight rules</SubHead>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label={isDual ? "Name of PIC (flight instructor)" : "Name of PIC"}
                mono
                value={f.picName}
                onChange={(e) => set("picName", e.target.value)}
                hint={isDual ? "On a dual flight enter the instructor's name, not SELF." : undefined}
                required
              />
              <Select label="Pilot function" value={f.pilotFunction} onChange={(e) => set("pilotFunction", e.target.value)}>
                {functionOptions.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>

            {isSafety && (
              <label className="mt-3 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={f.tookControl} onChange={(e) => set("tookControl", e.target.checked)} />
                I took control (a safety pilot logs time only if they took control)
              </label>
            )}

            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {isPowered && (
                <Select label="Operating role" value={f.operatingRole} onChange={(e) => set("operatingRole", e.target.value)}>
                  <option value="">Not recorded (single pilot)</option>
                  <option value="PILOT_FLYING">Pilot flying</option>
                  <option value="PILOT_MONITORING">Pilot monitoring</option>
                </Select>
              )}
              {isPowered && (
                <Select
                  label="Flight rules"
                  value={f.flightRules}
                  onChange={(e) => {
                    const v = e.target.value;
                    // A changed-in-flight (Y/Z) flight is marked with the yz_flight
                    // attribute so the record and export show only the IFR portion.
                    setF((prev) => ({
                      ...prev,
                      flightRules: v,
                      attributes:
                        v === "MIXED"
                          ? prev.attributes.includes("yz_flight")
                            ? prev.attributes
                            : [...prev.attributes, "yz_flight"]
                          : prev.attributes.filter((a) => a !== "yz_flight"),
                    }));
                  }}
                >
                  <option value="VFR">VFR</option>
                  <option value="IFR">IFR</option>
                  <option value="MIXED">Part IFR, part VFR (changed in flight)</option>
                </Select>
              )}
              {isPowered && f.flightRules === "MIXED" && (
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-700">Time flown under IFR</span>
                    <AttrTimeInput value={f.ifrTime} onChange={(v) => set("ifrTime", v)} />
                  </div>
                  <p className={`mt-1 text-xs ${parseHHMM(f.ifrTime) > computedBlock ? "text-rose-600" : "text-slate-500"}`}>
                    {parseHHMM(f.ifrTime) > computedBlock
                      ? `Cannot exceed the flight time ${fmtHHMM(computedBlock)}.`
                      : `The part of the flight flown under IFR; the rest counts as VFR (max ${fmtHHMM(computedBlock) || "—"}).`}
                  </p>
                </div>
              )}
              {isSailplane && (
                <Select label="Launch method" value={f.launchMethod} onChange={(e) => set("launchMethod", e.target.value)}>
                  <option value="">Not recorded</option>
                  <option value="WINCH">Winch</option>
                  <option value="AEROTOW">Aerotow</option>
                  <option value="SELF_LAUNCH">Self-launch</option>
                  <option value="BUNGEE">Bungee</option>
                  <option value="CAR_TOW">Car tow</option>
                </Select>
              )}
              {isBalloon && (
                <Select label="Flight type" value={f.balloonFlightType} onChange={(e) => set("balloonFlightType", e.target.value)}>
                  <option value="">Not recorded</option>
                  <option value="FREE">Free flight</option>
                  <option value="TETHERED">Tethered flight</option>
                </Select>
              )}
              {isBalloon && (
                <Select
                  label="Balloon group"
                  value={f.balloonGroup}
                  onChange={(e) => set("balloonGroup", e.target.value)}
                >
                  <option value="">Unknown</option>
                  <option value="A">Group A (up to 3,400 m³)</option>
                  <option value="B">Group B (3,401 - 6,000 m³)</option>
                  <option value="C">Group C (6,001 - 10,500 m³)</option>
                  <option value="D">Group D (over 10,500 m³)</option>
                </Select>
              )}
            </div>
          </div>
        </div>
        {/* ── Right column: route + times ── */}
        <div className="space-y-5 p-4">
          <div>
            <SubHead
              right={
                <span className="flex items-center gap-1.5 normal-case tracking-normal">
                  <span className="uppercase tracking-wide">Format</span>
                  <select value={timeMode} onChange={(e) => setTimeMode(e.target.value as TimeMode)} className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-xs">
                    <option value="utc">UTC</option>
                    {!isBalloon && <option value="local">Local</option>}
                  </select>
                </span>
              }
            >
              Route &amp; times
            </SubHead>

            <div className="flex items-start gap-1.5">
              <div className="min-w-0 flex-1">
                {isBalloon ? (
                  <Field label="Departure (place)" value={f.departurePlace} onChange={(e) => set("departurePlace", e.target.value)} required />
                ) : (
                  <>
                    <Field label="Departure (ICAO)" mono maxLength={4} placeholder="ICAO" value={f.departurePlace} onChange={(e) => set("departurePlace", e.target.value)} autoCapitalize="characters" autoCorrect="off" spellCheck={false} required />
                    <p className={`mt-1 text-xs ${depName ? "font-medium text-brand-700" : "text-slate-400"}`}>{depName || "Use ZZZZ for no ICAO code."}</p>
                    {dep === "ZZZZ" && (
                      <Field label="Departure place name" value={f.departurePlaceName} onChange={(e) => set("departurePlaceName", e.target.value)} required />
                    )}
                  </>
                )}
              </div>
              {!isBalloon && (
                <div className="shrink-0">
                  {/* Invisible label-height spacer keeps the button top level with the
                      input boxes, so the icon centres on the route pair. */}
                  <span aria-hidden="true" className="mb-1 block text-[11px] opacity-0">{" "}</span>
                  <button
                    type="button"
                    onClick={swapPlaces}
                    aria-label="Swap departure and arrival"
                    title="Swap departure and arrival"
                    className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                  >
                    ⇄
                  </button>
                </div>
              )}
              <div className="min-w-0 flex-1">
                {isBalloon ? (
                  <Field label="Arrival (place)" value={f.arrivalPlace} onChange={(e) => set("arrivalPlace", e.target.value)} required />
                ) : (
                  <>
                    <Field label="Arrival (ICAO)" mono maxLength={4} placeholder="ICAO" value={f.arrivalPlace} onChange={(e) => set("arrivalPlace", e.target.value)} autoCapitalize="characters" autoCorrect="off" spellCheck={false} required />
                    <p className={`mt-1 text-xs ${arrName ? "font-medium text-brand-700" : "text-slate-400"}`}>{arrName || "Use ZZZZ for no ICAO code."}</p>
                    {arr === "ZZZZ" && (
                      <Field label="Arrival place name" value={f.arrivalPlaceName} onChange={(e) => set("arrivalPlaceName", e.target.value)} required />
                    )}
                  </>
                )}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-4">
              <div className="w-32">
                <TimeField label={timeLabels.off} value={f.blockStart} onChange={(v) => set("blockStart", v)} action={<MiniLink onClick={blockOffNow}>Now</MiniLink>} />
              </div>
              <div className="w-32">
                <TimeField
                  label={timeLabels.on}
                  value={f.blockEnd}
                  onChange={(v) => set("blockEnd", v)}
                  action={
                    <span className="flex gap-1.5">
                      <MiniLink onClick={() => blockOnPlus(1)}>+1h</MiniLink>
                      <MiniLink onClick={() => blockOnPlus(2)}>+2h</MiniLink>
                    </span>
                  }
                />
              </div>
            </div>

            {isPowered && f.crewSize > 2 && !isSeries && (
              <div className="mt-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-700">Logged flight time</span>
                  <AttrTimeInput value={f.seriesTime} onChange={(v) => set("seriesTime", v)} />
                </div>
                <p className={`mt-1 text-xs ${seriesExceeds ? "text-rose-600" : "text-slate-500"}`}>
                  {seriesExceeds
                    ? `Cannot exceed the calculated ${fmtHHMM(crewShareLogged)}.`
                    : `Calculated ${fmtHHMM(crewShareLogged) || "—"} for a ${f.crewSize}-pilot crew. Reduce it if you logged less — e.g. a relief pilot who rested.`}
                </p>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{isBalloon ? "Landings & inflations" : "Total landings"}</div>
                <div className="mt-0.5 text-xs text-slate-400">
                  {splitLandings ? "Day / night entered separately (crosses twilight)" : "Day / night calculated automatically"}
                </div>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                {splitLandings ? (
                  <>
                    <NumberStepperField label="Day" value={f.dayLandings} onChange={(v) => set("dayLandings", v)} />
                    <NumberStepperField label="Night" value={f.nightLandings} onChange={(v) => set("nightLandings", v)} />
                  </>
                ) : (
                  <NumberStepperField label="" value={f.landings} onChange={(v) => set("landings", v)} />
                )}
                {isBalloon && (
                  <NumberStepperField label="Inflations" value={f.inflations} onChange={(v) => set("inflations", v)} />
                )}
              </div>
            </div>

            {timeMode === "local" && (
              <p className="mt-2 text-xs text-slate-500">
                Local times are read at the aerodromes and converted to UTC for storage; the export notes the entry was made in local time.
              </p>
            )}

            {/* Total block time: a flat light summary card. */}
            <div className="mt-4 flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{timeLabels.total}</div>
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-2xl font-bold tabular-nums text-slate-800">
                    {computedBlock > 0
                      ? `${String(Math.floor(computedBlock / 60)).padStart(2, "0")}:${String(computedBlock % 60).padStart(2, "0")}`
                      : "--:--"}
                  </span>
                  {computedBlock > 0 && <span className="text-sm text-slate-500">({(computedBlock / 60).toFixed(2)} hrs)</span>}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1 text-right">
                {has("cross_country") && <Pill tone="green">Cross-country (XC)</Pill>}
                {!isBalloon && (dep || arr) && <span className="font-mono text-[11px] text-slate-400">{dep || "—"} → {arr || "—"}</span>}
              </div>
            </div>
          </div>
        </div>
        </div>
        </Panel>

        <AttributesSection
          category={f.category}
          attributes={f.attributes}
          details={f.attrDetails}
          launchMethod={f.launchMethod}
          balloonFlightType={f.balloonFlightType}
          seriesTimeHHMM={f.seriesTime}
          seriesExceeds={seriesExceeds}
          computedBlockMinutes={crewShareLogged}
          onToggleAttr={toggleAttr}
          onSetDetail={setDetail}
          onSetSeries={(v) => set("seriesTime", v)}
          onSetLaunch={(v) => set("launchMethod", v)}
          onSetBalloonType={(v) => set("balloonFlightType", v)}
        />

        <Panel title="Remarks & navigation notes">
          <div className="p-4">
            <input
              value={f.remarks}
              onChange={(e) => set("remarks", e.target.value)}
              placeholder="Any note for this entry — it appears in the logbook export."
              className="block min-h-[2.25rem] w-full appearance-none rounded-md border border-slate-200 bg-white px-2.5 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            />
          </div>
        </Panel>

        {!editing && <RecentEntries entries={recent} />}

        {/* Sticky action bar on mobile so Save is always within reach. The extra
            bottom padding clears the iOS home indicator / browser bar. */}
        <div className="sticky bottom-0 z-10 -mx-4 flex gap-2 border-t border-slate-200 bg-white/95 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.85rem)] shadow-[0_-6px_16px_rgba(15,23,42,0.08)] backdrop-blur sm:hidden">
          <Button
            type="submit"
            disabled={busy || clockBlocked}
            title={clockBlocked ? "Your computer's clock is off by more than 30 minutes. Fix it before saving." : undefined}
            className="flex-1 py-2.5 md:flex-none md:py-2"
          >
            {busy ? "Saving..." : editing ? "Save changes" : "Save entry"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => navigate(editing && editId ? `/entry/${editId}` : "/")} className="py-2.5 md:py-2">Cancel</Button>
        </div>
      </form>
      )}
    </div>
  );
}
