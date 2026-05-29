import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import * as api from "../api";
import { useAuth } from "../auth";
import { Alert, Card } from "../components/ui";

/**
 * Pilot's home screen. Three things, in this order: a glance at what they've
 * logged (total time, landings, flights, last-90-days time), three big quick
 * actions (log a flight, generate the PDF, jump to the logbook), and a
 * five-row recent-flights preview. Everything is derived client-side from the
 * same listEntries call the logbook uses, so the dashboard has no extra
 * server cost.
 */
export function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [entries, setEntries] = useState<api.EntryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    api
      .listEntries()
      .then((r) => setEntries(r.entries))
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load your logbook."))
      .finally(() => setLoading(false));
  }, []);

  const stats = useMemo(() => computeStats(entries), [entries]);
  const recent = useMemo(() => entries.slice(0, 5), [entries]);

  async function exportPdf() {
    setExporting(true);
    setError(null);
    try {
      const blob = await api.exportLogbookPdf();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "logbook.pdf";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not generate the export.");
    } finally {
      setExporting(false);
    }
  }

  const firstName = (user?.name ?? "").split(" ")[0] ?? "";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          {firstName ? `Welcome back, ${firstName}` : "Welcome back"}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {loading ? "Loading your logbook..." : `${entries.length} flight${entries.length === 1 ? "" : "s"} on file.`}
        </p>
      </div>

      {error && <Alert>{error}</Alert>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Total flight time" value={hhmm(stats.totalMinutes)} sublabel={`across ${stats.totalFlights} flight${stats.totalFlights === 1 ? "" : "s"}`} />
        <StatCard label="Landings" value={String(stats.totalLandings)} sublabel={`${stats.dayLandings} day · ${stats.nightLandings} night`} />
        <StatCard label="Last 90 days" value={hhmm(stats.last90Minutes)} sublabel={`${stats.last90Flights} flight${stats.last90Flights === 1 ? "" : "s"}`} />
        <StatCard label="PIC time" value={hhmm(stats.picMinutes)} sublabel={stats.instructorMinutes > 0 ? `${hhmm(stats.instructorMinutes)} instructor` : "all-time"} />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <ActionTile
          onClick={() => navigate("/new")}
          icon={<PencilIcon />}
          title="Log a flight"
          subtitle="Record a new entry in your logbook"
          accent="brand"
        />
        <ActionTile
          onClick={exportPdf}
          icon={<DocumentIcon />}
          title={exporting ? "Generating..." : "Generate logbook PDF"}
          subtitle="FOCA-format export with audit appendix"
          disabled={exporting || loading}
          accent="emerald"
        />
        <ActionTile
          onClick={() => navigate("/logbook")}
          icon={<TableIcon />}
          title="Open logbook"
          subtitle="Search, filter, sign off, edit"
          accent="slate"
        />
      </div>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-medium">Recent flights</h2>
          <Link to="/logbook" className="text-sm text-brand-700 hover:underline">View all →</Link>
        </div>
        {loading ? (
          <p className="text-sm text-slate-500">Loading...</p>
        ) : recent.length === 0 ? (
          <p className="text-sm italic text-slate-400">
            No flights yet. <Link to="/new" className="text-brand-700 hover:underline">Log your first flight</Link>.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {recent.map((e) => {
              const c = e.content.columns;
              const isFstd = Boolean(c?.fstd);
              return (
                <li key={e.id}>
                  <Link
                    to={`/entry/${e.id}`}
                    className="flex items-center justify-between gap-4 py-2.5 hover:bg-slate-50 -mx-2 px-2 rounded"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="hidden text-sm text-slate-500 tabular-nums sm:inline">{c?.date}</span>
                      <span className="truncate text-sm font-medium text-slate-700">
                        {isFstd ? `FSTD ${c?.fstd?.deviceType}` : e.content.aircraft?.registration}
                      </span>
                      <span className="hidden truncate text-sm text-slate-500 md:inline">
                        {c?.departurePlace} → {c?.arrivalPlace}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 flex-none">
                      <span className="text-sm tabular-nums text-slate-700">
                        {hhmm(isFstd ? c?.fstd?.totalMinutes : c?.total)}
                      </span>
                      {e.locked ? (
                        <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">Signed</span>
                      ) : c?.signatureRequired ? (
                        <span className="rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-800">Sig missing</span>
                      ) : null}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

interface Stats {
  totalMinutes: number;
  totalLandings: number;
  dayLandings: number;
  nightLandings: number;
  totalFlights: number;
  last90Minutes: number;
  last90Flights: number;
  picMinutes: number;
  instructorMinutes: number;
}

function computeStats(entries: api.EntryRow[]): Stats {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - 90);
  const cutoffIso = cutoff.toISOString().slice(0, 10);
  const s: Stats = {
    totalMinutes: 0, totalLandings: 0, dayLandings: 0, nightLandings: 0,
    totalFlights: 0, last90Minutes: 0, last90Flights: 0, picMinutes: 0, instructorMinutes: 0,
  };
  for (const e of entries) {
    const c = e.content.columns;
    const fstdMins = Number(c?.fstd?.totalMinutes ?? 0);
    const flightMins = Number(c?.total ?? 0);
    const mins = fstdMins + flightMins;
    s.totalMinutes += mins;
    s.totalFlights += 1;
    s.dayLandings += Number(c?.dayLandings ?? 0);
    s.nightLandings += Number(c?.nightLandings ?? 0);
    s.picMinutes += Number(c?.pic ?? 0);
    s.instructorMinutes += Number(c?.instructor ?? 0);
    if (c?.date && c.date >= cutoffIso) {
      s.last90Minutes += mins;
      s.last90Flights += 1;
    }
  }
  s.totalLandings = s.dayLandings + s.nightLandings;
  return s;
}

function hhmm(m: unknown): string {
  const n = Number(m ?? 0);
  if (!Number.isFinite(n) || n <= 0) return "0:00";
  return `${Math.floor(n / 60)}:${String(Math.round(n) % 60).padStart(2, "0")}`;
}

function StatCard({ label, value, sublabel }: { label: string; value: string; sublabel?: string }) {
  return (
    <Card>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-ink">{value}</div>
      {sublabel && <div className="mt-0.5 text-xs text-slate-500">{sublabel}</div>}
    </Card>
  );
}

const ACCENT: Record<string, string> = {
  brand: "bg-brand-600 hover:bg-brand-700 text-white",
  emerald: "bg-emerald-600 hover:bg-emerald-700 text-white",
  slate: "bg-slate-700 hover:bg-slate-800 text-white",
};

function ActionTile({
  onClick,
  icon,
  title,
  subtitle,
  accent,
  disabled,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  accent: keyof typeof ACCENT;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`group flex items-center gap-3 rounded-lg p-4 text-left shadow-sm transition disabled:opacity-50 disabled:cursor-not-allowed ${ACCENT[accent]}`}
    >
      <span className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-white/20">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block font-medium">{title}</span>
        <span className="block text-xs opacity-90">{subtitle}</span>
      </span>
    </button>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}
function DocumentIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z" />
      <path d="M14 3v6h6" />
      <path d="M8 13h8M8 17h5" />
    </svg>
  );
}
function TableIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 10h18M9 4v16" />
    </svg>
  );
}

// Keep the export available for places that re-export Dashboard if needed later.
export default Dashboard;
