import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import * as api from "../api";
import { useAuth } from "../auth";
import { Alert, Button, Card, Field } from "../components/ui";
import {
  ATTRIBUTE_LABELS,
  CATEGORY_LABELS,
  FUNCTION_LABELS,
  INSTRUCTOR_POSITION_LABELS,
  LAUNCH_METHOD_LABELS,
  OPERATING_ROLE_LABELS,
} from "../labels";

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

/**
 * Compact silhouette per Part-FCL category, drawn inline so no icon library is
 * pulled in. currentColor inherits the text colour so it sits with the muted
 * registration text in the table.
 */
function CategoryIcon({ category }: { category?: string }) {
  const c = (category ?? "AEROPLANE").toUpperCase();
  const label = CATEGORY_LABELS[c] ?? "Aircraft";
  const common = { width: 14, height: 14, viewBox: "0 0 24 24", fill: "currentColor" as const, "aria-label": label };
  if (c === "HELICOPTER") {
    return (
      <svg {...common}>
        <rect x="2" y="5" width="20" height="1.4" rx=".7" />
        <rect x="11" y="6.4" width="2" height="2" />
        <path d="M3 12c0-2 2-3.6 5-3.6h5l5 2.5-2 2.5H4c-.6 0-1-.4-1-1z" />
        <path d="M14 11.6h7v1.2h-7z" />
        <path d="M20.5 9.5h1.2v3h-1.2z" />
        <rect x="3" y="15" width="14" height="1" />
        <rect x="4.5" y="13.5" width="1" height="2" />
        <rect x="14.5" y="13.5" width="1" height="2" />
      </svg>
    );
  }
  if (c === "SAILPLANE") {
    return (
      <svg {...common}>
        <path d="M12 2c-.5 0-.9.4-.9.9v6L1 11.8v1l10.1-1.2v6.8l-2 1.4v.7l2.9-.7 2.9.7v-.7l-2-1.4v-6.8L23 12.8v-1L12.9 8.9v-6c0-.5-.4-.9-.9-.9z" />
      </svg>
    );
  }
  if (c === "BALLOON") {
    return (
      <svg {...common}>
        <path d="M12 2c-4.4 0-8 3.6-8 8 0 3 1.6 5.6 4 7v.5h8V17c2.4-1.4 4-4 4-7 0-4.4-3.6-8-8-8z" />
        <path d="M9.4 17.4h1v3h-1zM13.6 17.4h1v3h-1z" />
        <path d="M8.5 20h7v2.5h-7z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M12 2c-.6 0-1 .45-1 1v5.5L2 13v1.5l9-2.5V18l-2.5 1.5v1l3.5-1 3.5 1v-1L13 18v-6l9 2.5V13l-9-4.5V3c0-.55-.4-1-1-1z" />
    </svg>
  );
}

/** Caret on the left of each row; rotates when its row is expanded. */
function Caret({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`text-slate-400 transition-transform ${open ? "rotate-90" : ""}`}
    >
      <path d="M9 5l7 7-7 7" />
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
  // Pilot can select unlocked entries and ask one signer to countersign the batch.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [requestOpen, setRequestOpen] = useState(false);
  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function clearSelection() {
    setSelected(new Set());
  }

  // Inline expansion of a row reveals its detail panel without navigating away.
  // The set lets several rows be open at once so the pilot can compare details.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleExpandAll() {
    setExpanded((prev) => (prev.size > 0 ? new Set() : new Set(entries.map((e) => e.id))));
  }

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

      {selected.size > 0 ? (
        <div className="flex items-center justify-between rounded-md border border-brand-200 bg-brand-50 px-3 py-2 text-sm">
          <span className="font-medium text-brand-800">
            {selected.size} {selected.size === 1 ? "entry" : "entries"} selected
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={clearSelection}>Clear</Button>
            <Button onClick={() => setRequestOpen(true)}>Request sign-off</Button>
          </div>
        </div>
      ) : entries.length > 0 ? (
        <div className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
          <svg className="mt-0.5 h-4 w-4 flex-none text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8h.01M11 12h1v4h1" />
          </svg>
          <span>
            Tick the checkboxes to pick several flights, then ask one instructor or examiner to sign them off together with a single signature.
          </span>
        </div>
      ) : null}

      {requestOpen && (
        <BulkSignoffDialog
          entryIds={[...selected]}
          onClose={() => setRequestOpen(false)}
          onSuccess={() => {
            setRequestOpen(false);
            clearSelection();
          }}
        />
      )}

      <div ref={listRef} className="scroll-mt-4" />
      <Card>
        {loading ? (
          <p className="text-sm text-slate-500">Loading...</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-slate-500">No entries yet. Record your first flight.</p>
        ) : (
          <div className="hidden overflow-x-auto md:block">
            <div className="flex justify-end pb-2">
              <button
                type="button"
                onClick={toggleExpandAll}
                className="text-xs text-slate-500 underline hover:text-slate-700"
              >
                {expanded.size > 0 ? "Collapse all" : "Expand all"}
              </button>
            </div>
            <table className="w-full whitespace-nowrap text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-2 py-2">
                    <input
                      type="checkbox"
                      aria-label="Select all unlocked entries"
                      checked={
                        entries.filter((e) => !e.locked).length > 0 &&
                        entries.filter((e) => !e.locked).every((e) => selected.has(e.id))
                      }
                      onChange={(ev) => {
                        const open = entries.filter((e) => !e.locked).map((e) => e.id);
                        setSelected(ev.target.checked ? new Set(open) : new Set());
                      }}
                    />
                  </th>
                  <th className="w-3 px-2 py-2" aria-hidden="true"></th>
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
                  const open = expanded.has(e.id);
                  return (
                    <Fragment key={e.id}>
                      <tr
                        className="cursor-pointer border-b last:border-0 hover:bg-slate-50"
                        onClick={() => toggleExpanded(e.id)}
                        aria-expanded={open}
                      >
                        <td className="px-2 py-2" onClick={(ev) => ev.stopPropagation()}>
                          <input
                            type="checkbox"
                            aria-label={`Select entry ${c?.date ?? ""}`}
                            checked={selected.has(e.id)}
                            disabled={e.locked}
                            onChange={() => toggleSelected(e.id)}
                          />
                        </td>
                        <td className="px-2 py-2"><Caret open={open} /></td>
                        <td className="px-2 py-2">{c?.date}</td>
                        <td className="px-2 py-2">
                          {fstd ? (
                            <span className="text-slate-500">FSTD {fstd.deviceType}</span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-slate-700">
                              <CategoryIcon category={c?.category} />
                              <span>{e.content.aircraft?.registration}</span>
                              <span className="text-slate-400">{e.content.aircraft?.makeModelVariant}</span>
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
                      {open && (
                        <tr className="border-b bg-slate-50/70 last:border-0">
                          <td colSpan={19} className="px-0 py-0">
                            <EntryDetailPanel entry={e} onEdit={() => navigate(`/entry/${e.id}`)} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
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
              const open = expanded.has(e.id);
              return (
                <li key={e.id} className="rounded-lg border bg-white active:bg-slate-50">
                  <div className="flex gap-2 p-3">
                    <input
                      type="checkbox"
                      aria-label={`Select entry ${c?.date ?? ""}`}
                      className="mt-1 h-4 w-4 flex-none"
                      checked={selected.has(e.id)}
                      disabled={e.locked}
                      onChange={() => toggleSelected(e.id)}
                    />
                    <button
                      type="button"
                      onClick={() => toggleExpanded(e.id)}
                      aria-expanded={open}
                      className="flex-1 text-left"
                    >
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5 font-medium">
                          <Caret open={open} />
                          {c?.date}
                        </span>
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
                          <span className="inline-flex items-center gap-1.5 text-slate-700">
                            <CategoryIcon category={c?.category} />
                            <span>{e.content.aircraft?.registration}</span>
                            <span className="text-slate-400">{e.content.aircraft?.makeModelVariant}</span>
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
                  </div>
                  {open && (
                    <div className="border-t border-slate-100 px-3 pb-3 pt-3">
                      <EntryDetailPanel entry={e} onEdit={() => navigate(`/entry/${e.id}`)} compact />
                    </div>
                  )}
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

/**
 * Inline expansion of a row: three short columns mirroring the entry-detail
 * page. Driven by what `listEntries` already returns, so no extra request is
 * needed to open a row. Signature signer details (name, place, date) still
 * live on the full detail page reached by "Open full page".
 */
function EntryDetailPanel({
  entry,
  onEdit,
  compact = false,
}: {
  entry: api.EntryRow;
  onEdit: () => void;
  compact?: boolean;
}) {
  const c = entry.content.columns;
  const fstd = c?.fstd;
  const isBalloon = (c?.category ?? "").toUpperCase() === "BALLOON";
  const balloonGroup = isBalloon
    ? (() => {
        const groups: Array<["A" | "B" | "C" | "D", number | undefined]> = [
          ["A", c?.balloonGroupA],
          ["B", c?.balloonGroupB],
          ["C", c?.balloonGroupC],
          ["D", c?.balloonGroupD],
        ];
        const hit = groups.find(([, v]) => (v ?? 0) > 0);
        return hit ? `${hit[0]} — ${hhmm(hit[1])}` : undefined;
      })()
    : undefined;

  return (
    <div className={`${compact ? "" : "px-5 pb-5 pt-4"} grid gap-5 ${compact ? "" : "md:grid-cols-3"}`}>
      <div>
        <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Time breakdown
        </h3>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[13px]">
          {fstd ? (
            <>
              <Dt>FSTD total</Dt><Dd mono>{hhmm(fstd.totalMinutes)}</Dd>
              <Dt>Device</Dt><Dd>{fstd.deviceType} ({fstd.qualificationNumber})</Dd>
            </>
          ) : isBalloon ? (
            <>
              {balloonGroup && (<><Dt>Hot-air group</Dt><Dd mono>{balloonGroup}</Dd></>)}
              {(c?.balloonGas ?? 0) > 0 && (<><Dt>Gas</Dt><Dd mono>{hhmm(c?.balloonGas)}</Dd></>)}
              {(c?.night ?? 0) > 0 && (<><Dt>Night</Dt><Dd mono>{hhmm(c?.night)}</Dd></>)}
              <Dt>Landings</Dt><Dd>{c?.dayLandings ?? 0} day · {c?.nightLandings ?? 0} night</Dd>
              {c?.dayNightPattern && (<><Dt>Day/night</Dt><Dd mono>{c.dayNightPattern}</Dd></>)}
            </>
          ) : (
            <>
              {(c?.singleEngine ?? 0) > 0 && (<><Dt>Single-engine</Dt><Dd mono>{hhmm(c?.singleEngine)}</Dd></>)}
              {(c?.multiEngine ?? 0) > 0 && (<><Dt>Multi-engine</Dt><Dd mono>{hhmm(c?.multiEngine)}</Dd></>)}
              {(c?.multiPilot ?? 0) > 0 && (<><Dt>Multi-pilot</Dt><Dd mono>{hhmm(c?.multiPilot)}</Dd></>)}
              {(c?.night ?? 0) > 0 && (<><Dt>Night</Dt><Dd mono>{hhmm(c?.night)}</Dd></>)}
              {(c?.ifr ?? 0) > 0 && (<><Dt>IFR</Dt><Dd mono>{hhmm(c?.ifr)}</Dd></>)}
              <Dt>Landings</Dt><Dd>{c?.dayLandings ?? 0} day · {c?.nightLandings ?? 0} night</Dd>
              {c?.dayNightPattern && (<><Dt>Day/night</Dt><Dd mono>{c.dayNightPattern}</Dd></>)}
            </>
          )}
        </dl>
      </div>

      <div>
        <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Function &amp; classification
        </h3>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[13px]">
          {entry.content.function?.primary && (
            <><Dt>Pilot function</Dt><Dd>{FUNCTION_LABELS[entry.content.function.primary] ?? entry.content.function.primary}</Dd></>
          )}
          {c?.operatingRole && (<><Dt>Operating role</Dt><Dd>{OPERATING_ROLE_LABELS[c.operatingRole] ?? c.operatingRole}</Dd></>)}
          {c?.crewSize && c.crewSize > 0 && (
            <><Dt>Operating crew</Dt><Dd>{c.crewSize}{c.crewSize > 2 ? " (augmented)" : ""}</Dd></>
          )}
          {c?.category && (<><Dt>Category</Dt><Dd>{CATEGORY_LABELS[c.category] ?? c.category}</Dd></>)}
          {c?.instructorPosition && (
            <><Dt>Instructor seat</Dt><Dd>{INSTRUCTOR_POSITION_LABELS[c.instructorPosition] ?? c.instructorPosition}</Dd></>
          )}
          {c?.launchMethod && (<><Dt>Launch</Dt><Dd>{LAUNCH_METHOD_LABELS[c.launchMethod] ?? c.launchMethod}</Dd></>)}
          {c?.balloonFlightType && (
            <><Dt>Flight type</Dt><Dd>{c.balloonFlightType === "TETHERED" ? "Tethered" : "Free flight"}</Dd></>
          )}
          {c?.inflations !== undefined && (<><Dt>Inflations</Dt><Dd mono>{c.inflations}</Dd></>)}
          {c?.departurePlaceName && (<><Dt>From name</Dt><Dd>{c.departurePlaceName}</Dd></>)}
          {c?.arrivalPlaceName && (<><Dt>To name</Dt><Dd>{c.arrivalPlaceName}</Dd></>)}
        </dl>
        {c?.attributes && c.attributes.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {c.attributes.map((a) => (
              <span key={a} className="rounded-full bg-slate-200/70 px-2.5 py-0.5 text-[11px] text-slate-700">
                {ATTRIBUTE_LABELS[a] ?? a}
              </span>
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Remarks &amp; sign-off
        </h3>
        {entry.content.remarks ? (
          <p className="text-[13px] italic text-slate-700">{entry.content.remarks}</p>
        ) : (
          <p className="text-[13px] text-slate-400">No remarks.</p>
        )}
        <p className="mt-2 text-[12.5px] text-slate-600">
          {entry.locked
            ? "Countersigned — open the full page for signer details."
            : c?.signatureRequired
              ? <span className="text-amber-700">Requires a sign-off before it can be credited.</span>
              : "No sign-off recorded."}
        </p>
        <div className="mt-3 flex gap-2">
          <Link to={`/entry/${entry.id}`} className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
            Open full page
          </Link>
          {!entry.locked && (
            <button
              type="button"
              onClick={(ev) => { ev.stopPropagation(); onEdit(); }}
              className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Edit
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Dt({ children }: { children: ReactNode }) {
  return <dt className="text-slate-500">{children}</dt>;
}
function Dd({ children, mono = false }: { children: ReactNode; mono?: boolean }) {
  return <dd className={`m-0 ${mono ? "font-mono" : ""}`}>{children}</dd>;
}

const CAPACITY_LABELS: Record<string, string> = {
  INSTRUCTOR: "Instructor",
  EXAMINER: "Examiner",
  SUPERVISING_PIC: "Supervising PIC",
  ATO: "ATO",
  DTO: "DTO",
  HOT: "Head of training",
  AIRPORT: "Airport",
  OTHER: "Other",
};

/** Modal: ask one signer to countersign every entry in a batch with one link. */
function BulkSignoffDialog({
  entryIds,
  onClose,
  onSuccess,
}: {
  entryIds: string[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [capacity, setCapacity] = useState("INSTRUCTOR");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ link: string; emailed: boolean; emailConfigured: boolean; entryCount: number } | null>(null);

  async function submit() {
    setErr(null);
    if (!name.trim() || !email.trim()) {
      setErr("Signer name and email are required.");
      return;
    }
    setBusy(true);
    try {
      const r = await api.requestSignoffBatch({
        entryIds,
        signerName: name.trim(),
        signerEmail: email.trim(),
        capacity,
      });
      setResult({ link: r.link, emailed: r.emailed, emailConfigured: r.emailConfigured, entryCount: r.entryCount });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not request sign-off.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {result ? (
          <div className="space-y-3 text-sm">
            <h2 className="text-base font-semibold">
              Sign-off requested for {result.entryCount} {result.entryCount === 1 ? "entry" : "entries"}
            </h2>
            <p className="text-slate-600">
              {result.emailed
                ? "We emailed the signer the one-time link. You can also share it directly:"
                : result.emailConfigured
                  ? "We could not send the email; share the link directly:"
                  : "Email isn't configured on this server, so share the link directly:"}
            </p>
            <div className="rounded-md bg-slate-50 p-2 font-mono text-xs break-all">{result.link}</div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => navigator.clipboard?.writeText(result.link)}>Copy link</Button>
              <Button onClick={onSuccess}>Done</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <h2 className="text-base font-semibold">Request sign-off</h2>
            <p className="text-sm text-slate-600">
              One signer will countersign {entryIds.length} {entryIds.length === 1 ? "entry" : "entries"} with a single
              signature. They'll get a one-time link.
            </p>
            {err && <Alert>{err}</Alert>}
            <Field label="Signer name" value={name} onChange={(e) => setName(e.target.value)} required />
            <Field label="Signer email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">Capacity</span>
              <select
                className="block min-h-[2.625rem] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
              >
                {Object.entries(CAPACITY_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
              <Button onClick={submit} disabled={busy}>{busy ? "Sending..." : "Send request"}</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
