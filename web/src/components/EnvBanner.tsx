import { deployEnv } from "../lib/environment";

/**
 * A loud, always-visible marker shown on every non-production deployment, so a
 * staging / preview build can never be mistaken for the live app. Renders
 * nothing in production (and in the native app, which is always a production
 * release). Purely decorative and click-through (`pointer-events-none`), so it
 * never blocks the UI underneath.
 */
export function EnvBanner() {
  const env = deployEnv();
  if (env === "production") return null;
  const label = env === "development" ? "Local dev" : "Staging";
  return (
    <div aria-hidden="true">
      {/* amber frame around the whole viewport */}
      <div className="pointer-events-none fixed inset-0 z-[9998] border-[3px] border-amber-500/80" />
      {/* label tab hanging from the top edge (sits in the empty centre of the header) */}
      <div className="pointer-events-none fixed left-1/2 top-0 z-[9999] -translate-x-1/2 whitespace-nowrap rounded-b-md bg-amber-500 px-3 py-0.5 text-[11px] font-bold uppercase tracking-wider text-white shadow-md">
        {label}<span className="hidden sm:inline"> · test data — not production</span>
      </div>
    </div>
  );
}
