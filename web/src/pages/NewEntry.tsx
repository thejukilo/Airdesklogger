import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import * as api from "../api";
import { Alert, Button, Card, Field, Select } from "../components/ui";

/** datetime-local gives "YYYY-MM-DDTHH:MM"; the form treats it as UTC. */
function toUtcIso(local: string): string {
  return local ? `${local}:00Z` : "";
}

const empty = {
  registration: "",
  makeModelVariant: "",
  engineClass: "SE",
  category: "AEROPLANE",
  multiPilot: false,
  departurePlace: "",
  departureTime: "",
  arrivalPlace: "",
  arrivalTime: "",
  picName: "SELF",
  dayLandings: 1,
  nightLandings: 0,
  night: 0,
  ifr: 0,
  primary: "PIC",
  instructor: 0,
  remarks: "",
};

export function NewEntry() {
  const navigate = useNavigate();
  const [f, setF] = useState(empty);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupMsg, setLookupMsg] = useState<string | null>(null);

  function set<K extends keyof typeof f>(k: K, v: (typeof f)[K]) {
    setF((prev) => ({ ...prev, [k]: v }));
  }

  async function onLookup() {
    const reg = f.registration.trim();
    if (!reg) return;
    setLookingUp(true);
    setLookupMsg(null);
    try {
      const { match, source } = await api.lookupAircraft(reg);
      if (match) {
        const categories = ["AEROPLANE", "HELICOPTER", "SAILPLANE", "BALLOON"];
        setF((prev) => ({
          ...prev,
          makeModelVariant: match.model || prev.makeModelVariant,
          category: categories.includes(match.category) ? match.category : prev.category,
          multiPilot: match.multiPilot ?? prev.multiPilot,
        }));
        setLookupMsg(
          source === "external"
            ? `Found in the public registry: ${match.model}. Check the category and engine below.`
            : `Found: ${match.model}.`,
        );
      } else {
        setLookupMsg("Not found in the registry. Enter the aircraft details manually.");
      }
    } catch (err) {
      setLookupMsg(err instanceof Error ? err.message : "Lookup failed.");
    } finally {
      setLookingUp(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.createEntry({
        aircraft: {
          makeModelVariant: f.makeModelVariant,
          registration: f.registration,
          engineClass: f.engineClass as "SE" | "ME",
          multiPilot: f.multiPilot,
          category: f.category,
        },
        legs: [
          {
            departurePlace: f.departurePlace.toUpperCase(),
            departureTime: toUtcIso(f.departureTime),
            arrivalPlace: f.arrivalPlace.toUpperCase(),
            arrivalTime: toUtcIso(f.arrivalTime),
          },
        ],
        picName: f.picName,
        landings: { day: Number(f.dayLandings), night: Number(f.nightLandings) },
        conditions: { night: Number(f.night), ifr: Number(f.ifr) },
        function: { primary: f.primary, instructor: Number(f.instructor) },
        remarks: f.remarks,
      });
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
      <p className="text-sm text-slate-500">All times are entered and stored in UTC.</p>
      <Card>
        <form onSubmit={onSubmit} className="space-y-5">
          {error && <Alert>{error}</Alert>}

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Field
                label="Aircraft registration"
                value={f.registration}
                onChange={(e) => set("registration", e.target.value)}
                hint="Enter a registration and look it up to fill in the rest."
                required
              />
            </div>
            <Button type="button" variant="ghost" onClick={onLookup} disabled={lookingUp || !f.registration.trim()}>
              {lookingUp ? "Looking up..." : "Look up"}
            </Button>
          </div>
          {lookupMsg && <p className="text-xs text-slate-600">{lookupMsg}</p>}

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
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.multiPilot} onChange={(e) => set("multiPilot", e.target.checked)} />
            Multi-pilot operation
          </label>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Departure (ICAO)" value={f.departurePlace} onChange={(e) => set("departurePlace", e.target.value)} required />
            <Field label="Departure time (UTC)" type="datetime-local" value={f.departureTime} onChange={(e) => set("departureTime", e.target.value)} required />
            <Field label="Arrival (ICAO)" value={f.arrivalPlace} onChange={(e) => set("arrivalPlace", e.target.value)} required />
            <Field label="Arrival time (UTC)" type="datetime-local" value={f.arrivalTime} onChange={(e) => set("arrivalTime", e.target.value)} required />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Name of PIC" value={f.picName} onChange={(e) => set("picName", e.target.value)} required />
            <Select label="Pilot function" value={f.primary} onChange={(e) => set("primary", e.target.value)}>
              <option value="PIC">PIC</option>
              <option value="PICUS">PICUS</option>
              <option value="SPIC">SPIC</option>
              <option value="CO_PILOT">Co-pilot</option>
              <option value="DUAL">Dual</option>
            </Select>
          </div>

          <div className="grid grid-cols-4 gap-4">
            <Field label="Day landings" type="number" min={0} value={f.dayLandings} onChange={(e) => set("dayLandings", Number(e.target.value))} />
            <Field label="Night landings" type="number" min={0} value={f.nightLandings} onChange={(e) => set("nightLandings", Number(e.target.value))} />
            <Field label="Night (min)" type="number" min={0} value={f.night} onChange={(e) => set("night", Number(e.target.value))} />
            <Field label="IFR (min)" type="number" min={0} value={f.ifr} onChange={(e) => set("ifr", Number(e.target.value))} />
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
