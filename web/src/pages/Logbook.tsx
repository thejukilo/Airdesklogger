import { useEffect, useState } from "react";
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

function clock(iso: string | undefined): string {
  return iso ? `${iso.slice(11, 16)}Z` : "";
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
        <div className="flex gap-2">
          <Button variant="ghost" onClick={exportPdf} disabled={exporting || entries.length === 0}>
            {exporting ? "Preparing..." : "Export PDF"}
          </Button>
          <Link to="/new">
            <Button>New entry</Button>
          </Link>
        </div>
      </div>

      {error && <Alert>{error}</Alert>}

      <Card>
        {loading ? (
          <p className="text-sm text-slate-500">Loading...</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-slate-500">No entries yet. Record your first flight.</p>
        ) : (
          <div className="overflow-x-auto">
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
                      <td className="px-2 py-2 text-right">{clock(c?.departureTime)}</td>
                      <td className="px-2 py-2 text-right">{clock(c?.arrivalTime)}</td>
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
