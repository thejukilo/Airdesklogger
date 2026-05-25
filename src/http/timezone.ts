/**
 * Maps a coordinate to its IANA timezone name, so a local-time entry can be
 * converted against the aerodrome's timezone rather than the user's device. The
 * lookup data is bundled with the tz-lookup package (offline, no network).
 */

import tzlookup from "tz-lookup";

export function timezoneAt(latitude: number, longitude: number): string | null {
  try {
    return tzlookup(latitude, longitude);
  } catch {
    return null;
  }
}
