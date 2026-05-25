/**
 * Converting a local wall-clock time at a place to a UTC instant.
 *
 * When a pilot enters block times in local time (FOCA 2.2.7), "local" means the
 * civil time at the aerodrome, not the time on the device they happen to be
 * holding. So the conversion is done against the aerodrome's IANA timezone,
 * which accounts for daylight saving and historical offsets. The timezone name
 * itself is looked up from the airport's coordinates outside this module; here
 * we only do the timezone-aware arithmetic, using the timezone database that
 * ships with the JavaScript runtime (Intl), so there is no extra data to trust.
 */

const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** The offset (ms, east positive) of a timezone at a given UTC instant. */
function offsetMs(timeZone: string, instantMs: number): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(instantMs))) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  );
  return asUtc - instantMs;
}

export class LocalTimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalTimeError";
  }
}

/**
 * Interpret a wall-clock time ("YYYY-MM-DDTHH:MM" or with seconds) as civil time
 * in the given IANA timezone and return the corresponding UTC instant. Uses two
 * passes so a value near a daylight-saving change resolves to the correct side.
 */
export function zonedWallClockToUtc(wallClock: string, timeZone: string): Date {
  const m = WALL_CLOCK.exec(wallClock.trim());
  if (!m) throw new LocalTimeError(`Local time "${wallClock}" is not a wall-clock value.`);
  const [, y, mo, d, h, mi, s] = m;
  const guess = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? "0"));

  const off1 = offsetMs(timeZone, guess);
  let utc = guess - off1;
  const off2 = offsetMs(timeZone, utc);
  if (off2 !== off1) utc = guess - off2;

  const result = new Date(utc);
  if (Number.isNaN(result.getTime())) throw new LocalTimeError(`Could not convert "${wallClock}" in ${timeZone}.`);
  return result;
}
