import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import * as api from "../api";
import { Alert, Button, Card, Field } from "../components/ui";

/**
 * Confirms an email address from the one-time token issued at registration.
 * FOCA 2.1.3 requires the identity to be verified before the account is used, so
 * a new account cannot sign in until this step is done.
 */
export function Verify() {
  const [params] = useSearchParams();
  const [token, setToken] = useState(params.get("token") ?? "");
  const [status, setStatus] = useState<"idle" | "working" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const tried = useRef(false);

  async function submit(t: string) {
    if (!t.trim()) return;
    setStatus("working");
    setMessage(null);
    try {
      await api.verifyEmail(t.trim());
      setStatus("done");
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Could not verify the address.");
    }
  }

  // If a token arrived in the link, verify it once automatically.
  useEffect(() => {
    const t = params.get("token");
    if (t && !tried.current) {
      tried.current = true;
      void submit(t);
    }
  }, [params]);

  return (
    <div className="mx-auto max-w-sm pt-10">
      <h1 className="mb-4 text-xl font-semibold">Verify your email</h1>
      <Card>
        {status === "done" ? (
          <div className="space-y-3">
            <p className="text-sm text-emerald-700">Your email address is verified.</p>
            <Link to="/login">
              <Button className="w-full">Continue to sign in</Button>
            </Link>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit(token);
            }}
            className="space-y-4"
          >
            {message && <Alert>{message}</Alert>}
            <p className="text-sm text-slate-600">
              Paste the verification token from your email, or open the link we sent you.
            </p>
            <Field label="Verification token" value={token} onChange={(e) => setToken(e.target.value)} required />
            <Button type="submit" disabled={status === "working" || !token.trim()} className="w-full">
              {status === "working" ? "Verifying..." : "Verify email"}
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
