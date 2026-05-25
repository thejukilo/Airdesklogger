import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import * as api from "../api";
import { Alert, Button, Card, Field } from "../components/ui";

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [needsVerify, setNeedsVerify] = useState(false);
  const [resendMsg, setResendMsg] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setResendMsg(null);
    setNeedsVerify(false);
    setBusy(true);
    try {
      await login(email, password);
      navigate("/");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not sign in.";
      setError(message);
      if (message.toLowerCase().includes("verify")) setNeedsVerify(true);
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setResendMsg(null);
    try {
      await api.resendVerification(email);
      setResendMsg("If that address has an unverified account, a new link is on its way.");
    } catch {
      setResendMsg("Could not send the email just now. Please try again.");
    }
  }

  return (
    <div className="mx-auto max-w-sm pt-10">
      <h1 className="mb-4 text-xl font-semibold">Sign in</h1>
      <Card>
        <form onSubmit={onSubmit} className="space-y-4">
          {error && <Alert>{error}</Alert>}
          {needsVerify && (
            <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">
              <button type="button" onClick={resend} className="font-medium text-ink underline">
                Resend verification email
              </button>
              {resendMsg && <p className="mt-2 text-xs text-slate-500">{resendMsg}</p>}
            </div>
          )}
          <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <Field label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Signing in..." : "Sign in"}
          </Button>
        </form>
      </Card>
      <p className="mt-4 text-center text-sm text-slate-600">
        No account? <Link to="/register" className="font-medium text-ink underline">Create one</Link>
      </p>
    </div>
  );
}
