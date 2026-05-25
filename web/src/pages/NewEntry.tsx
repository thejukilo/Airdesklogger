import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import * as api from "../api";
import { Alert, Button, Card, Field, Select } from "../components/ui";

/**
 * Times are entered as a date plus block-off and block-on times. The pilot
 * chooses UTC or local; either way they are sent as ISO instants (UTC keeps "Z",
 * local carries the device offset) and the server stores UTC, flagging local
 * entries (FOCA 2.2.7). A block-on time at or before block-off rolls to the next
 * day.
 */
type TimeMode = "utc" | "local";

function deviceOffset(localValue: string): string {
  const d = new Date(localValue);
  const minutesEast = -d.getTimezoneOffset();
  const sign = minutesEast >= 0 ? "+" : "-";
  const abs = Math.abs(minutesEast);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

function toIso(localValue: string, mode: TimeMode): string {
  return mode === "utc" ? `${localValue}:00Z` : `${localValue}:00${deviceOffset(localValue)}`;
}

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function blockMinutes(date: string, start: string, end: string): number {
  const s = new Date(`${date}T${start}:00Z`).getTime();
  let e = new Date(`${date}T${end}:00Z`).getTime();
  if (e <= s) e += 86_400_000;
  return Math.round((e - s) / 60_000);
}

/** Debounced ICAO lookup that sets a friendly airport name. Returns a cleanup. */
function resolveAirport(code: string, setName: (n: string | null) => void): () => void {
  if (code.length !== 4) {
    setName(null);
    return () => {};
  }
  const t = setTimeout(async () => {
    try {
      const { airports } = await api.searchAirports(code);
      const exact = airports.find((a) => a.icao === code);
      setName(exact ? exact.name : "Unknown ICAO code");
    } catch {
      setName(null);
    }
  }, 400);
  return () => clearTimeout(t);
}

const empty = {
  date: "",
  blockStart: "",
  blockEnd: "",
  registration: "",
  makeModelVariant: "",
  engineClass: "SE",
  category: "AEROPLANE",
  multiPilot: false,
  departurePlace: "",
  arrivalPlace: "",
  primary: "PIC",
  tookControl: false,
  operatingRole: "",
  flightRules: "VFR",
  dayLandings: 1,
  nightLandings: 0,
  night: 0,
  picName: "SELF",
  remarks: "",
};

export function NewEntry() {
  const navigate = useNavigate();
  const [f, setF] = useState(empty);
  const [timeMode, setTimeMode] = useState<TimeMode>("utc");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [aircraftMsg, setAircraftMsg] = useState<string | null>(null);
  const [depName, setDepName] = useState<string | null>(null);
  const [arrName, setArrName] = useState<string | null>(null);

  function set<K extends keyof typeof f>(k: K, v: (typeof f)[K]) {
    setF((prev) => ({ ...prev, [k]: v }));
  }

  // Auto-fill aircraft details a moment after the registration stops changing.
  const reg = f.registration.trim().toUpperCase();
  useEffect(() => {
    if (reg.length < 2) {
      setAircraftMsg(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const { match } = await api.lookupAircraft(reg);
        if (match) {
          setF((prev) => ({
            ...prev,
            makeModelVariant: match.model || prev.makeModelVariant,
            category: ["AEROPLANE", "HELICOPTER", "SAILPLANE", "BALLOON"].includes(match.category)
              ? match.category
              : prev.category,
            multiPilot: match.multiPilot ?? prev.multiPilot,
          }));
          setAircraftMsg(`Found: ${match.model}`);
        } else {
          setAircraftMsg("Not found; enter the type manually.");
        }
      } catch {
        setAircraftMsg(null);
      }
    }, 600);
    return () => clearTimeout(t);
  }, [reg]);

  // Show the airport name for entered ICAO codes.
  const dep = f.departurePlace.trim().toUpperCase();
  const arr = f.arrivalPlace.trim().toUpperCase();
  useEffect(() => resolveAirport(dep, setDepName), [dep]);
  useEffect(() => resolveAirport(arr, setArrName), [arr]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const arrivalDate = f.blockEnd > f.blockStart ? f.date : nextDay(f.date);
      const ifr = f.flightRules === "IFR" ? blockMinutes(f.date, f.blockStart, f.blockEnd) : 0;
      await api.createEntry({
        aircraft: {
          makeModelVariant: f.makeModelVariant,
          registration: reg,
          engineClass: f.engineClass as "SE" | "ME",
          multiPilot: f.multiPilot,
          category: f.category,
        },
        legs: [
          {
            departurePlace: f.departurePlace.toUpperCase(),
            departureTime: toIso(`${f.date}T${f.blockStart}`, timeMode),
            arrivalPlace: f.arrivalPlace.toUpperCase(),
            arrivalTime: toIso(`${arrivalDate}T${f.blockEnd}`, timeMode),
          },
        ],
        picName: f.picName,
        landings: { day: Number(f.dayLandings), night: Number(f.nightLandings) },
        conditions: { night: Number(f.night), ifr },
        function: {
          primary: f.primary,
          instructor: 0,
          ...(f.primary === "SAFETY_PILOT" ? { tookControl: f.tookControl } : {}),
        },
        ...(f.operatingRole ? { operatingRole: f.operatingRole } : {}),
        remarks: f.remarks,
      } as never);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the entry.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold">New flight entry</h1>
      <Card>
        <form onSubmit={onSubmit} className="space-y-5">
          {error && <Alert>{error}</Alert>}

          <Field label="Date of flight" type="date" value={f.date} onChange={(e) => set("date", e.target.value)} required />

          <div>
            <Field
              label="Aircraft registration"
              value={f.registration}
              onChange={(e) => set("registration", e.target.value)}
              hint="The type fills in automatically from the registration."
              required
            />
            {aircraftMsg && <p className="mt-1 text-xs text-slate-500">{aircraftMsg}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Make / model / variant" value={f.makeModelVariant} onChange={(e) => set("makeModelVariant", e.target.value)} required />
            <Select label="Category" value={f.category} onChange={(e) => set("category", e.target.value)}>
              <option value="AEROPLANE">Aeroplane</option>
              <option value="HELICOPTER">Helicopter</option>
              <option value="SAILPLANE">Sailplane</option>
              <option value="BALLOON">Balloon</option>
            </Select>
            <Select label="Engine" value={f.engineClass} onChange={(e) => set("engineClass", e.target.value)}>
              <option value="SE">Single-engine</option>
              <option value="ME">Multi-engine</option>
            </Select>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input type="checkbox" checked={f.multiPilot} onChange={(e) => set("multiPilot", e.target.checked)} />
              Multi-pilot operation
            </label>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Field label="Departure (ICAO)" value={f.departurePlace} onChange={(e) => set("departurePlace", e.target.value)} required />
              {depName && <p className="mt-1 text-xs text-slate-500">{depName}</p>}
            </div>
            <div>
              <Field label="Arrival (ICAO)" value={f.arrivalPlace} onChange={(e) => set("arrivalPlace", e.target.value)} required />
              {arrName && <p className="mt-1 text-xs text-slate-500">{arrName}</p>}
            </div>
          </div>

          <div className="rounded-md bg-slate-50 p-3">
            <Select label="Times are entered in" value={timeMode} onChange={(e) => setTimeMode(e.target.value as TimeMode)}>
              <option value="utc">UTC</option>
              <option value="local">Local time (this device)</option>
            </Select>
            <div className="mt-3 grid grid-cols-2 gap-4">
              <Field label="Block off (start)" type="time" value={f.blockStart} onChange={(e) => set("blockStart", e.target.value)} required />
              <Field label="Block on (end)" type="time" value={f.blockEnd} onChange={(e) => set("blockEnd", e.target.value)} required />
            </div>
            <p className="mt-1 text-xs text-slate-500">Stored as UTC; local entries are flagged on the export.</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Name of PIC" value={f.picName} onChange={(e) => set("picName", e.target.value)} required />
            <Select label="Pilot function" value={f.primary} onChange={(e) => set("primary", e.target.value)}>
              <option value="PIC">Pilot in command</option>
              <option value="CO_PILOT">Second in command (co-pilot)</option>
              <option value="DUAL">Dual (student / trainee)</option>
              <option value="PICUS">PIC under supervision (PICUS)</option>
              <option value="SPIC">Student PIC (SPIC)</option>
              <option value="SAFETY_PILOT">Safety pilot</option>
            </Select>
          </div>

          {f.primary === "SAFETY_PILOT" && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={f.tookControl} onChange={(e) => set("tookControl", e.target.checked)} />
              I took control (a safety pilot logs time only if they took control)
            </label>
          )}

          <div className="grid grid-cols-2 gap-4">
            <Select label="Operating role (optional)" value={f.operatingRole} onChange={(e) => set("operatingRole", e.target.value)}>
              <option value="">Not recorded</option>
              <option value="PILOT_FLYING">Pilot flying</option>
              <option value="PILOT_MONITORING">Pilot monitoring</option>
            </Select>
            <Select label="Flight rules" value={f.flightRules} onChange={(e) => set("flightRules", e.target.value)}>
              <option value="VFR">VFR</option>
              <option value="IFR">IFR</option>
            </Select>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <Field label="Day landings" type="number" min={0} value={f.dayLandings} onChange={(e) => set("dayLandings", Number(e.target.value))} />
            <Field label="Night landings" type="number" min={0} value={f.nightLandings} onChange={(e) => set("nightLandings", Number(e.target.value))} />
            <Field label="Night time (min)" type="number" min={0} value={f.night} onChange={(e) => set("night", Number(e.target.value))} />
          </div>

          <Field label="Remarks" value={f.remarks} onChange={(e) => set("remarks", e.target.value)} />

          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>{busy ? "Saving..." : "Save entry"}</Button>
            <Button type="button" variant="ghost" onClick={() => navigate("/")}>Cancel</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
