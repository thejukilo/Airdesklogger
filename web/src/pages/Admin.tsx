import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../auth";
import * as api from "../api";
import { Alert, Button, Card, Field } from "../components/ui";

/**
 * Administrator dashboard: a few database figures and one-click maintenance
 * actions. A signed-in user who is not yet an admin can become one here by
 * presenting the deployment's bootstrap token (the first-time setup).
 */
export function Admin() {
  const { user, refreshUser } = useAuth();
  const isAdmin = (user?.roles ?? []).includes("ADMIN");

  if (!isAdmin) return <Bootstrap onDone={refreshUser} />;
  return <Dashboard />;
}

function Bootstrap({ onDone }: { onDone: (u: api.SessionUser) => void }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api.adminBootstrap(token.trim());
      api.setToken(res.token);
      onDone(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not enable admin access.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm pt-6">
      <h1 className="mb-4 text-xl font-semibold">Administrator access</h1>
      <Card>
        <form onSubmit={onSubmit} className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <p className="text-sm text-slate-600">
            This area is for administrators. Enter the bootstrap token to grant your account admin
            access (this is the one-time setup).
          </p>
          <Field
            label="Bootstrap token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            required
          />
          <Button type="submit" disabled={busy || !token.trim()} className="w-full">
            {busy ? "Checking..." : "Enable admin access"}
          </Button>
        </form>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}

function Dashboard() {
  const [stats, setStats] = useState<api.AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function loadStats() {
    setLoading(true);
    try {
      setStats(await api.adminStats());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load stats.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void loadStats();
  }, []);

  async function run(label: string, fn: () => Promise<string>) {
    setBusy(label);
    setResult(null);
    setError(null);
    try {
      setResult(await fn());
      await loadStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The action failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">Admin</h1>
      {error && <Alert>{error}</Alert>}

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-medium">Database</h2>
          <button type="button" onClick={loadStats} className="text-sm text-slate-500 underline">
            Refresh
          </button>
        </div>
        {loading || !stats ? (
          <p className="text-sm text-slate-500">Loading...</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Database size" value={stats.databaseSize} />
            <Stat label="Flight entries" value={stats.entries} />
            <Stat label="Users" value={stats.users} />
            <Stat label="Aircraft" value={stats.aircraft} />
            <Stat label="Airports" value={stats.airports} />
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-1 font-medium">Reference data</h2>
        <p className="mb-3 text-sm text-slate-500">
          Load the public datasets. Airports come from OurAirports (with coordinates, needed for night
          time and local-time conversion). Aircraft come from the configured dataset, if any. Aircraft
          types load the bundled ICAO list used to classify a registration's category.
        </p>
        {result && <p className="mb-3 text-sm text-emerald-700">{result}</p>}
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => run("airports", async () => {
              const r = await api.adminImportAirports();
              return `Imported ${r.imported} airports.`;
            })}
            disabled={busy !== null}
          >
            {busy === "airports" ? "Importing airports..." : "Import airports"}
          </Button>
          <Button
            variant="ghost"
            onClick={() => run("aircraft", async () => {
              const r = await api.adminImportAircraft();
              return r.configured ? `Imported ${r.imported} aircraft.` : (r.message ?? "Nothing to import.");
            })}
            disabled={busy !== null}
          >
            {busy === "aircraft" ? "Importing aircraft..." : "Import aircraft"}
          </Button>
          <Button
            variant="ghost"
            onClick={() => run("icao-types", async () => {
              const r = await api.adminSeedIcaoTypes();
              return `Seeded ${r.seeded} aircraft types.`;
            })}
            disabled={busy !== null}
          >
            {busy === "icao-types" ? "Seeding aircraft types..." : "Seed aircraft types"}
          </Button>
          <Button
            variant="ghost"
            onClick={() => run("aircraft", async () => {
              const r = await api.adminSeedAircraft();
              return `Seeded ${r.seeded} aircraft.`;
            })}
            disabled={busy !== null}
          >
            {busy === "aircraft" ? "Seeding aircraft..." : "Seed aircraft register (CH)"}
          </Button>
          <Button
            variant="ghost"
            onClick={() => run("aircraft-eu", async () => {
              const r = await api.adminSeedAircraftEurope();
              return `Added ${r.seeded} new aircraft from the Europe register.`;
            })}
            disabled={busy !== null}
          >
            {busy === "aircraft-eu" ? "Seeding Europe..." : "Seed aircraft register (Europe)"}
          </Button>
          <Button
            variant="ghost"
            onClick={() => run("simulators", async () => {
              const r = await api.adminSeedSimulators();
              return `Seeded ${r.seeded} simulators.`;
            })}
            disabled={busy !== null}
          >
            {busy === "simulators" ? "Seeding simulators..." : "Seed simulators"}
          </Button>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 aria-disabled:pointer-events-none aria-disabled:opacity-60"
                 aria-disabled={busy !== null}>
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              disabled={busy !== null}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                const csv = await file.text();
                await run("balloon-groups", async () => {
                  const r = await api.adminApplyBalloonGroups(csv);
                  return `Updated balloon group on ${r.updated} aircraft.`;
                });
              }}
            />
            {busy === "balloon-groups" ? "Applying balloon groups..." : "Apply balloon groups (CSV)"}
          </label>
        </div>
      </Card>

      <DangerZone busy={busy} run={run} />
    </div>
  );
}

/**
 * Pre-launch reset switch. Wipes every flight entry, signature, sign-off
 * request, import mapping, and audit-ledger row across all pilots, so the
 * development team can iterate on the import pipeline without manually
 * cleaning up between runs. Removed before the system carries any real
 * regulatory data.
 */
function DangerZone({
  busy,
  run,
}: {
  busy: string | null;
  run: (key: string, fn: () => Promise<string>) => Promise<void>;
}) {
  const [confirmPhrase, setConfirmPhrase] = useState("");
  const required = "WIPE ALL LOGS";

  async function wipe() {
    if (confirmPhrase !== required) return;
    if (!confirm(`Last chance. This deletes every flight entry, signature, sign-off, import mapping, and audit-ledger row for every pilot. Continue?`)) return;
    await run("wipe-all", async () => {
      const r = await api.adminWipeAllEntries();
      setConfirmPhrase("");
      const lines = Object.entries(r.before).map(([t, n]) => `${t}: ${n}`);
      return `Wiped. Before: ${lines.join(", ")}.`;
    });
  }

  return (
    <Card>
      <div className="rounded-md border border-rose-300 bg-rose-50 p-4">
        <h2 className="text-rose-900 font-semibold">Danger zone — development only</h2>
        <p className="mt-1 text-sm text-rose-800">
          Clears every flight entry, signature, sign-off request, import mapping,
          and audit-ledger row across <strong>all</strong> pilots. Aircraft and
          airport reference data, user accounts, roles, and import tokens are
          kept. This will be removed before launch.
        </p>
        <p className="mt-3 text-xs text-rose-800">
          Type <code className="rounded bg-white px-1.5 py-0.5">{required}</code> to enable the button:
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="text"
            className="w-48 rounded border border-rose-300 bg-white px-2 py-1 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-rose-400"
            value={confirmPhrase}
            onChange={(e) => setConfirmPhrase(e.target.value)}
            placeholder={required}
            disabled={busy !== null}
            autoComplete="off"
          />
          <button
            type="button"
            onClick={wipe}
            disabled={busy !== null || confirmPhrase !== required}
            className="rounded-md bg-rose-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-rose-700 focus:outline-none focus:ring-2 focus:ring-rose-400 disabled:cursor-not-allowed disabled:bg-rose-300"
          >
            {busy === "wipe-all" ? "Wiping..." : "Clear all flight logs"}
          </button>
        </div>
      </div>
    </Card>
  );
}
