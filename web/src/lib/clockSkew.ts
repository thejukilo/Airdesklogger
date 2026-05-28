/**
 * Tracks how far the user's system clock drifts from the server's. The server's
 * HTTP Date response header is the reference; subtracting it from the browser's
 * Date.now() (at the request mid-point, to discount round-trip latency) gives a
 * signed skew in milliseconds where a positive number means the client is ahead
 * of real time. Every authenticated request updates this through api.ts.
 */

import { useEffect, useState } from "react";

/** A skew larger than this in either direction blocks creating a new flight. */
export const SEVERE_SKEW_MS = 30 * 60 * 1000;
/** Above this we warn but still allow saving. */
export const WARN_SKEW_MS = 5 * 60 * 1000;

let skewMs = 0;
let measured = false;
const listeners = new Set<(skew: number) => void>();

export function getClockSkew(): number {
  return skewMs;
}
export function hasMeasured(): boolean {
  return measured;
}

export function subscribeClockSkew(fn: (skew: number) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Called from api.ts on every completed request. The Date header has
 * second-level precision; we use the midpoint of the local send/receive
 * timestamps to cancel out symmetric network latency.
 */
export function recordServerDate(
  headerValue: string | null,
  requestStartMs: number,
  requestEndMs: number,
): void {
  if (!headerValue) return;
  const serverMs = Date.parse(headerValue);
  if (!Number.isFinite(serverMs)) return;
  const midpointMs = (requestStartMs + requestEndMs) / 2;
  skewMs = midpointMs - serverMs;
  measured = true;
  for (const fn of listeners) fn(skewMs);
}

/** React hook returning the current signed skew in ms; re-renders on update. */
export function useClockSkew(): number {
  const [s, setS] = useState(skewMs);
  useEffect(() => subscribeClockSkew(setS), []);
  return s;
}
