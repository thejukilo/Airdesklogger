# Airdesk Logger — Import API v1

A single, narrow ingress for school / partner systems to append flight entries
to a pilot's logbook on Airdesk. The API is **write-only and append-only**: the
caller can post a flight, it cannot read, update, void, or sign anything. All
read, edit, sign-off, and delete actions remain with the pilot in the SPA.

## At a glance

| | |
|---|---|
| **Base URL** | `https://log.airdeck.ch/api/import/v1` |
| **Auth** | Personal Access Token: `Authorization: Bearer airdesk_pat_…` |
| **Endpoint** | `POST /entries` |
| **Content type** | `application/json` |
| **Dry-run** | `POST /entries?dryRun=1` (validates only, no write) |
| **Idempotency key** | `externalId` in each entry — `(token, externalId)` is unique |
| **Rate limit** | 100 req/min, 5 000 req/day per token (configurable per partner) |

## Auth: per-pilot personal access tokens

Each pilot generates a token from their Airdesk **Account → Personal access
tokens** page. The token:

- Carries the single scope `entries:append`.
- Is shown once at creation; only its Argon2id hash is stored.
- Has a configurable expiry (default: 365 days; "never" available).
- Can be revoked from the same page at any time.
- Is logged on every use (last-used timestamp, IP, endpoint).

Provide it as a bearer token on every request. There is no other credential.

```http
Authorization: Bearer airdesk_pat_8f2a…
```

A revoked or expired token returns `401`. A token without `entries:append`
returns `403`.

## The only endpoint

### `POST /entries`

Accepts **either** one entry **or** a batch.

#### Single

```json
{
  "externalId": "OPS-2026-1184",
  "sourceLabel": "MyFlightSchool",
  "kind": "FLIGHT",
  "entry": { ...FlightEntryInput, see below }
}
```

#### Batch (recommended for nightly syncs, max 50 entries)

```json
{
  "entries": [
    { "externalId": "OPS-2026-1184", "sourceLabel": "MyFlightSchool", "kind": "FLIGHT", "entry": { ... } },
    { "externalId": "OPS-2026-1185", "sourceLabel": "MyFlightSchool", "kind": "FSTD",   "entry": { ... } }
  ]
}
```

### Top-level fields

| Field | Required | Notes |
|---|---|---|
| `externalId` | yes | Your stable per-flight id. Idempotency key. Retries with the same value never create duplicates. |
| `sourceLabel` | yes | Free text shown to the pilot ("Imported from MyFlightSchool"). |
| `kind` | yes | `"FLIGHT"` for a flown leg, `"FSTD"` for a simulator session. Case-sensitive. |
| `entry` | yes | Body of the entry. Shape depends on `kind`. |

### Status codes

| | |
|---|---|
| `201 Created` | One entry was created. Body: `{ status: "created", externalId, id }`. |
| `200 OK` | The same `externalId` already existed; nothing was written. Body: `{ status: "duplicate", externalId, id }`. Treat as success. |
| `207 Multi-Status` | Batch with mixed results. Body: `{ entries: [...] }` with per-item status. |
| `400 Bad Request` | Malformed JSON or missing top-level field. |
| `401 Unauthorized` | Missing, revoked or expired token. |
| `403 Forbidden` | Token lacks `entries:append`. |
| `422 Unprocessable` | Entry validates structurally but fails a domain rule. Body: `{ valid: false, issues: [{ field, message }] }`. Do **not** retry; fix and re-post. |
| `429 Too Many Requests` | Rate limited. Body: `{ retryAfterSeconds }`. |
| `5xx` | Transient. Retry with exponential backoff (e.g. 2 s, 4 s, 8 s, 16 s, max 5 attempts). |

Per-item status in a batch response is one of `"created"`, `"duplicate"`,
`"rejected"`. Rejected items carry their own `issues` array.

### Dry run

Append `?dryRun=1` to the same endpoint. The server runs the full pipeline
(parsing, validation, time conversion) and returns the same response shapes,
but no row is written. Use this in CI for every code path of your mapper.

## The `entry` body

The `kind: "FLIGHT"` shape is the FOCA/EASA logbook entry. All fields below.
`kind: "FSTD"` has a smaller shape (see "FSTD session" further down).

### Aircraft

```json
"aircraft": {
  "registration": "HBPNT",
  "makeModelVariant": "Cessna 172S",
  "engineClass": "SE",
  "multiPilot": false,
  "category": "AEROPLANE",
  "balloonGroup": "A"
}
```

- `registration` — uppercase, dash-free is fine (`HBPNT`); we will not silently
  normalise case for you. If the registration is not in our reference table,
  the aircraft is auto-added from these fields.
- `engineClass` — exactly `"SE"` or `"ME"`. Drives columns 5a/5b of the export.
- `multiPilot` — boolean. Drives column 6.
- `category` — `"AEROPLANE"` | `"HELICOPTER"` | `"SAILPLANE"` | `"BALLOON"`.
  Defaults to `"AEROPLANE"` when absent. Required for balloons.
- `balloonGroup` — `"A"`, `"B"`, `"C"` or `"D"`. Balloon flights only.

### Legs

```json
"legs": [
  {
    "departurePlace": "LSZH",
    "departureTime": "2026-05-28T07:45:00Z",
    "arrivalPlace": "LSGG",
    "arrivalTime":   "2026-05-28T08:55:00Z"
  }
]
```

- ICAO codes are 4 uppercase letters. For places without an ICAO code use
  `"ZZZZ"` and add `departurePlaceName` / `arrivalPlaceName` with a free-text
  description.
- Times are ISO 8601 UTC by default (`Z` suffix). If you send local times,
  set `entry.timeZone` to `"LOCAL"` (see "Time zones" below).

### Function & landings

```json
"picName": "SELF",
"landings": { "day": 1, "night": 0 },
"conditions": { "night": 0, "ifr": 0 },
"function": {
  "primary": "PIC",
  "instructor": 0,
  "instructorPosition": "PILOT_SEAT",
  "tookControl": false
}
```

- `picName` — free text. `"SELF"` for own-PIC flights.
- `landings.day`/`night` — integer counts. We auto-classify if you set both
  to `0` and the flight has any landings.
- `conditions.night`/`ifr` — **integer minutes**, not hours, not `HH:MM`. We
  will recompute `night` if you send `0` and we can determine the aerodrome
  coordinates from our reference table.
- `function.primary` — one of `"PIC"`, `"PICUS"`, `"SPIC"`, `"CO_PILOT"`,
  `"DUAL"`, `"SAFETY_PILOT"`. `DUAL`, `PICUS`, `SPIC` trigger our
  "signature missing" rule automatically.
- `function.instructor` — minutes of instructor time logged on the flight
  (independent of `primary`). Integer.
- `function.tookControl` — only meaningful when `primary` is `"SAFETY_PILOT"`.

### Optional fields

| Field | Type / enum | Notes |
|---|---|---|
| `remarks` | string | Free text. |
| `operatingRole` | `"PILOT_FLYING"` \| `"PILOT_MONITORING"` | |
| `launchMethod` | `"WINCH"` \| `"AEROTOW"` \| `"SELF_LAUNCH"` \| `"BUNGEE"` \| `"CAR_TOW"` | Sailplane only. |
| `balloonFlightType` | `"FREE"` \| `"TETHERED"` | Balloon only. |
| `inflations` | int ≥ 0 | Balloon only. |
| `crewSize` | `2` \| `3` \| `4` | 3/4 = augmented; we apply the share automatically. |
| `flightTimeMinutes` | int ≥ 1 | Reduced total for a series of flights. May only **reduce** the block time. Set only when `attributes` includes `"series_of_flights"`. |
| `attributes` | string[] | Structured attribute keys; see the spec section below. |
| `attributeDetails` | object | Per-attribute counts, time, level, comments; see spec. |
| `timeZone` | `"UTC"` \| `"LOCAL"` | Defaults to `"UTC"`. See below. |

### Operational extras — entry-detail only

These optional fields are stored and shown on the entry-detail page in the
SPA, but **are not rendered on the FOCA PDF export**. They are informational:
they help the pilot reconcile their logbook against the source system, but
EASA does not require them in the official logbook grid.

```json
"counters": {
  "ftcStart": "1392:38",
  "ftcEnd":   "1393:06",
  "hobbsStart": "987:12",
  "hobbsEnd":   "987:40"
},
"track": {
  "type": "LineString",
  "coordinates": [
    [8.4145, 47.4823],
    [8.4090, 47.4801],
    [7.5295, 47.4435]
  ]
},
"provenance": {
  "reservationId": "8e3f…",
  "pilotLogNo": 1184,
  "createdAt": "2026-05-28T13:55:02Z",
  "createdBy": "Max Mustermann",
  "schoolRecordedInstructorAt": "2026-05-28T14:02:11Z",
  "schoolRecordedInstructorBy": "Erika Beispiel"
}
```

- `counters.ftcStart` / `ftcEnd` / `hobbsStart` / `hobbsEnd` — accepted as
  either an integer (minutes-since-zero, e.g. `83558` for `1392:38`) or a
  string in `hhh:mm` form. We normalise to integer minutes and always display
  as `hhh:mm`. We also compute the counter delta and surface a soft warning
  if it diverges from the time-derived block by more than ~10 %.
- `track` — GeoJSON `LineString` in WGS84, `[lon, lat]` pairs. Lazy-loaded
  Leaflet map on the entry-detail page when present. Maximum 5 000 points;
  longer tracks are rejected with `422`. Not part of the PDF.
- `provenance` — free-form object stored as JSONB and rendered on the
  entry-detail page under "Source". The school's `instructor_signed_at` /
  `instructor_signed_by` are preserved here as *information*; they do **not**
  satisfy the EASA sign-off. Imported entries always arrive unsigned.

### Attributes — the full key list

`attributes` is an array of canonical keys. Each maps to (a) a flag on the
entry's "Attributes & endorsements" appendix and (b) an optional field on
`attributeDetails` that carries the count, time, level or comment.

| Key | Detail field(s) | Categories |
|---|---|---|
| `hdf` | `hdfTakeoffs: int` | Helicopter |
| `mountain_landings` | `mountainLandings: int`, `mountainLandingGear: "SKI"\|"WHEELS"` | Aeroplane, Helicopter |
| `mountain_landing_official` | `mountainLandingsOfficial: int` | Helicopter |
| `mountain_landing_2000` | `mountainLandingsAbove2000: int` | Helicopter |
| `mountain_landing_2700` | `mountainLandingsAbove2700: int` | Helicopter |
| `go_around` | `goArounds: int` | Aeroplane |
| `touch_and_go` | `touchAndGo: int` | Aeroplane |
| `nvis` | `nvisMinutes: int` (must not exceed total flight time) | Helicopter |
| `heslo_1` … `heslo_4` | `heslo1Cycles` … `heslo4Cycles: int` | Helicopter |
| `hec_1`, `hec_2` | `hec1Cycles`, `hec2Cycles: int` | Helicopter |
| `hho` | `hhoCycles: int` | Helicopter |
| `solo` | — | All |
| `cross_country` | — | All |
| `series_of_flights` | — (uses entry-level `flightTimeMinutes`) | All |
| `tethered_flight` | — (use `balloonFlightType: "TETHERED"`) | Balloon |
| `cloud_flying_privilege` | — | Sailplane |
| `launch_privilege` | — (use entry-level `launchMethod`) | Sailplane |
| `aerobatic_privilege` | `aerobaticLevel: "BASIC"\|"ADVANCED"` | All |
| `skill_test` | `skillTestComment: string` | All |
| `proficiency_check` | `proficiencyCheckComment: string` | All |
| `licence_proficiency_check` | `licenceProficiencyCheckComment: string` | All |
| `operator_proficiency_check` | — | All |
| `operator_line_check` | — | All |
| `language_proficiency_check` | `languageProficiencyComment: string` | All |
| `aoc` | `aocComment: string` | Sailplane, Balloon |
| `demo_flight` | `demoFlightComment: string` | Sailplane |
| `refresher_training`, `difference_training`, `familiarization` | — | All |
| `course_completed`, `instruction_training_course` | — | All |
| `demonstration_of_ability_to_instruct` | — | All |
| `zftt`, `towing`, `low_visibility_landing`, `sea_landings` | (`lowVisibilityLandingType` for low-vis) | All |

Tests, checks, recurrent training, course completions, and `DUAL`/`PICUS`/
`SPIC` flights all trigger our **signature-missing** rule. The entry lands in
the pilot's logbook with a "missing" badge; the pilot uses the SPA to request
the sign-off by email. The import API never signs anything.

### Time zones

The handling is driven by **two settings on the token** (set by the pilot on
their Account page when they generate the token), plus an optional per-request
override:

| Setting | Values | Default | Meaning |
|---|---|---|---|
| `sourceTimeZone` (token) | `UTC` \| `LOCAL` | `UTC` | What the importer's leg times mean. UTC = ISO with `Z`; LOCAL = wall-clock at the aerodrome. |
| `storeTimeZone` (token) | `UTC` \| `LOCAL` | `UTC` | What lands in the logbook. UTC stores ISO; LOCAL stores wall-clock and renders with an `L` suffix on the PDF. |
| `entry.timeZone` (body) | `UTC` \| `LOCAL` | inherits the token's `sourceTimeZone` | Per-request override for the source side, in case one importer ships mixed feeds. The store side is always the token's setting. |

The four resulting paths:

| Source | Store | What happens |
|---|---|---|
| UTC | UTC | Pass-through. (Most common.) |
| LOCAL | UTC | Convert wall-clock → UTC via the aerodrome's IANA zone. Unresolved aerodromes (`ZZZZ`) keep wall-clock and flag `timesLocal=true`. |
| UTC | LOCAL | Shift UTC → wall-clock at the aerodrome. Stamp `timesLocal=true`, render with `L`. |
| LOCAL | LOCAL | Keep wall-clock as-is, `timesLocal=true`, no aerodrome lookup needed. |

Every leg time must still be an ISO 8601 string. For LOCAL sources the trailing
`Z` (or its absence) is ignored — the value is read as wall-clock. The "no
future flight" guard always runs against the server clock, with a 14-hour grace
for unresolved local times to cover UTC+14.

### TMG aircraft

Touring motor gliders sit between aeroplane and sailplane in EASA's logbook
columns. The choice is the pilot's, not the importer's. To support this:

- The importer sends `aircraft.category: "TMG"` whenever the source aircraft is
  classed as a TMG.
- The pilot picks once at token-creation time how TMG hours should be filed
  (`AEROPLANE` or `SAILPLANE`).
- We resolve `"TMG"` to the token's `tmgCategory` **before** any other rule
  runs, so the resulting entry behaves like the resolved category for column
  layout, allowed attributes, and signature requirements.
- `"TMG"` is accepted on import only. It is never stored as an entry category.

### FSTD session shape

```json
{
  "externalId": "SIM-2026-0408",
  "sourceLabel": "MyFlightSchool",
  "kind": "FSTD",
  "entry": {
    "deviceType": "A320",
    "qualificationNumber": "CH-FFS-A320-007",
    "qualification": "FFS Level D",
    "pilotFunction": "TRAINEE",
    "instruction": "OPC type rating",
    "date": "2026-04-18T09:00:00Z",
    "totalMinutes": 240,
    "landings": { "day": 6, "night": 0 },
    "remarks": "",
    "attributes": ["operator_proficiency_check"]
  }
}
```

- `deviceType` — model the device represents (e.g. `"A320"`, `"EC135"`).
- `qualificationNumber` — the device's EASA code.
- `qualification` — free text (`"FFS Level D"`, `"FNPT II"`, etc.).
- `pilotFunction` — `"TRAINEE"` or `"SFI_SFE"`.
- `instruction` — short description of the exercise (e.g. `"OPC type rating"`).
- `totalMinutes` — including pre/after-flight checks.
- `landings.day`/`night` — optional, default zero.

## Field-mapping cheat sheet — the four landmines

These cause 80% of the integration failures we expect to see. Read them once:

1. **Durations are minutes.** 1 h 30 m → `90`. Not `1.5`. Not `"01:30"`.
2. **Enums are case-sensitive.** `"PIC"` accepted, `"pic"` rejected. We do not
   silently normalise — silent fixes are how mappings rot.
3. **ICAO codes are 4 uppercase letters.** Lowercase, IATA codes, or codes with
   dashes are rejected. Use `"ZZZZ"` + the place name field for sites without
   ICAO codes.
4. **UTC times by default.** If your system stores local time, set
   `entry.timeZone: "LOCAL"` and provide aerodrome codes so we can convert.

## Error response shape

A 422 returns:

```json
{
  "valid": false,
  "issues": [
    { "field": "entry.function.primary", "message": "Expected one of PIC, PICUS, SPIC, CO_PILOT, DUAL, SAFETY_PILOT; got \"pic\"." },
    { "field": "entry.aircraft.registration", "message": "Use uppercase ICAO format." }
  ]
}
```

`field` is a dot path into the request body. Surface the messages directly to
your staff — they are written to be human-readable.

## Provenance on the pilot's side

Every imported entry is stamped with:

```
{ "source": { "tokenName": "MyFlightSchool", "externalId": "OPS-2026-1184", "importedAt": "2026-05-28T14:02:11Z" } }
```

The pilot sees a small "imported" badge on the logbook row, with the source
label on hover. The entry-detail page shows the full provenance. The FOCA
change-log export carries the import as a row in the audit table.

The pilot **can void** an imported entry from the SPA. Doing so does not
notify the school. Re-posting the same `externalId` after a void will return
`200 duplicate`; the void stays in place. If you need to push a correction,
post a new entry with a different `externalId`; the pilot voids the wrong one.

## What this API does not do

- No read endpoints. No `GET /entries`.
- No update endpoints. No `PUT /entries/:externalId`.
- No delete endpoints. No `DELETE /entries/:externalId`.
- No sign-off. The Ed25519 signature stays inside the pilot's / instructor's
  MFA-gated session. Pushing a check-type attribute lands the entry as
  "missing"; the pilot triggers the email-link sign-off from the SPA.
- No profile read or write. The token is bound to one pilot; we never accept
  identity fields (name, DOB) from the import.
- No aircraft lookup or airport lookup endpoints. Send the registration and
  the ICAO codes; we resolve them internally.
- No webhooks back to the school.

## A complete example

```bash
curl -sS -X POST \
  -H "Authorization: Bearer airdesk_pat_8f2a..." \
  -H "Content-Type: application/json" \
  https://log.airdeck.ch/api/import/v1/entries \
  -d '{
    "externalId": "OPS-2026-1184",
    "sourceLabel": "MyFlightSchool",
    "kind": "FLIGHT",
    "entry": {
      "aircraft": { "registration": "HBPNT", "makeModelVariant": "Cessna 172S", "engineClass": "SE", "multiPilot": false, "category": "AEROPLANE" },
      "legs": [
        { "departurePlace": "LSZH", "departureTime": "2026-05-28T07:45:00Z", "arrivalPlace": "LSGG", "arrivalTime": "2026-05-28T08:55:00Z" }
      ],
      "picName": "M. Schmidt",
      "landings": { "day": 1, "night": 0 },
      "conditions": { "night": 0, "ifr": 0 },
      "function": { "primary": "DUAL", "instructor": 70 },
      "remarks": "PPL training flight - navigation exercise",
      "attributes": ["cross_country"]
    }
  }'
```

Response:

```json
{ "status": "created", "externalId": "OPS-2026-1184", "id": "0192a1e8-..." }
```

Because `function.primary` is `"DUAL"`, the entry lands in the pilot's
logbook with a "signature missing" badge. The pilot opens the entry in the
SPA and uses **Request sign-off by email** to send the instructor the
single-use signing link.
