import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import * as api from "../api";
import { useAuth } from "../auth";
import { Alert, Button, Card } from "../components/ui";

/**
 * Guided CSV import. Steps the pilot moves through explicitly:
 *   1. Upload — drop in the filled template, say whether times are UTC or local,
 *      how the dates are written, and whether the PIC column uses their name.
 *   2. Review & fix — the server validates every row (no write yet). Each row
 *      with a problem gets inline editors for the exact fields that are wrong
 *      (a dropdown for a missing function, etc.), with an "apply to all" option,
 *      and a Re-check re-validates. The pilot sees the computed total per row.
 *   3. Done — only the valid rows were written; a summary and a link onward.
 *
 * The uploaded CSV is parsed into an editable grid so fixes are applied locally
 * and the corrected grid is exactly what gets imported. Nothing is created until
 * the pilot presses "Import" on the review step.
 */

const TEMPLATE_HEADER =
  "external_id,date,off_block_utc,on_block_utc,departure_icao,arrival_icao,registration,type,engine_class,multi_pilot,category,pic_name,function,day_landings,night_landings,night_minutes,ifr_minutes,instructor_minutes,remarks,attributes";

// The aircraft columns are left blank here on purpose: the importer fills the
// type, engine class, category and multi-pilot from the registration.
const TEMPLATE_ROWS = [
  "LEGACY-000001,2019-04-06,08:15,09:40,LSZH,LSGG,HB-PNT,,,,,SELF,PIC,1,0,0,0,0,VFR nav Zurich to Geneva,",
  "LEGACY-000002,2019-04-13,13:20,14:05,LSGG,LSGG,HB-PNT,,,,,M. Schmidt,DUAL,4,0,0,0,45,PPL circuits,",
  "LEGACY-000003,2020-11-21,17:30,19:10,LSZB,LSZB,HB-KFG,,,,,SELF,PIC,0,3,55,0,0,Night rating,cross_country",
];

const DATE_FORMAT_LABELS: Record<Exclude<api.CsvDateFormat, "auto">, string> = {
  YMD: "YYYY-MM-DD",
  DMY: "DD/MM/YYYY (day first)",
  MDY: "MM/DD/YYYY (month first)",
};

// ---------------------------------------------------------------------------
// Minimal CSV grid (parse + serialize) so problem rows can be edited in place.
// ---------------------------------------------------------------------------
interface Grid {
  headers: string[];
  rows: string[][];
}

function parseGrid(text: string): Grid {
  const matrix: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let started = false;
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const pushField = () => { row.push(field); field = ""; };
  const pushRow = () => { matrix.push(row); row = []; started = false; };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (inQuotes) {
      if (ch === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; started = true; continue; }
    if (ch === ",") { pushField(); started = true; continue; }
    if (ch === "\r") continue;
    if (ch === "\n") { if (started || field.length > 0 || row.length > 0) { pushField(); pushRow(); } continue; }
    field += ch; started = true;
  }
  if (started || field.length > 0 || row.length > 0) { pushField(); pushRow(); }
  const nonEmpty = matrix.filter((r) => r.some((c) => c.trim() !== ""));
  const headers = nonEmpty[0] ?? [];
  return { headers, rows: nonEmpty.slice(1) };
}

function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function toCsv(grid: Grid): string {
  const lines = [grid.headers, ...grid.rows].map((r) => r.map(csvCell).join(","));
  return lines.join("\n") + "\n";
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, "_");
}
function colIndex(grid: Grid, name: string): number {
  return grid.headers.findIndex((h) => normalizeHeader(h) === name);
}

// ---------------------------------------------------------------------------
// Which CSV columns can be fixed inline, and how.
// ---------------------------------------------------------------------------
interface ColumnMeta {
  label: string;
  type: "text" | "select";
  options?: string[];
  /** Placeholder for the blank option of a select (blank = fill from reg). */
  blankLabel?: string;
  placeholder?: string;
}

const COLUMN_META: Record<string, ColumnMeta> = {
  date: { label: "Date", type: "text", placeholder: "YYYY-MM-DD" },
  off_block_utc: { label: "Off-block", type: "text", placeholder: "HH:MM" },
  on_block_utc: { label: "On-block", type: "text", placeholder: "HH:MM" },
  departure_icao: { label: "From (ICAO)", type: "text", placeholder: "LSZH / ZZZZ" },
  arrival_icao: { label: "To (ICAO)", type: "text", placeholder: "LSGG / ZZZZ" },
  registration: { label: "Registration", type: "text" },
  type: { label: "Type", type: "text", placeholder: "(from registration)" },
  engine_class: { label: "Engine class", type: "select", options: ["", "SE", "ME"], blankLabel: "From registration" },
  multi_pilot: { label: "Multi-pilot", type: "select", options: ["", "true", "false"], blankLabel: "From registration" },
  category: { label: "Category", type: "select", options: ["", "AEROPLANE", "HELICOPTER", "SAILPLANE", "BALLOON"], blankLabel: "From registration" },
  pic_name: { label: "PIC name", type: "text", placeholder: "SELF" },
  function: { label: "Function", type: "select", options: ["PIC", "PICUS", "SPIC", "CO_PILOT", "DUAL", "SAFETY_PILOT"] },
  day_landings: { label: "Day landings", type: "text" },
  night_landings: { label: "Night landings", type: "text" },
  night_minutes: { label: "Night (min)", type: "text" },
  ifr_minutes: { label: "IFR (min)", type: "text" },
  instructor_minutes: { label: "Instructor (min)", type: "text" },
  remarks: { label: "Remarks", type: "text" },
  attributes: { label: "Attributes", type: "text" },
};
const EDITABLE = new Set(Object.keys(COLUMN_META));
const APPLY_ALL = new Set(["function", "category", "engine_class", "multi_pilot", "pic_name"]);

/** Turn a server issue's field path into the CSV columns that would fix it. */
function fixableColumns(issues: Array<{ field: string }>): string[] {
  const cols: string[] = [];
  const add = (c: string) => { if (!cols.includes(c)) cols.push(c); };
  for (const { field } of issues) {
    if (EDITABLE.has(field)) add(field);
    else if (field === "aircraft.category") add("category");
    else if (field === "aircraft.registration") ["registration", "type", "engine_class", "category", "multi_pilot"].forEach(add);
    else if (field === "legs.place") { add("departure_icao"); add("arrival_icao"); }
    else if (field === "legs" || field === "entry") { add("date"); add("off_block_utc"); add("on_block_utc"); }
  }
  return cols;
}

function hhmm(m: number | null): string {
  if (m === null || !Number.isFinite(m) || m <= 0) return "—";
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function downloadTemplate() {
  const blob = new Blob([[TEMPLATE_HEADER, ...TEMPLATE_ROWS].join("\n") + "\n"], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "airdesk-logbook-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

type Step = "upload" | "review" | "done";

function StatusBadge({ status }: { status: api.CsvImportRow["status"] }) {
  const map: Record<api.CsvImportRow["status"], string> = {
    ready: "bg-sky-50 text-sky-700",
    created: "bg-emerald-50 text-emerald-700",
    error: "bg-rose-50 text-rose-700",
  };
  const label = status === "ready" ? "Ready" : status === "created" ? "Added" : "Problem";
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${map[status]}`}>{label}</span>;
}

function ResultTable({ rows }: { rows: api.CsvImportRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="px-2 py-2 font-medium">Row</th>
            <th className="px-2 py-2 font-medium">Date</th>
            <th className="px-2 py-2 font-medium">Route</th>
            <th className="px-2 py-2 font-medium">Aircraft</th>
            <th className="px-2 py-2 font-medium">Function</th>
            <th className="px-2 py-2 text-right font-medium">Total</th>
            <th className="px-2 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.line} className="border-b align-top last:border-0">
              <td className="px-2 py-2 tabular-nums text-slate-400">{r.line}</td>
              <td className="px-2 py-2 whitespace-nowrap font-mono">{r.date || "—"}</td>
              <td className="px-2 py-2 whitespace-nowrap font-mono">{r.route}</td>
              <td className="px-2 py-2 whitespace-nowrap">{r.aircraft}</td>
              <td className="px-2 py-2 whitespace-nowrap">{r.function || "—"}</td>
              <td className="px-2 py-2 text-right font-mono tabular-nums">{hhmm(r.totalMinutes)}</td>
              <td className="px-2 py-2"><StatusBadge status={r.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One editable field for a problem row, with an optional "apply to all". */
function CellEditor({
  grid, line, colName, onSet, onApplyAll,
}: {
  grid: Grid;
  line: number;
  colName: string;
  onSet: (line: number, colName: string, value: string) => void;
  onApplyAll: (colName: string, value: string) => void;
}) {
  const idx = colIndex(grid, colName);
  if (idx < 0) return null; // column not present in the file
  const meta = COLUMN_META[colName]!;
  const ri = line - 2;
  const value = grid.rows[ri]?.[idx] ?? "";

  const control = meta.type === "select" ? (
    <select
      value={meta.options!.includes(value) ? value : ""}
      onChange={(e) => onSet(line, colName, e.target.value)}
      className="min-w-[9rem] rounded-md border border-slate-300 bg-white px-2 py-1 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30"
    >
      {!meta.options!.includes(value) && <option value="" disabled hidden>Select…</option>}
      {meta.options!.map((o) => (
        <option key={o} value={o}>{o === "" ? (meta.blankLabel ?? "—") : o}</option>
      ))}
    </select>
  ) : (
    <input
      value={value}
      placeholder={meta.placeholder}
      onChange={(e) => onSet(line, colName, e.target.value)}
      className="min-w-[9rem] rounded-md border border-slate-300 bg-white px-2 py-1 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30"
    />
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-28 text-xs font-medium text-slate-500">{meta.label}</span>
      {control}
      {APPLY_ALL.has(colName) && (
        <button
          type="button"
          onClick={() => onApplyAll(colName, grid.rows[ri]?.[idx] ?? "")}
          className="text-xs text-brand-600 underline hover:text-brand-700"
          title="Set this value on every flight in the file"
        >
          apply to all
        </button>
      )}
    </div>
  );
}

function RowFixer({
  row, grid, onSet, onApplyAll,
}: {
  row: api.CsvImportRow;
  grid: Grid;
  onSet: (line: number, colName: string, value: string) => void;
  onApplyAll: (colName: string, value: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const targeted = fixableColumns(row.issues ?? []);
  const cols = showAll ? Object.keys(COLUMN_META).filter((c) => colIndex(grid, c) >= 0) : targeted;

  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-medium text-slate-700">
          Row {row.line} · {row.date || "?"} · {row.route}
        </div>
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="text-xs text-slate-500 underline hover:text-slate-700"
        >
          {showAll ? "Only the problems" : "Edit all fields"}
        </button>
      </div>
      {row.issues && row.issues.length > 0 && (
        <ul className="mb-2 space-y-0.5">
          {row.issues.map((iss, i) => (
            <li key={i} className="text-xs text-rose-600">
              <span className="font-medium">{iss.field}:</span> {iss.message}
            </li>
          ))}
        </ul>
      )}
      {cols.length > 0 ? (
        <div className="space-y-2">
          {cols.map((c) => (
            <CellEditor key={c} grid={grid} line={row.line} colName={c} onSet={onSet} onApplyAll={onApplyAll} />
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-500">
          This problem can't be fixed inline. Edit the row in your file and upload it again.
        </p>
      )}
    </div>
  );
}

export function ImportLogbook() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("upload");
  const [csv, setCsv] = useState("");
  const [grid, setGrid] = useState<Grid | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [timeZone, setTimeZone] = useState<"UTC" | "LOCAL">("UTC");
  const [dateFormat, setDateFormat] = useState<api.CsvDateFormat>("auto");
  const [selfEnabled, setSelfEnabled] = useState(true);
  const [selfName, setSelfName] = useState(user?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false); // edits made since the last check
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<api.CsvImportResult | null>(null);

  const readyCount = result?.summary.ready ?? 0;
  const errorRows = useMemo(
    () => (result ? result.rows.filter((r) => r.status === "error").sort((a, b) => a.line - b.line) : []),
    [result],
  );
  const tableRows = useMemo(
    () => (result ? [...result.rows].sort((a, b) => (a.status === "error" ? 0 : 1) - (b.status === "error" ? 0 : 1) || a.line - b.line) : []),
    [result],
  );

  function onFile(file: File) {
    setError(null);
    const reader = new FileReader();
    reader.onload = () => { setCsv(String(reader.result ?? "")); setFileName(file.name); setGrid(null); };
    reader.onerror = () => setError("Could not read that file.");
    reader.readAsText(file);
  }

  function callOpts(text: string, commit: boolean) {
    return {
      text,
      opts: {
        timeZone,
        dateFormat,
        selfName: selfEnabled && selfName.trim() ? selfName.trim() : null,
        commit,
      },
    };
  }

  async function runPreview(text: string) {
    setBusy(true);
    setError(null);
    try {
      const { opts } = callOpts(text, false);
      const r = await api.importLogbookCsv(text, opts);
      setResult(r);
      setDirty(false);
      setStep("review");
    } catch (e) {
      setError(e instanceof api.ApiError ? e.message : "Could not check that file.");
    } finally {
      setBusy(false);
    }
  }

  async function check() {
    if (!csv.trim()) { setError("Add a CSV file or paste its contents first."); return; }
    const g = parseGrid(csv);
    if (g.rows.length === 0) { setError("The file has no flights to import."); return; }
    setGrid(g);
    await runPreview(toCsv(g));
  }

  async function commit() {
    if (!grid) return;
    setBusy(true);
    setError(null);
    try {
      const { opts } = callOpts(toCsv(grid), true);
      const r = await api.importLogbookCsv(toCsv(grid), opts);
      setResult(r);
      setStep("done");
    } catch (e) {
      setError(e instanceof api.ApiError ? e.message : "Could not import that file.");
    } finally {
      setBusy(false);
    }
  }

  function setCell(line: number, colName: string, value: string) {
    setGrid((prev) => {
      if (!prev) return prev;
      const idx = colIndex(prev, colName);
      if (idx < 0) return prev;
      const ri = line - 2;
      const rows = prev.rows.map((r, i) => {
        if (i !== ri) return r;
        const next = r.slice();
        while (next.length <= idx) next.push("");
        next[idx] = value;
        return next;
      });
      return { headers: prev.headers, rows };
    });
    setDirty(true);
  }

  function applyToAll(colName: string, value: string) {
    setGrid((prev) => {
      if (!prev) return prev;
      const idx = colIndex(prev, colName);
      if (idx < 0) return prev;
      const rows = prev.rows.map((r) => {
        const next = r.slice();
        while (next.length <= idx) next.push("");
        next[idx] = value;
        return next;
      });
      return { headers: prev.headers, rows };
    });
    setDirty(true);
  }

  function resetAll() {
    setStep("upload"); setCsv(""); setGrid(null); setFileName(null); setResult(null); setDirty(false);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Import a logbook</h1>
        <Link to="/logbook" className="text-sm text-slate-500 hover:text-slate-700">Back to logbook</Link>
      </div>

      {error && <Alert>{error}</Alert>}

      {step === "upload" && (
        <Card>
          <div className="space-y-5">
            <div className="space-y-2 text-sm text-slate-600">
              <p>
                Bringing hours across from another system? Fill in the template, one row per flight, then
                upload it here. Nothing is added to your logbook until you have reviewed it on the next step.
              </p>
              <p>
                You only need the <strong>date</strong>, <strong>times</strong>, <strong>airports</strong>,{" "}
                <strong>registration</strong> and <strong>function</strong>. The aircraft type, engine class
                and category are filled in from the registration. Durations are in <strong>minutes</strong>;
                airports are 4-letter ICAO (use <code className="rounded bg-slate-100 px-1">ZZZZ</code> if there
                is no code). Anything the checker flags can be fixed on the next step.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button variant="ghost" onClick={downloadTemplate}>Download template</Button>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }}
              />
              <Button onClick={() => fileRef.current?.click()}>Choose CSV file</Button>
              {fileName && <span className="text-sm text-slate-500">{fileName}</span>}
            </div>

            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">Or paste the CSV</span>
              <textarea
                value={csv}
                onChange={(e) => { setCsv(e.target.value); setFileName(null); setGrid(null); }}
                rows={6}
                placeholder="date,off_block_utc,on_block_utc,departure_icao,arrival_icao,registration,function,..."
                className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
              />
            </label>

            <div className="grid gap-5 sm:grid-cols-2">
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-slate-700">The times in my file are</legend>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="radio" name="tz" checked={timeZone === "UTC"} onChange={() => setTimeZone("UTC")} />
                  UTC (recommended)
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="radio" name="tz" checked={timeZone === "LOCAL"} onChange={() => setTimeZone("LOCAL")} />
                  Local time at the airport
                </label>
              </fieldset>

              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-700">Date format in my file</span>
                <select
                  value={dateFormat}
                  onChange={(e) => setDateFormat(e.target.value as api.CsvDateFormat)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
                >
                  <option value="auto">Detect automatically</option>
                  <option value="YMD">YYYY-MM-DD</option>
                  <option value="DMY">DD/MM/YYYY (day first)</option>
                  <option value="MDY">MM/DD/YYYY (month first)</option>
                </select>
                <span className="mt-1 block text-xs text-slate-500">
                  We normalise every date to YYYY-MM-DD and show you the result before importing.
                </span>
              </label>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
              <label className="flex items-start gap-2 text-sm text-slate-700">
                <input type="checkbox" className="mt-0.5" checked={selfEnabled} onChange={(e) => setSelfEnabled(e.target.checked)} />
                <span>My own flights list my name in the PIC column. Log those as <strong>myself (SELF)</strong>.</span>
              </label>
              {selfEnabled && (
                <label className="mt-2 block text-sm">
                  <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">My name as written in the file</span>
                  <input
                    value={selfName}
                    onChange={(e) => setSelfName(e.target.value)}
                    placeholder="e.g. your full name"
                    className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
                  />
                  <span className="mt-1 block text-xs text-slate-500">
                    Only rows whose PIC exactly matches this become SELF. Instructor names on your dual flights are left as they are.
                  </span>
                </label>
              )}
            </div>

            <div className="flex justify-end">
              <Button onClick={check} disabled={busy || !csv.trim()}>{busy ? "Checking..." : "Check file"}</Button>
            </div>
          </div>
        </Card>
      )}

      {step === "review" && result && grid && (
        <>
          <Card>
            <div className="space-y-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                <p className="text-slate-700">
                  <strong>{result.summary.total}</strong> flights in the file.{" "}
                  <span className="text-sky-700">{result.summary.ready} ready to import</span>
                  {result.summary.errors > 0 && (<>{" · "}<span className="text-rose-700">{result.summary.errors} with problems</span></>)}.
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Dates read as <strong>{DATE_FORMAT_LABELS[result.dateFormat]}</strong>. Check the Date column below;
                  if a date looks wrong, go back and set the date format explicitly.
                </p>
              </div>
              <ResultTable rows={tableRows} />
              <div className="flex items-center justify-between border-t border-slate-100 pt-3">
                <Button variant="ghost" onClick={() => { setStep("upload"); setResult(null); }} disabled={busy}>Back</Button>
                <div className="flex items-center gap-2">
                  {dirty && <span className="text-xs text-amber-700">Unsaved fixes — re-check to validate.</span>}
                  {(dirty || result.summary.errors > 0) && (
                    <Button variant="ghost" onClick={() => runPreview(toCsv(grid))} disabled={busy}>
                      {busy ? "Checking..." : "Re-check"}
                    </Button>
                  )}
                  <Button onClick={commit} disabled={busy || dirty || readyCount === 0}>
                    {busy ? "Importing..." : `Import ${readyCount} ${readyCount === 1 ? "flight" : "flights"}`}
                  </Button>
                </div>
              </div>
            </div>
          </Card>

          {errorRows.length > 0 && (
            <Card>
              <div className="space-y-3">
                <div>
                  <h2 className="text-base font-semibold">Fix problems ({errorRows.length})</h2>
                  <p className="mt-0.5 text-sm text-slate-600">
                    Set the missing or invalid values below, then <strong>Re-check</strong>. Use “apply to all”
                    to set the same value on every flight (handy when a whole column is missing). Re-importing is
                    safe: a flight already in your logbook is skipped, never duplicated.
                  </p>
                </div>
                <div className="space-y-3">
                  {errorRows.map((r) => (
                    <RowFixer key={r.line} row={r} grid={grid} onSet={setCell} onApplyAll={applyToAll} />
                  ))}
                </div>
                <div className="flex justify-end border-t border-slate-100 pt-3">
                  <Button onClick={() => runPreview(toCsv(grid))} disabled={busy}>
                    {busy ? "Checking..." : "Re-check"}
                  </Button>
                </div>
              </div>
            </Card>
          )}
        </>
      )}

      {step === "done" && result && (
        <Card>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12l4 4L19 7" />
                </svg>
              </div>
              <div>
                <h2 className="text-lg font-semibold">Import complete</h2>
                <p className="text-sm text-slate-600">
                  {result.summary.created} {result.summary.created === 1 ? "flight" : "flights"} added to your logbook
                  {result.summary.errors > 0 && `, ${result.summary.errors} skipped`}.
                </p>
              </div>
            </div>
            {result.summary.errors > 0 && (
              <>
                <p className="text-sm text-slate-600">These rows were not imported. Go back to fix them, or edit your file and import again.</p>
                <ResultTable rows={result.rows.filter((r) => r.status === "error")} />
              </>
            )}
            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
              <Button variant="ghost" onClick={resetAll}>Import another file</Button>
              <Button onClick={() => navigate("/logbook")}>Go to logbook</Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
