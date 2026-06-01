import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import * as api from "../api";
import { Alert, Button, Card, Field } from "../components/ui";
import { AddressAutocomplete } from "../components/AddressAutocomplete";

export function Register() {
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    dateOfBirth: "",
    addressStreet: "",
    addressZip: "",
    addressCountry: "",
    licenseNumber: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [verifyToken, setVerifyToken] = useState<string | null>(null);
  const [emailed, setEmailed] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState<string>("");
  const [resendBusy, setResendBusy] = useState(false);
  const [resendNote, setResendNote] = useState<string | null>(null);

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api.register({
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        password: form.password,
        dateOfBirth: form.dateOfBirth,
        addressStreet: form.addressStreet,
        addressZip: form.addressZip,
        addressCountry: form.addressCountry,
        ...(form.licenseNumber ? { licenseNumber: form.licenseNumber } : {}),
      });
      // The account must confirm its email before it can sign in (FOCA 2.1.3).
      // In production, the server only sends the verification link by email -
      // emailVerificationToken comes back only as a developer fallback when
      // SMTP is not configured, never in production.
      setVerifyToken(res.emailVerificationToken ?? null);
      setEmailed(res.emailed);
      setSubmittedEmail(form.email);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the account.");
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setResendNote(null);
    setResendBusy(true);
    try {
      await api.resendVerification(submittedEmail);
      setResendNote(`We just sent another verification email to ${submittedEmail}.`);
    } catch (err) {
      setResendNote(err instanceof Error ? err.message : "Could not resend the email.");
    } finally {
      setResendBusy(false);
    }
  }

  if (submittedEmail) {
    return (
      <div className="mx-auto max-w-sm pt-10">
        <h1 className="mb-4 text-xl font-semibold">Check your inbox</h1>
        <Card>
          <div className="space-y-3 text-sm text-slate-600">
            {emailed ? (
              <>
                <p>
                  Your account was created. We sent a verification link to{" "}
                  <span className="font-medium text-slate-800">{submittedEmail}</span>.
                  Open the email and click the link to activate the account.
                </p>
                <p className="text-xs text-slate-500">
                  Didn't get it? Check your spam folder. The link expires after 24 hours.
                </p>
                <Button className="w-full" onClick={resend} disabled={resendBusy}>
                  {resendBusy ? "Resending..." : "Resend verification email"}
                </Button>
                {resendNote && (
                  <p className="text-xs text-slate-600">{resendNote}</p>
                )}
              </>
            ) : verifyToken ? (
              <>
                <p>
                  Your account was created, but the verification email could not be sent
                  (SMTP is not configured on this environment).
                </p>
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <strong>Developer fallback:</strong> the link below appears only when no
                  email could be delivered. In production it is never shown.
                </p>
                <Link to={`/verify?token=${encodeURIComponent(verifyToken)}`}>
                  <Button className="w-full">Verify (developer link)</Button>
                </Link>
              </>
            ) : (
              <>
                <p>
                  Your account was created but the verification email could not be sent
                  and no fallback is available. Please contact support.
                </p>
              </>
            )}
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm pt-10">
      <h1 className="mb-4 text-xl font-semibold">Create account</h1>
      <Card>
        <form onSubmit={onSubmit} className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <strong className="block font-semibold">Enter your details carefully</strong>
            <span className="mt-0.5 block">
              EASA rules tie every logbook record to one physical person. As soon as you log your first
              flight, your <strong>first name</strong>, <strong>last name</strong> and{" "}
              <strong>date of birth</strong> are permanently locked - they cannot be changed afterwards,
              even by support. Address and licence number stay editable.
            </span>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="First name" value={form.firstName} onChange={set("firstName")} required />
            <Field label="Last name" value={form.lastName} onChange={set("lastName")} required />
          </div>
          <Field label="Email" type="email" value={form.email} onChange={set("email")} required />
          <Field
            label="Password"
            type="password"
            value={form.password}
            onChange={set("password")}
            hint="At least 12 characters."
            required
          />
          <Field label="Date of birth" type="date" max={today} value={form.dateOfBirth} onChange={set("dateOfBirth")} required />
          <AddressAutocomplete
            countryHint="ch"
            onSelect={(a) =>
              setForm((f) => ({
                ...f,
                addressStreet: a.street || f.addressStreet,
                addressZip: [a.zip, a.place].filter(Boolean).join(" ") || f.addressZip,
                addressCountry: a.country || f.addressCountry,
              }))
            }
          />
          <Field label="Street / no." value={form.addressStreet} onChange={set("addressStreet")} required />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="ZIP / place" value={form.addressZip} onChange={set("addressZip")} required />
            <Field label="Country" value={form.addressCountry} onChange={set("addressCountry")} required />
          </div>
          <Field label="Licence number (optional)" value={form.licenseNumber} onChange={set("licenseNumber")} />
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Creating..." : "Create account"}
          </Button>
        </form>
      </Card>
      <p className="mt-4 text-center text-sm text-slate-600">
        Already have an account? <Link to="/login" className="font-medium text-ink underline">Sign in</Link>
      </p>
    </div>
  );
}
