/**
 * Strict UTC enforcement.
 *
 * EASA logs must be in UTC only. There is no local-time option, so we refuse to
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

const OFFSET_ISO =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/;

export class AmbiguousTimeError extends Error {
  constructor(input: string) {
    super(
      `Time "${input}" has no timezone. Provide UTC (suffix Z or +00:00) or a local time ` +
        `with an explicit offset such as +02:00; a bare local time cannot be converted.`,
    );
    this.name = "AmbiguousTimeError";
  }
}

export interface ParsedInstant {
  /** The instant, always stored in UTC. */
  utc: Date;
  /** True when the caller supplied a non-zero offset (local time entry). */
  enteredLocal: boolean;
}

/**
 * Parse a time at the entry boundary, allowing UTC or local time. FOCA 2.2.7
 * requires local-time entry to be possible with UTC as the default, and exports
 * to flag local entries. We always store UTC; when the caller supplies a non-zero
 * offset we convert it and record that the entry was made in local time. A
 * timezone-less string is still rejected, because without an offset there is no
 * way to convert it to UTC.
 */
export function parseInstant(input: string): ParsedInstant {
  if (!OFFSET_ISO.test(input)) throw new AmbiguousTimeError(input);
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) throw new AmbiguousTimeError(input);
  const offset = input.slice(-6);
  const isUtc = input.endsWith("Z") || offset === "+00:00" || offset === "-00:00";
  return { utc: d, enteredLocal: !isUtc };
}

/** Format an instant back to canonical UTC ISO (always 'Z', second precision). */
export function toUtcIso(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** The UTC calendar date (yyyy-mm-dd) of an instant. This is the logbook DATE column. */
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
