import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import * as api from "../api";
import { Alert, Button, Card, Field, Select } from "../components/ui";
import { ATTRIBUTE_GROUPS, SIMULATOR_ATTRIBUTES } from "../labels";

/**
 * Records a simulator (FSTD) session, shown under the "Simulator session"
 * category of the new-entry page. The device is picked by autocomplete on its
 * EASA code or serial number, or added when not listed. The session carries no
 * flight time - the device, the pilot's function and the duration are what
 * matter.
 */

// FSTD types a pilot may pick when adding a device (the screenshot list, minus
// the non-loggable "flight simulator", "uncertified simulator" and "initial
// values").
const FSTD_TYPES = [
  "FFS Level A", "FFS Level B", "FFS Level C", "FFS Level D",
  "FTD 1", "FTD 2", "FTD 3",
  "FNPT I", "FNPT II", "FNPT III",
  "OTD", "BITD", "BATD", "AATD",
];

const SIM_GROUPS = ATTRIBUTE_GROUPS.map((g) => ({
  title: g.title,
  items: g.items.filter((it) => SIMULATOR_ATTRIBUTES.has(it.key)),
})).filter((g) => g.items.length > 0);

function parseHHMM(s: string): number {
  const m = /^(\d{1,2}):([0-5]?\d)$/.exec(s.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}
function autoFormatHHMM(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 4);
  return d.length <= 2 ? d : `${d.slice(0, d.length - 2)}:${d.slice(d.length - 2)}`;
}

const empty = {
  date: "",
  simQuery: "",
  easaCode: "",
  model: "",
  fstdType: "",
  pilotFunction: "TRAINEE" as "TRAINEE" | "SFI_SFE",
  duration: "",
  dayLandings: 0,
  nightLandings: 0,
  remarks: "",
  attributes: [] as string[],
};

export function SimulatorSession() {
  const navigate = useNavigate();
  const [f, setF] = useState(empty);
  const [results, setResults] = useState<api.SimulatorRef[]>([]);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function set<K extends keyof typeof f>(k: K, v: (typeof f)[K]) {
    setF((prev) => ({ ...prev, [k]: v }));
  }
  function toggleAttr(key: string) {
    setF((prev) => ({
      ...prev,
      attributes: prev.attributes.includes(key) ? prev.attributes.filter((a) => a !== key) : [...prev.attributes, key],
    }));
  }

  const selected = Boolean(f.easaCode);

  // Autocomplete simulators while typing, until one is selected.
  useEffect(() => {
    if (selected || f.simQuery.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const { simulators } = await api.searchSimulators(f.simQuery.trim());
        setResults(simulators);
      } catch {
        setResults([]);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [f.simQuery, selected]);

  function choose(s: api.SimulatorRef) {
    setF((prev) => ({
      ...prev,
      easaCode: s.easaCode,
      model: s.aircraftType ?? "",
      fstdType: s.qualification ?? "",
      simQuery: s.easaCode,
    }));
    setResults([]);
    setAdding(false);
  }

  function clearDevice() {
    setF((prev) => ({ ...prev, easaCode: "", model: "", fstdType: "", simQuery: "" }));
  }

  async function addNew() {
    setError(null);
    if (!f.easaCode.trim() || !f.model.trim() || !f.fstdType) {
      setError("Enter the FSTD EASA ID, model and type to add a simulator.");
      return;
    }
    setBusy(true);
    try {
      await api.addSimulator({ easaCode: f.easaCode.trim(), aircraftType: f.model.trim(), qualification: f.fstdType });
      setAdding(false);
      setF((prev) => ({ ...prev, simQuery: prev.easaCode.trim() }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the simulator.");
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!selected) {
      setError("Pick a simulator (or add one) first.");
      return;
    }
    const totalMinutes = parseHHMM(f.duration);
    if (totalMinutes <= 0) {
      setError("Enter the session duration as HH:MM.");
      return;
    }
    setBusy(true);
    try {
      await api.createFstd({
        date: `${f.date}T00:00:00Z`,
        deviceType: f.model,
        qualificationNumber: f.easaCode,
        qualification: f.fstdType,
        pilotFunction: f.pilotFunction,
        totalMinutes,
        landings: { day: Number(f.dayLandings), night: Number(f.nightLandings) },
        remarks: f.remarks,
        ...(f.attributes.length ? { attributes: f.attributes } : {}),
      });
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the session.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <form onSubmit={onSubmit} className="space-y-5">
        {error && <Alert>{error}</Alert>}

        <Field label="Date" type="date" value={f.date} onChange={(e) => set("date", e.target.value)} required />

        {/* Simulator picker */}
        {selected ? (
          <div className="rounded-md bg-slate-50 p-3 text-sm">
            <div className="font-medium">{f.easaCode}</div>
            <div className="text-slate-600">
              {f.model || "Unknown model"}
              {f.fstdType ? ` - ${f.fstdType}` : ""}
            </div>
            <button type="button" onClick={clearDevice} className="mt-1 text-xs text-sky-700 underline">
              Change simulator
            </button>
          </div>
        ) : (
          <div>
            <Field
              label="Simulator"
              value={f.simQuery}
              onChange={(e) => set("simQuery", e.target.value)}
              hint="Search by EASA code or serial number."
            />
            {results.length > 0 && (
              <ul className="mt-1 max-h-48 overflow-auto rounded-md border border-slate-200 bg-white text-sm">
                {results.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => choose(s)}
                      className="block w-full px-3 py-1.5 text-left hover:bg-slate-50"
                    >
                      <span className="font-medium">{s.easaCode}</span>
                      <span className="text-slate-500">
                        {s.serialNumber ? `  ${s.serialNumber}` : ""}
                        {s.aircraftType ? `  -  ${s.aircraftType}` : ""}
                        {s.qualification ? ` (${s.qualification})` : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {f.simQuery.trim().length >= 2 && !adding && (
              <button type="button" onClick={() => setAdding(true)} className="mt-2 text-xs text-sky-700 underline">
                Not listed? Add this simulator
              </button>
            )}
            {adding && (
              <div className="mt-2 space-y-3 rounded-md bg-slate-50 p-3">
                <Field label="FSTD EASA ID" value={f.easaCode} onChange={(e) => set("easaCode", e.target.value)} />
                <Field label="Model (aircraft type)" value={f.model} onChange={(e) => set("model", e.target.value)} />
                <Select label="FSTD type" value={f.fstdType} onChange={(e) => set("fstdType", e.target.value)}>
                  <option value="">Select a type...</option>
                  {FSTD_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </Select>
                <div className="flex gap-2">
                  <Button type="button" onClick={addNew} disabled={busy}>Add simulator</Button>
                  <Button type="button" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Select label="Pilot function" value={f.pilotFunction} onChange={(e) => set("pilotFunction", e.target.value as typeof f.pilotFunction)}>
            <option value="TRAINEE">Trainee</option>
            <option value="SFI_SFE">SFI / SFE</option>
          </Select>
          <Field
            label="Session duration (HH:MM)"
            inputMode="numeric"
            placeholder="HH:MM"
            value={f.duration}
            onChange={(e) => set("duration", autoFormatHHMM(e.target.value))}
            required
          />
        </div>

        <div>
          <span className="mb-1 block text-sm font-medium text-slate-700">Landings (optional)</span>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Day" type="number" min={0} inputMode="numeric" value={f.dayLandings} onChange={(e) => set("dayLandings", Number(e.target.value))} />
            <Field label="Night" type="number" min={0} inputMode="numeric" value={f.nightLandings} onChange={(e) => set("nightLandings", Number(e.target.value))} />
          </div>
        </div>

        <div>
          <span className="mb-2 block text-sm font-medium text-slate-700">Attributes and endorsements</span>
          <div className="space-y-3">
            {SIM_GROUPS.map((g) => (
              <div key={g.title}>
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">{g.title}</div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
                  {g.items.map((a) => (
                    <label key={a.key} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={f.attributes.includes(a.key)} onChange={() => toggleAttr(a.key)} />
                      {a.label}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            A proficiency or operator check recorded here will require a sign-off.
          </p>
        </div>

        <Field label="Remarks" value={f.remarks} onChange={(e) => set("remarks", e.target.value)} />

        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>{busy ? "Saving..." : "Save session"}</Button>
          <Button type="button" variant="ghost" onClick={() => navigate("/")}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}
