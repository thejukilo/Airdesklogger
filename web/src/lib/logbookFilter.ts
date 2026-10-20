/**
 * Logbook filter engine.
 *
 * A single field catalog + one pure evaluator drives both the FilterBar UI
 * (which operators and inputs to show) and the actual filtering of entries.
 * Keeping it pure (no React, type-only import of EntryRow) makes it unit
 * testable and lets the Logbook page reuse the matched set for export.
 *
 * All conditions combine with AND. A condition with no (or an unparseable)
 * value is treated as inactive and does not narrow the list, so typing a
 * filter never surprises the pilot with an empty table mid-keystroke.
 */

import type { EntryRow } from "../api";
import { ATTRIBUTE_LABELS, CATEGORY_LABELS, FUNCTION_LABELS, OPERATING_ROLE_LABELS } from "../labels";

export type FieldType = "text" | "duration" | "number" | "date" | "enum" | "boolean" | "attribute";

export type Operator =
  | "contains" | "notContains" | "eq" | "neq" | "startsWith" | "endsWith" | "isEmpty" | "isNotEmpty"
  | "gt" | "gte" | "lt" | "lte" | "between"
  | "before" | "after" | "on" | "inLastMonths"
  | "is" | "isNot" | "isAnyOf" | "isNoneOf"
  | "isTrue" | "isFalse"
  | "has" | "notHas" | "hasAnyOf" | "hasAllOf";

/** How many value inputs an operator needs. */
export type ValueKind = "none" | "single" | "two" | "multi";

export interface OperatorDef {
  op: Operator;
  label: string;
  valueKind: ValueKind;
}

function numericOperators(): OperatorDef[] {
  return [
    { op: "eq", label: "=", valueKind: "single" },
    { op: "neq", label: "≠", valueKind: "single" },
    { op: "gt", label: "greater than", valueKind: "single" },
    { op: "gte", label: "≥", valueKind: "single" },
    { op: "lt", label: "less than", valueKind: "single" },
    { op: "lte", label: "≤", valueKind: "single" },
    { op: "between", label: "between", valueKind: "two" },
  ];
}

export const OPERATORS_BY_TYPE: Record<FieldType, OperatorDef[]> = {
  text: [
    { op: "contains", label: "contains", valueKind: "single" },
    { op: "notContains", label: "does not contain", valueKind: "single" },
    { op: "eq", label: "is", valueKind: "single" },
    { op: "neq", label: "is not", valueKind: "single" },
    { op: "startsWith", label: "starts with", valueKind: "single" },
    { op: "endsWith", label: "ends with", valueKind: "single" },
    { op: "isEmpty", label: "is empty", valueKind: "none" },
    { op: "isNotEmpty", label: "is not empty", valueKind: "none" },
  ],
  duration: numericOperators(),
  number: numericOperators(),
  date: [
    { op: "on", label: "on", valueKind: "single" },
    { op: "before", label: "before", valueKind: "single" },
    { op: "after", label: "after", valueKind: "single" },
    { op: "between", label: "between", valueKind: "two" },
    { op: "inLastMonths", label: "in the last (months)", valueKind: "single" },
  ],
  enum: [
    { op: "is", label: "is", valueKind: "single" },
    { op: "isNot", label: "is not", valueKind: "single" },
    { op: "isAnyOf", label: "is any of", valueKind: "multi" },
    { op: "isNoneOf", label: "is none of", valueKind: "multi" },
  ],
  boolean: [
    { op: "isTrue", label: "is yes", valueKind: "none" },
    { op: "isFalse", label: "is no", valueKind: "none" },
  ],
  attribute: [
    { op: "has", label: "has", valueKind: "single" },
    { op: "notHas", label: "does not have", valueKind: "single" },
    { op: "hasAnyOf", label: "has any of", valueKind: "multi" },
    { op: "hasAllOf", label: "has all of", valueKind: "multi" },
  ],
};

export interface Option {
  value: string;
  label: string;
}

export interface FieldDef {
  key: string;
  label: string;
  group: string;
  type: FieldType;
  /** For enum / attribute fields: the selectable values. */
  options?: Option[];
  /** Extract the comparable value from an entry row. */
  get: (row: EntryRow) => unknown;
}

const optionsFrom = (labels: Record<string, string>): Option[] =>
  Object.entries(labels).map(([value, label]) => ({ value, label }));

const ATTRIBUTE_OPTIONS: Option[] = Object.entries(ATTRIBUTE_LABELS)
  .map(([value, label]) => ({ value, label }))
  .sort((a, b) => a.label.localeCompare(b.label));

const KIND_OPTIONS: Option[] = [
  { value: "FLIGHT", label: "Flight" },
  { value: "FSTD", label: "Simulator (FSTD)" },
];

/** Minutes for a time field; absent values count as 0. */
const minutes = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** The full filterable field catalog. */
export const FIELDS: FieldDef[] = [
  // Flight
  { key: "date", label: "Date", group: "Flight", type: "date", get: (r) => r.content.columns?.date ?? "" },
  { key: "kind", label: "Kind", group: "Flight", type: "enum", options: KIND_OPTIONS, get: (r) => (r.content.columns?.fstd ? "FSTD" : "FLIGHT") },
  { key: "registration", label: "Aircraft registration", group: "Flight", type: "text", get: (r) => r.content.aircraft?.registration ?? "" },
  { key: "aircraftType", label: "Aircraft type", group: "Flight", type: "text", get: (r) => r.content.aircraft?.makeModelVariant ?? r.content.columns?.fstd?.deviceType ?? "" },
  { key: "category", label: "Category", group: "Flight", type: "enum", options: optionsFrom(CATEGORY_LABELS), get: (r) => (r.content.columns?.fstd ? "" : (r.content.columns?.category ?? "AEROPLANE")) },
  { key: "departure", label: "Departure place", group: "Flight", type: "text", get: (r) => r.content.columns?.departurePlace ?? "" },
  { key: "arrival", label: "Arrival place", group: "Flight", type: "text", get: (r) => r.content.columns?.arrivalPlace ?? "" },
  { key: "picName", label: "PIC name", group: "Flight", type: "text", get: (r) => r.content.picName ?? "" },
  { key: "remarks", label: "Remarks", group: "Flight", type: "text", get: (r) => r.content.remarks ?? "" },

  // Times (minutes, entered as hh:mm)
  { key: "total", label: "Total time", group: "Times", type: "duration", get: (r) => (r.content.columns?.fstd ? minutes(r.content.columns.fstd.totalMinutes) : minutes(r.content.columns?.total)) },
  { key: "singleEngine", label: "Single-engine", group: "Times", type: "duration", get: (r) => minutes(r.content.columns?.singleEngine) },
  { key: "multiEngine", label: "Multi-engine", group: "Times", type: "duration", get: (r) => minutes(r.content.columns?.multiEngine) },
  { key: "multiPilot", label: "Multi-pilot", group: "Times", type: "duration", get: (r) => minutes(r.content.columns?.multiPilot) },
  { key: "night", label: "Night", group: "Times", type: "duration", get: (r) => minutes(r.content.columns?.night) },
  { key: "ifr", label: "IFR", group: "Times", type: "duration", get: (r) => minutes(r.content.columns?.ifr) },
  { key: "pic", label: "PIC time", group: "Times", type: "duration", get: (r) => minutes(r.content.columns?.pic) },
  { key: "coPilot", label: "Co-pilot time", group: "Times", type: "duration", get: (r) => minutes(r.content.columns?.coPilot) },
  { key: "dual", label: "Dual time", group: "Times", type: "duration", get: (r) => minutes(r.content.columns?.dual) },
  { key: "instructor", label: "Instructor time", group: "Times", type: "duration", get: (r) => minutes(r.content.columns?.instructor) },

  // Landings & crew
  { key: "dayLandings", label: "Day landings", group: "Landings & crew", type: "number", get: (r) => minutes(r.content.columns?.dayLandings) },
  { key: "nightLandings", label: "Night landings", group: "Landings & crew", type: "number", get: (r) => minutes(r.content.columns?.nightLandings) },
  { key: "crewSize", label: "Operating crew size", group: "Landings & crew", type: "number", get: (r) => minutes(r.content.columns?.crewSize) },

  // Function & role
  { key: "function", label: "Pilot function", group: "Function & role", type: "enum", options: optionsFrom(FUNCTION_LABELS), get: (r) => r.content.function?.primary ?? "" },
  { key: "operatingRole", label: "Operating role", group: "Function & role", type: "enum", options: optionsFrom(OPERATING_ROLE_LABELS), get: (r) => r.content.columns?.operatingRole ?? "" },

  // Status
  { key: "signed", label: "Signed", group: "Status", type: "boolean", get: (r) => r.locked },
  { key: "signatureMissing", label: "Signature missing", group: "Status", type: "boolean", get: (r) => Boolean(r.content.columns?.signatureRequired) && !r.locked },
  { key: "localTime", label: "Local-time entry", group: "Status", type: "boolean", get: (r) => Boolean(r.content.columns?.timesLocal || r.content.columns?.enteredInLocalTime) },
  { key: "imported", label: "Imported", group: "Status", type: "boolean", get: (r) => Boolean(r.import_source) },

  // Attributes
  { key: "attribute", label: "Attribute", group: "Attributes", type: "attribute", options: ATTRIBUTE_OPTIONS, get: (r) => r.content.columns?.attributes ?? [] },
];

export const FIELD_MAP: Record<string, FieldDef> = Object.fromEntries(FIELDS.map((f) => [f.key, f]));

export const FIELD_GROUPS: string[] = FIELDS.reduce<string[]>((groups, f) => {
  if (!groups.includes(f.group)) groups.push(f.group);
  return groups;
}, []);

export interface Condition {
  id: string;
  field: string;
  op: Operator;
  /** string for single-value ops; string[] for `two` (length 2) and `multi`. */
  value?: string | string[];
}

export interface FilterSpec {
  match: "AND";
  conditions: Condition[];
}

export function operatorsForField(field: FieldDef): OperatorDef[] {
  return OPERATORS_BY_TYPE[field.type];
}

export function valueKind(field: FieldDef, op: Operator): ValueKind {
  return operatorsForField(field).find((o) => o.op === op)?.valueKind ?? "single";
}

let counter = 0;
export function newCondition(field: FieldDef = FIELDS[0]!): Condition {
  const op = operatorsForField(field)[0]!.op;
  const kind = valueKind(field, op);
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `c${++counter}`;
  return { id, field: field.key, op, value: kind === "multi" ? [] : kind === "two" ? ["", ""] : "" };
}

/** hh:mm or plain minutes → minutes; null when unparseable. */
export function parseDuration(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  if (s.includes(":")) {
    const m = /^(\d{1,3}):([0-5]?\d)$/.exec(s);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseNumber(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function asString(v: Condition["value"]): string {
  return typeof v === "string" ? v : "";
}
function asArray(v: Condition["value"]): string[] {
  return Array.isArray(v) ? v : [];
}

/**
 * Whether a condition is complete enough to actually filter. Incomplete or
 * unparseable conditions are ignored rather than matching nothing.
 */
export function isActive(cond: Condition, field: FieldDef): boolean {
  const kind = valueKind(field, cond.op);
  if (kind === "none") return true;
  if (kind === "multi") return asArray(cond.value).length > 0;
  const parseNum = field.type === "duration" ? parseDuration : parseNumber;
  if (kind === "two") {
    const [a, b] = asArray(cond.value);
    if (!a || !b) return false;
    if (field.type === "duration" || field.type === "number") return parseNum(a) !== null && parseNum(b) !== null;
    return true; // date range
  }
  const s = asString(cond.value);
  if (!s) return false;
  if (field.type === "duration" || field.type === "number" || cond.op === "inLastMonths") {
    return (cond.op === "inLastMonths" ? parseNumber(s) : parseNum(s)) !== null;
  }
  return true;
}

function evalText(value: string, op: Operator, cv: string): boolean {
  const v = value.toLowerCase();
  const q = cv.toLowerCase();
  switch (op) {
    case "contains": return v.includes(q);
    case "notContains": return !v.includes(q);
    case "eq": return v === q;
    case "neq": return v !== q;
    case "startsWith": return v.startsWith(q);
    case "endsWith": return v.endsWith(q);
    case "isEmpty": return value.trim() === "";
    case "isNotEmpty": return value.trim() !== "";
    default: return false;
  }
}

function evalNumber(value: number, op: Operator, cond: Condition, duration: boolean): boolean {
  const parse = duration ? parseDuration : parseNumber;
  if (op === "between") {
    const [a, b] = asArray(cond.value);
    const lo = parse(a ?? "");
    const hi = parse(b ?? "");
    if (lo === null || hi === null) return true; // incomplete → inactive
    return value >= Math.min(lo, hi) && value <= Math.max(lo, hi);
  }
  const target = parse(asString(cond.value));
  if (target === null) return true;
  switch (op) {
    case "eq": return value === target;
    case "neq": return value !== target;
    case "gt": return value > target;
    case "gte": return value >= target;
    case "lt": return value < target;
    case "lte": return value <= target;
    default: return false;
  }
}

/** Subtract n months from a yyyy-mm-dd date; returns yyyy-mm-dd. */
export function monthsAgo(n: number, today = new Date()): string {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - n, today.getUTCDate()));
  return d.toISOString().slice(0, 10);
}

function evalDate(value: string, op: Operator, cond: Condition): boolean {
  if (op === "between") {
    const [a, b] = asArray(cond.value);
    if (!a || !b) return true;
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    return value >= lo && value <= hi;
  }
  if (op === "inLastMonths") {
    const n = parseNumber(asString(cond.value));
    if (n === null) return true;
    return value >= monthsAgo(n);
  }
  const cv = asString(cond.value);
  switch (op) {
    case "on": return value === cv;
    case "before": return value < cv;
    case "after": return value > cv;
    default: return false;
  }
}

function evalEnum(value: string, op: Operator, cond: Condition): boolean {
  switch (op) {
    case "is": return value === asString(cond.value);
    case "isNot": return value !== asString(cond.value);
    case "isAnyOf": return asArray(cond.value).includes(value);
    case "isNoneOf": return !asArray(cond.value).includes(value);
    default: return false;
  }
}

function evalBoolean(value: boolean, op: Operator): boolean {
  if (op === "isTrue") return value === true;
  if (op === "isFalse") return value === false;
  return false;
}

function evalAttribute(values: string[], op: Operator, cond: Condition): boolean {
  switch (op) {
    case "has": return values.includes(asString(cond.value));
    case "notHas": return !values.includes(asString(cond.value));
    case "hasAnyOf": return asArray(cond.value).some((a) => values.includes(a));
    case "hasAllOf": return asArray(cond.value).every((a) => values.includes(a));
    default: return false;
  }
}

/** Evaluate one (already active) condition against a row. */
export function evaluateCondition(row: EntryRow, cond: Condition, field: FieldDef): boolean {
  const raw = field.get(row);
  switch (field.type) {
    case "text": return evalText(String(raw ?? ""), cond.op, asString(cond.value));
    case "duration": return evalNumber(minutes(raw), cond.op, cond, true);
    case "number": return evalNumber(minutes(raw), cond.op, cond, false);
    case "date": return evalDate(String(raw ?? ""), cond.op, cond);
    case "enum": return evalEnum(String(raw ?? ""), cond.op, cond);
    case "boolean": return evalBoolean(Boolean(raw), cond.op);
    case "attribute": return evalAttribute(Array.isArray(raw) ? (raw as string[]) : [], cond.op, cond);
    default: return true;
  }
}

/** True when a row satisfies every active condition (AND). */
export function matchesFilter(row: EntryRow, spec: FilterSpec, fields: Record<string, FieldDef> = FIELD_MAP): boolean {
  for (const cond of spec.conditions) {
    const field = fields[cond.field];
    if (!field || !isActive(cond, field)) continue;
    if (!evaluateCondition(row, cond, field)) return false;
  }
  return true;
}

/** How many conditions are actually filtering (for the "N active" badge). */
export function activeCount(spec: FilterSpec, fields: Record<string, FieldDef> = FIELD_MAP): number {
  return spec.conditions.filter((c) => fields[c.field] && isActive(c, fields[c.field]!)).length;
}
