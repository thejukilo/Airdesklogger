# FOCA Review — Meeting Briefing

A working document for the meeting with FOCA. It lists the requirements and
questions raised, with an answer for **non-technical** readers (plain terms) and
a **technical** answer underneath, plus what to show live and any honest open
points.

How to read each section:
- **In plain terms** — the short, everyone-can-follow answer.
- **Technical detail** — for FOCA's technical expert.
- **Show live** — what to click to demonstrate it.
- **Open / honest note** — anything not fully finished, stated plainly.

Reference documents in the repository:
- `docs/infrastructure-and-security.md` — hosting, encryption, data handling.
- `docs/regulatory-submission.md` — the full requirement-by-requirement submission.
- `COMPLIANCE.md` — requirement coverage tracker.

Last updated: 2026-10-28.

---

## Status at a glance

| Topic | Requirement | Status |
|---|---|---|
| Data tracking & storage | 2.1.1 / 2.2.1 | ✅ Ready to demonstrate |
| Entry attributes (aeroplane) | 2.2.3 | ✅ Complete (all minimum attributes now in the form) |
| Enhanced crew / pilot function | 2.2.4 / 2.3.4 / 2.3.5 | ✅ Functions covered; ⚠️ one wording point on 2.3.5 |
| Simulator (FSTD) sessions | 2.1.5 / 2.3.2 | ✅ Real EASA device database loaded |
| Filter possibilities for export | 2.5.1 | ✅ Done (field filters + period export) |
| Integrity of the record | 2.3 | ✅ Hash-chained audit trail + one-click verify |

---

## 1. Data tracking & storage (FOCA 2.1.1 and 2.2.1)

**What FOCA asked:** insight into how data is tracked and stored, to demonstrate:
- **2.1.1** — "A copy of all data shall be stored in at least one location outside of portable devices, e.g. on a secure server."
- **2.2.1** — "All data relevant to the evaluation of licence and endorsement eligibility … shall be tracked electronically in a way that can be processed and evaluated digitally."

**In plain terms.** Nothing important lives on the pilot's phone. Every logbook
entry is saved on a secure server in a proper database, and it's saved as
structured data (separate fields for date, times, places, etc.) — not as a
block of free text — so it can be filtered, totalled and checked by computer.

**Technical detail.**
- Storage is **PostgreSQL** (hosted on Supabase, EU/CH region), server-side. The
  browser/app holds only a short-lived session token — no logbook copy on the
  device. Daily backups with point-in-time recovery cover loss/theft (2.1.2).
- Each entry is stored as a structured record: the twelve AMC1 FCL.050 column
  values are **computed and stored as typed fields** (times as integer minutes,
  category and attributes as coded values), in a `jsonb` column
  (`flight_entry_versions.content`). Only genuinely free-text fields (PIC name,
  remarks) are text, as 2.3.1 permits. Places and aircraft are linked to
  reference tables by code, not typed.

**Show live.**
1. Log a flight on one device, then open the app on another device / browser and
   log in → the same flight is there (proves it's on the server, not the device).
2. The **Logbook filters** and the **PDF export** — filtering and totalling
   happen on the structured fields in real time (that *is* "evaluated digitally").

**Open / honest note.** Confirm the exact Supabase region before the meeting
(noted as "to confirm" in `docs/infrastructure-and-security.md`).

---

## 2. Entry attributes for aeroplanes (FOCA 2.2.3)

**What FOCA asked:** are the required entry attributes supported for aeroplanes?
2.2.3 lists a minimum set that *shall* be supported (skill test, operator
checks, training types, ZFTT, towing, low-visibility landing **including type**,
sea landings, mountain landings including ski/wheels, etc.).

**In plain terms.** Yes — when a pilot logs an aeroplane flight they can now tick
every attribute on FOCA's required list, grouped sensibly (checks, training,
landings, etc.).

**Technical detail.** The aeroplane entry form offers the full 2.2.3 minimum
set. Attributes are stored as coded values in `attributes[]`, with refinements
(e.g. the low-visibility **approach category** CAT II / IIIA / IIIB, and the
mountain-landing **gear** ski/wheels) in structured detail fields. Check/test
attributes require a sign-off to be creditable, and a missing-but-required
signature is flagged on the export (2.4.6).

**Show live.** New aeroplane entry → open the attributes section → the groups
**Takeoffs/landings** (incl. sea landing and low-visibility landing with a type
selector), **Flights** (incl. towing, aerobatic), **Training** (training flight,
difference training, refresher, familiarisation, ZFTT, course completed,
instruction training course, demo of ability to instruct) and **Checks** (skill
test, PC, LPC, language, operator proficiency check, operator line check).

**Open / honest note.** This was completed for **aeroplanes** (the topic). The
helicopter / sailplane / balloon forms can be reviewed the same way if FOCA wants
them checked too.

---

## 3. Enhanced crew & pilot function (FOCA 2.2.4, 2.3.4, 2.3.5)

**What FOCA asked:** handling of "enhanced crew" / pilot functions.

**In plain terms.** The pilot function picker covers PIC, PICUS, SPIC, co-pilot,
dual, and the instructor/examiner roles (pilot seat, jump seat, supervising,
examiner) — the same model an accepted logbook like capzlog uses, and a little
more. For augmented (3- or 4-pilot) crews, the system can log each pilot's
correct share of the time automatically.

**Technical detail.**
- **Pilot functions (2.2.4):** PIC / PICUS / SPIC / CO_PILOT / DUAL / SAFETY_PILOT,
  plus instructor position (pilot seat / jump seat / supervising / examiner).
- **Augmented-crew share (2.3.4):** a crew of 3 logs two-thirds, a crew of 4 logs
  one-half, applied to all time categories; landings are never scaled. All time
  values are **calculated automatically**, not typed.
- **Reduce-only edits (2.3.5):** the automatically calculated values are not
  directly editable; the series-of-flights exception is enforced as reduce-only
  (a reduced total above the calculated time is rejected).

**Open / honest note (the one real point on 2.3.5).** FOCA 2.3.5 says an edited
auto-calculated value "may only reduce." The series-of-flights case enforces
this. **However**, a general amendment *after the 48-hour window* currently lets
the time be increased as well as reduced (it is logged in the change log, but not
blocked), and `COMPLIANCE.md` currently *claims* it cannot be increased. Decide
before the meeting whether to (a) correct the wording to match the code, or
(b) enforce reduce-only in code. (A crew-size input field is **not** required —
capzlog doesn't have one either.)

---

## 4. Simulator (FSTD) sessions (FOCA 2.1.5, 2.3.2)

**What FOCA asked:** are FSTD sessions supported, with the device taken from a
common database including the device type/level (2.3.2)?

**In plain terms.** Yes. A simulator session is its own logbook entry. The device
is chosen from the **real EASA FSTD register** by autocomplete (EASA code or
serial number), and the record keeps its qualification level. A device that isn't
listed can be added, and any device ever used in a session stays findable.

**Technical detail.**
- FSTD sessions are recorded on their own row (flight columns blank, column 11),
  with device EASA code, FSTD type/level, pilot function (trainee / SFI-SFE),
  duration, landings and attributes. They share the same audit trail and export
  as flights.
- **Common database (2.3.2):** the simulator reference list is the **authentic
  EASA FSTD register** (876 devices, extracted from EASA FSTDIS and de-duplicated
  by EASA code; the device's qualification level is retained). Replaces the
  earlier placeholder data.
- A session against an unknown device registers it so it validates; the picker
  searches both the reference list and devices used in sessions, so nothing a
  pilot logged goes missing.

**Show live.** New simulator session → type a Swiss code such as **CH-135** or
**CH-345** → it appears with its aircraft type and level.

**Open / honest note.** Coverage of the EASA register is ~99%+ at the device
level (the source system's own pagination is imperfect to extract); a small
number of legacy codes from the previous list are carried over as code-only
entries so historical references still resolve.

---

## 5. Filter possibilities for export (FOCA 2.5.1)

**What FOCA asked:** 2.5.1 — "The complete experience of the pilot **as well as
periods relevant for revalidation** of licences or endorsements shall be
exportable in a printable format."

**In plain terms.** The pilot can export the whole logbook, or filter it first —
by date range ("last 12 months"), by any field (aircraft type, total time,
attribute, etc.) — and the PDF reflects exactly what's filtered. That covers both
the complete record and the revalidation-period export.

**Technical detail.** The Logbook page has a filter builder: each condition is
Field → Operator → Value, with operators matched to the data type (text:
contains / is; numbers & durations: >, <, between; dates: before / after /
in the last N months; attributes: has / has any of). The export sends the matched
entries, and each exported entry still carries its full version history,
re-verified signatures and change log (so 2.5.2 is preserved). The complete,
unfiltered export remains available and includes post-48h deletions.

**Show live.** Logbook → Filters → e.g. "Date in the last 12 months" and "Total
time > 02:00" → **Export PDF** reflects the filtered set.

---

## 6. Integrity of the record & the audit trail (FOCA 2.3)

This underpins several of the above and is likely to be probed directly.

**In plain terms.** Every create, edit, sign-off and deletion is written to a
tamper-evident log. Entries are never overwritten — a change adds a new version
and keeps the old one. The log records who did what and when, and the records are
cryptographically chained so any later tampering is detectable. There's a button
that re-checks the whole chain.

### 6a. How the tables work together

| Table | Role |
|---|---|
| `flight_entries` | One row per entry; points to the current version; holds locked/voided flags. |
| `flight_entry_versions` | The immutable history — one row per version (the structured content + its hash). Append-only. |
| `signatures` | The sign-offs, each bound to one version's content hash + an Ed25519 signature. Append-only. |
| `audit_ledger` | The global hash-chained record of every change (CREATE / MODIFY / SIGN / VOID). Append-only. |

Every action runs in one atomic database transaction (all tables update
together, or none do).

- **New entry:** write the entry header + version 0 + a CREATE ledger record.
- **Edit:** write a **new** version (old one kept), move the "current version"
  pointer, write a MODIFY ledger record. Editing never overwrites.
- **Sign-off:** write a signature over the exact current content hash, lock the
  entry (no further versions permitted by a DB trigger), write a SIGN ledger
  record.
- **Delete:** mark the entry voided (kept for the audit trail), write a VOID
  ledger record. A signed entry cannot be voided.

### 6b. The `audit_ledger` columns

| Column | Holds | Purpose |
|---|---|---|
| `seq` | 0, 1, 2 … no gaps | Fixes the order; a gap reveals a removed row. |
| `prev_hash` | the previous row's `record_hash` | The chain link. |
| `event_type` | CREATE / MODIFY / SIGN / VOID | What happened. |
| `entry_id` | the entry | Which entry changed. |
| `payload_hash` | SHA-256 of the version content | Pins exactly what the entry said. |
| `actor_id` | the account | Who did it. |
| `recorded_at` | server UTC time | When. |
| `record_hash` | SHA-256 of all the above | This row's fingerprint; the next row's `prev_hash`. |

If any past record is altered, its `record_hash` no longer matches **and** every
later row's `prev_hash` breaks — detectable by recomputation.

**Show live.** Admin → **Verify audit trail** → "✓ Audit trail intact — N records
verified" (or it names the first broken record).

### 6c. "What if someone runs an UPDATE directly on the data?"

Likely question: *change a stored `content` from "A" to "B" with a SQL UPDATE.*

- **It is blocked.** A database trigger rejects any UPDATE/DELETE on
  `flight_entry_versions`, `signatures` and `audit_ledger` — even from a direct
  SQL connection ("append-only; UPDATE is not permitted"). In normal operation
  the change simply cannot happen.
- **If the trigger were bypassed** (which needs database-owner rights to drop it —
  a deliberate, privileged act): the change leaves mismatches — the stored
  content hash, the ledger's `payload_hash` and (for a signed entry) the
  signature no longer match the content. A signed entry cannot be convincingly
  re-forged, because the signer's private key lives in the application
  environment, not the database.

**Honest note (worth volunteering).** The chain-verify button checks the
*ledger's* internal chain; it does not currently re-hash the entry content and
compare it to the recorded hashes, so that specific tampering is **detectable by
an auditor** (re-hash the content, the hashes won't match) but is **not yet
auto-flagged** by the app. Closing this is a small, planned change (re-hash
content vs. the ledger and verify signatures against the actual content).

### 6d. "Is it blockchain?"

**It uses the same core idea — a hash-chained, append-only, tamper-evident
ledger — but it is not a blockchain.** A blockchain's strength comes from many
independent nodes agreeing by consensus; here there is one database on a trusted
server (no nodes, no consensus, no mining). The correct term is a **hash-chained
audit ledger**. For independent verification beyond our own copy, the chain head
can be **externally anchored** (e.g. periodically handed to FOCA or a timestamping
service).

### 6e. "Will it scale to thousands of users?"

Yes. The ledger grows linearly and the rows are tiny (~300 bytes). At 10,000
users that's on the order of ~1.5M rows/year — well within PostgreSQL's comfort
zone (it handles tens to hundreds of millions of rows routinely). Two things to
watch as it grows (neither a blocker): the ledger append is deliberately
serialised for integrity (fine at logbook write rates), and whole-chain
verification will be made incremental/checkpointed as volume increases.
Signature images are the main storage driver and can move to object storage if
needed.

---

## 7. Open items (consolidated, honest)

| Item | What it is | Suggested action |
|---|---|---|
| 2.3.5 "may only reduce" | Doc says post-48h edits can't increase time; code allows it (logged). | Correct the doc, **or** enforce reduce-only in code. |
| Audit content-verify | Direct content tampering is detectable but not auto-flagged by the verify button. | Add content re-hash + signature-vs-content check to the verify. |
| Operator trust boundary | Chain self-verifies relative to an independently held copy; a DB owner could rebuild it. | Optional: external anchoring / periodic signed exports to FOCA. |
| Whole-chain verify cost | Verify loads the entire ledger; slow at large scale. | Make incremental/checkpointed before high volume. |
| Data residency | Exact Supabase region to confirm. | Confirm before submission. |
| Other categories' attributes | 2.2.3 completed for aeroplanes; helicopter/sailplane/balloon not re-checked. | Review if FOCA wants them. |

---

## 8. One-line summaries (quick reference in the room)

- **2.1.1 / 2.2.1:** Server-side PostgreSQL, structured per-field data; demonstrable by cross-device login and the live filters/export.
- **2.2.3:** All required aeroplane attributes are now in the form, with type refinements.
- **2.3.4/2.3.5:** Functions covered; times auto-calculated; reduce-only enforced for series (one wording point on post-48h edits).
- **2.1.5 / 2.3.2:** FSTD sessions supported; device picked from the real EASA register, level retained.
- **2.5.1:** Complete and period/field-filtered printable export, with the full audit appendix.
- **2.3 integrity:** Append-only, hash-chained audit ledger; one-click verify; immutable at the database level.
