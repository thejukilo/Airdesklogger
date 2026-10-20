import { useState } from "react";
import {
  FIELDS,
  FIELD_MAP,
  FIELD_GROUPS,
  operatorsForField,
  valueKind,
  newCondition,
  type Condition,
  type FieldDef,
  type FilterSpec,
  type Operator,
} from "../lib/logbookFilter";

/**
 * Advanced logbook filter builder. Each row is Field → Operator → Value, with
 * the operator list and value input chosen from the field's data type. All rows
 * combine with AND. The parent owns the FilterSpec and re-derives the visible
 * list (and the export set) from it.
 */

const selectCls =
  "rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-800 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30";
const inputCls = `${selectCls} w-36`;

function emptyValueFor(field: FieldDef, op: Operator): Condition["value"] {
  const kind = valueKind(field, op);
  return kind === "multi" ? [] : kind === "two" ? ["", ""] : "";
}

function ValueInput({
  field,
  cond,
  onValue,
}: {
  field: FieldDef;
  cond: Condition;
  onValue: (v: Condition["value"]) => void;
}) {
  const kind = valueKind(field, cond.op);
  if (kind === "none") return null;

  const single = typeof cond.value === "string" ? cond.value : "";
  const pair = Array.isArray(cond.value) ? cond.value : ["", ""];
  const multi = Array.isArray(cond.value) ? cond.value : [];

  if (kind === "multi" && field.options) {
    return (
      <select
        multiple
        size={Math.min(5, field.options.length)}
        className={`${selectCls} w-56`}
        value={multi}
        onChange={(e) => onValue(Array.from(e.target.selectedOptions).map((o) => o.value))}
      >
        {field.options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    );
  }

  if (kind === "two") {
    const isDate = field.type === "date";
    return (
      <div className="flex items-center gap-1">
        <input
          className={`${inputCls} w-28`}
          type={isDate ? "date" : "text"}
          placeholder={field.type === "duration" ? "hh:mm" : isDate ? "" : "min"}
          value={pair[0] ?? ""}
          onChange={(e) => onValue([e.target.value, pair[1] ?? ""])}
        />
        <span className="text-xs text-slate-400">and</span>
        <input
          className={`${inputCls} w-28`}
          type={isDate ? "date" : "text"}
          placeholder={field.type === "duration" ? "hh:mm" : isDate ? "" : "max"}
          value={pair[1] ?? ""}
          onChange={(e) => onValue([pair[0] ?? "", e.target.value])}
        />
      </div>
    );
  }

  // single
  if (field.type === "enum" || (field.type === "attribute")) {
    return (
      <select className={`${selectCls} w-44`} value={single} onChange={(e) => onValue(e.target.value)}>
        <option value="">Select…</option>
        {(field.options ?? []).map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    );
  }
  if (field.type === "date") {
    if (cond.op === "inLastMonths") {
      return (
        <div className="flex items-center gap-1">
          <input className={`${inputCls} w-20`} type="number" min={1} value={single} onChange={(e) => onValue(e.target.value)} />
          <span className="text-xs text-slate-400">months</span>
        </div>
      );
    }
    return <input className={inputCls} type="date" value={single} onChange={(e) => onValue(e.target.value)} />;
  }
  // text / number / duration
  return (
    <input
      className={inputCls}
      inputMode={field.type === "text" ? undefined : "numeric"}
      placeholder={field.type === "duration" ? "hh:mm" : field.type === "number" ? "number" : ""}
      value={single}
      onChange={(e) => onValue(e.target.value)}
    />
  );
}

function FilterRow({
  cond,
  onChange,
  onRemove,
}: {
  cond: Condition;
  onChange: (next: Condition) => void;
  onRemove: () => void;
}) {
  const field = FIELD_MAP[cond.field] ?? FIELDS[0]!;

  function changeField(key: string) {
    const next = FIELD_MAP[key] ?? FIELDS[0]!;
    const op = operatorsForField(next)[0]!.op;
    onChange({ ...cond, field: key, op, value: emptyValueFor(next, op) });
  }
  function changeOp(op: Operator) {
    onChange({ ...cond, op, value: emptyValueFor(field, op) });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select className={`${selectCls} w-48`} value={cond.field} onChange={(e) => changeField(e.target.value)}>
        {FIELD_GROUPS.map((group) => (
          <optgroup key={group} label={group}>
            {FIELDS.filter((f) => f.group === group).map((f) => (
              <option key={f.key} value={f.key}>{f.label}</option>
            ))}
          </optgroup>
        ))}
      </select>

      <select className={`${selectCls} w-44`} value={cond.op} onChange={(e) => changeOp(e.target.value as Operator)}>
        {operatorsForField(field).map((o) => (
          <option key={o.op} value={o.op}>{o.label}</option>
        ))}
      </select>

      <ValueInput field={field} cond={cond} onValue={(v) => onChange({ ...cond, value: v })} />

      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove filter"
        className="ml-auto rounded-md px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
      >
        ✕
      </button>
    </div>
  );
}

export function FilterBar({
  spec,
  onChange,
  activeCount,
}: {
  spec: FilterSpec;
  onChange: (next: FilterSpec) => void;
  activeCount: number;
}) {
  const [open, setOpen] = useState(spec.conditions.length > 0);

  function setConditions(conditions: Condition[]) {
    onChange({ ...spec, conditions });
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-2 text-sm font-medium text-slate-700"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 5h18M6 12h12M10 19h4" />
          </svg>
          Filters
          {activeCount > 0 && (
            <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-700">{activeCount} active</span>
          )}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`text-slate-400 transition-transform ${open ? "rotate-90" : ""}`}>
            <path d="M9 5l7 7-7 7" />
          </svg>
        </button>
        {spec.conditions.length > 0 && (
          <button type="button" onClick={() => setConditions([])} className="text-xs text-slate-500 underline hover:text-slate-700">
            Clear all
          </button>
        )}
      </div>

      {open && (
        <div className="space-y-2 border-t border-slate-100 px-3 py-3">
          {spec.conditions.length === 0 && (
            <p className="text-sm text-slate-500">No filters. Add one to narrow the logbook and the export.</p>
          )}
          {spec.conditions.map((cond) => (
            <FilterRow
              key={cond.id}
              cond={cond}
              onChange={(next) => setConditions(spec.conditions.map((c) => (c.id === next.id ? next : c)))}
              onRemove={() => setConditions(spec.conditions.filter((c) => c.id !== cond.id))}
            />
          ))}
          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={() => setConditions([...spec.conditions, newCondition()])}
              className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-sm text-slate-700 hover:bg-slate-50"
            >
              <span className="text-base leading-none">+</span> Add filter
            </button>
            {spec.conditions.length > 1 && (
              <span className="text-xs text-slate-400">Matches entries meeting all conditions</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
