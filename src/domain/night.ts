/**
 * Night time, computed rather than typed (FOCA 2.3.4 requires the time values to
 * be calculated automatically). EASA night is the period between the end of
 * evening civil twilight and the beginning of morning civil twilight, that is
 * when the centre of the sun is more than 6 degrees below the horizon.
 *
 * We compute the civil twilight times for the departure aerodrome on the day of
 * the leg using the standard sunrise equation, and measure how much of the leg
 * falls in night. Using the departure position for the whole leg is an
 * approximation that is accurate for the short legs that make up the vast
 * majority of a logbook; a leg with no known position contributes no night time.
 */

const RAD = Math.PI / 180;
const CIVIL_ALTITUDE = -6; // degrees below the horizon
const DAY_MS = 86_400_000;
const J2000 = 2451545.0;

function toJulian(ms: number): number {
  return ms / DAY_MS + 2440587.5;
}
function fromJulian(j: number): number {
  return (j - 2440587.5) * DAY_MS;
}

interface DayLight {
  /** Beginning of morning civil twilight (UTC ms), if the sun crosses -6 deg. */
  dawn: number | null;
  /** End of evening civil twilight (UTC ms), if the sun crosses -6 deg. */
  dusk: number | null;
  /** True when the sun stays below -6 deg all day (continuous civil darkness). */
  polarNight: boolean;
}

/**
 * Civil twilight bounds for a calendar day (taken at UTC noon of that day) at a
 * given position, via the sunrise equation with a -6 degree altitude.
 */
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

  if (cosH > 1) return { dawn: null, dusk: null, polarNight: true }; // sun never rises above -6
  if (cosH < -1) return { dawn: null, dusk: null, polarNight: false }; // sun never sets below -6

  const H = Math.acos(cosH) / RAD / 360; // in fractions of a day
  return {
    dawn: fromJulian(jTransit - H),
    dusk: fromJulian(jTransit + H),
    polarNight: false,
  };
}

function overlap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

/**
 * Minutes of the interval [departure, arrival] that fall in night, at the given
 * position. Returns 0 when no position is known.
 */
export function nightMinutes(
  departure: Date,
  arrival: Date,
  coords: { latitude: number; longitude: number } | null | undefined,
): number {
  if (!coords) return 0;
  const start = departure.getTime();
  const end = arrival.getTime();
  if (!(end > start)) return 0;

  // The leg can span more than one calendar day; consider each UTC day it touches.
  let dayMs = 0;
  const firstDay = Math.floor(start / DAY_MS) * DAY_MS;
  for (let day = firstDay; day < end; day += DAY_MS) {
    const noon = day + DAY_MS / 2;
    const { dawn, dusk, polarNight } = civilTwilight(noon, coords.latitude, coords.longitude);
    if (polarNight) continue; // whole day is night, so no daylight to subtract
    if (dawn === null || dusk === null) {
      // Sun never goes below civil twilight: the whole day is daylight.
      dayMs += overlap(start, end, day, day + DAY_MS);
      continue;
    }
    dayMs += overlap(start, end, dawn, dusk);
  }

  const nightMs = end - start - dayMs;
  return Math.round(Math.max(0, nightMs) / 60_000);
}

/**
 * The day/night pattern of a flight as a dash-joined sequence of D and N
 * segments (e.g. "D", "N", "D-N", "N-D-N", "D-N-D"), found by walking the
 * civil-twilight crossings between departure and arrival. Like nightMinutes it
 * uses the departure position for the whole flight, so the segments line up with
 * the computed night time. Returns null when the position is unknown.
 */
export function dayNightPattern(
  departure: Date,
  arrival: Date,
  coords: { latitude: number; longitude: number } | null | undefined,
): string | null {
  if (!coords) return null;
  const start = departure.getTime();
  const end = arrival.getTime();
  if (!(end > start)) return null;

  const transitions: Array<{ t: number; to: "D" | "N" }> = [];
  const firstDay = Math.floor(start / DAY_MS) * DAY_MS;
  for (let day = firstDay; day < end; day += DAY_MS) {
    const { dawn, dusk } = civilTwilight(day + DAY_MS / 2, coords.latitude, coords.longitude);
    if (dawn !== null && dawn > start && dawn < end) transitions.push({ t: dawn, to: "D" });
    if (dusk !== null && dusk > start && dusk < end) transitions.push({ t: dusk, to: "N" });
  }
  transitions.sort((a, b) => a.t - b.t);

  let state: "D" | "N" = isNightAt(departure, coords) ? "N" : "D";
  const seq: Array<"D" | "N"> = [state];
  for (const tr of transitions) {
    if (tr.to !== state) {
      state = tr.to;
      seq.push(state);
    }
  }
  return seq.join("-");
}

/**
 * Whether a single instant falls in night (sun more than 6 degrees below the
 * horizon) at a position. Used to classify a landing as day or night. Returns
 * false when no position is known.
 */
export function isNightAt(
  instant: Date,
  coords: { latitude: number; longitude: number } | null | undefined,
): boolean {
  if (!coords) return false;
  const t = instant.getTime();
  const day = Math.floor(t / DAY_MS) * DAY_MS;
  const { dawn, dusk, polarNight } = civilTwilight(day + DAY_MS / 2, coords.latitude, coords.longitude);
  if (polarNight) return true;
  if (dawn === null || dusk === null) return false; // sun never sets below civil twilight: daylight
  return t < dawn || t >= dusk;
}
