/**
 * ICAO location indicators.
 *
 * FOCA 2.3.3 requires that a place be either a valid ICAO code chosen from a
 * maintained database, or the "no location indicator" with the aerodrome name
 * given as free text. ICAO location indicators (ICAO Doc 7910) are four-letter
 * codes; ZZZZ is the reserved indicator for an aerodrome that has no code. This
 * module covers the format and the special indicator; membership in the airport
 * database is checked in the reference repository, since it needs the data.
 */

export const NO_LOCATION_INDICATOR = "ZZZZ";

export function normalizeIcao(value: string): string {
  return value.trim().toUpperCase();
}

/** A syntactically valid four-letter ICAO location indicator. */
export function isIcaoFormat(value: string): boolean {
  return /^[A-Z]{4}$/.test(normalizeIcao(value));
}

export function isNoLocationIndicator(value: string): boolean {
  return normalizeIcao(value) === NO_LOCATION_INDICATOR;
}
