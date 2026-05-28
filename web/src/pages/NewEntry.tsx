import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import * as api from "../api";
import { Button, Card, Field, Select } from "../components/ui";
import { SEVERE_SKEW_MS, useClockSkew } from "../lib/clockSkew";
import { CATEGORY_LABELS } from "../labels";
import { ATTR_SPEC, type AttrCategory, type AttrGroup, type AttrItem, type AttrSubGroup } from "../lib/attributesSpec";
import { SimulatorSession } from "./SimulatorSession";

// The new-entry category chooser: the four flight categories plus the simulator
// session, which has its own form.
const ENTRY_CATEGORIES = ["AEROPLANE", "HELICOPTER", "SAILPLANE", "BALLOON"] as const;

/** A titled card that groups related fields, so the form reads as sections. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      <div className="space-y-4">{children}</div>
    </Card>
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
      className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${
        disabled
          ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
          : active
            ? "border-brand-600 bg-brand-600 text-white"
            : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
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

/** A label that shows its explanatory note on hover (no separate icon needed). */
function HoverLabel({ children, note }: { children: ReactNode; note?: string }) {
  if (!note) return <span>{children}</span>;
  return (
    <span className="group relative inline-flex cursor-help items-center">
      <span className="underline decoration-dotted decoration-slate-400 underline-offset-2">{children}</span>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-0 top-full z-30 mt-1 hidden w-72 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-left text-[12px] font-normal normal-case leading-snug tracking-normal text-slate-100 shadow-lg group-hover:block group-focus-within:block"
      >
        {note}
      </span>
    </span>
  );
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
            className={`px-2.5 text-xs font-semibold ${i > 0 ? "border-l border-slate-400" : ""} ${active ? "bg-sky-700 text-white" : "bg-white text-slate-700 hover:bg-slate-100"}`}
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

interface SelectionLine {
  key: string;
  label: string;
  value?: string;
}

function attrItemValue(
  item: AttrItem,
  details: api.AttributeDetails,
  ctx: { launchMethod: string; balloonFlightType: string; seriesTimeHHMM: string },
): string | undefined {
  const input = item.input;
  if (!input) return undefined;
  if (input.kind === "count") {
    const n = (details as Record<string, unknown>)[input.field] as number | undefined;
    return n && n > 0 ? `× ${n}` : undefined;
  }
  if (input.kind === "time") {
    if (input.entryField) {
      // seriesTimeHHMM is the user-edited HH:MM string
      return ctx.seriesTimeHHMM || undefined;
    }
    const n = (details as Record<string, unknown>)[input.field] as number | undefined;
    return n && n > 0 ? fmtHHMM(n) : undefined;
  }
  if (input.kind === "segment") {
    if (input.entryField) {
      const v = input.field === "launchMethod" ? ctx.launchMethod : "";
      return input.options.find((o) => o.value === v)?.label;
    }
    const v = (details as Record<string, unknown>)[input.field] as string | undefined;
    return v ? input.options.find((o) => o.value === v)?.label : undefined;
  }
  if (input.kind === "text") {
    const v = (details as Record<string, unknown>)[input.field] as string | undefined;
    return v && v.trim() ? `— ${v.trim()}` : undefined;
  }
  return undefined;
}

function selectionForCategory(
  category: string,
  attributes: string[],
  details: api.AttributeDetails,
  ctx: { launchMethod: string; balloonFlightType: string; seriesTimeHHMM: string },
): SelectionLine[] {
  const out: SelectionLine[] = [];
  const isOn = (item: AttrItem) => {
    if (item.entryToggle) {
      const v = item.entryToggle.field === "balloonFlightType" ? ctx.balloonFlightType : "";
      return v === item.entryToggle.whenValue;
    }
    return attributes.includes(item.key);
  };
  for (const g of specForCategory(category)) {
    for (const it of specGroupItems(g)) {
      if (!isOn(it)) continue;
      const val = attrItemValue(it, details, ctx);
      out.push({ key: it.key, label: it.label, ...(val !== undefined ? { value: val } : {}) });
    }
  }
  return out;
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
  const lines = selectionForCategory(p.category, p.attributes, p.details, ctx);

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

  return (
    <div className="space-y-3">
      <h2 className="text-base font-semibold text-slate-800">Attributes &amp; endorsements</h2>

      {/* Your selection panel */}
      <div className="border border-slate-300 bg-white">
        <div className="flex items-baseline justify-between bg-sky-700 px-3.5 py-2 text-white">
          <span className="text-xs font-bold uppercase tracking-wider">Your selection</span>
          <span className="text-[11px] opacity-90">{lines.length === 1 ? "1 item" : `${lines.length} items`}</span>
        </div>
        <div className="px-3.5 py-2.5 text-sm">
          {lines.length === 0 ? (
            <span className="italic text-slate-400">Nothing added yet. Tick from the categories below.</span>
          ) : (
            <ul className="flex flex-wrap gap-x-3 gap-y-1">
              {lines.map((l, i) => (
                <li key={l.key} className="inline-flex items-baseline gap-1">
                  {i > 0 && <span className="text-slate-300">·</span>}
                  <span className="font-semibold text-sky-700">{l.label}</span>
                  {l.value && <span className="text-slate-700">{l.value}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Group accordions */}
      {groups.map((g, gi) => (
        <details key={g.title} open className="group/cat border border-slate-300 bg-white">
          <summary className="flex cursor-pointer list-none items-center gap-2 bg-sky-700 px-3.5 py-2 text-white">
            <span className="inline-block h-[9px] w-[9px] -translate-y-[1px] rotate-[-45deg] border-b-2 border-r-2 border-white transition-transform group-open/cat:translate-y-0 group-open/cat:rotate-45" aria-hidden="true" />
            <span className="text-[13px] font-bold uppercase tracking-wider">{gi + 1}. {g.title}</span>
          </summary>
          <div className="px-3.5 pb-3 pt-2">
            {g.note && <p className="mb-2 text-xs text-slate-600">{g.note}</p>}
            {g.subs ? (
              g.subs.map((sub, si) => (
                <SubGroupBlock
                  key={sub.title}
                  sub={sub}
                  first={si === 0}
                  isOn={isOn}
                  toggle={toggle}
                  ctx={ctx}
                  details={p.details}
                  computedBlockMinutes={p.computedBlockMinutes}
                  seriesExceeds={p.seriesExceeds}
                  onSetDetail={p.onSetDetail}
                  onSetSeries={p.onSetSeries}
                  onSetLaunch={p.onSetLaunch}
                />
              ))
            ) : (
              <ItemsGrid
                items={g.items ?? []}
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
            )}
          </div>
        </details>
      ))}
    </div>
  );
}

function SubGroupBlock({
  sub, first, isOn, toggle, ctx, details, computedBlockMinutes, seriesExceeds, onSetDetail, onSetSeries, onSetLaunch,
}: {
  sub: AttrSubGroup;
  first: boolean;
  isOn: (it: AttrItem) => boolean;
  toggle: (it: AttrItem) => void;
  ctx: { launchMethod: string; balloonFlightType: string; seriesTimeHHMM: string };
  details: api.AttributeDetails;
  computedBlockMinutes: number;
  seriesExceeds: boolean;
  onSetDetail: <K extends keyof api.AttributeDetails>(field: K, value: api.AttributeDetails[K]) => void;
  onSetSeries: (v: string) => void;
  onSetLaunch: (v: string) => void;
}) {
  return (
    <div className={first ? "" : "mt-3 border-t border-slate-200 pt-3"}>
      <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-sky-700">{sub.title}</div>
      <ItemsGrid
        items={sub.items}
        isOn={isOn}
        toggle={toggle}
        details={details}
        ctx={ctx}
        computedBlockMinutes={computedBlockMinutes}
        seriesExceeds={seriesExceeds}
        onSetDetail={onSetDetail}
        onSetSeries={onSetSeries}
        onSetLaunch={onSetLaunch}
      />
    </div>
  );
}

function ItemsGrid({
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
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.key} className="py-1.5">
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isOn(item)}
              onChange={() => toggle(item)}
              className="h-3.5 w-3.5 accent-sky-700"
            />
            <HoverLabel note={item.note}>{item.label}</HoverLabel>
          </label>
          {isOn(item) && item.input && (
            <div className="ml-[22px] mt-1.5 flex flex-wrap items-center gap-2 text-sm">
              {renderInput(item, details, ctx, computedBlockMinutes, seriesExceeds, onSetDetail, onSetSeries, onSetLaunch)}
            </div>
          )}
        </div>
      ))}
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
  primary: "PIC" | "PICUS" | "SPIC" | "CO_PILOT" | "DUAL" | "SAFETY_PILOT";
  instructorPosition?: "PILOT_SEAT" | "JUMP_SEAT" | "SUPERVISING" | "EXAMINER";
};

const POWERED_FUNCTIONS: FnOption[] = [
  { key: "PIC", label: "PIC (pilot in command)", primary: "PIC" },
  { key: "PICUS", label: "PICUS (PIC under supervision)", primary: "PICUS" },
  { key: "SPIC", label: "SPIC (student PIC)", primary: "SPIC" },
  { key: "CO_PILOT", label: "Co-pilot (COPI)", primary: "CO_PILOT" },
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
  departurePlace: "",
  arrivalPlace: "",
  departurePlaceName: "",
  arrivalPlaceName: "",
  pilotFunction: "PIC",
  tookControl: false,
  operatingRole: "",
  flightRules: "VFR",
  launchMethod: "",
  balloonFlightType: "",
  balloonGroup: "",
  inflations: 1,
  seriesTime: "",
  landings: 1,
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
    departurePlace: cols?.departurePlace ?? "",
    arrivalPlace: cols?.arrivalPlace ?? "",
    departurePlaceName: cols?.departurePlaceName ?? "",
    arrivalPlaceName: cols?.arrivalPlaceName ?? "",
    pilotFunction: functionKey(c.function?.primary, c.columns?.instructorPosition),
    tookControl: c.function?.tookControl ?? false,
    operatingRole: cols?.operatingRole ?? "",
    flightRules: (cols?.ifr ?? 0) > 0 ? "IFR" : "VFR",
    launchMethod: cols?.launchMethod ?? "",
    balloonFlightType: cols?.balloonFlightType ?? "",
    balloonGroup: c.aircraft?.balloonGroup ?? "",
    inflations: cols?.inflations ?? 1,
    seriesTime: cols?.flightTimeMinutes ? fmtHHMM(cols.flightTimeMinutes) : "",
    landings: (cols?.dayLandings ?? 0) + (cols?.nightLandings ?? 0),
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
  // Attributes are optional, so the section is collapsed by default to stay out
  // of the way; it opens when the pilot has one to add.

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

  const has = (key: string) => f.attributes.includes(key);
  const isSeries = has("series_of_flights");

  // Calculated flight time from the block times, used as the ceiling for a
  // series of flights (which may only be logged with a reduced time).
  const computedBlock = f.blockStart && f.blockEnd ? blockMinutes(f.date || "1970-01-01", f.blockStart, f.blockEnd) : 0;
  // The entered series time, in minutes; extending beyond the calculated block
  // time is not allowed and is flagged rather than silently clamped.
  const seriesMinutes = parseHHMM(f.seriesTime);
  const seriesExceeds = isSeries && computedBlock > 0 && seriesMinutes > computedBlock;
  // Prefill the editable series time (HH:MM) with the calculated time when it is
  // empty; the pilot may then reduce it.
  useEffect(() => {
    if (isSeries && computedBlock > 0 && parseHHMM(f.seriesTime) === 0) set("seriesTime", fmtHHMM(computedBlock));
  }, [isSeries, computedBlock]);

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
        ? { off: "Departure time", on: "Arrival time", total: "Total flight time" }
        : f.category === "SAILPLANE"
          ? { off: "Flight start", on: "Flight end", total: "Total flight time" }
          : { off: "Block off (start)", on: "Block on (end)", total: "Total block time" };

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
      setError(`The flight time of a series can only be reduced, not extended beyond the calculated ${fmtHHMM(computedBlock)}.`);
      return;
    }
    setBusy(true);
    try {
      const arrivalDate = f.blockEnd > f.blockStart ? f.date : nextDay(f.date);
      const ifr = isPowered && f.flightRules === "IFR" ? blockMinutes(f.date, f.blockStart, f.blockEnd) : 0;
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
        landings: { day: Number(f.landings), night: 0 },
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
        ...(isSeries && seriesMinutes > 0 && seriesMinutes < computedBlock
          ? { flightTimeMinutes: seriesMinutes }
          : {}),
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
        navigate("/");
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
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold">
        {editing ? "Edit flight entry" : simulator ? "New simulator session" : "New entry"}
      </h1>

      <div className="flex flex-wrap gap-2">
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
            label="Simulator session"
            onClick={() => setSimulator(true)}
          />
        )}
      </div>

      {!simulator && categoryMismatch && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
          {reg} must be logged as {indefinite(CATEGORY_LABELS[regAllowed[0]!]!)}{" "}
          {regAllowed.map((c) => CATEGORY_LABELS[c]).join(" or ")}, not {indefinite(CATEGORY_LABELS[f.category]!)}{" "}
          {CATEGORY_LABELS[f.category]}. Choose the highlighted category above.
        </div>
      )}
      {!simulator && !categoryMismatch && aircraftMsg && (
        <div
          className={`rounded-md border px-4 py-3 text-sm font-medium ${
            aircraftNotFound
              ? "border-amber-300 bg-amber-50 text-amber-800"
              : "border-sky-300 bg-sky-50 text-sky-800"
          }`}
        >
          {aircraftMsg}
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
      <form onSubmit={onSubmit} className="space-y-4">
        {editing && (
          <Section title="Change">
            <Field
              label="Reason for change (optional)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              hint="Changes more than 48 hours after the entry are recorded in the change history."
            />
          </Section>
        )}

        <Section title="Aircraft and date">
          <div className="sm:max-w-[14rem]">
            <Field label="Date of flight" type="date" max={today} value={f.date} onChange={(e) => set("date", e.target.value)} required />
          </div>
          <div>
            <Field
              label="Aircraft registration"
              value={f.registration}
              onChange={(e) => set("registration", e.target.value)}
              hint="The type fills in automatically from the registration."
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              required
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Make / model / variant" value={f.makeModelVariant} onChange={(e) => set("makeModelVariant", e.target.value)} required />
            {isPowered && (
              <Select label="Engine" value={f.engineClass} onChange={(e) => set("engineClass", e.target.value)}>
                <option value="SE">Single-engine</option>
                <option value="ME">Multi-engine</option>
              </Select>
            )}
            {isPowered && (
              <label className="flex items-end gap-2 pb-2 text-sm">
                <input type="checkbox" checked={f.multiPilot} onChange={(e) => set("multiPilot", e.target.checked)} />
                Multi-pilot operation
              </label>
            )}
          </div>
        </Section>

        <Section title="Route and times">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              {isBalloon ? (
                <Field label="Departure (place)" value={f.departurePlace} onChange={(e) => set("departurePlace", e.target.value)} required />
              ) : (
                <>
                  <Field label="Departure (ICAO)" value={f.departurePlace} onChange={(e) => set("departurePlace", e.target.value)} hint="Use ZZZZ for a place with no ICAO code." autoCapitalize="characters" autoCorrect="off" spellCheck={false} required />
                  {depName && <p className="mt-1 text-xs text-slate-500">{depName}</p>}
                  {dep === "ZZZZ" && (
                    <Field label="Departure place name" value={f.departurePlaceName} onChange={(e) => set("departurePlaceName", e.target.value)} required />
                  )}
                </>
              )}
            </div>
            <div>
              {isBalloon ? (
                <Field label="Arrival (place)" value={f.arrivalPlace} onChange={(e) => set("arrivalPlace", e.target.value)} required />
              ) : (
                <>
                  <Field label="Arrival (ICAO)" value={f.arrivalPlace} onChange={(e) => set("arrivalPlace", e.target.value)} hint="Use ZZZZ for a place with no ICAO code." autoCapitalize="characters" autoCorrect="off" spellCheck={false} required />
                  {arrName && <p className="mt-1 text-xs text-slate-500">{arrName}</p>}
                  {arr === "ZZZZ" && (
                    <Field label="Arrival place name" value={f.arrivalPlaceName} onChange={(e) => set("arrivalPlaceName", e.target.value)} required />
                  )}
                </>
              )}
            </div>
          </div>

          <div className="rounded-md bg-slate-50 p-3">
            <Select label="Times are entered in" value={timeMode} onChange={(e) => setTimeMode(e.target.value as TimeMode)}>
              <option value="utc">UTC</option>
              {!isBalloon && <option value="local">Local time (at the aerodrome)</option>}
            </Select>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={timeLabels.off} type="time" value={f.blockStart} onChange={(e) => set("blockStart", e.target.value)} required />
              <Field label={timeLabels.on} type="time" value={f.blockEnd} onChange={(e) => set("blockEnd", e.target.value)} required />
            </div>
            <div className="mt-3 flex items-baseline justify-between rounded-md border border-slate-200 bg-white px-3 py-2">
              <span className="text-sm font-medium text-slate-700">{timeLabels.total}</span>
              <span className="font-mono text-base font-semibold tabular-nums text-slate-900">
                {computedBlock > 0
                  ? `${String(Math.floor(computedBlock / 60)).padStart(2, "0")}:${String(computedBlock % 60).padStart(2, "0")}`
                  : "--:--"}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Local times are read at the departure and arrival aerodromes and converted to UTC for storage; the export notes that the entry was made in local time.
            </p>
          </div>
        </Section>

        <Section title="Function">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label={isDual ? "Name of PIC (flight instructor)" : "Name of PIC"}
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
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={f.tookControl} onChange={(e) => set("tookControl", e.target.checked)} />
              I took control (a safety pilot logs time only if they took control)
            </label>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {isPowered && (
              <Select label="Operating role (optional)" value={f.operatingRole} onChange={(e) => set("operatingRole", e.target.value)}>
                <option value="">Not recorded</option>
                <option value="PILOT_FLYING">Pilot flying</option>
                <option value="PILOT_MONITORING">Pilot monitoring</option>
              </Select>
            )}
            {isPowered && (
              <Select label="Flight rules" value={f.flightRules} onChange={(e) => set("flightRules", e.target.value)}>
                <option value="VFR">VFR</option>
                <option value="IFR">IFR</option>
              </Select>
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
        </Section>

        <Section title="Landings and time">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field label="Landings" type="number" min={0} inputMode="numeric" value={f.landings} onChange={(e) => set("landings", Number(e.target.value))} />
            {isBalloon && (
              <Field label="Inflations" type="number" min={0} inputMode="numeric" value={f.inflations} onChange={(e) => set("inflations", Number(e.target.value))} />
            )}
          </div>
          <p className="text-xs text-slate-500">
            Night time, and whether the landings count as day or night, are worked out automatically from the
            aerodrome positions and the block times.
          </p>
        </Section>

        <AttributesSection
          category={f.category}
          attributes={f.attributes}
          details={f.attrDetails}
          launchMethod={f.launchMethod}
          balloonFlightType={f.balloonFlightType}
          seriesTimeHHMM={f.seriesTime}
          seriesExceeds={seriesExceeds}
          computedBlockMinutes={computedBlock}
          onToggleAttr={toggleAttr}
          onSetDetail={setDetail}
          onSetSeries={(v) => set("seriesTime", v)}
          onSetLaunch={(v) => set("launchMethod", v)}
          onSetBalloonType={(v) => set("balloonFlightType", v)}
        />

        <Section title="Remarks">
          <Field label="Remarks" value={f.remarks} onChange={(e) => set("remarks", e.target.value)} />
        </Section>

        {/* Sticky action bar on mobile so Save is always within reach. The extra
            bottom padding clears the iOS home indicator / browser bar. */}
        <div className="sticky bottom-0 z-10 -mx-4 flex gap-2 border-t border-slate-200 bg-white/95 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.85rem)] shadow-[0_-6px_16px_rgba(15,23,42,0.08)] backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:p-0 md:shadow-none md:backdrop-blur-none">
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
