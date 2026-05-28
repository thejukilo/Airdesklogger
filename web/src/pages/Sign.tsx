import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import * as api from "../api";
import { Alert, Button, Card, Field } from "../components/ui";
import { SignaturePad, type SignaturePadHandle } from "../components/SignaturePad";

const ROLE_LABELS: Record<string, string> = {
  INSTRUCTOR: "Instructor",
  EXAMINER: "Examiner",
  SUPERVISING_PIC: "Supervising PIC",
  ATO: "ATO",
  DTO: "DTO",
  HOT: "Head of training",
  AIRPORT: "Airport",
  OTHER: "Other",
};

function hhmm(v: number | null): string {
  const m = Number(v ?? 0);
  if (!Number.isFinite(m) || m <= 0) return "00:00";
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * Public signing page for an external instructor or examiner. No account is
 * needed; the one-time token in the URL authorises signing the entries in the
 * batch (one link can cover several flights, countersigned with one signature).
 */
export function Sign() {
  const { token = "" } = useParams();
  const [data, setData] = useState<api.PublicSignoff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [done, setDone] = useState(false);

  const pad = useRef<SignaturePadHandle>(null);
  const [name, setName] = useState("");
  const [license, setLicense] = useState("");
  const [place, setPlace] = useState("");
  // True once the pilot has put pen to canvas; flips the Sign button enabled.
  // Kept in state because SignaturePad does not re-render its parent on draw.
  const [hasSignature, setHasSignature] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);

  useEffect(() => {
    api
      .getSignoffPublic(token)
      .then((d) => {
        setData(d);
        setName(d.signerName);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "This link is not valid."))
      .finally(() => setLoading(false));
  }, [token]);

  const canSubmit = name.trim().length > 0 && place.trim().length > 0 && hasSignature && !signing;

  async function submit() {
    setSignError(null);
    if (!name.trim()) {
      setSignError("Your full name is required.");
      return;
    }
    if (!place.trim()) {
      setSignError("The place where you are signing is required.");
      return;
    }
    if (!hasSignature || pad.current?.isEmpty()) {
      setSignError("Please draw your signature.");
      return;
    }
    setSigning(true);
    try {
      await api.submitSignoffPublic(token, {
        signerName: name.trim(),
        ...(license.trim() ? { signerLicense: license.trim() } : {}),
        signedPlace: place.trim(),
        signatureImage: pad.current!.toDataURL(),
      });
      setDone(true);
    } catch (err) {
      setSignError(err instanceof Error ? err.message : "Could not sign.");
    } finally {
      setSigning(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 text-ink">
      <div className="mx-auto max-w-lg space-y-4">
        <h1 className="text-lg font-semibold">Airdeck Logger sign-off</h1>

        {loading && <p className="text-sm text-slate-500">Loading...</p>}
        {error && <Alert>{error}</Alert>}

        {done ? (
          <Card>
            <p className="text-sm text-emerald-700">
              Thank you. {data && data.entries.length > 1 ? `All ${data.entries.length} entries have been signed` : "The entry has been signed"} and locked. You can close this page.
            </p>
          </Card>
        ) : (
          data && (
            <>
              <Card>
                <p className="mb-3 text-sm text-slate-600">
                  You have been asked to countersign{" "}
                  {data.entries.length === 1 ? "this flight" : <strong>{data.entries.length} flights</strong>} as{" "}
                  <strong>{ROLE_LABELS[data.capacity] ?? data.capacity}</strong>. One signature
                  will apply to {data.entries.length === 1 ? "the entry" : "all of them"}.
                </p>
                <ul className="divide-y divide-slate-200 text-sm">
                  {data.entries.map((e) => (
                    <li key={e.id} className="py-2">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-medium">{e.date}</span>
                        <span className="text-slate-500">{e.aircraft}</span>
                      </div>
                      <div className="flex items-baseline justify-between gap-3 text-slate-500">
                        <span>
                          {e.departurePlace} to {e.arrivalPlace}
                        </span>
                        <span>{hhmm(e.total)} - PIC: {e.picName ?? "-"}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>

              <Card>
                <div className="space-y-3">
                  {signError && <Alert>{signError}</Alert>}
                  <Field label="Your full name" value={name} onChange={(e) => setName(e.target.value)} required />
                  <Field label="Licence / certificate number (optional)" value={license} onChange={(e) => setLicense(e.target.value)} />
                  <Field label="Place" value={place} onChange={(e) => setPlace(e.target.value)} hint="Where you are signing (e.g. LSGG, the aerodrome or city)." required />
                  <div>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="font-medium text-slate-700">Signature <span className="text-red-500">*</span></span>
                      <button
                        type="button"
                        className="text-xs text-slate-500 underline"
                        onClick={() => { pad.current?.clear(); setHasSignature(false); }}
                      >
                        Clear
                      </button>
                    </div>
                    <SignaturePad ref={pad} onChange={setHasSignature} />
                  </div>
                  <p className="text-xs text-slate-500">
                    Signing permanently locks {data.entries.length === 1 ? "the entry" : `all ${data.entries.length} entries`}.
                  </p>
                  <Button onClick={submit} disabled={!canSubmit}>
                    {signing ? "Signing..." : data.entries.length === 1 ? "Sign and lock" : `Sign and lock all ${data.entries.length}`}
                  </Button>
                </div>
              </Card>
            </>
          )
        )}
      </div>
    </div>
  );
}
