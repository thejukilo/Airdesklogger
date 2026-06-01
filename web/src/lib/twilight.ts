/**
 * Client-side civil twilight classification. Identical math to
 * src/domain/night.ts on the server (NOAA sunrise equation at -6 degrees
 * solar altitude) so the SPA's day-vs-night judgement matches what the
 * server will compute on save. Used to decide whether the Log-a-flight
 * form should expose a single "Landings" field or split it into day and
 * night when the flight crosses evening/morning twilight at the
 * arrival aerodrome.
 */

const RAD = Math.PI / 180;
const CIVIL_ALTITUDE = -6;
const DAY_MS = 86_400_000;
const J2000 = 2451545.0;

function toJulian(ms: number): number { return ms / DAY_MS + 2440587.5; }
function fromJulian(j: number): number { return (j - 2440587.5) * DAY_MS; }

interface DayLight {
  dawn: number | null;
  dusk: number | null;
  polarNight: boolean;
}

function civilTwilight(dayUtcMs: number, latDeg: number, lonDeg: number): DayLight {
  const jdate = toJulian(dayUtcMs);
  const n = Math.round(jdate - J2000 + 0.0008);
  const meanSolarTime = n - lonDeg / 360;
  const M = (357.5291 + 0.98560028 * meanSolarTime) % 360;
  const Mr = M * RAD;
  const C = 1.9148 * Math.sin(Mr) + 0.02 * Math.sin(2 * Mr) + 0.0003 * Math.sin(3 * Mr);
  const lambda = ((M + C + 180 + 102.9372) % 360) * RAD;
  const jTransit = J2000 + meanSolarTime + 0.0053 * Math.sin(Mr) - 0.0069 * Math.sin(2 * lambda);
  const sinDecl = Math.sin(lambda) * Math.sin(23.44 * RAD);
  const decl = Math.asin(sinDecl);
  const lat = latDeg * RAD;
  const cosH =
    (Math.sin(CIVIL_ALTITUDE * RAD) - Math.sin(lat) * sinDecl) / (Math.cos(lat) * Math.cos(decl));
  if (cosH > 1) return { dawn: null, dusk: null, polarNight: true };
  if (cosH < -1) return { dawn: null, dusk: null, polarNight: false };
  const H = Math.acos(cosH) / RAD / 360;
  return { dawn: fromJulian(jTransit - H), dusk: fromJulian(jTransit + H), polarNight: false };
}

export interface LatLon { latitude: number; longitude: number }

/** True when the given UTC instant is night (sun below -6 deg) at the position. */
export function isNightAt(instant: Date, coords: LatLon | null | undefined): boolean {
  if (!coords) return false;
  const t = instant.getTime();
  const day = Math.floor(t / DAY_MS) * DAY_MS;
  const { dawn, dusk, polarNight } = civilTwilight(day + DAY_MS / 2, coords.latitude, coords.longitude);
  if (polarNight) return true;
  if (dawn === null || dusk === null) return false;
  return t < dawn || t >= dusk;
}

/**
 * Convert a wall-clock string ("YYYY-MM-DDTHH:MM" or with seconds) interpreted
 * at a given IANA timezone into the corresponding UTC instant. Mirrors the
 * server-side zonedWallClockToUtc in src/domain/localTime.ts so the SPA's
 * day/night judgement matches what classifyLandings will compute on save when
 * the form is in local-time mode.
 */
const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

function offsetMs(timeZone: string, instantMs: number): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(instantMs))) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  const asUtc = Date.UTC(
    Number(map.year), Number(map.month) - 1, Number(map.day),
    Number(map.hour), Number(map.minute), Number(map.second),
  );
  return asUtc - instantMs;
}

export function zonedWallClockToUtc(wallClock: string, timeZone: string): Date | null {
  const m = WALL_CLOCK.exec(wallClock.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const guess = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? "0"));
  let off = offsetMs(timeZone, guess);
  let utc = guess - off;
  const off2 = offsetMs(timeZone, utc);
  if (off2 !== off) utc = guess - off2;
  const result = new Date(utc);
  return Number.isNaN(result.getTime()) ? null : result;
}

/**
 * Whether the day/night classification at departure differs from the one at
 * arrival, using the arrival airport's coordinates for both samples (the same
 * convention the server uses when classifying landings). When true, the form
 * should expose two landing inputs so the pilot can split day-vs-night
 * landings explicitly; the server will keep the split verbatim.
 */
export function spansTwilight(
  departure: Date,
  arrival: Date,
  arrivalCoords: LatLon | null | undefined,
): boolean {
  if (!arrivalCoords) return false;
  return isNightAt(departure, arrivalCoords) !== isNightAt(arrival, arrivalCoords);
}
