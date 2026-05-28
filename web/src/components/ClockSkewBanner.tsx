import { useEffect, useState } from "react";
import {
  getClockSkew,
  hasMeasured,
  subscribeClockSkew,
  SEVERE_SKEW_MS,
  WARN_SKEW_MS,
} from "../lib/clockSkew";

/**
 * App-wide banner that surfaces a wrong system clock. Comparison is done in
 * UTC milliseconds, so the user's timezone is irrelevant: a Tokyo pilot with
 * an NTP-synced clock sees nothing, a pilot anywhere with their clock set 2
 * hours forward sees the red banner.
 */
export function ClockSkewBanner() {
  const [skew, setSkew] = useState(getClockSkew());
  const [ready, setReady] = useState(hasMeasured());
  useEffect(
    () =>
      subscribeClockSkew((s) => {
        setSkew(s);
        setReady(true);
      }),
    [],
  );

  if (!ready) return null;
  const abs = Math.abs(skew);
  if (abs < WARN_SKEW_MS) return null;
  const severe = abs >= SEVERE_SKEW_MS;
  const minutes = Math.round(abs / 60_000);
  const display =
    minutes >= 120 ? `${Math.round(minutes / 60)} hours` : `${minutes} minutes`;
  const direction = skew > 0 ? "ahead of" : "behind";

  return (
    <div
      role="status"
      aria-live="polite"
      className={`${
        severe
          ? "border-b border-red-300 bg-red-50 text-red-900"
          : "border-b border-amber-300 bg-amber-50 text-amber-900"
      } px-4 py-2 text-sm`}
    >
      <div className="mx-auto flex max-w-screen-2xl items-start gap-2">
        <svg
          className={`mt-0.5 h-4 w-4 flex-none ${severe ? "text-red-600" : "text-amber-600"}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
        <div>
          <strong className="font-semibold">Your computer's clock looks wrong.</strong>{" "}
          It is about {display} {direction} real time.{" "}
          {severe
            ? "Saving a new flight is disabled until you fix the clock - the wrong time would be baked into the logbook record."
            : "Flight times pre-fill from your clock - please double-check them before saving."}{" "}
          <a
            href="https://time.is/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium underline"
          >
            Check real time
          </a>
        </div>
      </div>
    </div>
  );
}
