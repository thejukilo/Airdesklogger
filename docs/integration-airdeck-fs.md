# Airdesk Flight School → Airdesk Logger — developer integration guide

This document is for the **Airdesk Flight School** (`*.airdeck.ch`) developer
team. It tells you exactly how to push closed flights from your `flights`
table into a pilot's personal logbook on Airdesk Logger.

If you've already read `api-import-v1.md`, this is the school-side companion
— the API spec is the contract, this is the mapping from your schema.

---

## 1. What you're building

A small export job — call it `pushFlightToLogger(flightId)` — that:

1. Reads one row from `public.flights` (already closed: `flight_end IS NOT NULL`).
2. Joins it to `aircraft`, `aircraft_types`, `flight_pilots`, `users`.
3. For each pilot on the flight who has opted in (PAT saved on their profile),
   transforms the row into the Airdesk Logger import payload.
4. POSTs it to `https://log.airdeck.ch/api/import/v1/entries` using **that
   pilot's** bearer token.
5. Stores the response status against the flight so you don't re-export
   unchanged rows.

Trigger it from:
- An `AFTER UPDATE` Postgres trigger on `flights` when `flight_end` transitions
  from NULL to NOT NULL, or
- A queue worker after the pilot taps "Return flight" in your UI, or
- A nightly catch-up cron (`SELECT … WHERE pushed_at IS NULL`).

Recommended: real-time on close + nightly catch-up for retries.

---

## 2. Prerequisites on your side

### 2.1 New columns

Per pilot, store their Airdesk Logger PAT and a friendly source label that
will appear on the pilot's logbook overview:

```sql
ALTER TABLE public.users
  ADD COLUMN airdesk_pat            text,
  ADD COLUMN airdesk_pat_label      text,
  ADD COLUMN airdesk_export_enabled boolean NOT NULL DEFAULT false;
```

Per flight, track the per-pilot push status so retries are cheap:

```sql
CREATE TABLE public.airdesk_pushes (
  tenant_id    uuid    NOT NULL REFERENCES tenants(id),
  flight_id    uuid    NOT NULL REFERENCES flights(id),
  user_id      uuid    NOT NULL REFERENCES users(id),
  status       text    NOT NULL,           -- 'created' | 'duplicate' | 'rejected' | 'error'
  http_status  int     NOT NULL,
  response     jsonb   NOT NULL,
  pushed_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (flight_id, user_id)
);
```

### 2.2 Pilot profile UI

On the pilot's profile, add:

- A field "Airdesk Logger personal access token" (the pilot pastes the
  `airdesk_pat_…` string they generated on log.airdeck.ch).
- A free-text label (default: your tenant's name) that the pilot will see on
  their Airdesk logbook row.
- A toggle "Auto-export closed flights to my Airdesk Logger". Default off
  until the PAT is set, then on.

Surface a small "tested OK / token invalid" pill next to the field by hitting
the import endpoint with `?dryRun=1` and a minimal payload after the pilot
saves the PAT.

---

## 3. Column-by-column mapping

| Your column (`public.flights.*` unless noted) | Airdesk Logger field | Conversion |
|---|---|---|
| `id` (uuid) | `externalId` | Use as-is (UUID string). |
| `tenant_id` | — | **Never send.** Token-bound. |
| `reservation_id` | `entry.provenance.reservationId` | Optional. |
| `aircraft_id` → `aircraft.registration` | `entry.aircraft.registration` | Uppercase, no dash needed. |
| `aircraft_id` → `aircraft.manufacturer + ' ' + aircraft.model` | `entry.aircraft.makeModelVariant` | Concat. Prefer `aircraft_types.display_name` if non-null. |
| `aircraft_id` → `aircraft.aircraft_class` | `entry.aircraft.category` + `engineClass` + `multiPilot` | See §4.1. |
| `pilot_id` | — | **Never send.** Token resolves it. |
| `instructor_id` → `users.display_name` | `entry.picName` (when `function.primary = "DUAL"` / "PICUS" / "SPIC") or used to populate provenance | See §4.2. |
| `flight_date` | (combined with `block_start`/`block_end` → ISO UTC) | See §4.3. |
| `departure_icao` | `entry.legs[0].departurePlace` | Uppercase. If empty or not a 4-letter ICAO, send `"ZZZZ"` and add `entry.legs[0].departurePlaceName`. |
| `arrival_icao` | `entry.legs[0].arrivalPlace` | Same. |
| `block_start` (minute-of-day, 0..1439) | `entry.legs[0].departureTime` | `flight_date + block_start` → ISO UTC. See §4.3. |
| `block_end` | `entry.legs[0].arrivalTime` | Same. Cross-midnight → add a day. |
| `flight_start` | `entry.counters.flightStart` | Same conversion, optional. |
| `flight_end` | `entry.counters.flightEnd` | Same conversion, optional. |
| `ftc_start` | `entry.counters.ftcStart` | Integer minutes-since-zero, send as-is. |
| `ftc_end` | `entry.counters.ftcEnd` | Same. |
| `hobbs_start` | `entry.counters.hobbsStart` | Optional. |
| `hobbs_end` | `entry.counters.hobbsEnd` | Optional. |
| `landings_day` | `entry.landings.day` | Integer. |
| `landings_night` | `entry.landings.night` | Integer. (Logger re-classifies against arrival airport sunset; safe to send both as-is.) |
| `go_arounds` | `entry.attributes: ["go_around"]` + `entry.attributeDetails.goArounds` | Only emit the attribute when `go_arounds > 0`. |
| `passengers` | `entry.attributeDetails.passengers`? | Not yet in the v1 spec — drop for now, will land in v1.1. |
| `fuel_type`, `oil_litres`, `aircraft_status_ok` | — | **Drop.** Operational data, not part of the FOCA logbook. |
| `comment` | `entry.remarks` | Free text. |
| `pilot_log_no` | `entry.provenance.pilotLogNo` | Integer. |
| `created_at` | `entry.provenance.createdAt` | ISO 8601. |
| `created_by` → `users.display_name` | `entry.provenance.createdBy` | Resolve to a display name, don't send the UUID. |
| `instructor_minutes` | `entry.function.instructor` | Pass through, integer minutes. |
| `instructor_signed_at` | `entry.provenance.schoolRecordedInstructorAt` | Information only. **Does not** satisfy EASA sign-off. |
| `instructor_signed_by` → `users.display_name` | `entry.provenance.schoolRecordedInstructorBy` | Display name. |
| `track` (jsonb) | `entry.track` | Must be a GeoJSON `LineString`. If your `track` is a `FeatureCollection` or a polyline-encoded string, convert first. See §4.4. |
| `flight_pilots.function` (per-pilot row) | `entry.function.primary` | See §4.2. |
| `flight_pilots.landings_logged` | — | Use `flights.landings_day/night` totals; don't double-count. |

---

## 4. The four conversions worth getting right

### 4.1 `aircraft_class` → `category` + `engineClass` + `multiPilot`

Your `aircraft_class` enum doesn't map 1:1. Use this table:

| `aircraft.aircraft_class` | `category` | `engineClass` | `multiPilot` |
|---|---|---|---|
| `SEP` | `AEROPLANE` | `SE` | `false` |
| `SET` | `AEROPLANE` | `SE` | `false` |
| `TMG` | **send `"TMG"`** — the pilot's token decides | `SE` | `false` |
| `MEP` | `AEROPLANE` | `ME` | `false` |
| `MET` | `AEROPLANE` | `ME` | `false` |
| `Glider` / `SAILPLANE` | `SAILPLANE` | `SE` | `false` |
| `Helicopter` | `HELICOPTER` | `SE` *or* `ME` (per type) | `false` *or* `true` (per type) |
| `Balloon` | `BALLOON` | `SE` | `false` (and you must send `balloonGroup`) |

For TMG aircraft, **do not** decide the filing on the school side. Send
`category: "TMG"` and Airdesk resolves it per the pilot's token preference
(AEROPLANE or SAILPLANE). Pilots set this once when they generate the token;
the choice is regulatory and theirs to make.

For multi-pilot types (large helicopters, jets, A320, etc.) hold a small
lookup keyed by `aircraft_types.id` with `multi_pilot boolean` and
`engine_class text` overrides. Default everything else as above.

For **balloons**, Airdesk Logger requires `aircraft.balloonGroup ∈ {A,B,C,D}`.
Your schema doesn't carry this today; either add a column on
`aircraft_types` (`balloon_group text CHECK (balloon_group IN ('A','B','C','D'))`)
or refuse to export balloon flights until the pilot fills it in. Default
guess (`"A"`) **will silently mis-classify** a Cameron O-105 flight as a
small-balloon series — don't do it.

### 4.2 `flight_pilots.function` → `function.primary`

You have one `flight_pilots` row per crew member per flight. To build the
payload for the pilot whose PAT we're using, find **their** row:

```sql
SELECT function, time_logged, landings_logged
  FROM public.flight_pilots
 WHERE flight_id = :flight_id AND user_id = :pilot_id;
```

Map their `function` enum value:

| Your `flight_pilots.function` | Airdesk Logger `function.primary` |
|---|---|
| `PIC` | `PIC` |
| `CO_PILOT` / `SIC` | `CO_PILOT` |
| `DUAL` / `STUDENT` | `DUAL` |
| `PICUS` | `PICUS` |
| `SPIC` | `SPIC` |
| `INSTRUCTOR` / `FI` / `CRI` / `IRI` / `TRI` | (on the *instructor's* PAT, this is `PIC`. On the *student's* PAT, this is `DUAL`.) |
| `SAFETY_PILOT` | `SAFETY_PILOT` |
| `EXAMINER` | `PIC` and include attribute `skill_test` or `proficiency_check` |

> Don't post a flight twice from the same school account if both pilots have
> their own PAT — each PAT belongs to a different pilot's logbook. Two PATs
> means two posts (one per pilot), with the right `function.primary` for each.

`picName`:
- If the row you're posting is `function = DUAL/PICUS/SPIC` → look up
  `flights.instructor_id → users.display_name` and send that.
- Otherwise → `"SELF"`.

`function.instructor` (minutes):
- If `flights.instructor_minutes` is non-null and the posting pilot is the
  student → send `flights.instructor_minutes`.
- Otherwise → `0`.

### 4.3 Minute-of-day + `flight_date` → ISO 8601 UTC

`block_start`, `block_end`, `flight_start`, `flight_end` are integers in
`0..1439`. They are **UTC** wall-clock minutes (your UI shows `10:40z` —
the `z` suffix is the giveaway). Cross-midnight flights have `block_end <
block_start`; in that case the arrival date is `flight_date + 1`.

Always send UTC; you don't need to think about local time. Each pilot's Airdesk
token carries their own source/store time-zone preference, set on their Account
page. When the pilot wants their logbook to read in local time, our side runs
the UTC → local projection using the aerodrome's IANA zone. Do not pre-convert.
If the pilot has a glider-club token that legitimately ships wall-clock (no
UTC clock on the source system), they will toggle their token's source to
LOCAL — but for the Airdesk Flight School integration the source is always
UTC.

```ts
function todIsoUtc(date: string /* YYYY-MM-DD */, mod: number): string {
  const h = String(Math.floor(mod / 60)).padStart(2, "0");
  const m = String(mod % 60).padStart(2, "0");
  return `${date}T${h}:${m}:00Z`;
}

function legTimes(flightDate: string, blockStart: number, blockEnd: number) {
  const depDate = flightDate;
  let arrDate = flightDate;
  if (blockEnd < blockStart) {
    const d = new Date(flightDate + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + 1);
    arrDate = d.toISOString().slice(0, 10);
  }
  return {
    departureTime: todIsoUtc(depDate, blockStart),
    arrivalTime:   todIsoUtc(arrDate, blockEnd),
  };
}
```

If a flight has only `flight_start`/`flight_end` and no `block_start`/`block_end`
(rare, e.g. a freelancer counter-only flight) — refuse to export. Airdesk
Logger requires the block times.

### 4.4 `track` jsonb → GeoJSON `LineString`

Your `flights.track` is `jsonb` with no schema enforced. The import API
expects exactly:

```json
{ "type": "LineString", "coordinates": [[lon, lat], [lon, lat], ...] }
```

Normalise common shapes before sending:

- If it's already a `Feature` with a `LineString` geometry → unwrap to the
  geometry.
- If it's a `FeatureCollection` → take the first `LineString` feature's geometry.
- If it's a polyline-encoded string → decode (e.g. `@googlemaps/polyline-codec`).
- If you have a stream of `aircraft_positions` rows for this flight,
  build the LineString:

  ```sql
  SELECT jsonb_build_object(
    'type', 'LineString',
    'coordinates', jsonb_agg(jsonb_build_array(lon, lat) ORDER BY recorded_at)
  )
  FROM public.aircraft_positions
  WHERE aircraft_id = :ac_id
    AND recorded_at BETWEEN :flight_start_ts AND :flight_end_ts;
  ```

Hard cap: 5 000 points. Resample if your tracker is high-rate.

If you can't produce a valid LineString, drop the field — it's optional.

---

## 5. The source query

Run this once per `(flight_id, pilot_id)` pair you want to export. It collects
everything the transformer below needs.

```sql
SELECT
  f.id                                                AS flight_id,
  f.flight_date,
  UPPER(COALESCE(NULLIF(f.departure_icao, ''), 'ZZZZ')) AS departure_icao,
  UPPER(COALESCE(NULLIF(f.arrival_icao,   ''), 'ZZZZ')) AS arrival_icao,
  f.block_start, f.block_end,
  f.flight_start, f.flight_end,
  f.ftc_start, f.ftc_end,
  f.hobbs_start, f.hobbs_end,
  f.landings_day, f.landings_night, f.go_arounds,
  f.comment, f.passengers, f.pilot_log_no,
  f.created_at, f.created_by,
  f.instructor_id, f.instructor_minutes,
  f.instructor_signed_at, f.instructor_signed_by,
  f.reservation_id,
  f.track,
  a.registration,
  a.aircraft_class,
  COALESCE(at.display_name, a.manufacturer || ' ' || a.model) AS make_model_variant,
  at.id   AS aircraft_type_id,
  fp.function       AS pilot_function,
  fp.time_logged    AS pilot_time_logged,
  instr.display_name  AS instructor_name,
  creator.display_name AS created_by_name,
  signer.display_name  AS school_recorded_instructor_name,
  pilot.airdesk_pat        AS pat,
  pilot.airdesk_pat_label  AS source_label,
  pilot.airdesk_export_enabled AS export_enabled
FROM public.flights f
JOIN public.aircraft a            ON a.id = f.aircraft_id
LEFT JOIN public.aircraft_types at ON at.id = a.type_id
JOIN public.flight_pilots fp      ON fp.flight_id = f.id AND fp.user_id = :pilot_id
JOIN public.users pilot           ON pilot.id = :pilot_id
LEFT JOIN public.users instr      ON instr.id = f.instructor_id
LEFT JOIN public.users creator    ON creator.id = f.created_by
LEFT JOIN public.users signer     ON signer.id = f.instructor_signed_by
WHERE f.id = :flight_id
  AND f.tenant_id = :tenant_id
  AND f.flight_end IS NOT NULL;
```

---

## 6. Reference transformer (TypeScript)

```ts
import type { Pool } from "pg";

const AIRDESK_URL = "https://log.airdeck.ch/api/import/v1/entries";

type SourceRow = {/* the SELECT result above */};

export async function pushFlight(db: Pool, flightId: string, pilotId: string, tenantId: string) {
  const { rows } = await db.query(SOURCE_SQL, [flightId, pilotId, tenantId]);
  const r: SourceRow = rows[0];
  if (!r || !r.export_enabled || !r.pat) return;

  const payload = buildPayload(r);

  const res = await fetch(AIRDESK_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${r.pat}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = await res.json().catch(() => ({}));
  await db.query(
    `INSERT INTO airdesk_pushes (tenant_id, flight_id, user_id, status, http_status, response)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (flight_id, user_id) DO UPDATE
       SET status = EXCLUDED.status,
           http_status = EXCLUDED.http_status,
           response = EXCLUDED.response,
           pushed_at = now()`,
    [tenantId, flightId, pilotId, body?.status ?? "error", res.status, body],
  );

  if (res.status === 422) notifyPilot(pilotId, body.issues);
  if (res.status === 401) markPatInvalid(pilotId);
}

function buildPayload(r: SourceRow) {
  const ac = mapAircraft(r);
  const fn = mapFunction(r);
  const legs = [{
    departurePlace: r.departure_icao,
    arrivalPlace:   r.arrival_icao,
    ...legTimes(r.flight_date, r.block_start, r.block_end),
  }];

  const attributes: string[] = [];
  const attributeDetails: Record<string, unknown> = {};
  if (r.go_arounds > 0) {
    attributes.push("go_around");
    attributeDetails.goArounds = r.go_arounds;
  }
  // …add other mapped attributes if you start using them

  const counters: Record<string, unknown> = {
    ftcStart: r.ftc_start,
    ftcEnd:   r.ftc_end,
  };
  if (r.hobbs_start) counters.hobbsStart = r.hobbs_start;
  if (r.hobbs_end)   counters.hobbsEnd   = r.hobbs_end;
  if (r.flight_start != null && r.flight_end != null) {
    const t = legTimes(r.flight_date, r.flight_start, r.flight_end);
    counters.flightStart = t.departureTime;
    counters.flightEnd   = t.arrivalTime;
  }

  const provenance: Record<string, unknown> = {
    reservationId: r.reservation_id,
    pilotLogNo:    r.pilot_log_no,
    createdAt:     r.created_at,
    createdBy:     r.created_by_name,
  };
  if (r.instructor_signed_at) {
    provenance.schoolRecordedInstructorAt = r.instructor_signed_at;
    provenance.schoolRecordedInstructorBy = r.school_recorded_instructor_name;
  }

  return {
    externalId:  r.flight_id,
    sourceLabel: r.source_label ?? "Flightschool",
    kind:        "FLIGHT",
    entry: {
      aircraft: ac,
      legs,
      picName: fn.picName,
      landings:   { day: r.landings_day, night: r.landings_night },
      conditions: { night: 0, ifr: 0 },              // school doesn't track these per leg
      function:   { primary: fn.primary, instructor: fn.instructorMinutes },
      remarks:    r.comment ?? "",
      attributes,
      attributeDetails,
      counters,
      provenance,
      ...(r.track ? { track: normaliseTrack(r.track) } : {}),
    },
  };
}
```

`mapAircraft`, `mapFunction`, `legTimes`, `normaliseTrack` are the functions
described in §4.

---

## 7. Testing protocol

1. **Dry run first.** Every code path of `buildPayload` runs against
   `POST /entries?dryRun=1` in your CI. Any 422 fails the build.
2. **Round-trip an export twice.** Second run must be 100 % `200 duplicate`.
3. **Pilot opt-in regression.** Toggle `airdesk_export_enabled = false`,
   close a flight, confirm `airdesk_pushes` has no row.
4. **Cross-midnight flight.** Build a fixture where `block_end < block_start`,
   confirm arrival ISO has the +1 day.
5. **ZZZZ landings.** Wipe `departure_icao`, confirm payload sends
   `"ZZZZ"` + `departurePlaceName`.
6. **Token revoke.** Set the PAT to a known-bad value, confirm the push gets
   401, your UI surfaces "token invalid" to the pilot, and
   `airdesk_export_enabled` is auto-cleared.

Ask Airdesk for a sandbox pilot account for staging.

---

## 8. Error handling — what to do with each response

| HTTP | Logger response | Your action |
|---|---|---|
| `201` | `{ status: "created", id }` | Persist `airdesk_pushes` row; done. |
| `200` | `{ status: "duplicate", id }` | Same as 201; mark exported. |
| `207` | `{ entries: [...] }` | Walk each item by `externalId`; treat each as if it were the single response. |
| `400` | `{ error: "..." }` | Your envelope is broken (missing top-level field). Fix the mapper, not the data. |
| `401` | `{ error: "..." }` | PAT bad/revoked/expired. Clear `airdesk_export_enabled`, surface a banner on the pilot's profile asking them to re-paste. |
| `403` | `{ error: "..." }` | Token lacks the `entries:append` scope — should never happen for self-issued PATs. Alert your ops team. |
| `422` | `{ valid: false, issues: [...] }` | The flight failed a domain rule. **Show the issues to the pilot in your UI** (they own the source data); do not retry the same body. Log the failure against the flight. |
| `429` | `{ retryAfterSeconds }` | Back off per the body and retry. |
| `5xx` | — | Exponential backoff: 2 s, 4 s, 8 s, 16 s, 30 s, then give up and let the nightly catch-up handle it. |

---

## 9. What never to send

- Internal UUIDs: `tenant_id`, `pilot_id`, `instructor_id`, `created_by`,
  `aircraft_id`, etc. (Resolve to display names and aviation fields first.)
- `instructor_minutes` field name (rename to `function.instructor`).
- `fuel_type`, `oil_litres`, `aircraft_status_ok` (operational, not logbook).
- The school's own `instructor_signed_at` / `instructor_signed_by` as a
  signature claim — these go in `provenance` as information, not in any
  signature field. The pilot still has to invite their instructor through
  Airdesk's sign-off flow.

---

## 10. Versioning

The import API is `v1`. We will not break the v1 contract:

- New optional fields may appear; your mapper ignores what it doesn't know.
- New attribute keys may be added; you only use the ones you actually map.
- Breaking changes ship as `v2` with at least 6 months overlap.

If a field you need is missing (e.g. `passengers` is queued for v1.1), raise
it on our side before you build a workaround.

---

## 11. Open questions for the Airdesk Flight School team

Before you start the implementation, please confirm:

1. **Counter units.** Are `flights.ftc_start/end`, `hobbs_start/end` stored as
   integer minutes-since-zero (so `1392:38 == 83558`)? The UI rendering
   suggests yes; confirm against your `aircraft.current_ftc` (numeric) update
   path.
2. **`flight_pilots.function` enum values.** Send the full list of allowed
   values so we can confirm the mapping table in §4.2 covers them all.
3. **Multi-pilot lookup.** Do you already have a flag for multi-pilot types
   on `aircraft_types`, or do we need to add one?
4. **Balloon group.** Are balloon groups stored anywhere today, or do we
   need to add a column on `aircraft_types` and a per-tenant data fix-up
   before the first balloon flight can export?
5. **Track shape.** Confirm `flights.track` is GeoJSON `LineString` already.
   If not, point us at the shape so we can adjust §4.4.

Reply on the integration ticket and we'll lock the contract.
