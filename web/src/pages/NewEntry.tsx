import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import * as api from "../api";
import { Alert, Button, Card, Field, Select } from "../components/ui";
import { ATTRIBUTE_GROUPS, ATTRIBUTE_LABELS, CATEGORY_LABELS } from "../labels";

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

/**
 * Pilot function as one choice. The five primary capacities map straight to the
 * domain `primary`; the instructor/examiner choices map to `primary` plus an
 * `instructorPosition` (Part-FCL: instructor on the pilot seat, jump seat,
 * supervising, or as examiner). Jump-seat time is not loggable as PIC, so it
 * maps to co-pilot. Safety pilot is kept only so an older entry still loads.
 */
type FnOption = {
  key: string;
  label: string;
  primary: "PIC" | "PICUS" | "SPIC" | "CO_PILOT" | "DUAL" | "SAFETY_PILOT";
  instructorPosition?: "PILOT_SEAT" | "JUMP_SEAT" | "SUPERVISING" | "EXAMINER";
};

const POWERED_FUNCTIONS: FnOption[] = [
  { key: "PIC", label: "PIC (pilot in command)", primary: "PIC" },
  { key: "PICUS", label: "PICUS (PIC under supervision)", primary: "PICUS" },
  { key: "SPIC", label: "SPIC (student PIC)", primary: "SPIC" },
  { key: "CO_PILOT", label: "Co-pilot (COPI)", primary: "CO_PILOT" },
  { key: "DUAL", label: "Dual", primary: "DUAL" },
  { key: "FI_PILOT_SEAT", label: "Instructor (pilot seat)", primary: "PIC", instructorPosition: "PILOT_SEAT" },
  { key: "FI_JUMP_SEAT", label: "Instructor (jump seat)", primary: "CO_PILOT", instructorPosition: "JUMP_SEAT" },
  { key: "FI_SUPERVISING", label: "Supervising instructor", primary: "PIC", instructorPosition: "SUPERVISING" },
  { key: "FE_EXAMINER", label: "Examiner", primary: "PIC", instructorPosition: "EXAMINER" },
];
const UNPOWERED_FUNCTIONS: FnOption[] = [
  { key: "PIC", label: "PIC (pilot in command)", primary: "PIC" },
  { key: "DUAL", label: "Dual", primary: "DUAL" },
];
const LEGACY_FUNCTIONS: FnOption[] = [{ key: "SAFETY_PILOT", label: "Safety pilot", primary: "SAFETY_PILOT" }];
const ALL_FUNCTIONS: FnOption[] = [...POWERED_FUNCTIONS, ...LEGACY_FUNCTIONS];

function resolveFunction(key: string): FnOption {
  return ALL_FUNCTIONS.find((o) => o.key === key) ?? POWERED_FUNCTIONS[0]!;
}
/** Reverse-map a stored entry (primary + instructor position) to a single key. */
function functionKey(primary?: string, instructorPosition?: string): string {
  if (instructorPosition) {
    const m = ALL_FUNCTIONS.find((o) => o.instructorPosition === instructorPosition);
    if (m) return m.key;
  }
  return ALL_FUNCTIONS.find((o) => !o.instructorPosition && o.primary === primary)?.key ?? "PIC";
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
  pilotFunction: "PIC",
  tookControl: false,
  operatingRole: "",
  flightRules: "VFR",
  launchMethod: "",
  balloonFlightType: "",
  inflations: 1,
  instructor: 0,
  seriesMinutes: 0,
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
    pilotFunction: functionKey(c.function?.primary, c.columns?.instructorPosition),
    tookControl: c.function?.tookControl ?? false,
    operatingRole: cols?.operatingRole ?? "",
    flightRules: (cols?.ifr ?? 0) > 0 ? "IFR" : "VFR",
    launchMethod: cols?.launchMethod ?? "",
    balloonFlightType: cols?.balloonFlightType ?? "",
    inflations: cols?.inflations ?? 1,
    instructor: c.function?.instructor ?? 0,
    seriesMinutes: cols?.flightTimeMinutes ?? 0,
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
  const [regCategory, setRegCategory] = useState<string | null>(null);
  const [depName, setDepName] = useState<string | null>(null);
  const [arrName, setArrName] = useState<string | null>(null);
  // Attributes are optional, so the section is collapsed by default to stay out
  // of the way; it opens when the pilot has one to add.
  const [showAttributes, setShowAttributes] = useState(false);

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
  const isSeries = has("series_of_flights");
  const showDetails =
    has("heslo") || has("hec") || has("mountain_landings") || has("low_visibility_landing") || isSeries;

  // Calculated flight time from the block times, used as the ceiling for a
  // series of flights (which may only be logged with a reduced time).
  const computedBlock = f.blockStart && f.blockEnd ? blockMinutes(f.date || "1970-01-01", f.blockStart, f.blockEnd) : 0;
  // Prefill the editable series time with the calculated time, and clamp it so it
  // can never exceed it (reduce only).
  useEffect(() => {
    if (!isSeries) return;
    if (f.seriesMinutes === 0 || f.seriesMinutes > computedBlock) set("seriesMinutes", computedBlock);
  }, [isSeries, computedBlock]);

  // Only the attributes that apply to the chosen category (launch is
  // sailplane-only; HESLO/HEC are helicopter-only).
  const visibleGroups = ATTRIBUTE_GROUPS.map((g) => ({
    title: g.title,
    items: g.items.filter((it) => !it.categories || it.categories.includes(f.category)),
  })).filter((g) => g.items.length > 0);
  const selectedLabels = f.attributes.map((k) => ATTRIBUTE_LABELS[k] ?? k);

  // When the category changes, drop any selected attribute that no longer
  // applies, so the entry does not carry (and the server does not reject) a
  // launch privilege on an aeroplane or a HESLO on a balloon.
  useEffect(() => {
    const hiddenRestricted = ATTRIBUTE_GROUPS.flatMap((g) => g.items)
      .filter((it) => it.categories && !it.categories.includes(f.category))
      .map((it) => it.key);
    if (f.attributes.some((k) => hiddenRestricted.includes(k))) {
      setF((prev) => ({ ...prev, attributes: prev.attributes.filter((k) => !hiddenRestricted.includes(k)) }));
    }
  }, [f.category]);

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
      setRegCategory(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const { match, subtype } = await api.lookupAircraft(reg);
        if (match) {
          const known = ["AEROPLANE", "HELICOPTER", "SAILPLANE", "BALLOON"].includes(match.category)
            ? match.category
            : null;
          setRegCategory(known);
          const detail = subtype ? `${match.model} (${subtype})` : match.model;
          setF((prev) => {
            const corrected = known && known !== prev.category;
            setAircraftMsg(
              corrected
                ? `${reg} is registered as a ${CATEGORY_LABELS[known]}; category set to match. ${detail}`
                : `Found: ${detail}`,
            );
            return {
              ...prev,
              makeModelVariant: match.model || prev.makeModelVariant,
              category: known ?? prev.category,
              // More than one engine means multi-engine; a known single engine
              // sets single-engine. Leave the choice alone when unknown.
              engineClass:
                typeof match.engineCount === "number"
                  ? match.engineCount > 1
                    ? "ME"
                    : "SE"
                  : prev.engineClass,
              multiPilot: match.multiPilot ?? prev.multiPilot,
            };
          });
        } else {
          setRegCategory(null);
          setAircraftMsg("Not found; enter the type manually.");
        }
      } catch {
        setAircraftMsg(null);
        setRegCategory(null);
      }
    }, 600);
    return () => clearTimeout(t);
  }, [reg]);

  // If the registration is known and the chosen category no longer matches it
  // (the pilot changed it after the lookup), warn and block: the registration is
  // authoritative for the category.
  const categoryMismatch = regCategory && regCategory !== f.category;

  // EASA times the flight from first movement (block) for aeroplanes, but from
  // rotor start to rotor stop for helicopters (AMC1 FCL.050 (g)). Balloons log
  // a plain departure and arrival time.
  const timeLabels =
    f.category === "HELICOPTER"
      ? { off: "Rotor start", on: "Rotor stop" }
      : f.category === "BALLOON"
        ? { off: "Departure time", on: "Arrival time" }
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

  // The selected pilot function resolves to a primary capacity plus, for the
  // instructor/examiner choices, a seat position.
  const fn = resolveFunction(f.pilotFunction);
  const isDual = fn.primary === "DUAL";
  const isSafety = fn.primary === "SAFETY_PILOT";
  const isJumpSeat = fn.instructorPosition === "JUMP_SEAT";

  // On a dual flight the PIC is the instructor, so SELF is not valid: clear it
  // when the function switches to dual so the pilot must type the instructor.
  useEffect(() => {
    if (isDual && f.picName.trim().toUpperCase() === "SELF") set("picName", "");
  }, [isDual]);

  // Jump-seat time cannot be logged as instructor time (FOCA 2.2.4), so zero it.
  useEffect(() => {
    if (isJumpSeat && Number(f.instructor) !== 0) set("instructor", 0);
  }, [f.pilotFunction]);

  // Balloons and sailplanes are not aeroplane/helicopter: they have no SE/ME or
  // multi-pilot columns and no IFR, but carry their own conditions (launch
  // method for sailplanes, free/tethered for balloons).
  const isSailplane = f.category === "SAILPLANE";
  const isBalloon = f.category === "BALLOON";
  const isPowered = !isSailplane && !isBalloon;
  // Functions offered for the category; keep the current value if it is not in
  // the list (e.g. a legacy safety-pilot entry, or after switching category).
  const baseFunctions = isPowered ? POWERED_FUNCTIONS : UNPOWERED_FUNCTIONS;
  const functionOptions = baseFunctions.some((o) => o.key === f.pilotFunction)
    ? baseFunctions
    : [...baseFunctions, resolveFunction(f.pilotFunction)];
  useEffect(() => {
    if (!isPowered && !UNPOWERED_FUNCTIONS.some((o) => o.key === f.pilotFunction)) set("pilotFunction", "PIC");
    // Balloon places are free text with no aerodrome timezone, so times are UTC.
    if (isBalloon && timeMode === "local") setTimeMode("utc");
  }, [f.category]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (categoryMismatch) {
      setError(`${reg} is registered as a ${CATEGORY_LABELS[regCategory!]}, not a ${CATEGORY_LABELS[f.category]}. Correct the category or the registration.`);
      return;
    }
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
          primary: fn.primary,
          instructor: isJumpSeat ? 0 : Number(f.instructor),
          ...(fn.instructorPosition ? { instructorPosition: fn.instructorPosition } : {}),
          ...(isSafety ? { tookControl: f.tookControl } : {}),
        },
        ...(isPowered && f.operatingRole ? { operatingRole: f.operatingRole } : {}),
        ...(isSailplane && f.launchMethod ? { launchMethod: f.launchMethod } : {}),
        ...(isBalloon && f.balloonFlightType ? { balloonFlightType: f.balloonFlightType } : {}),
        ...(isBalloon ? { inflations: Number(f.inflations) } : {}),
        // Only send the reduced time when the pilot has lowered it below the
        // calculated block time for a series of flights.
        ...(isSeries && f.seriesMinutes > 0 && f.seriesMinutes < computedBlock
          ? { flightTimeMinutes: f.seriesMinutes }
          : {}),
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
            <div>
              <Select label="Category" value={f.category} onChange={(e) => set("category", e.target.value)}>
                <option value="AEROPLANE">Aeroplane</option>
                <option value="HELICOPTER">Helicopter</option>
                <option value="SAILPLANE">Sailplane</option>
                <option value="BALLOON">Balloon</option>
              </Select>
              {categoryMismatch && (
                <p className="mt-1 text-xs text-red-600">
                  {reg} is registered as a {CATEGORY_LABELS[regCategory!]}, not a {CATEGORY_LABELS[f.category]}.
                </p>
              )}
            </div>
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
            <Select label="Pilot function" value={f.pilotFunction} onChange={(e) => set("pilotFunction", e.target.value)}>
              {functionOptions.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>

          {isSafety && (
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
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field label="Landings" type="number" min={0} inputMode="numeric" value={f.landings} onChange={(e) => set("landings", Number(e.target.value))} />
            {isBalloon && (
              <Field label="Inflations" type="number" min={0} inputMode="numeric" value={f.inflations} onChange={(e) => set("inflations", Number(e.target.value))} />
            )}
            <Field label="Instructor (min)" type="number" min={0} inputMode="numeric" value={f.instructor} onChange={(e) => set("instructor", Number(e.target.value))} disabled={isJumpSeat} hint={isJumpSeat ? "Not loggable from the jump seat." : undefined} />
          </div>
          <p className="text-xs text-slate-500">
            Night time, and whether the landings count as day or night, are worked out automatically from the
            aerodrome positions and the block times.
          </p>
        </Section>

        <Section title="Attributes and endorsements">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-slate-600">
              {selectedLabels.length > 0 ? selectedLabels.join(", ") : "None added (optional)."}
            </p>
            <button
              type="button"
              onClick={() => setShowAttributes((v) => !v)}
              className="shrink-0 text-sm text-sky-700 underline"
            >
              {showAttributes ? "Done" : selectedLabels.length > 0 ? "Edit" : "Add"}
            </button>
          </div>

          {showAttributes && (
            <div className="mt-2 space-y-3">
              {visibleGroups.map((g) => (
                <div key={g.title}>
                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">{g.title}</div>
                  <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-3">
                    {g.items.map((a) => (
                      <label key={a.key} className="flex items-center gap-2 py-1 text-sm" title={a.note}>
                        <input type="checkbox" checked={has(a.key)} onChange={() => toggleAttr(a.key)} />
                        <span className={a.note ? "underline decoration-dotted decoration-slate-400 underline-offset-2" : undefined}>
                          {a.label}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              <p className="text-xs text-slate-500">
                A skill test, proficiency check or line check will require a sign-off.
              </p>
            </div>
          )}

          {showDetails && (
            <div className="grid grid-cols-1 gap-4 rounded-md bg-slate-50 p-3 sm:grid-cols-2">
              {isSeries && (
                <Field
                  label="Flight time (min)"
                  type="number"
                  min={1}
                  max={computedBlock}
                  inputMode="numeric"
                  value={f.seriesMinutes}
                  onChange={(e) => set("seriesMinutes", Math.min(Math.max(0, Number(e.target.value)), computedBlock))}
                  hint={`Calculated ${Math.floor(computedBlock / 60)}h ${String(computedBlock % 60).padStart(2, "0")}m. You may only reduce it.`}
                />
              )}
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
