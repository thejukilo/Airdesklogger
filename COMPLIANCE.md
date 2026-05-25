# Requirements coverage and remaining work

This file tracks how the project maps onto the two binding sources and what is
still outstanding. It is an internal engineering tracker, kept in the repo so it
survives between work sessions.

Sources:
1. AMC1 FCL.050 (Easy Access Rules for Part-FCL, Aug 2020) in `Easy_Access_Rules_for_Part-FCL-Aug20.pdf`.
2. FOCA GM/INFO "Accepted Logbook Formats" (ISS 1 / REV 0, 01.02.2024) in `foca_gminfo_foca-acccepted-logbook_formats.pdf`.

Supporting detail: FOCA GM/INFO "Logging of Flight Time" in `gm-info_loft.pdf`.

Status key: `[x]` done, `[ ] PARTIAL` present but incomplete, `[ ] OPEN` not started.

## A. AMC1 FCL.050 (record content)

- [x] Pilot name and address (profile; PDF header)
- [x] Name of PIC per flight (`picName`)
- [x] Date of flight (column 1)
- [x] Place and time of departure and arrival (columns 2, 3)
- [x] Type make/model/variant and registration (column 4)
- [x] SE / ME indication (column 5)
- [x] Total time of flight, block time (column 7)
- [x] Accumulated total, page carry-over (`src/domain/totals.ts`)
- [x] Pilot function PIC / solo / SPIC / PICUS / co-pilot / dual / instructor (column 10)
- [x] PICUS and SPIC countersigned by PIC or FI (sign-off locks the entry)
- [x] Multi-flight single-entry rule, same day, return to base, gaps under 30 min (`src/domain/multiFlight.ts`)
- [x] Operational conditions night and IFR columns exist (column 9)
- [x] Electronic format and full 12-column layout, column notes honoured
- [x] FSTD session, with an entry screen (`web/src/pages/NewFstd.tsx`); a device not yet known is recorded provisionally from the session.
- [x] Night is calculated automatically from civil twilight (`src/domain/night.ts`); IFR is derived from the flight rules. Neither is hand-typed.
- [x] Same-day series of flights can be logged as one entry from the form.
- [x] Helicopter time is labelled rotor start to rotor stop on the form (AMC1 g).
- [ ] PARTIAL: airship flight-time basis (mast release to secured) is not specially handled; airship is not a selectable category.
- [ ] PARTIAL: cruise-relief co-pilot covered via co-pilot plus augmented-crew fractions, no dedicated flag.

## B. FOCA Accepted Logbook Formats, Chapter 2

### 2.1 Basic requirements
- [x] 2.1.1 / 2.1.2 Data stored off-device and recoverable (server-side Postgres / Supabase)
- [x] 2.1.4 Aircraft categories aeroplane, helicopter, sailplane, balloon (`AircraftCategory`)
- [x] 2.1.3 Identity verified by confirmed email. Login is now refused until the address is verified, with a registration-to-verify flow and a /verify page.
- [x] 2.1.5 Flight and FSTD entries with their properties, both with entry screens.

### 2.2 Format of the record and supported values
- [x] 2.2.1 Data tracked in a digitally processable way (structured JSONB columns)
- [x] 2.2.2 At least the Part-FCL columns and fields
- [x] 2.2.4 Pilot functions incl. instructor on pilot seat / jump seat / supervising / as examiner (`InstructorPosition`)
- [x] 2.2.5 Sailplane launch method (`LaunchMethod`)
- [x] 2.2.6 TMG and powered gliders loggable as aeroplane or sailplane (category is selectable)
- [ ] PARTIAL: 2.2.7 Local-time entry possible with UTC default. Local times are converted to UTC against the aerodrome's own timezone and shown as UTC (Z). The provenance flag (entered in local time) is still stored on the record but is no longer printed on the export, so the "indicate on the print-out" part of 2.2.7 is not currently shown on the face of the PDF (a deliberate choice; the time is accurate UTC).
- [x] 2.2.3 Additional attributes. The 25 attributes (`src/domain/attributes.ts`) plus the refinements: HESLO 1 to 4 and HEC 1 to 2 levels with a cycle count, mountain landing ski or wheels, and low-visibility landing type (`AttributeDetails`).

### 2.3 Integrity of the record
- [x] 2.3.1 Type and range validation, structured storage not free text
- [x] 2.3.7 Tamper-proof change log, integral to the export. Append-only versions plus hash-chained ledger; change-log appendix in the PDF. We always version, which is stricter than the optional 48-hour exception.
- [ ] PARTIAL: 2.3.2 Aircraft from a common database. All fields present incl. `balloonGroup` and `validFrom`; depends on the full reference dataset being loaded operationally.
- [x] 2.3.3 Airports from a common database, valid ICAO or no-location indicator. ICAO table and ZZZZ supported; a free-text aerodrome name is captured and required for the ZZZZ case.
- [x] 2.3.4 All time values calculated automatically. SE/ME, single/multi-pilot, function split, augmented-crew fractions and night are auto-derived; IFR follows the flight rules. Night is computed from civil twilight.
- [ ] PARTIAL: 2.3.5 Auto-calculated values not user-editable except Part-FCL exceptions, attribute-gated, reduce-only. Computed columns are not editable and the augmented-crew and series exceptions are auto-applied; there is no general reduce-only manual override.
- [ ] PARTIAL: 2.3.6 Rigorous validation on entry, import and save, including at the data store. Strong app-layer validation; DB-level enforcement is limited to immutability triggers and a few CHECK constraints.

### 2.4 Entry signatures
- [x] 2.4.1 Signable by instructor, examiner, ATO/DTO, HOT, airport, other (`src/auth/roles.ts`)
- [x] 2.4.2 Single and multiple entries signable at once (batch sign)
- [x] 2.4.3 Signature as on-screen image (`SignaturePad`), plus Ed25519 binding
- [x] 2.4.4 Prevent tampering with the signature (signing locks the entry)
- [x] 2.4.5 Alteration invalidates the signature (locking prevents edits; export re-verifies the hash and marks valid or INVALID)
- [x] 2.4.6 Missing-but-required signatures clearly indicated on exports ("signature required" in remarks)

### 2.5 Exports and print-outs
- [x] 2.5.1 Complete experience exportable in printable form (PDF, A4 or US Letter)
- [x] 2.5.2 Export includes AMC1 FCL.050 data, attributes, signatures, complete change log

## C. FOCA Chapters 1 and 3, route to acceptance
- [x] 1.1 / 1.2 Paper and electronic PDF extract, signed page by page (per-page signature block)
- [ ] OPEN: 1.3 / 3.x FOCA accepted digital logbook with dLIS dataset submission. FOCA supplies the data format; the PDF is the accepted interim. The formal steps (declaration of conformity, test account, dLIS testing, acceptance letter) are administrative.

## Remaining work, shortlist
1. dLIS dataset export and the FOCA acceptance process (1.3 / 3.x). The dataset format is published by FOCA and the acceptance is administrative (declaration of conformity, test account, acceptance letter); the PDF is the accepted interim. This cannot be completed in code alone.
2. A general reduce-only manual override for a calculated value when a Part-FCL exception applies (2.3.5). The automatic exceptions (augmented crew, series of flights) are handled; an explicit manual reduction path is not.
3. Airship flight-time basis (AMC1 g); airship is not a selectable category.
4. A dedicated cruise-relief co-pilot flag (covered today by co-pilot plus augmented-crew fractions).

## Operational notes
- Night time needs airport coordinates. The built-in starter set carries them; for full coverage, re-run the airport import so every aerodrome has a position. A leg from an aerodrome with no coordinates contributes no night time.
- Enforcing email verification means an account must confirm its address before signing in. Existing unverified accounts (from before this change) will need to verify or be recreated.
