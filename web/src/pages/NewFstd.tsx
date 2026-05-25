import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import * as api from "../api";
import { Alert, Button, Card, Field, Select } from "../components/ui";
import { ATTRIBUTES } from "../labels";

/**
 * Records a synthetic training (FSTD) session, column 11 of AMC1 FCL.050. The
 * session carries no flight time; the device, the exercise and the session time
 * are what matter. A device not yet known is provisionally recorded server-side.
 */
const empty = {
  date: "",
  deviceType: "",
  deviceKind: "FFS",
  qualificationNumber: "",
  instruction: "",
  hours: 0,
  minutes: 0,
  remarks: "",
  attributes: [] as string[],
};

export function NewFstd() {
  const navigate = useNavigate();
  const [f, setF] = useState(empty);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const totalMinutes = Number(f.hours) * 60 + Number(f.minutes);
      await api.createFstd({
        date: `${f.date}T00:00:00Z`,
        deviceType: f.deviceType,
        deviceKind: f.deviceKind,
        qualificationNumber: f.qualificationNumber,
        instruction: f.instruction,
        totalMinutes,
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
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold">New FSTD session</h1>
      <Card>
        <form onSubmit={onSubmit} className="space-y-5">
          {error && <Alert>{error}</Alert>}

          <Field label="Date" type="date" value={f.date} onChange={(e) => set("date", e.target.value)} required />

          <div className="grid grid-cols-2 gap-4">
            <Field
              label="Device type"
              value={f.deviceType}
              onChange={(e) => set("deviceType", e.target.value)}
              hint="Aircraft type for a full simulator, or FNPT I / FNPT II."
              required
            />
            <Select label="Device kind" value={f.deviceKind} onChange={(e) => set("deviceKind", e.target.value)}>
              <option value="FFS">Full flight simulator (FFS)</option>
              <option value="FTD">Flight training device (FTD)</option>
              <option value="FNPT_I">FNPT I</option>
              <option value="FNPT_II">FNPT II</option>
              <option value="BITD">BITD</option>
              <option value="OTHER">Other</option>
            </Select>
          </div>

          <Field
            label="Qualification number"
            value={f.qualificationNumber}
            onChange={(e) => set("qualificationNumber", e.target.value)}
            required
          />

          <Field
            label="FSTD instruction / exercise"
            value={f.instruction}
            onChange={(e) => set("instruction", e.target.value)}
            hint="For example: type rating training, or a proficiency check."
          />

          <div className="grid grid-cols-2 gap-4">
            <Field label="Session time (hours)" type="number" min={0} value={f.hours} onChange={(e) => set("hours", Number(e.target.value))} />
            <Field label="Session time (minutes)" type="number" min={0} max={59} value={f.minutes} onChange={(e) => set("minutes", Number(e.target.value))} />
          </div>

          <div>
            <span className="mb-2 block text-sm font-medium text-slate-700">Attributes and endorsements</span>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
              {ATTRIBUTES.map((a) => (
                <label key={a.key} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={f.attributes.includes(a.key)} onChange={() => toggleAttr(a.key)} />
                  {a.label}
                </label>
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
    </div>
  );
}
