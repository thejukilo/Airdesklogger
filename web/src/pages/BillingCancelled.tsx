import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import * as api from "../api";
import { Alert, Button, Card } from "../components/ui";

/**
 * Landing after the pilot closed the Stripe Checkout without completing.
 * No subscription was created. We surface a friendly recovery: a button to
 * re-open Checkout in one click, and a link back to the dashboard.
 */
export function BillingCancelled() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retry() {
    setBusy(true);
    setError(null);
    try {
      const { url } = await api.startCheckout();
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open checkout.");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md pt-10">
      <Card>
        <div className="space-y-4 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Checkout cancelled</h1>
          <p className="text-sm text-slate-600">
            No payment was taken. Your account is unchanged. You can try again or come back later.
          </p>
          {error && <Alert>{error}</Alert>}
          <div className="flex flex-col gap-2">
            <Button onClick={retry} disabled={busy} className="w-full">
              {busy ? "Opening checkout..." : "Try again"}
            </Button>
            <button
              type="button"
              onClick={() => navigate("/")}
              className="text-xs text-slate-500 hover:text-slate-700"
            >
              Back to dashboard
            </button>
            <Link to="/account" className="text-xs text-slate-500 hover:text-slate-700">
              Manage account
            </Link>
          </div>
        </div>
      </Card>
    </div>
  );
}
