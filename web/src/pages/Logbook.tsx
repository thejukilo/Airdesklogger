import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import * as api from "../api";
import { useAuth } from "../auth";
import { Alert, Button, Card, Field } from "../components/ui";
import { FUNCTION_LABELS } from "../labels";

const SIGNER_ROLES = ["INSTRUCTOR", "EXAMINER", "ATO", "DTO", "HOT", "AIRPORT"];

function hhmm(v: number | string | null | undefined): string {
  const m = Number(v ?? 0);
  if (!Number.isFinite(m) || m <= 0) return "";
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function clock(iso: string | undefined, local = false): string {
  return iso ? `${iso.slice(11, 16)}${local ? "L" : "Z"}` : "";
}

const ICON = "h-6 w-6";
const iconProps = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, viewBox: "0 0 24 24" };

function PlusIcon() {
  return (
    <svg className={ICON} {...iconProps}><path d="M12 5v14M5 12h14" /></svg>
  );
}
function DownloadIcon() {
  return (
    <svg className={ICON} {...iconProps}><path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" /></svg>
  );
}
function LogIcon() {
  return (
    <svg className={ICON} {...iconProps}><path d="M4 5h16M4 12h16M4 19h10" /></svg>
  );
}
function GearIcon() {
  return (
    <svg className={ICON} {...iconProps}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
    </svg>
  );
}

/** An app-style quick-action button used on the mobile home screen. */
function Tile({ icon, label, onClick, disabled }: { icon: ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex flex-col items-center justify-center gap-2 rounded-xl border border-slate-200/80 bg-white p-4 text-slate-700 shadow-card ring-1 ring-slate-900/[0.03] transition active:bg-brand-50 disabled:opacity-50"
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-100 text-brand-700">{icon}</span>
      <span className="text-sm font-medium">{label}</span>
    </button>
  );
}

export function Logbook() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [entries, setEntries] = useState<api.EntryRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [openId, setOpenId] = useState("");
  const isSigner = (user?.roles ?? []).some((r) => SIGNER_ROLES.includes(r));
  const listRef = useRef<HTMLDivElement>(null);

  const totalMinutes = entries.reduce((sum, e) => sum + (Number(e.content.columns?.total) || 0), 0);
  const totalLandings = entries.reduce(
    (sum, e) => sum + (Number(e.content.columns?.dayLandings) || 0) + (Number(e.content.columns?.nightLandings) || 0),
    0,
  );

  useEffect(() => {
    api
      .listEntries()
      .then((r) => setEntries(r.entries))
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load entries."))
      .finally(() => setLoading(false));
  }, []);

  async function exportPdf() {
    setExporting(true);
    setError(null);
    try {
      const blob = await api.exportLogbookPdf();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "logbook.pdf";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not export.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Logbook</h1>
        <div className="hidden gap-2 md:flex">
          <Button variant="ghost" onClick={exportPdf} disabled={exporting || entries.length === 0}>
            {exporting ? "Preparing..." : "Export PDF"}
          </Button>
          <Link to="/new" state={{ simulator: true }}>
            <Button variant="ghost">Simulator session</Button>
          </Link>
          <Link to="/new">
            <Button>New entry</Button>
          </Link>
        </div>
      </div>

      {/* Mobile home screen: a status widget and app-style quick actions. */}
      <div className="space-y-4 md:hidden">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-brand-100 bg-gradient-to-br from-brand-50 to-white p-4 text-center shadow-card">
            <div className="text-2xl font-semibold tabular-nums text-brand-700">{hhmm(totalMinutes) || "00:00"}</div>
            <div className="mt-0.5 text-xs uppercase tracking-wide text-slate-500">Total time</div>
          </div>
          <div className="rounded-xl border border-brand-100 bg-gradient-to-br from-brand-50 to-white p-4 text-center shadow-card">
            <div className="text-2xl font-semibold tabular-nums text-brand-700">{totalLandings}</div>
            <div className="mt-0.5 text-xs uppercase tracking-wide text-slate-500">Landings</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Tile icon={<PlusIcon />} label="New flight" onClick={() => navigate("/new")} />
          <Tile icon={<DownloadIcon />} label="Download report" onClick={exportPdf} disabled={exporting || entries.length === 0} />
          <Tile icon={<LogIcon />} label="Flight log" onClick={() => listRef.current?.scrollIntoView({ behavior: "smooth" })} />
          <Tile icon={<GearIcon />} label="Settings" onClick={() => navigate("/account")} />
        </div>
      </div>

      {error && <Alert>{error}</Alert>}

      <div ref={listRef} className="scroll-mt-4" />
      <Card>
        {loading ? (
          <p className="text-sm text-slate-500">Loading...</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-slate-500">No entries yet. Record your first flight.</p>
        ) : (
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full whitespace-nowrap text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-2 py-2 font-medium">Date</th>
                  <th className="px-2 py-2 font-medium">Aircraft</th>
                  <th className="px-2 py-2 font-medium">From</th>
                  <th className="px-2 py-2 font-medium">To</th>
                  <th className="px-2 py-2 text-right font-medium">Off</th>
                  <th className="px-2 py-2 text-right font-medium">On</th>
                  <th className="px-2 py-2 text-right font-medium">Total</th>
                  <th className="px-2 py-2 font-medium">Function</th>
                  <th className="px-2 py-2 text-right font-medium">PIC</th>
                  <th className="px-2 py-2 text-right font-medium">Co</th>
                  <th className="px-2 py-2 text-right font-medium">Dual</th>
                  <th className="px-2 py-2 text-right font-medium">Instr</th>
                  <th className="px-2 py-2 text-right font-medium">Night</th>
                  <th className="px-2 py-2 text-right font-medium">IFR</th>
                  <th className="px-2 py-2 text-right font-medium">Ldg</th>
                  <th className="px-2 py-2 font-medium">PIC name</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="font-mono text-[13px]">
                {entries.map((e) => {
                  const c = e.content.columns;
                  const fstd = c?.fstd;
                  return (
                    <tr
                      key={e.id}
                      className="cursor-pointer border-b last:border-0 hover:bg-slate-50"
                      onClick={() => navigate(`/entry/${e.id}`)}
                    >
                      <td className="px-2 py-2">{c?.date}</td>
                      <td className="px-2 py-2">
                        {fstd ? (
                          <span className="text-slate-500">FSTD {fstd.deviceType}</span>
                        ) : (
                          <span>
                            {e.content.aircraft?.registration}
                            <span className="ml-1 text-slate-400">{e.content.aircraft?.makeModelVariant}</span>
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2">{c?.departurePlace}</td>
                      <td className="px-2 py-2">{c?.arrivalPlace}</td>
                      <td className="px-2 py-2 text-right">{clock(c?.departureTime, c?.timesLocal)}</td>
                      <td className="px-2 py-2 text-right">{clock(c?.arrivalTime, c?.timesLocal)}</td>
                      <td className="px-2 py-2 text-right font-semibold">{fstd ? hhmm(fstd.totalMinutes) : hhmm(c?.total)}</td>
                      <td className="px-2 py-2 font-sans">{FUNCTION_LABELS[e.content.function?.primary ?? ""] ?? ""}</td>
                      <td className="px-2 py-2 text-right">{hhmm(c?.pic)}</td>
                      <td className="px-2 py-2 text-right">{hhmm(c?.coPilot)}</td>
                      <td className="px-2 py-2 text-right">{hhmm(c?.dual)}</td>
                      <td className="px-2 py-2 text-right">{hhmm(c?.instructor)}</td>
                      <td className="px-2 py-2 text-right">{hhmm(c?.night)}</td>
                      <td className="px-2 py-2 text-right">{hhmm(c?.ifr)}</td>
                      <td className="px-2 py-2 text-right">
                        {(c?.dayLandings ?? 0) + (c?.nightLandings ?? 0) || ""}
                      </td>
                      <td className="px-2 py-2 font-sans">{e.content.picName}</td>
                      <td className="px-2 py-2 font-sans">
                        {e.locked ? (
                          <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">Signed</span>
                        ) : (
                          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">Open</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Mobile: a stacked card per entry instead of the wide table. */}
        {!loading && entries.length > 0 && (
          <ul className="space-y-3 md:hidden">
            {entries.map((e) => {
              const c = e.content.columns;
              const fstd = c?.fstd;
              return (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/entry/${e.id}`)}
                    className="w-full rounded-lg border bg-white p-3 text-left active:bg-slate-50"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{c?.date}</span>
                      {e.locked ? (
                        <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">Signed</span>
                      ) : (
                        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">Open</span>
                      )}
                    </div>
                    <div className="mt-1 text-sm">
                      {fstd ? (
                        <span className="text-slate-500">FSTD {fstd.deviceType}</span>
                      ) : (
                        <span>
                          {e.content.aircraft?.registration}
                          <span className="ml-1 text-slate-400">{e.content.aircraft?.makeModelVariant}</span>
                        </span>
                      )}
                    </div>
                    {!fstd && (
                      <div className="mt-1 font-mono text-[13px] text-slate-600">
                        {c?.departurePlace} {clock(c?.departureTime, c?.timesLocal)} to {c?.arrivalPlace} {clock(c?.arrivalTime, c?.timesLocal)}
                      </div>
                    )}
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                      <span>Total <span className="font-mono font-semibold text-ink">{fstd ? hhmm(fstd.totalMinutes) : hhmm(c?.total)}</span></span>
                      {e.content.function?.primary && <span>{FUNCTION_LABELS[e.content.function.primary] ?? e.content.function.primary}</span>}
                      {e.content.picName && <span>PIC {e.content.picName}</span>}
                      {((c?.dayLandings ?? 0) + (c?.nightLandings ?? 0)) > 0 && (
                        <span>Ldg {(c?.dayLandings ?? 0) + (c?.nightLandings ?? 0)}</span>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {isSigner && (
        <Card>
          <h2 className="mb-1 font-medium">Open an entry to sign</h2>
          <p className="mb-3 text-sm text-slate-500">
            Paste the entry ID a pilot shared with you to review and countersign it.
          </p>
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (openId.trim()) navigate(`/entry/${openId.trim()}`);
            }}
          >
            <div className="flex-1">
              <Field label="Entry ID" value={openId} onChange={(e) => setOpenId(e.target.value)} />
            </div>
            <Button type="submit" variant="ghost" disabled={!openId.trim()}>
              Open
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}
