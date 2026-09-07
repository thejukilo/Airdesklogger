# Bulk import template — bringing an existing logbook across

This is for the common onboarding case: a pilot arrives with **hundreds or
thousands of hours already flown** in another system (paper logbook, another
app, a school's ops database) and wants that history in Airdesk.

There is no single "opening balance" line in an EASA logbook — the running
totals are *derived* from the individual flights, page by page. So migrating a
history means bringing the **flights** across, one row per flight. Once they are
in, Airdesk computes every column total, the brought-forward / carried-forward
subtotals, and the grand total automatically.

`import-template.csv` (next to this file) is the staging sheet. One row = one
flight. Fill it in a spreadsheet and upload it.

## Two ways to use it

1. **In-app, guided (self-service).** In the app, open **Logbook → Import**.
   Download the template, fill it in, upload it, and the importer validates
   every row and shows you a preview (with the computed total time per flight
   and any problems) *before* anything is written. You confirm, and only the
   valid rows are added. This is the path for a pilot bringing their own
   history across. Endpoint: `POST /api/import/csv` (session-authenticated).

2. **Machine-to-machine (schools / partner software).** The same column
   meanings map onto the token-based Import API v1
   (`POST /api/import/v1/entries`, JSON, batched), documented in
   `docs/api-import-v1.md`. Each row's `external_id` is the idempotency key
   there, so a re-run never duplicates a flight.

Re-running an in-app import is safe too: a flight whose block time clashes with
one already in the logbook is skipped (the overlap guard), never duplicated.

## The columns

| Column | Required | Maps to | Notes |
|---|---|---|---|
| `external_id` | yes | `externalId` | Any stable unique id per flight. Use a running number like `LEGACY-000001`. Re-importing the same id is a no-op, so a partial run is safe to repeat. |
| `date` | yes | leg date | Any consistent order; the importer detects it (or you pick `YYYY-MM-DD` / `DD/MM/YYYY` / `MM/DD/YYYY`) and normalises to `YYYY-MM-DD`. `-`, `/` and `.` separators all work; 2-digit years use a 1970 pivot. |
| `off_block_utc` | yes | `legs[0].departureTime` | `HH:MM`, 24-hour. Combined with `date`. UTC unless you tell the importer the file is local. |
| `on_block_utc` | yes | `legs[0].arrivalTime` | `HH:MM`, 24-hour. If it is earlier than `off_block_utc` the flight is treated as crossing midnight (arrival next day). |
| `departure_icao` | yes | `legs[0].departurePlace` | 4 uppercase letters. Use `ZZZZ` for a site with no ICAO code and put the name in `remarks`. |
| `arrival_icao` | yes | `legs[0].arrivalPlace` | Same rules. |
| `registration` | yes | `aircraft.registration` | Dash-tolerant: `HBPNT`, `hb-pnt`, `HB-PNT` all resolve to the reference row. This drives the aircraft columns below. |
| `type` | auto | `aircraft.makeModelVariant` | **Leave blank** to fill from the registration. Provide a value only to override. |
| `engine_class` | auto | `aircraft.engineClass` | **Leave blank** to fill from the registration (`SE`/`ME`). |
| `multi_pilot` | auto | `aircraft.multiPilot` | **Leave blank** to fill from the registration (`true`/`false`). |
| `category` | auto | `aircraft.category` | **Leave blank** to fill from the registration (`AEROPLANE`/`HELICOPTER`/`SAILPLANE`/`BALLOON`). |
| `pic_name` | no | `picName` | Free text, or `SELF`. Blank counts as `SELF`. If the file uses your own name, tell the importer your name and matching rows become `SELF` automatically — instructor names on your dual flights are left alone. |
| `function` | yes | `function.primary` | One of `PIC`, `PICUS`, `SPIC`, `CO_PILOT`, `DUAL`, `SAFETY_PILOT`. |
| `day_landings` | yes | `landings.day` | Integer count. |
| `night_landings` | yes | `landings.night` | Integer count. |
| `night_minutes` | yes | `conditions.night` | **Minutes**, not hours. `0` if none. |
| `ifr_minutes` | yes | `conditions.ifr` | **Minutes**, not hours. `0` if none. |
| `instructor_minutes` | yes | `function.instructor` | **Minutes** of instructor time given. `0` for a normal flight. |
| `remarks` | no | `remarks` | Free text. Quote it if it contains a comma. |
| `attributes` | no | `attributes[]` | Space- or semicolon-separated keys, e.g. `cross_country solo`. Full key list is in `docs/api-import-v1.md`. Leave blank if none. |

## The four things that trip people up

1. **Durations are minutes.** 1 h 30 m is `90`, not `1.5` and not `01:30`. This
   applies to `night_minutes`, `ifr_minutes`, `instructor_minutes`.
2. **The registration drives the aircraft.** Leave `type`, `engine_class`,
   `category` and `multi_pilot` blank and they are filled from the reference
   database. If the registration is not on file, either add the aircraft in the
   app first or fill those columns in by hand for that flight.
3. **ICAO codes are 4 uppercase letters.** No IATA codes (`ZRH`), no lowercase.
   Unknown field → `ZZZZ` and describe it in `remarks`.
4. **Times are UTC.** If your source is local time, keep it consistent and flag
   it when you hand the sheet over — the converter can be told the whole file is
   local and shift it via the aerodrome, or store it as local with the `L`
   suffix (the token's time-zone settings, see the API doc).

## Signatures are not imported

`DUAL`, `PICUS`, and `SPIC` flights (and any check/test attribute) land with a
**"sign-off required"** badge, exactly as if entered by hand. Imported history
is never pre-signed. For a legacy migration that is usually fine — old flights
were signed in the previous logbook, and you are bringing the *record* across,
not re-attesting it. If a specific historical flight genuinely needs an Airdesk
signature, the pilot requests it from the SPA after import.

## Simulator (FSTD) sessions

The template above is for flown flights. FSTD sessions have a different shape
(device type, qualification, `totalMinutes` instead of block times). If the
history includes simulator time, keep those rows in a separate sheet and they
are mapped to the `kind: "FSTD"` body documented in `docs/api-import-v1.md`.
