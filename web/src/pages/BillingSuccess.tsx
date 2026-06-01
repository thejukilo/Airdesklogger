import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { Button, Card } from "../components/ui";

/**
 * Landing after a successful Stripe Checkout. Stripe redirects here via the
 * success_url; we poll the profile a couple of times so the just-arrived
 * subscription state shows up promptly (the webhook usually wins the race
 * but a slow network can leave the new state momentarily missing).
 */
export function BillingSuccess() {
  const { profile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [polled, setPolled] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    async function poll() {
      await refreshProfile();
      tries += 1;
      setPolled(tries);
      if (cancelled) return;
      const state = profile?.subscription?.state;
      if (state === "active" || tries >= 6) return;
      setTimeout(poll, 1500);
    }
    void poll();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const state = profile?.subscription?.state;
  const isActive = state === "active";

  return (
    <div className="mx-auto max-w-md pt-10">
      <Card>
        <div className="space-y-4 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">You're all set</h1>
          <p className="text-sm text-slate-600">
            {isActive
              ? "Your subscription is active. Welcome back to a full logbook."
              : polled >= 6
              ? "Payment went through. Your account will switch to active in a moment."
              : "Confirming your payment..."}
          </p>
          <div className="flex flex-col gap-2">
            <Button onClick={() => navigate("/")} className="w-full">Go to dashboard</Button>
            <Link to="/account" className="text-xs text-slate-500 hover:text-slate-700">
              Manage subscription
            </Link>
          </div>
        </div>
      </Card>
    </div>
  );
}
