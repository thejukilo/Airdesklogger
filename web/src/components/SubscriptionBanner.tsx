import { Link } from "react-router-dom";
import { useAuth } from "../auth";

/**
 * Inline banner that surfaces the holder's subscription state across the SPA.
 * Mounted near the top of every authenticated page (right under the header,
 * above the page content) so the trial countdown and the post-trial nudge are
 * always visible. Hidden on `active` accounts so there's no noise when nothing
 * needs attention.
 */
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
          <Link
            to="/account?subscribe=1"
            className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-amber-700"
          >
            Subscribe — CHF 5.99 / mo
          </Link>
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
          <Link
            to="/account?subscribe=1"
            className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-amber-700"
          >
            Update payment
          </Link>
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
          <Link
            to="/account?subscribe=1"
            className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-brand-700"
          >
            Resume
          </Link>
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
          <Link
            to="/account?subscribe=1"
            className="rounded-md bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-rose-700"
          >
            Subscribe — CHF 5.99 / mo
          </Link>
        </div>
      </div>
    );
  }

  return null; // active
}
