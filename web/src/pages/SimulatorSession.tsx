import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import * as api from "../api";
import { Alert, Button, Field, NumberStepperField, Panel, Pill, Select, SubHead } from "../components/ui";
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

  const active = SIM_GROUPS.flatMap((g) => g.items).filter((it) => f.attributes.includes(it.key));

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && <Alert>{error}</Alert>}

      <Panel title="Simulator session record">
        <div className="grid grid-cols-1 lg:grid-cols-2 lg:divide-x lg:divide-slate-200">
          {/* ── Device & date ── */}
          <div className="space-y-4 p-4">
            <SubHead>Device &amp; date</SubHead>
            <div className="sm:max-w-[14rem]">
              <Field label="Date" type="date" mono value={f.date} onChange={(e) => set("date", e.target.value)} required />
            </div>
            {selected ? (
              <div>
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Simulator</span>
                <div className="flex items-start justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="text-sm">
                    <div className="font-mono font-semibold text-slate-800">{f.easaCode}</div>
                    <div className="text-slate-600">
                      {f.model || "Unknown model"}
                      {f.fstdType ? ` · ${f.fstdType}` : ""}
                    </div>
                  </div>
                  <button type="button" onClick={clearDevice} className="shrink-0 text-xs font-medium text-brand-600 hover:underline">
                    Change
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <Field
                  label="Simulator"
                  mono
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
                            {s.aircraftType ? `  ·  ${s.aircraftType}` : ""}
                            {s.qualification ? ` (${s.qualification})` : ""}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {f.simQuery.trim().length >= 2 && !adding && (
                  <button type="button" onClick={() => setAdding(true)} className="mt-2 text-xs font-medium text-brand-600 hover:underline">
                    Not listed? Add this simulator
                  </button>
                )}
                {adding && (
                  <div className="mt-2 space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3">
                    <Field label="FSTD EASA ID" mono value={f.easaCode} onChange={(e) => set("easaCode", e.target.value)} />
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
          </div>

          {/* ── Session ── */}
          <div className="space-y-4 p-4">
            <SubHead>Session</SubHead>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Select label="Pilot function" value={f.pilotFunction} onChange={(e) => set("pilotFunction", e.target.value as typeof f.pilotFunction)}>
                <option value="TRAINEE">Trainee</option>
                <option value="SFI_SFE">SFI / SFE</option>
              </Select>
              <Field
                label="Session duration (HH:MM)"
                mono
                inputMode="numeric"
                placeholder="HH:MM"
                value={f.duration}
                onChange={(e) => set("duration", autoFormatHHMM(e.target.value))}
                required
              />
            </div>
            <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Landings (optional)</div>
                <div className="mt-0.5 text-xs text-slate-400">Recorded as day / night</div>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <NumberStepperField label="Day" value={f.dayLandings} onChange={(v) => set("dayLandings", v)} />
                <NumberStepperField label="Night" value={f.nightLandings} onChange={(v) => set("nightLandings", v)} />
              </div>
            </div>
          </div>
        </div>
      </Panel>

      <Panel
        title="Attributes & endorsements"
        badge={<Pill tone={active.length > 0 ? "blue" : "slate"}>{active.length} active</Pill>}
        right="Click to tag"
      >
        <div className="space-y-3 p-4">
          {active.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {active.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => toggleAttr(item.key)}
                  title="Remove"
                  className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 py-1 pl-3 pr-2 text-xs font-medium text-brand-700 hover:bg-brand-100"
                >
                  {item.label}
                  <span aria-hidden="true" className="text-brand-400">×</span>
                </button>
              ))}
            </div>
          )}
          <div className="divide-y divide-slate-100 rounded-md border border-slate-200">
            {SIM_GROUPS.map((g) => (
              <div key={g.title} className="flex flex-col gap-1.5 px-3 py-2.5 sm:flex-row sm:items-start sm:gap-3">
                <div className="shrink-0 pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 sm:w-40">{g.title}</div>
                <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                  {g.items.map((a) => {
                    const on = f.attributes.includes(a.key);
                    return (
                      <button
                        key={a.key}
                        type="button"
                        onClick={() => toggleAttr(a.key)}
                        aria-pressed={on}
                        className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                          on
                            ? "border-brand-600 bg-brand-600 text-white"
                            : "border-slate-200 bg-white text-slate-600 hover:border-brand-300 hover:bg-brand-50"
                        }`}
                      >
                        <span aria-hidden="true" className={on ? "text-white/70" : "text-slate-400"}>{on ? "✓" : "+"}</span>
                        {a.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-500">A proficiency or operator check recorded here will require a sign-off.</p>
        </div>
      </Panel>

      <Panel title="Remarks & navigation notes">
        <div className="p-4">
          <input
            value={f.remarks}
            onChange={(e) => set("remarks", e.target.value)}
            placeholder="Any note for this session — it appears in the logbook export."
            className="block min-h-[2.25rem] w-full appearance-none rounded-md border border-slate-200 bg-white px-2.5 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
          />
        </div>
      </Panel>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => navigate("/")}>Cancel</Button>
        <Button type="submit" disabled={busy}>{busy ? "Saving..." : "Save session"}</Button>
      </div>
    </form>
  );
}
