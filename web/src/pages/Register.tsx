import { useState, type FormEvent, type ReactNode, type ButtonHTMLAttributes } from "react";
import { Link } from "react-router-dom";
import * as api from "../api";
import { Alert, Field } from "../components/ui";
import { AddressAutocomplete } from "../components/AddressAutocomplete";

/** The brand mark (gradient square + diamond). Sky accent for the auth pages. */
function BrandMark() {
  return (
    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-sky-700 text-white shadow-sm">
      <svg viewBox="0 0 22 22" className="h-4 w-4" fill="none" aria-hidden="true">
        <path d="M3 11L11 3L19 11L11 19L3 11Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M7 11L11 7L15 11L11 15L7 11Z" fill="currentColor" />
      </svg>
    </span>
  );
}

function Wordmark() {
  return (
    <span className="flex items-center gap-2.5">
      <BrandMark />
      <span className="text-base font-semibold tracking-tight text-slate-900">
        Airdeck <span className="font-normal text-slate-500">Log</span>
      </span>
    </span>
  );
}

/** Sky-accented primary button, local to the auth pages (the shared app Button
 * is brand blue; the registration design uses sky). */
function SkyButton({ children, className = "", ...props }: { children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center rounded-md bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  );
}

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

  // ── Post-submit: "check your inbox" confirmation ──
  if (submittedEmail) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-6 py-12">
        <Link to="/" className="mb-6"><Wordmark /></Link>
        <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="mb-3 text-xl font-semibold text-slate-900">Check your inbox</h1>
          <div className="space-y-3 text-sm text-slate-600">
            {emailed ? (
              <>
                <p>
                  Your account was created. We sent a verification link to{" "}
                  <span className="font-medium text-slate-800">{submittedEmail}</span>. Open the email and
                  click the link to activate the account.
                </p>
                <p className="text-xs text-slate-500">
                  Didn't get it? Check your spam folder. The link expires after 24 hours.
                </p>
                <SkyButton className="w-full" onClick={resend} disabled={resendBusy}>
                  {resendBusy ? "Resending..." : "Resend verification email"}
                </SkyButton>
                {resendNote && <p className="text-xs text-slate-600">{resendNote}</p>}
              </>
            ) : verifyToken ? (
              <>
                <p>
                  Your account was created, but the verification email could not be sent (SMTP is not
                  configured on this environment).
                </p>
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <strong>Developer fallback:</strong> the link below appears only when no email could be
                  delivered. In production it is never shown.
                </p>
                <Link to={`/verify?token=${encodeURIComponent(verifyToken)}`}>
                  <SkyButton className="w-full">Verify (developer link)</SkyButton>
                </Link>
              </>
            ) : (
              <p>
                Your account was created but the verification email could not be sent and no fallback is
                available. Please contact support.
              </p>
            )}
          </div>
          <p className="mt-5 text-center text-sm text-slate-600">
            <Link to="/login" className="font-semibold text-sky-600 hover:text-sky-700 hover:underline">Back to sign in</Link>
          </p>
        </div>
      </div>
    );
  }

  // ── Registration form: two-column split ──
  return (
    <div className="flex min-h-screen w-full bg-white text-slate-900">
      {/* Left: the form */}
      <div className="relative flex flex-1 flex-col justify-center overflow-y-auto bg-white px-6 py-12 sm:px-16 lg:px-24">
        <Link to="/" className="absolute left-6 top-6 sm:left-8 sm:top-8">
          <Wordmark />
        </Link>

        <div className="mx-auto mt-12 w-full max-w-sm sm:mt-0">
          <h1 className="mb-2 text-3xl font-bold tracking-tight text-slate-900">Create your account</h1>
          <p className="mb-8 text-sm text-slate-500">Start your 30-day free trial. No credit card required.</p>

          {error && <div className="mb-5"><Alert>{error}</Alert></div>}

          {/* Permanent identity lock */}
          <div className="mb-6 flex gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 shadow-sm">
            <svg className="mt-0.5 h-5 w-5 flex-none text-slate-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <div className="text-sm leading-relaxed text-slate-700">
              <strong className="mb-1 block font-semibold text-slate-900">Permanent identity lock</strong>
              To keep the logbook tied to one person (EASA AMC1 FCL.050), your{" "}
              <span className="font-medium text-slate-900">first name</span>,{" "}
              <span className="font-medium text-slate-900">last name</span> and{" "}
              <span className="font-medium text-slate-900">date of birth</span> are permanently locked as
              soon as you log your first flight. Your address and licence number stay editable.
            </div>
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="First name" value={form.firstName} onChange={set("firstName")} required />
              <Field label="Last name" value={form.lastName} onChange={set("lastName")} required />
            </div>

            <Field label="Email address" type="email" value={form.email} onChange={set("email")} required />
            <Field label="Password" type="password" value={form.password} onChange={set("password")} hint="At least 12 characters." required />
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
            <div className="grid grid-cols-2 gap-4">
              <Field label="ZIP / place" value={form.addressZip} onChange={set("addressZip")} required />
              <Field label="Country" value={form.addressCountry} onChange={set("addressCountry")} required />
            </div>

            <Field label="Licence number (optional)" mono value={form.licenseNumber} onChange={set("licenseNumber")} />

            <div className="pt-2">
              <SkyButton type="submit" disabled={busy} className="w-full">
                {busy ? "Creating account..." : "Start your free trial"}
              </SkyButton>
            </div>
          </form>

          <p className="mt-8 text-center text-sm text-slate-600">
            Already have an account?{" "}
            <Link to="/login" className="font-semibold text-sky-600 hover:text-sky-700 hover:underline">Sign in</Link>
          </p>
        </div>
      </div>

      {/* Right: dark trust panel */}
      <div className="relative hidden flex-1 flex-col items-center justify-center overflow-hidden bg-slate-900 p-12 lg:flex">
        <div className="absolute inset-0 bg-[radial-gradient(#334155_1px,transparent_1px)] opacity-40 [background-size:24px_24px]" aria-hidden="true"></div>
        <div className="relative z-10 flex h-full w-full max-w-lg flex-col justify-center">
          <div className="flex flex-1 flex-col justify-center">
            <h2 className="mb-6 text-4xl font-bold leading-tight tracking-tight text-white lg:text-5xl">
              Your entire aviation career, secured in one immutable ledger.
            </h2>
          </div>
          <div className="shrink-0 border-t border-slate-800 pt-12">
            <ul className="space-y-4 text-sm font-medium text-slate-300 lg:text-base">
              {["EASA AMC1 FCL.050 compliant", "Seamless CSV imports", "Remote digital signatures"].map((t) => (
                <li key={t} className="flex items-center gap-3">
                  <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-sky-500/10 text-sky-400">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
