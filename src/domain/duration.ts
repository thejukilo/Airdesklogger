/**
 * Durations are stored as whole minutes (integers) everywhere — never floats —
 * so totals are exact and carry-over across pages cannot accumulate rounding
 * error. Display is HH:MM as on the paper logbook.
 */

export class DurationError extends Error {}

/** Parse "H:MM" / "HH:MM" / "HHH:MM" into minutes. */
export function parseHHMM(s: string): number {
  const m = /^(\d{1,4}):([0-5]\d)$/.exec(s.trim());
  if (!m) throw new DurationError(`Invalid duration "${s}", expected HH:MM`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Format minutes as HH:MM (hours not zero-padded beyond 2 digits min). */
export function formatHHMM(minutes: number): string {
  if (!Number.isInteger(minutes) || minutes < 0) {
    throw new DurationError(`Duration must be a non-negative integer, got ${minutes}`);
  }
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function sumMinutes(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0);
}
