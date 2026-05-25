import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import * as api from "../api";
import { Alert, Button, Card, Field } from "../components/ui";

/**
 * Starts a password reset. The response is the same whether or not the address
 * has an account, so the page never reveals which emails are registered.
 */
export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.requestPasswordReset(email);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the reset.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm pt-10">
      <h1 className="mb-4 text-xl font-semibold">Reset your password</h1>
      <Card>
        {sent ? (
          <div className="space-y-3 text-sm text-slate-600">
            <p>
              If an account exists for {email}, a link to choose a new password is on its way. The link
              expires in an hour.
            </p>
            <Link to="/login" className="font-medium text-ink underline">Back to sign in</Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            {error && <Alert>{error}</Alert>}
            <p className="text-sm text-slate-600">
              Enter your email address and we will send you a link to set a new password.
            </p>
            <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? "Sending..." : "Send reset link"}
            </Button>
          </form>
        )}
      </Card>
      <p className="mt-4 text-center text-sm text-slate-600">
        <Link to="/login" className="font-medium text-ink underline">Back to sign in</Link>
      </p>
    </div>
  );
}
