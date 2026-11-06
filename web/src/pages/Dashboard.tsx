import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import * as api from "../api";
import { useAuth } from "../auth";
import { Alert, Panel, Pill } from "../components/ui";

/**
 * Pilot's home screen. Three things, in this order: a glance at what they've
 * logged (total time, landings, flights, last-90-days time), three quick
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
      await api.presentLogbookPdf();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not generate the export.");
    } finally {
      setExporting(false);
    }
  }

  const firstName = (user?.name ?? "").split(" ")[0] ?? "";

  // The four at-a-glance figures, grouped into one strip. Border classes give a
  // clean 2×2 grid on mobile and a single divided row on desktop.
  const cells = [
    { label: "Total flight time", value: hhmm(stats.totalMinutes), sub: `across ${stats.totalFlights} flight${stats.totalFlights === 1 ? "" : "s"}`, cls: "" },
    { label: "Landings", value: String(stats.totalLandings), sub: `${stats.dayLandings} day · ${stats.nightLandings} night`, cls: "border-l border-slate-200" },
    { label: "Last 90 days", value: hhmm(stats.last90Minutes), sub: `${stats.last90Flights} flight${stats.last90Flights === 1 ? "" : "s"}`, cls: "border-t border-slate-200 md:border-l md:border-t-0" },
    { label: "PIC time", value: hhmm(stats.picMinutes), sub: stats.instructorMinutes > 0 ? `${hhmm(stats.instructorMinutes)} instructor` : "all-time", cls: "border-l border-t border-slate-200 md:border-t-0" },
  ];

  return (
    <div className="space-y-5">
      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          {firstName ? `Welcome back, ${firstName}` : "Welcome back"}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {loading ? "Loading your logbook..." : `${entries.length} flight${entries.length === 1 ? "" : "s"} on file.`}
        </p>
      </div>

      {error && <Alert>{error}</Alert>}

      {/* Grouped status strip: one panel, internal dividers. */}
      <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
        <div className="grid grid-cols-2 md:grid-cols-4">
          {cells.map((c) => (
            <div key={c.label} className={`px-5 py-4 ${c.cls}`}>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{c.label}</div>
              <div className="mt-1 font-mono text-[28px] font-bold leading-tight tabular-nums text-slate-900">{c.value}</div>
              <div className="mt-1 text-xs text-slate-500">{c.sub}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Quick actions: soft utility cards, not loud banners. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <ActionCard
          onClick={() => navigate("/new")}
          icon={<PencilIcon />}
          title="Log a flight"
          subtitle="Record a new entry in your logbook"
          tone="brand"
        />
        <ActionCard
          onClick={exportPdf}
          icon={<DocumentIcon />}
          title={exporting ? "Generating..." : "Generate logbook PDF"}
          subtitle="FOCA-format export with audit appendix"
          disabled={exporting || loading}
          tone="emerald"
        />
        <ActionCard
          onClick={() => navigate("/logbook")}
          icon={<TableIcon />}
          title="Open logbook"
          subtitle="Search, filter, sign off, edit"
          tone="slate"
        />
      </div>

      <Panel
        title="Recent flights"
        badge={recent.length > 0 ? <Pill>{recent.length} shown</Pill> : undefined}
        right={<Link to="/logbook" className="text-xs font-medium normal-case tracking-normal text-brand-600 hover:underline">View all →</Link>}
      >
        {loading ? (
          <p className="p-4 text-sm text-slate-500">Loading...</p>
        ) : recent.length === 0 ? (
          <p className="p-4 text-sm italic text-slate-400">
            No flights yet. <Link to="/new" className="not-italic text-brand-600 hover:underline">Log your first flight</Link>.
          </p>
        ) : (
          <>
            {/* Mobile: compact list that always fits — no horizontal scroll. */}
            <ul className="divide-y divide-slate-100 sm:hidden">
              {recent.map((e) => {
                const c = e.content.columns;
                const isFstd = Boolean(c?.fstd);
                const sigMissing = !e.locked && c?.signatureRequired;
                const reg = isFstd ? `FSTD ${c?.fstd?.deviceType}` : e.content.aircraft?.registration;
                const route = isFstd ? "Simulator" : `${c?.departurePlace} → ${c?.arrivalPlace}`;
                return (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => navigate(`/entry/${e.id}`)}
                      className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left outline-none focus-visible:bg-slate-50 ${sigMissing ? "bg-amber-50/60" : ""}`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block font-mono text-[11px] text-slate-500">{c?.date}</span>
                        <span className="block truncate font-mono text-sm font-semibold text-slate-700">
                          {[reg, route].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      <span className="flex flex-none flex-col items-end gap-1">
                        <span className="font-mono text-sm font-semibold tabular-nums text-slate-700">
                          {hhmm(isFstd ? c?.fstd?.totalMinutes : c?.total)}
                        </span>
                        {e.locked ? (
                          <Pill tone="green">Signed</Pill>
                        ) : sigMissing ? (
                          <span className="inline-flex items-center gap-1 whitespace-nowrap rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden="true" />
                            Sig missing
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            {/* Desktop: full table. */}
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-400">
                    <th className="px-4 py-2 font-semibold">Date</th>
                    <th className="px-3 py-2 font-semibold">Registration</th>
                    <th className="px-3 py-2 font-semibold">Route</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                    <th className="px-4 py-2 text-right font-semibold">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {recent.map((e) => {
                    const c = e.content.columns;
                    const isFstd = Boolean(c?.fstd);
                    const sigMissing = !e.locked && c?.signatureRequired;
                    const go = () => navigate(`/entry/${e.id}`);
                    return (
                      <tr
                        key={e.id}
                        onClick={go}
                        onKeyDown={(ev) => { if (ev.key === "Enter") go(); }}
                        tabIndex={0}
                        role="link"
                        className={`cursor-pointer outline-none focus-visible:bg-slate-50 ${sigMissing ? "bg-amber-50/60 hover:bg-amber-50" : "hover:bg-slate-50"}`}
                      >
                        <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-slate-500">{c?.date}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs font-semibold text-slate-700">
                          {isFstd ? `FSTD ${c?.fstd?.deviceType}` : e.content.aircraft?.registration}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-slate-500">
                          {isFstd ? "Simulator" : `${c?.departurePlace} → ${c?.arrivalPlace}`}
                        </td>
                        <td className="px-3 py-2.5">
                          {e.locked ? (
                            <Pill tone="green">Signed</Pill>
                          ) : sigMissing ? (
                            <span className="inline-flex items-center gap-1.5 rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden="true" />
                              Sig missing
                            </span>
                          ) : (
                            <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-300" aria-hidden="true" title="OK" />
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono text-xs font-semibold tabular-nums text-slate-700">
                          {hhmm(isFstd ? c?.fstd?.totalMinutes : c?.total)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Panel>
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

function ActionCard({
  onClick,
  icon,
  title,
  subtitle,
  tone,
  disabled,
}: {
  onClick: () => void;
  icon: ReactNode;
  title: string;
  subtitle: string;
  tone: "brand" | "emerald" | "slate";
  disabled?: boolean;
}) {
  const badge =
    tone === "brand" ? "bg-brand-600 text-white"
    : tone === "emerald" ? "bg-emerald-50 text-emerald-600"
    : "bg-slate-100 text-slate-600";
  const card =
    tone === "brand"
      ? "border-brand-100 bg-gradient-to-br from-brand-50 to-white hover:border-brand-300"
      : "border-slate-200 bg-gradient-to-br from-white to-slate-50 hover:border-slate-300";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`group flex items-start gap-3 rounded-md border p-4 text-left transition hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-50 ${card}`}
    >
      <span className={`flex h-10 w-10 flex-none items-center justify-center rounded-lg ${badge}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-slate-800">{title}</span>
        <span className="mt-0.5 block text-xs text-slate-500">{subtitle}</span>
      </span>
      <span className="mt-0.5 flex-none text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-400" aria-hidden="true">›</span>
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
