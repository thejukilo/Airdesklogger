import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import * as api from "../api";
import { Alert, Button, Card, Field, Select } from "../components/ui";
import { ATTRIBUTES } from "../labels";

/**
 * Times are entered as a date plus block-off and block-on times. The pilot
 * chooses UTC or local; either way they are sent as ISO instants (UTC keeps "Z",
 * local carries the device offset) and the server stores UTC, flagging local
 * entries (FOCA 2.2.7). A block-on time at or before block-off rolls to the next
 * day.
 */
type TimeMode = "utc" | "local";

/**
 * UTC times are sent with a Z suffix. Local times are sent as a bare wall-clock
 * value with no zone: the server converts them using the aerodrome's own
 * timezone (from the ICAO code), not this device's timezone.
 */
function toSubmitTime(dateTime: string, mode: TimeMode): string {
  return mode === "utc" ? `${dateTime}:00Z` : `${dateTime}:00`;
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
  departurePlaceName: "",
  arrivalPlaceName: "",
  primary: "PIC",
  tookControl: false,
  operatingRole: "",
  flightRules: "VFR",
  instructor: 0,
  dayLandings: 1,
  nightLandings: 0,
  picName: "SELF",
  remarks: "",
  extraLegs: [] as Array<{ departurePlace: string; arrivalPlace: string; blockStart: string; blockEnd: string }>,
  attributes: [] as string[],
  hesloLevel: "",
  hecLevel: "",
  hoistCycles: 0,
  mountainLandingGear: "",
  lowVisibilityLandingType: "",
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

  function toggleAttr(key: string) {
    setF((prev) => ({
      ...prev,
      attributes: prev.attributes.includes(key)
        ? prev.attributes.filter((a) => a !== key)
        : [...prev.attributes, key],
    }));
  }

  function addLeg() {
    setF((p) => ({
      ...p,
      extraLegs: [...p.extraLegs, { departurePlace: p.departurePlace, arrivalPlace: p.departurePlace, blockStart: "", blockEnd: "" }],
    }));
  }
  function removeLeg(i: number) {
    setF((p) => ({ ...p, extraLegs: p.extraLegs.filter((_, j) => j !== i) }));
  }
  function setLeg(i: number, k: "departurePlace" | "arrivalPlace" | "blockStart" | "blockEnd", v: string) {
    setF((p) => ({ ...p, extraLegs: p.extraLegs.map((l, j) => (j === i ? { ...l, [k]: v } : l)) }));
  }

  const has = (key: string) => f.attributes.includes(key);
  const showDetails = has("heslo") || has("hec") || has("mountain_landings") || has("low_visibility_landing");

  function buildAttributeDetails(): api.AttributeDetails | null {
    const d: api.AttributeDetails = {};
    if (has("heslo") && f.hesloLevel) d.hesloLevel = Number(f.hesloLevel) as 1 | 2 | 3 | 4;
    if (has("hec") && f.hecLevel) d.hecLevel = Number(f.hecLevel) as 1 | 2;
    if ((has("heslo") || has("hec")) && Number(f.hoistCycles) > 0) d.hoistCycles = Number(f.hoistCycles);
    if (has("mountain_landings") && f.mountainLandingGear) {
      d.mountainLandingGear = f.mountainLandingGear as "SKI" | "WHEELS";
    }
    if (has("low_visibility_landing") && f.lowVisibilityLandingType) {
      d.lowVisibilityLandingType = f.lowVisibilityLandingType;
    }
    return Object.keys(d).length > 0 ? d : null;
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

  // EASA times the flight from first movement (block) for aeroplanes, but from
  // rotor start to rotor stop for helicopters (AMC1 FCL.050 (g)).
  const timeLabels =
    f.category === "HELICOPTER"
      ? { off: "Rotor start", on: "Rotor stop" }
      : { off: "Block off (start)", on: "Block on (end)" };

  // Show the airport name for entered ICAO codes.
  const dep = f.departurePlace.trim().toUpperCase();
  const arr = f.arrivalPlace.trim().toUpperCase();
  useEffect(() => resolveAirport(dep, setDepName), [dep]);
  useEffect(() => resolveAirport(arr, setArrName), [arr]);

  // The date cannot be in the future, so cap the picker at today (device date).
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  // On a dual flight the PIC is the instructor, so SELF is not valid: clear it
  // when the function switches to dual so the pilot must type the instructor.
  const isDual = f.primary === "DUAL";
  useEffect(() => {
    if (isDual && f.picName.trim().toUpperCase() === "SELF") set("picName", "");
  }, [isDual]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const arrivalDate = f.blockEnd > f.blockStart ? f.date : nextDay(f.date);
      const ifr = f.flightRules === "IFR" ? blockMinutes(f.date, f.blockStart, f.blockEnd) : 0;
      await api.createEntry({
        timeZone: timeMode === "local" ? "LOCAL" : "UTC",
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
            departureTime: toSubmitTime(`${f.date}T${f.blockStart}`, timeMode),
            arrivalPlace: f.arrivalPlace.toUpperCase(),
            arrivalTime: toSubmitTime(`${arrivalDate}T${f.blockEnd}`, timeMode),
            ...(f.departurePlace.toUpperCase() === "ZZZZ" && f.departurePlaceName
              ? { departurePlaceName: f.departurePlaceName }
              : {}),
            ...(f.arrivalPlace.toUpperCase() === "ZZZZ" && f.arrivalPlaceName
              ? { arrivalPlaceName: f.arrivalPlaceName }
              : {}),
          },
          ...f.extraLegs.map((l) => ({
            departurePlace: l.departurePlace.toUpperCase(),
            departureTime: toSubmitTime(`${f.date}T${l.blockStart}`, timeMode),
            arrivalPlace: l.arrivalPlace.toUpperCase(),
            arrivalTime: toSubmitTime(`${l.blockEnd > l.blockStart ? f.date : nextDay(f.date)}T${l.blockEnd}`, timeMode),
          })),
        ],
        picName: f.picName,
        landings: { day: Number(f.dayLandings), night: Number(f.nightLandings) },
        conditions: { night: 0, ifr },
        function: {
          primary: f.primary,
          instructor: Number(f.instructor),
          ...(f.primary === "SAFETY_PILOT" ? { tookControl: f.tookControl } : {}),
        },
        ...(f.operatingRole ? { operatingRole: f.operatingRole } : {}),
        ...(f.attributes.length ? { attributes: f.attributes } : {}),
        ...(buildAttributeDetails() ? { attributeDetails: buildAttributeDetails() } : {}),
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

          <Field label="Date of flight" type="date" max={today} value={f.date} onChange={(e) => set("date", e.target.value)} required />

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
              <Field label="Departure (ICAO)" value={f.departurePlace} onChange={(e) => set("departurePlace", e.target.value)} hint="Use ZZZZ for a place with no ICAO code." required />
              {depName && <p className="mt-1 text-xs text-slate-500">{depName}</p>}
              {dep === "ZZZZ" && (
                <Field label="Departure place name" value={f.departurePlaceName} onChange={(e) => set("departurePlaceName", e.target.value)} required />
              )}
            </div>
            <div>
              <Field label="Arrival (ICAO)" value={f.arrivalPlace} onChange={(e) => set("arrivalPlace", e.target.value)} hint="Use ZZZZ for a place with no ICAO code." required />
              {arrName && <p className="mt-1 text-xs text-slate-500">{arrName}</p>}
              {arr === "ZZZZ" && (
                <Field label="Arrival place name" value={f.arrivalPlaceName} onChange={(e) => set("arrivalPlaceName", e.target.value)} required />
              )}
            </div>
          </div>

          <div className="rounded-md bg-slate-50 p-3">
            <Select label="Times are entered in" value={timeMode} onChange={(e) => setTimeMode(e.target.value as TimeMode)}>
              <option value="utc">UTC</option>
              <option value="local">Local time (at the aerodrome)</option>
            </Select>
            <div className="mt-3 grid grid-cols-2 gap-4">
              <Field label={timeLabels.off} type="time" value={f.blockStart} onChange={(e) => set("blockStart", e.target.value)} required />
              <Field label={timeLabels.on} type="time" value={f.blockEnd} onChange={(e) => set("blockEnd", e.target.value)} required />
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Local times are read at the departure and arrival aerodromes and converted to UTC for storage; the export notes that the entry was made in local time.
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">Additional legs (same-day series)</span>
              <button type="button" onClick={addLeg} className="text-xs text-slate-600 underline">
                Add leg
              </button>
            </div>
            <p className="mb-2 text-xs text-slate-500">
              For a series of flights on the same day that each return to the departure point with under 30
              minutes between them, recorded as one entry (AMC1 FCL.050).
            </p>
            {f.extraLegs.map((l, i) => (
              <div key={i} className="mb-2 grid grid-cols-9 items-end gap-2">
                <div className="col-span-2">
                  <Field label="From" value={l.departurePlace} onChange={(e) => setLeg(i, "departurePlace", e.target.value)} />
                </div>
                <div className="col-span-2">
                  <Field label="To" value={l.arrivalPlace} onChange={(e) => setLeg(i, "arrivalPlace", e.target.value)} />
                </div>
                <div className="col-span-2">
                  <Field label={timeLabels.off} type="time" value={l.blockStart} onChange={(e) => setLeg(i, "blockStart", e.target.value)} />
                </div>
                <div className="col-span-2">
                  <Field label={timeLabels.on} type="time" value={l.blockEnd} onChange={(e) => setLeg(i, "blockEnd", e.target.value)} />
                </div>
                <button type="button" onClick={() => removeLeg(i)} className="pb-2 text-xs text-slate-500 underline">
                  Remove
                </button>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field
              label={isDual ? "Name of PIC (flight instructor)" : "Name of PIC"}
              value={f.picName}
              onChange={(e) => set("picName", e.target.value)}
              hint={isDual ? "On a dual flight enter the instructor's name, not SELF." : undefined}
              required
            />
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
            <Field label="Instructor time (min)" type="number" min={0} value={f.instructor} onChange={(e) => set("instructor", Number(e.target.value))} />
          </div>
          <p className="-mt-2 text-xs text-slate-500">
            Night time is calculated automatically from the departure aerodrome and the block times.
          </p>

          <div>
            <span className="mb-2 block text-sm font-medium text-slate-700">
              Attributes and endorsements
            </span>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
              {ATTRIBUTES.map((a) => (
                <label key={a.key} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={f.attributes.includes(a.key)}
                    onChange={() => toggleAttr(a.key)}
                  />
                  {a.label}
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              A skill test, proficiency check or line check will require a sign-off.
            </p>
            {showDetails && (
              <div className="mt-3 grid grid-cols-2 gap-4 rounded-md bg-slate-50 p-3">
                {has("heslo") && (
                  <Select label="HESLO level" value={f.hesloLevel} onChange={(e) => set("hesloLevel", e.target.value)}>
                    <option value="">Not set</option>
                    <option value="1">HESLO 1</option>
                    <option value="2">HESLO 2</option>
                    <option value="3">HESLO 3</option>
                    <option value="4">HESLO 4</option>
                  </Select>
                )}
                {has("hec") && (
                  <Select label="HEC level" value={f.hecLevel} onChange={(e) => set("hecLevel", e.target.value)}>
                    <option value="">Not set</option>
                    <option value="1">HEC 1</option>
                    <option value="2">HEC 2</option>
                  </Select>
                )}
                {(has("heslo") || has("hec")) && (
                  <Field label="Number of cycles" type="number" min={0} value={f.hoistCycles} onChange={(e) => set("hoistCycles", Number(e.target.value))} />
                )}
                {has("mountain_landings") && (
                  <Select label="Mountain landing gear" value={f.mountainLandingGear} onChange={(e) => set("mountainLandingGear", e.target.value)}>
                    <option value="">Not set</option>
                    <option value="SKI">Ski</option>
                    <option value="WHEELS">Wheels</option>
                  </Select>
                )}
                {has("low_visibility_landing") && (
                  <Field label="Low-visibility landing type" value={f.lowVisibilityLandingType} onChange={(e) => set("lowVisibilityLandingType", e.target.value)} hint="For example CAT II, CAT IIIA." />
                )}
              </div>
            )}
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
