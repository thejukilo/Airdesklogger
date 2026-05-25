# AirdeskLogger

AirdeskLogger is the backend for a digital flight crew logbook that records flying time the way EASA expects it to be recorded. It is built around the logbook format described in AMC1 to FCL.050 (the Acceptable Means of Compliance for the recording of flight time under Part-FCL), and the parts of the regulation that are easy to get wrong have been written as small, testable pieces of logic rather than left to the user interface.

This repository contains the compliance core: the data model, the validation rules, the tamper-evident audit trail, the cryptographic sign-off, and the PDF generator that reproduces the traditional paper layout. It does not yet contain the HTTP API or the web, iOS and Android clients. Those sit on top of this core and are intentionally kept separate so the rules below can be reviewed and tested in isolation.

The stack is TypeScript on Node, with PostgreSQL for storage. It is designed to deploy on Vercel, so the database access is connection-pool friendly and the PDF engine is pure JavaScript with no native binaries.

## Why this exists, and what it does not claim

A logbook application can only ever be one part of regulatory compliance. The pilot still has to enter truthful data, the training organisation still has to supervise sign-off, and the competent authority still has to be satisfied with the operator's procedures. What software can do, and what this code does, is make the recording rules enforceable rather than advisory: times are stored in one timezone and one unit, history cannot be quietly rewritten, and a signed entry cannot be edited afterwards.

We have tried to be conservative. Where the regulation is precise (the thirty minute gap, the return to the departure point, the requirement to record in UTC) the code enforces it strictly and rejects input that does not comply. Where a judgement call belongs to a human (whether a flight was genuinely conducted under supervision, for example) the code records the claim and the countersignature but does not pretend to verify the airmanship behind it.

## The twelve columns

EASA describes the logbook as a fixed table. Every value the system stores maps onto one of these twelve columns or one of their sub-fields. The mapping lives in `src/domain/columns.ts` and is treated as the single source of truth, so the database schema, the validation, the page totals and the PDF all derive their column identities from the same place and cannot drift apart.

1. Date of the flight, in UTC, shown as dd/mm/yyyy.
2. Departure: place and time (UTC).
3. Arrival: place and time (UTC).
4. Aircraft: make, model and variant, plus registration.
5. Single-pilot time, split into single-engine and multi-engine.
6. Multi-pilot time.
7. Total time of flight.
8. Name of the pilot in command (or SELF).
9. Landings, split into day and night.
10. Operational condition time: night and IFR.
11. Pilot function time: PIC, co-pilot, dual and instructor.
12. Remarks and endorsements.

## Design decisions that affect compliance

A few choices run through the whole codebase and are worth stating plainly, because a reviewer will want to know they were deliberate.

**Time is UTC, always.** There is no setting for local time. A timestamp entering the domain has to be expressed in UTC by the caller. A string carrying a non-zero offset such as `+02:00`, or one with no timezone at all, is treated as ambiguous local time and rejected outright rather than guessed at. The enforcement lives in `src/domain/time.ts` and the database columns are `timestamptz`.

**Durations are whole minutes, never floating point.** Every duration is stored and summed as an integer number of minutes, and only formatted to HH:MM for display. This means the page-by-page totals are exact and a logbook with thousands of entries cannot drift by a minute through accumulated rounding. See `src/domain/duration.ts`.

**History is appended, not overwritten.** Correcting an entry creates a new immutable version. The previous version stays exactly as it was. On top of that, every change to any entry across the whole logbook is written to a single hash-chained ledger, so the order and content of changes can be proven later. This is described in more detail below.

## Project layout

```
src/
  domain/        Pure compliance logic. No database, no I/O. This is the part to read first.
    columns.ts       The twelve-column matrix, used as the single source of truth.
    time.ts          UTC enforcement and date handling.
    duration.ts      Integer-minute durations and HH:MM formatting.
    types.ts         Core domain types for an entry, its legs and its function time.
    multiFlight.ts   The rule for combining several flights into one entry.
    functionTime.ts  PIC, co-pilot, dual, instructor, and the PICUS/SPIC countersign rules.
    validation.ts    Derives the twelve column values and checks the cross-column invariants.
    hashChain.ts     The tamper-evident append-only ledger.
    signature.ts     Ed25519 sign-off and verification.
    totals.ts        Page-by-page totals with brought-forward and carried-forward.
  db/
    schema.sql       Tables, constraints and the immutability triggers.
    pool.ts          PostgreSQL connection pool, sized for serverless.
    migrate.ts       Applies the schema.
    repository.ts    Create, amend and sign operations, each writing a ledger record.
  pdf/
    logbook.ts       Renders the EASA grid, totals and signature block to PDF.
  demo.ts            An end-to-end walk through the whole lifecycle.
test/              One test file per domain module, plus database and PDF tests.
```

## The compliance features in detail

### UTC enforcement

`parseUtcInstant` accepts an ISO-8601 string only if it ends in `Z` or `+00:00`. Anything else throws `NonUtcTimeError`. The reasoning is that silently converting a local time to UTC is exactly the kind of quiet behaviour that produces wrong logbooks, so the system refuses the input and forces the caller to be explicit. Once inside the domain a time is a JavaScript `Date`, which is a point on the UTC timeline, and all display goes back out through `toUtcIso` or `formatLogbookDate`.

### The multi-flight rule

EASA permits several flights to be recorded as a single line only when they happened on the same day, returned to the original point of departure, and the gap on the ground between consecutive flights was under thirty minutes. `validateMultiFlight` in `src/domain/multiFlight.ts` checks all three, and adds two physical preconditions that the rule takes for granted: the legs must be in chronological order, and each leg must depart from where the previous one landed.

A single-leg entry is always a valid entry; the combining conditions only bind when there is more than one leg. The function returns a list of specific violations with codes (`GAP_TOO_LARGE`, `NOT_RETURN_TO_ORIGIN`, `NOT_SAME_DAY`, and so on) so the interface can tell the pilot exactly why a grouping was refused rather than just failing. The thirty minute limit is treated as strict: a gap of exactly thirty minutes is too long, twenty-nine is fine, and there are tests for both sides of that boundary.

### Pilot function time, including PICUS and SPIC

The four function sub-columns are PIC, co-pilot, dual and instructor. The first three are mutually exclusive ways of accounting for the same flight, so together they always add up to the total time. Instructor time is different: a flight instructor is normally also the pilot in command, so instructor time is recorded as an independent annotation alongside the PIC time rather than instead of it.

Two cases need a countersignature before the time counts:

- PICUS, pilot in command under supervision. The hours are credited as PIC time, but the supervising commander has to countersign that the flight was conducted as PICUS.
- SPIC, student pilot in command. A student acts as commander under instruction. The hours are credited as PIC, and the instructor countersigns. The instructor is not supposed to influence the conduct of the flight.

`functionMinutes` works out how the total splits across the four columns, and `countersignRequirement` returns who has to sign (the supervising PIC for PICUS, the instructor for SPIC) and why. The remarks annotation that EASA expects in these cases is produced by `functionRemark`.

### The immutable audit trail

There are two layers here, and they do different jobs.

The first layer is versioning. An entry has a stable identity and a chain of versions. The current data lives in `flight_entry_versions`, one row per version, and that table is append-only. Editing an entry inserts a new version; it never updates an existing row. So the full history is always present and the original is never lost.

The second layer is the ledger. Every create, amend and sign-off across the entire logbook appends one record to `audit_ledger`. Each record carries the hash of the previous record, so the records form a chain. If anyone alters or removes a past record, every record after it stops verifying, and `verifyChain` reports the sequence number where the chain broke. This is what turns "we did not overwrite the row" into something that can actually be demonstrated to an auditor.

Both of these are also enforced by the database itself, not just the application. `schema.sql` installs triggers that raise an exception on any UPDATE or DELETE against `flight_entry_versions`, `signatures` and `audit_ledger`. A direct SQL connection cannot rewrite the trail either. There is an integration test that connects to a real database and confirms the UPDATE and DELETE are refused.

### Cryptographic sign-off and locking

When an instructor or examiner signs off a training flight or a skill test, they sign over a canonical payload that binds the entry identity, the exact content hash being attested, who they are, their role, and the time of signing. The algorithm is Ed25519, from Node's built-in crypto, so there is no third-party cryptography dependency to audit.

A valid signature locks the entry. After that point the database trigger refuses any new version for that entry, which is how "permanently locked from future editing" is achieved. The signing functions take the key material as an argument rather than generating or holding it internally, so a deployment can keep the private key in a key management service and store only the public key in the database for later verification.

Verification is offline and repeatable. `verifySignature` recomputes the payload from the stored fields and checks it against the stored public key, so an auditor can confirm a sign-off years later without trusting the running service.

### Page totals and carry-over

A paper logbook shows three total rows at the foot of every page: the total for that page, the total brought forward from earlier pages, and the running total carried forward. `paginate` in `src/domain/totals.ts` reproduces this exactly. The carried-forward total of one page is the brought-forward total of the next, so the grand total threads through the whole book. Because everything is integer minutes, the totals are exact.

### PDF generation

`generateLogbookPdf` lays the data out on a landscape grid whose columns are the twelve mandatory columns and their sub-columns. Each page shows the entry rows, the three total rows with the carry-over described above, and a signature block where the pilot certifies that the entries on the page are true. There is room on the signature block for an instructor or examiner signature where a page contains signed-off training. The generator is built on pdf-lib using the standard Helvetica fonts, which keeps it working unchanged inside a serverless function with no font files to ship and no native code.

## Database schema

The tables are:

- `pilots`: a person, which can be the logbook holder or a signer. A signer's public key is kept here so old signatures stay verifiable.
- `flight_entries`: the stable identity of an entry, plus the small amount of mutable metadata (which version is current, and whether it is locked). The flight data itself does not live here.
- `flight_entry_versions`: the append-only snapshots, one per version, with the content as JSON, its content hash, who made the change and why.
- `signatures`: a sign-off against a specific version, with the signature, the public key and the role.
- `audit_ledger`: the global hash chain, one record per change.

The append-only behaviour and the lock-on-sign behaviour are enforced by triggers in the same file, so the guarantees hold at the database level rather than depending on the application being well behaved.

## Running it locally

You need Node 20 or newer and a PostgreSQL database.

```
npm install
```

Point the application at your database. Either set `DATABASE_URL`, or use the standard `PGHOST`, `PGUSER`, `PGDATABASE` variables. Then create the schema:

```
npm run migrate
```

Run the test suite. The pure domain tests run with no database. The integration test runs only when a connection is configured, and skips itself otherwise.

```
npm test
```

Walk through the whole lifecycle and produce a sample PDF (`logbook-sample.pdf`):

```
npm run demo
```

For a local database during development you can run a throwaway PostgreSQL on a Unix socket and talk to it like this:

```
PGHOST=/tmp PGUSER=postgres PGDATABASE=airdesklogger npm test
```

There is also a type check, which the continuous integration should run:

```
npm run typecheck
```

## Deploying on Vercel

Two things matter for serverless.

Use a pooled database connection. Set `DATABASE_URL` to a pooled endpoint such as Vercel Postgres, the Neon pooler, or Supabase with pgbouncer, so that a burst of function invocations does not exhaust direct connections. The pool size is read from `PGPOOL_MAX` and defaults to one, because each warm function instance keeps its own pool.

The PDF generator is already serverless-safe. It is pure JavaScript and uses the standard fonts, so there are no font files to include in the deployment and nothing native to compile.

Keep signing keys out of the database. The signing functions accept the key material as a parameter, so the private key should come from an environment variable or a key management service at request time, and only the public key should ever be written to `pilots.public_key`.

## How an auditor can check the data

Two checks can be run at any time without trusting the live service.

To check that history has not been tampered with, read the whole `audit_ledger` ordered by sequence and pass it to `verifyChain`. It recomputes every record hash and confirms each record points at the previous one. If it returns a broken sequence number, the trail was altered at that point.

To check a sign-off, read the signature row and call `verifySignature`. It rebuilds the signed payload from the stored fields and verifies it against the stored public key. A passing check means that signer, holding that key, attested exactly that content hash at that time.

## Tests and the compliance mapping

Each requirement has code that implements it and tests that exercise it.

| Requirement | Implemented in | Tested in |
| --- | --- | --- |
| UTC only, no local time | `domain/time.ts` | `test/time.test.ts` |
| The twelve column matrix | `domain/columns.ts`, `domain/validation.ts` | `test/validation.test.ts` |
| Multi-flight rule (same day, return to origin, gap under 30 min) | `domain/multiFlight.ts` | `test/multiFlight.test.ts` |
| PICUS and SPIC, with countersigning | `domain/functionTime.ts` | `test/functionTime.test.ts` |
| Immutable audit trail | `domain/hashChain.ts`, `db/schema.sql`, `db/repository.ts` | `test/hashChain.test.ts`, `test/db.integration.test.ts` |
| Cryptographic signatures and locking | `domain/signature.ts`, `db/repository.ts` | `test/signature.test.ts`, `test/db.integration.test.ts` |
| Page-by-page totals with carry-over | `domain/totals.ts` | `test/totals.test.ts` |
| PDF in the EASA layout | `pdf/logbook.ts` | `test/pdf.test.ts` |

## Scope and limitations

This is the backend core. It does not include the HTTP API, authentication, user accounts, or any client application. It does not attempt to validate a pilot's licence privileges or currency, and it does not decide whether a particular flight was lawfully conducted as PICUS or SPIC; it records the claim and the countersignature and leaves the judgement to the people responsible for it. The PDF reproduces the column layout and the totals faithfully, but the exact typography of any one published paper logbook will differ in small ways.

## Glossary

- PIC: pilot in command.
- PICUS: pilot in command under supervision. Credited as PIC, requires the supervising commander to countersign.
- SPIC: student pilot in command. A student acting as commander under instruction. Credited as PIC, requires the instructor to countersign.
- Dual: instruction received, logged by the student.
- Block time: from the moment the aircraft first moves under its own power for the purpose of taking off, to the moment it comes to rest at the end of the flight. Used here as the total time of flight.
- IFR: instrument flight rules.
- AMC1 FCL.050: the Acceptable Means of Compliance describing how flight time is recorded in a logbook under Part-FCL.
