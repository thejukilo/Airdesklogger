import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth";
import * as api from "../api";
import { Alert, Button, Card, Field, Select } from "../components/ui";
import { SignaturePad, type SignaturePadHandle } from "../components/SignaturePad";
import {
  ATTRIBUTE_LABELS,
  CATEGORY_LABELS,
  FUNCTION_LABELS,
  INSTRUCTOR_POSITION_LABELS,
  LAUNCH_METHOD_LABELS,
  OPERATING_ROLE_LABELS,
} from "../labels";

function hhmm(v: unknown): string {
  const m = Number(v ?? 0);
  if (!Number.isFinite(m) || m <= 0) return "00:00";
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Clock time from a stored ISO string: Z for UTC, L when the time is stored as local. */
function timeZ(iso: unknown, local = false): string {
  const s = typeof iso === "string" ? iso : "";
  return s.length >= 16 ? `${s.slice(11, 16)}${local ? "L" : "Z"}` : "";
}

const ROLE_LABELS: Record<string, string> = {
  INSTRUCTOR: "Instructor",
  EXAMINER: "Examiner",
  SUPERVISING_PIC: "Supervising PIC (for PICUS)",
  ATO: "ATO",
  DTO: "DTO",
  HOT: "Head of training",
  AIRPORT: "Airport",
  OTHER: "Other",
};

function capabilitiesFor(roles: string[]): string[] {
  const caps = new Set<string>();
  if (roles.includes("EXAMINER")) ["EXAMINER", "INSTRUCTOR", "SUPERVISING_PIC"].forEach((c) => caps.add(c));
  if (roles.includes("INSTRUCTOR")) ["INSTRUCTOR", "SUPERVISING_PIC"].forEach((c) => caps.add(c));
  if (roles.includes("PILOT")) caps.add("SUPERVISING_PIC");
  for (const r of ["ATO", "DTO", "HOT", "AIRPORT"]) if (roles.includes(r)) caps.add(r);
  if (roles.includes("ADMIN")) caps.add("OTHER");
  return [...caps];
}

export function EntryDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { user, mfaEnabled } = useAuth();
  const [entry, setEntry] = useState<api.EntryDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  async function deleteEntry() {
    if (!window.confirm("Delete this entry? It will be removed from your logbook.")) return;
    setDeleting(true);
    try {
      await api.deleteEntry(id);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the entry.");
      setDeleting(false);
    }
  }

  const pad = useRef<SignaturePadHandle>(null);
  const capabilities = capabilitiesFor(user?.roles ?? []);
  const [role, setRole] = useState(capabilities[0] ?? "");
  const [code, setCode] = useState("");
  const [signError, setSignError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);

  const [req, setReq] = useState({ signerName: "", signerEmail: "", capacity: "INSTRUCTOR" });
  const [reqResult, setReqResult] = useState<string | null>(null);
  const [reqLink, setReqLink] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);

  async function requestSignoff() {
    setReqResult(null);
    setReqLink(null);
    setRequesting(true);
    try {
      const r = await api.requestSignoff(id, req);
      setReqLink(r.link);
      setReqResult(
        r.emailed
          ? `A link was emailed to ${req.signerEmail}. You can also share the link below.`
          : r.emailConfigured
            ? "Email could not be sent; share the link below instead."
            : "Share this single-use link with the signer:",
      );
    } catch (err) {
      setReqResult(err instanceof Error ? err.message : "Could not create the request.");
    } finally {
      setRequesting(false);
    }
  }

  function load() {
    setLoading(true);
    api
      .getEntry(id)
      .then(setEntry)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load the entry."))
      .finally(() => setLoading(false));
  }
  useEffect(load, [id]);

  if (loading) return <p className="text-sm text-slate-500">Loading...</p>;
  if (error) return <Alert>{error}</Alert>;
  if (!entry?.current) return <Alert>Entry not found.</Alert>;

  const c = entry.current.content;
  const cols = c.columns;
  const locked = entry.current.locked;
  const isOwner = c.pilotId === user?.id;
  const canSign = !locked && !isOwner && capabilities.length > 0;
  const canRequest = !locked && isOwner;

  async function submitSignoff() {
    setSignError(null);
    if (pad.current?.isEmpty()) {
      setSignError("Please draw your signature.");
      return;
    }
    setSigning(true);
    try {
      await api.signEntry(id, { code: code.trim(), role, signatureImage: pad.current?.toDataURL() });
      setCode("");
      load();
    } catch (err) {
      setSignError(err instanceof Error ? err.message : "Could not sign the entry.");
    } finally {
      setSigning(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Flight entry</h1>
        <div className="flex items-center gap-4 text-sm">
          {isOwner && !cols?.fstd && (
            <button
              type="button"
              onClick={() => {
                if (locked && !window.confirm("This entry is signed. Editing it removes the sign-off and reopens it for the instructor to sign again. Continue?")) return;
                navigate(`/entry/${id}/edit`);
              }}
              className="font-medium text-brand-700 hover:underline"
            >
              Edit
            </button>
          )}
          {isOwner && (
            <button type="button" onClick={deleteEntry} disabled={deleting} className="font-medium text-red-600 hover:underline disabled:opacity-50">
              {deleting ? "Deleting..." : "Delete"}
            </button>
          )}
          <Link to="/" className="text-slate-600 hover:text-ink">Back to logbook</Link>
        </div>
      </div>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold">{String(cols?.date ?? "")}</div>
            <div className="text-sm text-slate-500">{cols?.timesLocal ? "Times in local time (L)" : "All times in UTC (Z = Zulu)"}</div>
          </div>
          {locked ? (
            <span className="rounded bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
              Locked (signed)
            </span>
          ) : (
            <span className="rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">Open</span>
          )}
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          <Detail
            label="Aircraft"
            value={
              cols?.fstd
                ? `FSTD ${cols.fstd.deviceType} (${cols.fstd.qualificationNumber})`
                : `${c.aircraft?.makeModelVariant ?? ""}${c.aircraft?.registration ? ` (${c.aircraft.registration})` : ""}`
            }
          />
          <Detail label="Category" value={CATEGORY_LABELS[cols?.category ?? ""] ?? cols?.category} />
          <Detail label="Name PIC" value={c.picName} />
          <Detail
            label="From"
            value={cols?.departurePlaceName ? `${cols.departurePlace} (${cols.departurePlaceName})` : cols?.departurePlace}
          />
          <Detail
            label="To"
            value={cols?.arrivalPlaceName ? `${cols.arrivalPlace} (${cols.arrivalPlaceName})` : cols?.arrivalPlace}
          />
          <Detail label="Total time" value={hhmm(cols?.total)} />
          <Detail label="Block off" value={timeZ(cols?.departureTime, cols?.timesLocal)} />
          <Detail label="Block on" value={timeZ(cols?.arrivalTime, cols?.timesLocal)} />
          {cols?.isMultiFlight ? <Detail label="Flight type" value="Series of flights" /> : null}
        </dl>
        {c.remarks && (
          <p className="mt-4 border-t pt-3 text-sm text-slate-600">
            <span className="font-medium text-slate-700">Remarks:</span> {c.remarks}
          </p>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 font-medium">Time breakdown</h2>
        <dl className="grid grid-cols-3 gap-x-6 gap-y-3 sm:grid-cols-4">
          <Detail label="Single-engine" value={hhmm(cols?.singleEngine)} />
          <Detail label="Multi-engine" value={hhmm(cols?.multiEngine)} />
          <Detail label="Multi-pilot" value={hhmm(cols?.multiPilot)} />
          <Detail label="Total" value={hhmm(cols?.total)} />
          <Detail label="PIC" value={hhmm(cols?.pic)} />
          <Detail label="Co-pilot" value={hhmm(cols?.coPilot)} />
          <Detail label="Dual" value={hhmm(cols?.dual)} />
          <Detail label="Instructor" value={hhmm(cols?.instructor)} />
          <Detail label="Night" value={hhmm(cols?.night)} />
          <Detail label="IFR" value={hhmm(cols?.ifr)} />
          <Detail label="Landings (day)" value={String(cols?.dayLandings ?? 0)} />
          <Detail label="Landings (night)" value={String(cols?.nightLandings ?? 0)} />
        </dl>
      </Card>

      <Card>
        <h2 className="mb-3 font-medium">Function and classification</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          <Detail label="Pilot function" value={FUNCTION_LABELS[c.function?.primary ?? ""] ?? c.function?.primary} />
          <Detail label="Operating role" value={OPERATING_ROLE_LABELS[cols?.operatingRole ?? ""]} />
          <Detail
            label="Operating crew"
            value={cols?.crewSize ? `${cols.crewSize}${cols.crewSize > 2 ? " (augmented)" : ""}` : undefined}
          />
          <Detail label="Instructor seat" value={INSTRUCTOR_POSITION_LABELS[cols?.instructorPosition ?? ""]} />
          <Detail label="Launch method" value={LAUNCH_METHOD_LABELS[cols?.launchMethod ?? ""]} />
          <Detail
            label="Flight type"
            value={cols?.balloonFlightType === "TETHERED" ? "Tethered" : cols?.balloonFlightType === "FREE" ? "Free flight" : undefined}
          />
          <Detail label="Inflations" value={cols?.inflations !== undefined ? String(cols.inflations) : undefined} />
          {c.function?.primary === "SAFETY_PILOT" ? (
            <Detail label="Took control" value={c.function?.tookControl ? "Yes" : "No"} />
          ) : null}
          {cols?.attributeDetails?.hesloLevel ? <Detail label="HESLO level" value={String(cols.attributeDetails.hesloLevel)} /> : null}
          {cols?.attributeDetails?.hecLevel ? <Detail label="HEC level" value={String(cols.attributeDetails.hecLevel)} /> : null}
          {cols?.attributeDetails?.hoistCycles ? <Detail label="Cycles" value={String(cols.attributeDetails.hoistCycles)} /> : null}
          {cols?.attributeDetails?.mountainLandingGear ? <Detail label="Mountain landing" value={cols.attributeDetails.mountainLandingGear} /> : null}
          {cols?.attributeDetails?.lowVisibilityLandingType ? <Detail label="Low-visibility landing" value={cols.attributeDetails.lowVisibilityLandingType} /> : null}
        </dl>
        {cols?.attributes && cols.attributes.length > 0 && (
          <div className="mt-4 border-t pt-3">
            <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Attributes</div>
            <div className="flex flex-wrap gap-2">
              {cols.attributes.map((a) => (
                <span key={a} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">
                  {ATTRIBUTE_LABELS[a] ?? a}
                </span>
              ))}
            </div>
          </div>
        )}
        {cols?.signatureRequired && (
          <p className="mt-3 rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
            This entry records a check or test and is not creditable until it is countersigned.
          </p>
        )}
      </Card>

      <Card>
        <h2 className="mb-2 font-medium">Sign-offs</h2>
        {entry.signatures.length === 0 ? (
          <p className="text-sm text-slate-500">No sign-offs yet.</p>
        ) : (
          <ul className="space-y-3">
            {entry.signatures.map((s, i) => (
              <li key={i} className="flex items-center justify-between gap-4 border-b pb-3 last:border-0">
                <div className="text-sm">
                  <div className="font-medium">{ROLE_LABELS[s.signerRole] ?? s.signerRole}</div>
                  <div className="text-slate-500">
                    {s.signerName}
                    {s.signerLicense ? ` (${s.signerLicense})` : ""} &middot; {s.signedAt}
                  </div>
                </div>
                {s.signatureImage && <img src={s.signatureImage} alt="signature" className="h-12 rounded border bg-white" />}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {canSign && (
        <Card>
          <h2 className="mb-2 font-medium">Countersign this entry</h2>
          {!mfaEnabled ? (
            <p className="text-sm text-slate-600">
              You must enable two-factor authentication before signing.{" "}
              <Link to="/account" className="font-medium text-ink underline">Set it up</Link>.
            </p>
          ) : (
            <div className="space-y-3">
              {signError && <Alert>{signError}</Alert>}
              <Select label="Signing as" value={role} onChange={(e) => setRole(e.target.value)}>
                {capabilities.map((cap) => (
                  <option key={cap} value={cap}>{ROLE_LABELS[cap] ?? cap}</option>
                ))}
              </Select>
              <div>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-medium text-slate-700">Signature</span>
                  <button type="button" className="text-xs text-slate-500 underline" onClick={() => pad.current?.clear()}>
                    Clear
                  </button>
                </div>
                <SignaturePad ref={pad} />
              </div>
              <Field
                label="Two-factor code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                hint="Signing permanently locks the entry."
                required
              />
              <Button onClick={submitSignoff} disabled={signing || !code.trim()}>
                {signing ? "Signing..." : "Sign and lock"}
              </Button>
            </div>
          )}
        </Card>
      )}

      {canRequest && (
        <Card>
          <h2 className="mb-2 font-medium">Request a sign-off by email</h2>
          <p className="mb-3 text-sm text-slate-500">
            Invite an instructor or examiner who does not have an account. They get a single-use link to sign.
          </p>
          <div className="space-y-3">
            {reqResult && <p className="text-sm text-slate-600">{reqResult}</p>}
            {reqLink && (
              <input
                readOnly
                value={reqLink}
                onFocus={(e) => e.target.select()}
                className="w-full rounded-md border bg-slate-50 px-3 py-2 text-xs"
              />
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Signer name" value={req.signerName} onChange={(e) => setReq((r) => ({ ...r, signerName: e.target.value }))} />
              <Field label="Signer email" type="email" value={req.signerEmail} onChange={(e) => setReq((r) => ({ ...r, signerEmail: e.target.value }))} />
            </div>
            <Select label="Capacity" value={req.capacity} onChange={(e) => setReq((r) => ({ ...r, capacity: e.target.value }))}>
              {["INSTRUCTOR", "EXAMINER", "SUPERVISING_PIC", "ATO", "DTO", "HOT", "AIRPORT", "OTHER"].map((cap) => (
                <option key={cap} value={cap}>{ROLE_LABELS[cap] ?? cap}</option>
              ))}
            </Select>
            <Button onClick={requestSignoff} disabled={requesting || !req.signerName.trim() || !req.signerEmail.trim()}>
              {requesting ? "Creating..." : "Create signing link"}
            </Button>
          </div>
        </Card>
      )}

      <Card>
        <h2 className="mb-2 font-medium">Change history</h2>
        <ul className="space-y-1 text-sm text-slate-600">
          {entry.history.map((h) => (
            <li key={h.version_no}>
              v{h.version_no} &middot; {h.created_at}
              {h.change_reason ? `: ${h.change_reason}` : ""}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-800">{value}</dd>
    </div>
  );
}
