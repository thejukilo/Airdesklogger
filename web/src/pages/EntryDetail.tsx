import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../auth";
import * as api from "../api";
import { Alert, Button, Card, Field, Select } from "../components/ui";
import { SignaturePad, type SignaturePadHandle } from "../components/SignaturePad";

function hhmm(v: unknown): string {
  const m = Number(v ?? 0);
  if (!Number.isFinite(m) || m <= 0) return "00:00";
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
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
  const { user, mfaEnabled } = useAuth();
  const [entry, setEntry] = useState<api.EntryDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
        <Link to="/" className="text-sm text-slate-600 hover:text-ink">Back to logbook</Link>
      </div>

      <Card>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <Row label="Date (UTC)" value={String(cols?.date ?? "")} />
          <Row label="Aircraft" value={`${c.aircraft?.makeModelVariant ?? ""} (${c.aircraft?.registration ?? ""})`} />
          <Row label="From" value={String(cols?.departurePlace ?? "")} />
          <Row label="To" value={String(cols?.arrivalPlace ?? "")} />
          <Row label="Total time" value={hhmm(cols?.total)} />
          <Row label="PIC time" value={hhmm(cols?.pic)} />
          <Row label="Name PIC" value={c.picName ?? ""} />
          <Row label="Status" value={locked ? "Locked (signed)" : "Open"} />
        </dl>
        {c.remarks && <p className="mt-3 text-sm text-slate-600">Remarks: {c.remarks}</p>}
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right">{value}</dd>
    </>
  );
}
