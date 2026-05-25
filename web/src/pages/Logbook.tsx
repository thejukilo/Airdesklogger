import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as api from "../api";
import { Alert, Button, Card } from "../components/ui";

function hhmm(minutes: string | null): string {
  const m = Number(minutes ?? 0);
  if (!Number.isFinite(m) || m <= 0) return "";
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function Logbook() {
  const [entries, setEntries] = useState<api.EntrySummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

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
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-slate-500">
                <th className="py-2 font-medium">Date (UTC)</th>
                <th className="py-2 font-medium">Total time</th>
                <th className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b last:border-0">
                  <td className="py-2">{e.date}</td>
                  <td className="py-2">{hhmm(e.total_minutes)}</td>
                  <td className="py-2">
                    {e.locked ? (
                      <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">Signed</span>
                    ) : (
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">Open</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
