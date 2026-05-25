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
 * needed; the one-time token in the URL authorises signing this one entry.
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

  async function submit() {
    setSignError(null);
    if (!name.trim()) {
      setSignError("Your full name is required.");
      return;
    }
    if (pad.current?.isEmpty()) {
      setSignError("Please draw your signature.");
      return;
    }
    setSigning(true);
    try {
      await api.submitSignoffPublic(token, {
        signerName: name.trim(),
        ...(license.trim() ? { signerLicense: license.trim() } : {}),
        signatureImage: pad.current?.toDataURL(),
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
        <h1 className="text-lg font-semibold">AirdeskLogger sign-off</h1>

        {loading && <p className="text-sm text-slate-500">Loading...</p>}
        {error && <Alert>{error}</Alert>}

        {done ? (
          <Card>
            <p className="text-sm text-emerald-700">
              Thank you. The entry has been signed and is now locked. You can close this page.
            </p>
          </Card>
        ) : (
          data && (
            <>
              <Card>
                <p className="mb-3 text-sm text-slate-600">
                  You have been asked to countersign this flight entry as{" "}
                  <strong>{ROLE_LABELS[data.capacity] ?? data.capacity}</strong>.
                </p>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                  <dt className="text-slate-500">Date (UTC)</dt>
                  <dd className="text-right">{data.entry.date}</dd>
                  <dt className="text-slate-500">Aircraft</dt>
                  <dd className="text-right">{data.entry.aircraft}</dd>
                  <dt className="text-slate-500">Route</dt>
                  <dd className="text-right">{data.entry.departurePlace} to {data.entry.arrivalPlace}</dd>
                  <dt className="text-slate-500">Total time</dt>
                  <dd className="text-right">{hhmm(data.entry.total)}</dd>
                  <dt className="text-slate-500">PIC</dt>
                  <dd className="text-right">{data.entry.picName}</dd>
                </dl>
              </Card>

              <Card>
                <div className="space-y-3">
                  {signError && <Alert>{signError}</Alert>}
                  <Field label="Your full name" value={name} onChange={(e) => setName(e.target.value)} required />
                  <Field label="Licence / certificate number (optional)" value={license} onChange={(e) => setLicense(e.target.value)} />
                  <div>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="font-medium text-slate-700">Signature</span>
                      <button type="button" className="text-xs text-slate-500 underline" onClick={() => pad.current?.clear()}>
                        Clear
                      </button>
                    </div>
                    <SignaturePad ref={pad} />
                  </div>
                  <p className="text-xs text-slate-500">Signing permanently locks the entry.</p>
                  <Button onClick={submit} disabled={signing}>
                    {signing ? "Signing..." : "Sign and lock"}
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
