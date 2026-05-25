import { useState, type FormEvent } from "react";
import QRCode from "qrcode";
import { useAuth } from "../auth";
import * as api from "../api";
import { Alert, Button, Card, Field } from "../components/ui";

export function Account() {
  const { user, mfaEnabled, setMfaEnabled } = useAuth();
  const [secret, setSecret] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function startSetup() {
    setError(null);
    setBusy(true);
    try {
      const { secret, otpauthUri } = await api.mfaSetup();
      setSecret(secret);
      setQr(await QRCode.toDataURL(otpauthUri, { margin: 1, width: 200 }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start MFA setup.");
    } finally {
      setBusy(false);
    }
  }

  async function activate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.mfaActivate(code.trim());
      setMfaEnabled(true);
      setSecret(null);
      setQr(null);
      setCode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That code did not match.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-xl font-semibold">Account</h1>

      <Card>
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-500">Name</dt>
            <dd>{user?.name}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">Email</dt>
            <dd>{user?.email}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">Roles</dt>
            <dd>{user?.roles.join(", ")}</dd>
          </div>
        </dl>
      </Card>

      <Card>
        <h2 className="mb-1 font-medium">Two-factor authentication</h2>
        <p className="mb-3 text-sm text-slate-500">
          Required to countersign entries. Add the key to an authenticator app, then confirm a code.
        </p>
        {error && <Alert>{error}</Alert>}

        {mfaEnabled ? (
          <p className="text-sm text-emerald-700">Two-factor authentication is enabled.</p>
        ) : !secret ? (
          <Button onClick={startSetup} disabled={busy}>
            {busy ? "Starting..." : "Set up MFA"}
          </Button>
        ) : (
          <form onSubmit={activate} className="space-y-3">
            {qr && <img src={qr} alt="Authenticator QR code" className="rounded border" />}
            <p className="text-xs text-slate-500">
              Or enter this key manually: <code className="break-all">{secret}</code>
            </p>
            <Field
              label="6-digit code from your app"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              required
            />
            <Button type="submit" disabled={busy}>
              {busy ? "Verifying..." : "Activate"}
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
