import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import * as api from "../api";
import { Alert, Button, Card, Field } from "../components/ui";

export function Register() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", password: "", licenseNumber: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.register({
        name: form.name,
        email: form.email,
        password: form.password,
        ...(form.licenseNumber ? { licenseNumber: form.licenseNumber } : {}),
      });
      await login(form.email, form.password);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the account.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm pt-10">
      <h1 className="mb-4 text-xl font-semibold">Create account</h1>
      <Card>
        <form onSubmit={onSubmit} className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <Field label="Full name" value={form.name} onChange={set("name")} required />
          <Field label="Email" type="email" value={form.email} onChange={set("email")} required />
          <Field
            label="Password"
            type="password"
            value={form.password}
            onChange={set("password")}
            hint="At least 12 characters."
            required
          />
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
