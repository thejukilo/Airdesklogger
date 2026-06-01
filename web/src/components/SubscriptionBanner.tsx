import { useState } from "react";
import * as api from "../api";
import { useAuth } from "../auth";

/**
 * Inline banner that surfaces the holder's subscription state across the SPA.
 * Mounted near the top of every authenticated page (right under the header,
 * above the page content) so the trial countdown and the post-trial nudge are
 * always visible. Hidden on `active` accounts so there's no noise when nothing
 * needs attention.
 */
function useCheckout() {
  const [busy, setBusy] = useState(false);
  return {
    busy,
    async go() {
      setBusy(true);
      try {
        const { url } = await api.startCheckout();
        window.location.href = url;
      } catch (err) {
        alert(err instanceof Error ? err.message : "Could not open checkout.");
        setBusy(false);
      }
    },
  };
}

function CTA({ label, color }: { label: string; color: "amber" | "brand" | "rose" }) {
  const { busy, go } = useCheckout();
  const cls = {
    amber: "bg-amber-600 hover:bg-amber-700",
    brand: "bg-brand-600 hover:bg-brand-700",
    rose: "bg-rose-600 hover:bg-rose-700",
  }[color];
  return (
    <button
      type="button"
      onClick={go}
      disabled={busy}
      className={`rounded-md px-3 py-1.5 text-xs font-semibold text-white shadow-sm disabled:opacity-60 ${cls}`}
    >
      {busy ? "Opening checkout..." : label}
    </button>
  );
}

export function SubscriptionBanner() {
  const { profile } = useAuth();
  const sub = profile?.subscription;
  if (!sub) return null;

  if (sub.state === "trialing") {
    const minutes = sub.trialMinutesRemaining ?? 0;
    if (minutes <= 0) return null; // expired but not yet cron-swept
    const hours = Math.floor(minutes / 60);
    const label =
      hours >= 48
        ? `${Math.ceil(hours / 24)} days left in your trial`
        : hours >= 1
        ? `${hours} hour${hours === 1 ? "" : "s"} left in your trial`
        : `${minutes} minute${minutes === 1 ? "" : "s"} left in your trial`;
    return (
      <div className="border-b border-amber-200 bg-amber-50">
        <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center justify-between gap-3 px-4 py-2 text-sm">
          <span className="text-amber-900">
            <span className="font-semibold">{label}.</span>{" "}
            <span className="text-amber-800">Add a card to keep your logbook live after the trial ends.</span>
          </span>
          <CTA label="Subscribe — CHF 5.99 / mo" color="amber" />
        </div>
      </div>
    );
  }

  if (sub.state === "past_due") {
    return (
      <div className="border-b border-amber-200 bg-amber-50">
        <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center justify-between gap-3 px-4 py-2 text-sm">
          <span className="text-amber-900">
            <span className="font-semibold">Payment failed.</span>{" "}
            <span className="text-amber-800">Update your card to avoid losing access.</span>
          </span>
          <CTA label="Update payment" color="amber" />
        </div>
      </div>
    );
  }

  if (sub.state === "cancelled") {
    return (
      <div className="border-b border-slate-200 bg-slate-50">
        <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center justify-between gap-3 px-4 py-2 text-sm">
          <span className="text-slate-700">
            <span className="font-semibold">Subscription cancelled.</span>{" "}
            <span className="text-slate-500">
              {sub.subscriptionPeriodEnd
                ? `Access until ${sub.subscriptionPeriodEnd.slice(0, 10)}.`
                : "Read-only after this period ends."}
            </span>
          </span>
          <CTA label="Resume" color="brand" />
        </div>
      </div>
    );
  }

  if (sub.state === "read_only") {
    return (
      <div className="border-b border-rose-200 bg-rose-50">
        <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center justify-between gap-3 px-4 py-2 text-sm">
          <span className="text-rose-900">
            <span className="font-semibold">Read-only mode.</span>{" "}
            <span className="text-rose-800">Subscribe to log new flights and to generate FOCA exports.</span>
          </span>
          <CTA label="Subscribe — CHF 5.99 / mo" color="rose" />
        </div>
      </div>
    );
  }

  return null; // active
}
