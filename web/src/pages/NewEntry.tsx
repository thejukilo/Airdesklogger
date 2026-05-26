import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import * as api from "../api";
import { Alert, Button, Card, Field, Select } from "../components/ui";
import { ATTRIBUTES } from "../labels";

/** A titled card that groups related fields, so the form reads as sections. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      <div className="space-y-4">{children}</div>
    </Card>
  );
}

/**
 * Times are entered as a date plus block-off and block-on times. The pilot
 * chooses UTC or local. UTC is sent with a Z; local is sent as a bare wall-clock
 * value and the server converts it using the aerodrome's timezone (FOCA 2.2.7),
 * always storing UTC. A block-on time at or before block-off rolls to the next
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
  launchMethod: "",
  balloonFlightType: "",
  instructor: 0,
  landings: 1,
  picName: "SELF",
  remarks: "",
  attributes: [] as string[],
  hesloLevel: "",
  hecLevel: "",
  hoistCycles: 0,
  mountainLandingGear: "",
  lowVisibilityLandingType: "",
};

/** Reverse-map a stored entry's content into the form fields, for editing. */
function fromContent(c: api.EntryContent): typeof empty {
  const cols = c.columns;
  const t = (iso: string | undefined) => (iso && iso.length >= 16 ? iso.slice(11, 16) : "");
  return {
    date: cols?.date ?? "",
    blockStart: t(cols?.departureTime),
    blockEnd: t(cols?.arrivalTime),
    registration: c.aircraft?.registration ?? "",
    makeModelVariant: c.aircraft?.makeModelVariant ?? "",
    engineClass: c.aircraft?.engineClass ?? ((cols?.multiEngine ?? 0) > 0 ? "ME" : "SE"),
    category: c.aircraft?.category ?? cols?.category ?? "AEROPLANE",
    multiPilot: c.aircraft?.multiPilot ?? ((cols?.multiPilot ?? 0) > 0),
    departurePlace: cols?.departurePlace ?? "",
    arrivalPlace: cols?.arrivalPlace ?? "",
    departurePlaceName: cols?.departurePlaceName ?? "",
    arrivalPlaceName: cols?.arrivalPlaceName ?? "",
    primary: c.function?.primary ?? "PIC",
    tookControl: c.function?.tookControl ?? false,
    operatingRole: cols?.operatingRole ?? "",
    flightRules: (cols?.ifr ?? 0) > 0 ? "IFR" : "VFR",
    launchMethod: cols?.launchMethod ?? "",
    balloonFlightType: cols?.balloonFlightType ?? "",
    instructor: c.function?.instructor ?? 0,
    landings: (cols?.dayLandings ?? 0) + (cols?.nightLandings ?? 0),
    picName: c.picName ?? "SELF",
    remarks: c.remarks ?? "",
    attributes: cols?.attributes ?? [],
    hesloLevel: cols?.attributeDetails?.hesloLevel ? String(cols.attributeDetails.hesloLevel) : "",
    hecLevel: cols?.attributeDetails?.hecLevel ? String(cols.attributeDetails.hecLevel) : "",
    hoistCycles: cols?.attributeDetails?.hoistCycles ?? 0,
    mountainLandingGear: cols?.attributeDetails?.mountainLandingGear ?? "",
    lowVisibilityLandingType: cols?.attributeDetails?.lowVisibilityLandingType ?? "",
  };
}

export function NewEntry() {
  const navigate = useNavigate();
  const { id: editId } = useParams();
  const editing = Boolean(editId);
  const [f, setF] = useState(empty);
  const [timeMode, setTimeMode] = useState<TimeMode>("utc");
  const [reason, setReason] = useState("");
  const [loadingEntry, setLoadingEntry] = useState(editing);
  const [editLocked, setEditLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [aircraftMsg, setAircraftMsg] = useState<string | null>(null);
  const [depName, setDepName] = useState<string | null>(null);
  const [arrName, setArrName] = useState<string | null>(null);

  useEffect(() => {
    if (!editId) return;
    api
      .getEntry(editId)
      .then((e) => {
        if (e.current?.content) setF(fromContent(e.current.content));
        setEditLocked(Boolean(e.current?.locked));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load the entry."))
      .finally(() => setLoadingEntry(false));
  }, [editId]);

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
  // Balloon places are free text, so no ICAO name lookup for them.
  useEffect(() => {
    if (f.category === "BALLOON") { setDepName(null); return; }
    return resolveAirport(dep, setDepName);
  }, [dep, f.category]);
  useEffect(() => {
    if (f.category === "BALLOON") { setArrName(null); return; }
    return resolveAirport(arr, setArrName);
  }, [arr, f.category]);

  // The date cannot be in the future, so cap the picker at today (device date).
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  // On a dual flight the PIC is the instructor, so SELF is not valid: clear it
  // when the function switches to dual so the pilot must type the instructor.
  const isDual = f.primary === "DUAL";
  useEffect(() => {
    if (isDual && f.picName.trim().toUpperCase() === "SELF") set("picName", "");
  }, [isDual]);

  // Balloons and sailplanes are not aeroplane/helicopter: they have no SE/ME or
  // multi-pilot columns and no IFR, but carry their own conditions (launch
  // method for sailplanes, free/tethered for balloons).
  const isSailplane = f.category === "SAILPLANE";
  const isBalloon = f.category === "BALLOON";
  const isPowered = !isSailplane && !isBalloon;
  useEffect(() => {
    if (!isPowered && f.primary !== "PIC" && f.primary !== "DUAL") set("primary", "PIC");
    // Balloon places are free text with no aerodrome timezone, so times are UTC.
    if (isBalloon && timeMode === "local") setTimeMode("utc");
  }, [f.category]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const arrivalDate = f.blockEnd > f.blockStart ? f.date : nextDay(f.date);
      const ifr = isPowered && f.flightRules === "IFR" ? blockMinutes(f.date, f.blockStart, f.blockEnd) : 0;
      const payload = {
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
            departurePlace: isBalloon ? f.departurePlace.trim() : f.departurePlace.toUpperCase(),
            departureTime: toSubmitTime(`${f.date}T${f.blockStart}`, timeMode),
            arrivalPlace: isBalloon ? f.arrivalPlace.trim() : f.arrivalPlace.toUpperCase(),
            arrivalTime: toSubmitTime(`${arrivalDate}T${f.blockEnd}`, timeMode),
            ...(f.departurePlace.toUpperCase() === "ZZZZ" && f.departurePlaceName
              ? { departurePlaceName: f.departurePlaceName }
              : {}),
            ...(f.arrivalPlace.toUpperCase() === "ZZZZ" && f.arrivalPlaceName
              ? { arrivalPlaceName: f.arrivalPlaceName }
              : {}),
          },
        ],
        picName: f.picName,
        landings: { day: Number(f.landings), night: 0 },
        conditions: { night: 0, ifr },
        function: {
          primary: f.primary,
          instructor: Number(f.instructor),
          ...(f.primary === "SAFETY_PILOT" ? { tookControl: f.tookControl } : {}),
        },
        ...(isPowered && f.operatingRole ? { operatingRole: f.operatingRole } : {}),
        ...(isSailplane && f.launchMethod ? { launchMethod: f.launchMethod } : {}),
        ...(isBalloon && f.balloonFlightType ? { balloonFlightType: f.balloonFlightType } : {}),
        ...(f.attributes.length ? { attributes: f.attributes } : {}),
        ...(buildAttributeDetails() ? { attributeDetails: buildAttributeDetails() } : {}),
        remarks: f.remarks,
      };
      if (editing && editId) {
        const amendPayload = reason.trim() ? { ...payload, reason: reason.trim() } : payload;
        await api.amendEntry(editId, amendPayload as never);
        navigate(`/entry/${editId}`);
      } else {
        await api.createEntry(payload as never);
        navigate("/");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the entry.");
    } finally {
      setBusy(false);
    }
  }

  if (loadingEntry) {
    return <p className="text-sm text-slate-500">Loading entry...</p>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold">{editing ? "Edit flight entry" : "New flight entry"}</h1>
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <Alert>{error}</Alert>}

        {editing && (
          <Section title="Change">
            {editLocked && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                This entry is signed. Saving your changes removes the sign-off and reopens it for the
                instructor to sign again.
              </p>
            )}
            <Field
              label="Reason for change (optional)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              hint="Changes more than 48 hours after the entry are recorded in the change history."
            />
          </Section>
        )}

        <Section title="Aircraft and date">
          <div className="max-w-[14rem]">
            <Field label="Date of flight" type="date" max={today} value={f.date} onChange={(e) => set("date", e.target.value)} required />
          </div>
          <div>
            <Field
              label="Aircraft registration"
              value={f.registration}
              onChange={(e) => set("registration", e.target.value)}
              hint="The type fills in automatically from the registration."
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              required
            />
            {aircraftMsg && <p className="mt-1 text-xs text-slate-500">{aircraftMsg}</p>}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Make / model / variant" value={f.makeModelVariant} onChange={(e) => set("makeModelVariant", e.target.value)} required />
            <Select label="Category" value={f.category} onChange={(e) => set("category", e.target.value)}>
              <option value="AEROPLANE">Aeroplane</option>
              <option value="HELICOPTER">Helicopter</option>
              <option value="SAILPLANE">Sailplane</option>
              <option value="BALLOON">Balloon</option>
            </Select>
            {isPowered && (
              <Select label="Engine" value={f.engineClass} onChange={(e) => set("engineClass", e.target.value)}>
                <option value="SE">Single-engine</option>
                <option value="ME">Multi-engine</option>
              </Select>
            )}
            {isPowered && (
              <label className="flex items-end gap-2 pb-2 text-sm">
                <input type="checkbox" checked={f.multiPilot} onChange={(e) => set("multiPilot", e.target.checked)} />
                Multi-pilot operation
              </label>
            )}
          </div>
        </Section>

        <Section title="Route and times">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              {isBalloon ? (
                <Field label="Departure (place)" value={f.departurePlace} onChange={(e) => set("departurePlace", e.target.value)} required />
              ) : (
                <>
                  <Field label="Departure (ICAO)" value={f.departurePlace} onChange={(e) => set("departurePlace", e.target.value)} hint="Use ZZZZ for a place with no ICAO code." autoCapitalize="characters" autoCorrect="off" spellCheck={false} required />
                  {depName && <p className="mt-1 text-xs text-slate-500">{depName}</p>}
                  {dep === "ZZZZ" && (
                    <Field label="Departure place name" value={f.departurePlaceName} onChange={(e) => set("departurePlaceName", e.target.value)} required />
                  )}
                </>
              )}
            </div>
            <div>
              {isBalloon ? (
                <Field label="Arrival (place)" value={f.arrivalPlace} onChange={(e) => set("arrivalPlace", e.target.value)} required />
              ) : (
                <>
                  <Field label="Arrival (ICAO)" value={f.arrivalPlace} onChange={(e) => set("arrivalPlace", e.target.value)} hint="Use ZZZZ for a place with no ICAO code." autoCapitalize="characters" autoCorrect="off" spellCheck={false} required />
                  {arrName && <p className="mt-1 text-xs text-slate-500">{arrName}</p>}
                  {arr === "ZZZZ" && (
                    <Field label="Arrival place name" value={f.arrivalPlaceName} onChange={(e) => set("arrivalPlaceName", e.target.value)} required />
                  )}
                </>
              )}
            </div>
          </div>

          <div className="rounded-md bg-slate-50 p-3">
            <Select label="Times are entered in" value={timeMode} onChange={(e) => setTimeMode(e.target.value as TimeMode)}>
              <option value="utc">UTC</option>
              {!isBalloon && <option value="local">Local time (at the aerodrome)</option>}
            </Select>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={timeLabels.off} type="time" value={f.blockStart} onChange={(e) => set("blockStart", e.target.value)} required />
              <Field label={timeLabels.on} type="time" value={f.blockEnd} onChange={(e) => set("blockEnd", e.target.value)} required />
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Local times are read at the departure and arrival aerodromes and converted to UTC for storage; the export notes that the entry was made in local time.
            </p>
          </div>
        </Section>

        <Section title="Function">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label={isDual ? "Name of PIC (flight instructor)" : "Name of PIC"}
              value={f.picName}
              onChange={(e) => set("picName", e.target.value)}
              hint={isDual ? "On a dual flight enter the instructor's name, not SELF." : undefined}
              required
            />
            <Select label="Pilot function" value={f.primary} onChange={(e) => set("primary", e.target.value)}>
              <option value="PIC">Pilot in command</option>
              <option value="DUAL">Dual (student / trainee)</option>
              {isPowered && <option value="CO_PILOT">Second in command (co-pilot)</option>}
              {isPowered && <option value="PICUS">PIC under supervision (PICUS)</option>}
              {isPowered && <option value="SPIC">Student PIC (SPIC)</option>}
              {isPowered && <option value="SAFETY_PILOT">Safety pilot</option>}
            </Select>
          </div>

          {f.primary === "SAFETY_PILOT" && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={f.tookControl} onChange={(e) => set("tookControl", e.target.checked)} />
              I took control (a safety pilot logs time only if they took control)
            </label>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {isPowered && (
              <Select label="Operating role (optional)" value={f.operatingRole} onChange={(e) => set("operatingRole", e.target.value)}>
                <option value="">Not recorded</option>
                <option value="PILOT_FLYING">Pilot flying</option>
                <option value="PILOT_MONITORING">Pilot monitoring</option>
              </Select>
            )}
            {isPowered && (
              <Select label="Flight rules" value={f.flightRules} onChange={(e) => set("flightRules", e.target.value)}>
                <option value="VFR">VFR</option>
                <option value="IFR">IFR</option>
              </Select>
            )}
            {isSailplane && (
              <Select label="Launch method" value={f.launchMethod} onChange={(e) => set("launchMethod", e.target.value)}>
                <option value="">Not recorded</option>
                <option value="WINCH">Winch</option>
                <option value="AEROTOW">Aerotow</option>
                <option value="SELF_LAUNCH">Self-launch</option>
                <option value="BUNGEE">Bungee</option>
                <option value="CAR_TOW">Car tow</option>
              </Select>
            )}
            {isBalloon && (
              <Select label="Flight type" value={f.balloonFlightType} onChange={(e) => set("balloonFlightType", e.target.value)}>
                <option value="">Not recorded</option>
                <option value="FREE">Free flight</option>
                <option value="TETHERED">Tethered flight</option>
              </Select>
            )}
          </div>
        </Section>

        <Section title="Landings and time">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Landings" type="number" min={0} inputMode="numeric" value={f.landings} onChange={(e) => set("landings", Number(e.target.value))} />
            <Field label="Instructor (min)" type="number" min={0} inputMode="numeric" value={f.instructor} onChange={(e) => set("instructor", Number(e.target.value))} />
          </div>
          <p className="text-xs text-slate-500">
            Night time, and whether the landings count as day or night, are worked out automatically from the
            aerodrome positions and the block times.
          </p>
        </Section>

        <Section title="Attributes and endorsements">
          <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-3">
            {ATTRIBUTES.map((a) => (
              <label key={a.key} className="flex items-center gap-2 py-1 text-sm">
                <input
                  type="checkbox"
                  checked={f.attributes.includes(a.key)}
                  onChange={() => toggleAttr(a.key)}
                />
                {a.label}
              </label>
            ))}
          </div>
          <p className="text-xs text-slate-500">
            A skill test, proficiency check or line check will require a sign-off.
          </p>
          {showDetails && (
            <div className="grid grid-cols-1 gap-4 rounded-md bg-slate-50 p-3 sm:grid-cols-2">
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
                <Field label="Number of cycles" type="number" min={0} inputMode="numeric" value={f.hoistCycles} onChange={(e) => set("hoistCycles", Number(e.target.value))} />
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
        </Section>

        <Section title="Remarks">
          <Field label="Remarks" value={f.remarks} onChange={(e) => set("remarks", e.target.value)} />
        </Section>

        {/* Sticky action bar on mobile so Save is always within reach. The extra
            bottom padding clears the iOS home indicator / browser bar. */}
        <div className="sticky bottom-0 z-10 -mx-4 flex gap-2 border-t border-slate-200 bg-white/95 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.85rem)] shadow-[0_-6px_16px_rgba(15,23,42,0.08)] backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:p-0 md:shadow-none md:backdrop-blur-none">
          <Button type="submit" disabled={busy} className="flex-1 py-2.5 md:flex-none md:py-2">{busy ? "Saving..." : editing ? "Save changes" : "Save entry"}</Button>
          <Button type="button" variant="ghost" onClick={() => navigate(editing && editId ? `/entry/${editId}` : "/")} className="py-2.5 md:py-2">Cancel</Button>
        </div>
      </form>
    </div>
  );
}
