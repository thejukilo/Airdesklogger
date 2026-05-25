/**
 * Strict UTC enforcement.
 *
 * EASA logs must be in UTC only — there is no local-time option. We refuse to
 * silently convert: any timestamp entering the domain must be expressed in UTC
 * by the caller. A string with a non-zero offset (e.g. +02:00) or no zone
 * designator at all is ambiguous local time and is rejected outright, rather
 * than guessed at. Internally an instant is a JS Date (a UTC point in time).
 */

const UTC_ISO =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?(Z|\+00:00|-00:00)$/;

export class NonUtcTimeError extends Error {
  constructor(input: string) {
    super(
      `Time "${input}" is not UTC. EASA logs accept UTC only (suffix Z or +00:00); ` +
        `local time and non-zero offsets are not permitted.`,
    );
    this.name = "NonUtcTimeError";
  }
}

/**
 * Parse an ISO-8601 string that MUST already be in UTC. Returns a Date (UTC
 * instant). Throws NonUtcTimeError for local/offset/zoneless input.
 */
export function parseUtcInstant(input: string): Date {
  if (!UTC_ISO.test(input)) throw new NonUtcTimeError(input);
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) throw new NonUtcTimeError(input);
  return d;
}

/** Format an instant back to canonical UTC ISO (always 'Z', second precision). */
export function toUtcIso(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** The UTC calendar date (yyyy-mm-dd) of an instant — the logbook DATE column. */
export function utcDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Logbook display date, dd/mm/yyyy in UTC. */
export function formatLogbookDate(d: Date): string {
  const [y, m, day] = utcDateKey(d).split("-");
  return `${day}/${m}/${y}`;
}

/** Whole-minute difference b - a. */
export function minutesBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 60000);
}
