import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import * as api from "../api";
import { useAuth } from "../auth";
import { Alert, Button, Card } from "../components/ui";

/**
 * Guided CSV import. Three steps the pilot moves through explicitly:
 *   1. Upload — drop in the filled template, say whether times are UTC or local,
 *      how the dates are written, and whether the PIC column uses their own name.
 *   2. Review — the server validates every row (no write yet); the pilot sees a
 *      per-row table with the computed total and any errors, so they confirm
 *      exactly what will be added.
 *   3. Done — only the valid rows were written; a summary and a link onward.
 *
 * Nothing is created until the pilot presses "Import" on the review step.
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
              <td className="px-2 py-2">
                <StatusBadge status={r.status} />
                {r.issues && r.issues.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {r.issues.map((iss, i) => (
                      <li key={i} className="text-xs text-rose-600">
                        <span className="font-medium">{iss.field}:</span> {iss.message}
                      </li>
                    ))}
                  </ul>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ImportLogbook() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("upload");
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [timeZone, setTimeZone] = useState<"UTC" | "LOCAL">("UTC");
  const [dateFormat, setDateFormat] = useState<api.CsvDateFormat>("auto");
  const [selfEnabled, setSelfEnabled] = useState(true);
  const [selfName, setSelfName] = useState(user?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<api.CsvImportResult | null>(null);

  const readyCount = result?.summary.ready ?? 0;
  const sortedRows = useMemo(() => {
    if (!result) return [];
    // Surface problem rows first on the review step so they are hard to miss.
    const rank = (s: api.CsvImportRow["status"]) => (s === "error" ? 0 : 1);
    return [...result.rows].sort((a, b) => rank(a.status) - rank(b.status) || a.line - b.line);
  }, [result]);

  function onFile(file: File) {
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      setCsv(String(reader.result ?? ""));
      setFileName(file.name);
    };
    reader.onerror = () => setError("Could not read that file.");
    reader.readAsText(file);
  }

  function callOpts(commit: boolean) {
    return {
      timeZone,
      dateFormat,
      selfName: selfEnabled && selfName.trim() ? selfName.trim() : null,
      commit,
    };
  }

  async function preview() {
    if (!csv.trim()) {
      setError("Add a CSV file or paste its contents first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api.importLogbookCsv(csv, callOpts(false));
      setResult(r);
      setStep("review");
    } catch (e) {
      setError(e instanceof api.ApiError ? e.message : "Could not check that file.");
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.importLogbookCsv(csv, callOpts(true));
      setResult(r);
      setStep("done");
    } catch (e) {
      setError(e instanceof api.ApiError ? e.message : "Could not import that file.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Import a logbook</h1>
        <Link to="/logbook" className="text-sm text-slate-500 hover:text-slate-700">
          Back to logbook
        </Link>
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
                is no code).
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button variant="ghost" onClick={downloadTemplate}>Download template</Button>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onFile(f);
                  e.target.value = "";
                }}
              />
              <Button onClick={() => fileRef.current?.click()}>Choose CSV file</Button>
              {fileName && <span className="text-sm text-slate-500">{fileName}</span>}
            </div>

            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">Or paste the CSV</span>
              <textarea
                value={csv}
                onChange={(e) => { setCsv(e.target.value); setFileName(null); }}
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
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={selfEnabled}
                  onChange={(e) => setSelfEnabled(e.target.checked)}
                />
                <span>
                  My own flights list my name in the PIC column. Log those as <strong>myself (SELF)</strong>.
                </span>
              </label>
              {selfEnabled && (
                <label className="mt-2 block text-sm">
                  <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                    My name as written in the file
                  </span>
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
              <Button onClick={preview} disabled={busy || !csv.trim()}>
                {busy ? "Checking..." : "Check file"}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {step === "review" && result && (
        <Card>
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
              <p className="text-slate-700">
                <strong>{result.summary.total}</strong> flights in the file.{" "}
                <span className="text-sky-700">{result.summary.ready} ready to import</span>
                {result.summary.errors > 0 && (
                  <>
                    {" · "}
                    <span className="text-rose-700">{result.summary.errors} with problems (will be skipped)</span>
                  </>
                )}
                .
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Dates read as <strong>{DATE_FORMAT_LABELS[result.dateFormat]}</strong>. Check the Date column below;
                if a date looks wrong, go back and set the date format explicitly.
              </p>
              {result.summary.errors > 0 && (
                <p className="mt-1 text-xs text-slate-500">
                  Fix the flagged rows in your file and import them in a second pass. Re-importing is safe:
                  a flight that clashes with one already in your logbook is skipped, never duplicated.
                </p>
              )}
            </div>

            <ResultTable rows={sortedRows} />

            <div className="flex items-center justify-between border-t border-slate-100 pt-3">
              <Button variant="ghost" onClick={() => { setStep("upload"); setResult(null); }} disabled={busy}>
                Back
              </Button>
              <Button onClick={commit} disabled={busy || readyCount === 0}>
                {busy ? "Importing..." : `Import ${readyCount} ${readyCount === 1 ? "flight" : "flights"}`}
              </Button>
            </div>
          </div>
        </Card>
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
                <p className="text-sm text-slate-600">
                  These rows were not imported. Fix them in your file and run the import again.
                </p>
                <ResultTable rows={sortedRows.filter((r) => r.status === "error")} />
              </>
            )}

            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
              <Button variant="ghost" onClick={() => { setStep("upload"); setCsv(""); setFileName(null); setResult(null); }}>
                Import another file
              </Button>
              <Button onClick={() => navigate("/logbook")}>Go to logbook</Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
