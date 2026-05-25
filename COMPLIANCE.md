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
- [ ] PARTIAL: FSTD session. Backend complete (`validateFstdSession`, column 11), no entry screen in the web app.
- [ ] PARTIAL: night and IFR are entered by the user, not auto-derived from position and time.
- [ ] PARTIAL: flight-time basis is block time for all categories. Helicopter (rotor start to stop) and airship timing are not differentiated.
- [ ] PARTIAL: cruise-relief co-pilot covered via co-pilot plus augmented-crew fractions, no dedicated flag.

## B. FOCA Accepted Logbook Formats, Chapter 2

### 2.1 Basic requirements
- [x] 2.1.1 / 2.1.2 Data stored off-device and recoverable (server-side Postgres / Supabase)
- [x] 2.1.4 Aircraft categories aeroplane, helicopter, sailplane, balloon (`AircraftCategory`)
- [ ] PARTIAL: 2.1.3 Identity verified by confirmed email. Verification token and endpoint exist, but login is not gated on a verified address.
- [ ] PARTIAL: 2.1.5 Flight and FSTD entries with their properties. Backend complete, FSTD has no UI.

### 2.2 Format of the record and supported values
- [x] 2.2.1 Data tracked in a digitally processable way (structured JSONB columns)
- [x] 2.2.2 At least the Part-FCL columns and fields
- [x] 2.2.4 Pilot functions incl. instructor on pilot seat / jump seat / supervising / as examiner (`InstructorPosition`)
- [x] 2.2.5 Sailplane launch method (`LaunchMethod`)
- [x] 2.2.6 TMG and powered gliders loggable as aeroplane or sailplane (category is selectable)
- [x] 2.2.7 Local-time entry possible, default UTC, and the export indicates entries made in local time. Time face is UTC with a Z suffix; a "(entered in local time)" note is added in the Remarks column.
- [ ] PARTIAL: 2.2.3 Additional attributes. 25 attributes present (`src/domain/attributes.ts`). Missing granularity: low-visibility landing type, mountain landings ski or wheels, HESLO 1 to 4 and HEC 1 to 2 levels, and number of cycles.

### 2.3 Integrity of the record
- [x] 2.3.1 Type and range validation, structured storage not free text
- [x] 2.3.7 Tamper-proof change log, integral to the export. Append-only versions plus hash-chained ledger; change-log appendix in the PDF. We always version, which is stricter than the optional 48-hour exception.
- [ ] PARTIAL: 2.3.2 Aircraft from a common database. All fields present incl. `balloonGroup` and `validFrom`; depends on the full reference dataset being loaded operationally.
- [ ] PARTIAL: 2.3.3 Airports from a common database, valid ICAO or no-location indicator. ICAO table and ZZZZ supported; free-text aerodrome name for the no-location case is not captured on the form.
- [ ] PARTIAL: 2.3.4 All time values calculated automatically. SE/ME, single/multi-pilot, function split and augmented-crew fractions are auto-derived; night and IFR are user-entered.
- [ ] PARTIAL: 2.3.5 Auto-calculated values not user-editable except Part-FCL exceptions, attribute-gated, reduce-only. Computed columns are not editable and the augmented-crew and series exceptions are auto-applied; no general reduce-only override.
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
1. FSTD session entry screen in the web app (backend already exists).
2. Multi-leg / series-of-flights entry in the form (rule is enforced server-side).
3. Night and IFR auto-calculation (2.3.4).
4. Attribute granularity: HESLO 1 to 4 and HEC 1 to 2 with cycle counts, mountain ski or wheels, low-visibility landing type (2.2.3).
5. Enforce email verification (2.1.3) without locking out existing accounts.
6. Free-text aerodrome name for the ZZZZ no-location case (2.3.3).
7. Helicopter and airship flight-time basis (AMC1 g).
8. dLIS dataset export when FOCA publishes the format (1.3).
