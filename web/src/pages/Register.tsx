import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import * as api from "../api";
import { Alert, Button, Card, Field } from "../components/ui";

export function Register() {
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    dateOfBirth: "",
    address: "",
    licenseNumber: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [verifyToken, setVerifyToken] = useState<string | null>(null);
  const [emailed, setEmailed] = useState(false);

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
        address: form.address,
        ...(form.licenseNumber ? { licenseNumber: form.licenseNumber } : {}),
      });
      // The account must confirm its email before it can sign in (FOCA 2.1.3).
      setVerifyToken(res.emailVerificationToken);
      setEmailed(res.emailed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the account.");
    } finally {
      setBusy(false);
    }
  }

  if (verifyToken) {
    return (
      <div className="mx-auto max-w-sm pt-10">
        <h1 className="mb-4 text-xl font-semibold">Confirm your email</h1>
        <Card>
          <div className="space-y-3 text-sm text-slate-600">
            <p>
              Your account was created. Before you can sign in, confirm your email address.
              {emailed
                ? ` A verification link was sent to ${form.email}.`
                : " Use the button below to confirm."}
            </p>
            <Link to={`/verify?token=${encodeURIComponent(verifyToken)}`}>
              <Button className="w-full">Verify now</Button>
            </Link>
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
          <p className="rounded-md bg-brand-50 px-3 py-2 text-xs text-slate-600">
            Your name, date of birth and address are required: EASA rules require these details so the
            electronic logbook record can be tied to you as a physical person.
          </p>
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
          <Field label="Full address" value={form.address} onChange={set("address")} required />
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
