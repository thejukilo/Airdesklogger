import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import * as api from "../api";
import { Alert, Button, Card, Field } from "../components/ui";

/** Sets a new password from the token in the reset link. */
export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await api.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset the password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm pt-10">
      <h1 className="mb-4 text-xl font-semibold">Choose a new password</h1>
      <Card>
        {done ? (
          <div className="space-y-3">
            <p className="text-sm text-emerald-700">Your password has been changed.</p>
            <Link to="/login">
              <Button className="w-full">Sign in</Button>
            </Link>
          </div>
        ) : !token ? (
          <Alert>This reset link is missing its token. Request a new one from the sign-in page.</Alert>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            {error && <Alert>{error}</Alert>}
            <Field
              label="New password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              hint="At least 12 characters."
              required
            />
            <Field
              label="Confirm new password"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
            <Button type="submit" disabled={busy || !password} className="w-full">
              {busy ? "Saving..." : "Set new password"}
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
