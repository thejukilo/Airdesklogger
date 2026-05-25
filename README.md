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
  auth/
    passwords.ts     Argon2id password hashing.
    totp.ts          RFC 6238 time-based one-time passwords (the second factor).
    tokens.ts        Session tokens (JWT).
    roles.ts         Roles and the authorisation rules.
    signingKeys.ts   Per-signer key pairs, with the private key wrapped at rest.
  http/
    parseEntry.ts    Turns a request body into a validated flight entry, enforcing UTC here.
    parseFstd.ts     Turns a request body into a validated FSTD session.
    auth.ts          Pulls and verifies the session token off a request.
  config.ts          Reads and checks the auth secrets from the environment.
  demo.ts            An end-to-end walk through the whole lifecycle.
api/               Vercel serverless functions. Thin handlers over the domain logic.
  health.ts          Liveness check.
  validate.ts        Validates one entry and returns the derived columns.
  logbook-pdf.ts     Renders entries to a PDF.
  auth/              Register, login and the two MFA endpoints.
  entries/           Create, list, read, amend and sign-off endpoints.
  audit/verify.ts    Recomputes the ledger chain (admin only).
public/            The static landing page Vercel publishes (a short description of the API).
vercel.json        Tells Vercel how to build and what to publish.
test/              One test file per domain module, plus database and PDF tests.
```

## The compliance features in detail

### UTC enforcement

`parseUtcInstant` accepts an ISO-8601 string only if it ends in `Z` or `+00:00`. Anything else throws `NonUtcTimeError`. The reasoning is that silently converting a local time to UTC is exactly the kind of quiet behaviour that produces wrong logbooks, so the system refuses the input and forces the caller to be explicit. Once inside the domain a time is a JavaScript `Date`, which is a point on the UTC timeline, and all display goes back out through `toUtcIso` or `formatLogbookDate`.

### The multi-flight rule

AMC1 FCL.050(b)(1)(vi) reads: "if the holder of a licence carries out a number of flights upon the same day returning on each occasion to the same place of departure and the interval between successive flights does not exceed 30 minutes, such series of flights may be recorded as a single entry." Read carefully, this is the local-flying case: several flights from one base, each returning to that base (circuits, training details), with short turnarounds. It is deliberately not an out-and-back to a different airfield, because in an out-and-back the first flight does not return to its place of departure.

`validateMultiFlight` in `src/domain/multiFlight.ts` enforces exactly that: same UTC day, every leg departing from and returning to the one common base, gaps under thirty minutes, and legs in chronological order. A single-leg entry is always a valid entry; the combining conditions only bind when there is more than one leg. The function returns specific violation codes (`GAP_TOO_LARGE`, `NOT_RETURNING_TO_DEPARTURE_POINT`, `NOT_SAME_DAY`, and so on) so the interface can say precisely why a grouping was refused. The thirty minute limit is strict: a gap of exactly thirty minutes is too long, twenty-nine is fine, and there are tests for both sides of that boundary.

### Synthetic training (FSTD) sessions

AMC1 FCL.050(a)(3) requires simulator sessions to be recorded too, and the printed layout gives them column 11. An FSTD session is its own kind of logbook record, recorded on its own row with the flight columns left blank: device type and qualification number (or FNPT I / FNPT II for other devices), the date, and the total time of the session including pre- and after-flight checks, with the exercise noted in the remarks. `validateFstdSession` produces the row, the session time accumulates in its own running total separate from flight time, and the PDF prints it in the FSTD column.

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

### Authentication, roles and the second factor

Every change to a logbook is now tied to an authenticated person, which is what makes the audit trail and the sign-off meaningful. Authentication is self-hosted in our own Postgres rather than handed to an outside provider, so the identity data stays where the flight data is.

Passwords are hashed with Argon2id (the WASM build, so it runs the same in tests and in a serverless function). Sessions are short-lived JSON Web Tokens that carry the user id and roles. A person can hold more than one role, because an instructor is usually also a pilot and an examiner is usually also an instructor; the rules in `roles.ts` work that out. A pilot can only write to their own logbook, and the holder id always comes from the session rather than the request body, so one pilot cannot post into another's logbook.

Sign-off is the one action that demands a second factor. Each account has its own Ed25519 signing key. The public half is stored in the clear so signatures stay verifiable for the life of the record; the private half is wrapped with AES-256-GCM under a server master key before it is stored, and it is only unwrapped for the moment of signing, after the signer has presented a valid time-based one-time code (TOTP, implemented from RFC 6238 and checked against the standard's own test vectors). A signer cannot countersign their own logbook. Both the successful and the failed step-ups are written to a security log that is append-only in the same way the flight trail is, so an attempt to sign is itself a recorded event.

The master key and the session secret come from the environment, never the database, so a database leak on its own exposes neither a usable private key nor a way to mint sessions.

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

## The HTTP API

The functions in `api/` are deliberately thin. They parse and check the request, call into the domain logic, and shape the response. None of the logic that matters lives in the handler itself, which keeps the rules in one place and easy to test.

Open endpoints (no database needed):

- `GET /api/health` reports that the service is running and returns the current UTC time.
- `POST /api/validate` takes one flight entry as JSON, validates it, and returns the twelve derived column values. A time that is not in UTC comes back as a 400. A rule failure (for example a multi-flight grouping that does not return to its origin) comes back as a 422 with the list of issues.
- `POST /api/logbook-pdf` takes a holder name and a list of entries and returns a PDF in the EASA layout. Every entry is validated first, so an invalid entry stops the render and names the row that failed.

Account endpoints:

- `POST /api/auth/register` creates an account. Anyone may register as a pilot. Granting instructor, examiner or admin needs a bootstrap token in the `x-admin-bootstrap` header, so a user cannot make themselves an examiner.
- `POST /api/auth/login` checks the password and returns a session token. A single factor here on purpose; the second factor is required at sign-off.
- `POST /api/auth/mfa/setup` and `POST /api/auth/mfa/activate` enrol and turn on the second factor for the signed-in account.

Logbook endpoints (require a session):

- `GET /api/entries` lists the holder's own entries; `POST /api/entries` records a new flight for the signed-in holder.
- `POST /api/fstd` records a synthetic training (simulator) session for the signed-in holder.
- `GET /api/entries/{id}` returns the current version and its full change history; `PATCH /api/entries/{id}` records a correction as a new version, and returns 409 if the entry is already locked.
- `POST /api/entries/{id}/sign` countersigns and locks an entry. The signer must hold a permitting role, have the second factor enabled, and present a current code.
- `GET /api/audit/verify` recomputes the whole ledger chain. Administrator only.

The open endpoints work on a fresh deployment before any storage is set up. The rest need a configured database and the auth secrets described below.

A request to `POST /api/validate` looks like this:

```
{
  "pilotId": "00000000-0000-0000-0000-000000000000",
  "aircraft": { "makeModelVariant": "Cessna 172S", "registration": "G-ABCD", "engineClass": "SE", "multiPilot": false },
  "legs": [
    { "departurePlace": "EGKB", "departureTime": "2026-05-25T08:00:00Z", "arrivalPlace": "LFAT", "arrivalTime": "2026-05-25T09:30:00Z" }
  ],
  "picName": "SELF",
  "landings": { "day": 1, "night": 0 },
  "conditions": { "night": 0, "ifr": 20 },
  "function": { "primary": "PIC", "instructor": 0 },
  "remarks": "training"
}
```

## Deploying on Vercel

The project is configured for Vercel in `vercel.json`. There is no application framework involved, so the build step runs the type check, the static landing page in `public` is published, and the files in `api` are deployed as serverless functions. This is also why a plain build without that configuration failed earlier with a message about a missing output directory: Vercel expected a static site to publish and there was none, because this is an API rather than a website.

Three things are worth knowing for a serverless deployment.

Use a pooled database connection. Set `DATABASE_URL` to a pooled endpoint such as Vercel Postgres, the Neon pooler, or Supabase with pgbouncer, so that a burst of function invocations does not exhaust direct connections. The pool size is read from `PGPOOL_MAX` and defaults to one, because each warm function instance keeps its own pool. The validate and PDF endpoints work without any of this; only the storage endpoints need it.

The PDF generator is already serverless-safe. It is pure JavaScript and uses the standard fonts, so there are no font files to include in the deployment and nothing native to compile.

Set the auth secrets. Two environment variables are required for anything beyond the open endpoints, and the service refuses to use weak values: `AUTH_JWT_SECRET` (at least 32 characters, signs session tokens) and `AUTH_SIGNING_MASTER_KEY` (exactly 64 hex characters, wraps each signer's private key). An optional `ADMIN_BOOTSTRAP_TOKEN` lets a registration request grant elevated roles. The `.env.example` file shows how to generate each one. These come from the environment, never the database.

Keep signing keys out of reach. Private signing keys are wrapped under the master key before they are stored, and the master key lives only in the environment, so a database leak alone does not expose a usable key.

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
| Multi-flight rule (same day, each flight returns to base, gap under 30 min) | `domain/multiFlight.ts` | `test/multiFlight.test.ts` |
| Synthetic training (FSTD) sessions, column 11 | `domain/validation.ts`, `pdf/logbook.ts`, `api/fstd` | `test/fstd.test.ts` |
| PICUS and SPIC, with countersigning | `domain/functionTime.ts` | `test/functionTime.test.ts` |
| Immutable audit trail | `domain/hashChain.ts`, `db/schema.sql`, `db/repository.ts` | `test/hashChain.test.ts`, `test/db.integration.test.ts` |
| Cryptographic signatures and locking | `domain/signature.ts`, `db/repository.ts` | `test/signature.test.ts`, `test/db.integration.test.ts` |
| Page-by-page totals with carry-over | `domain/totals.ts` | `test/totals.test.ts` |
| PDF in the EASA layout | `pdf/logbook.ts` | `test/pdf.test.ts` |
| Authenticated identity tied to every change | `auth/passwords.ts`, `auth/tokens.ts`, `db/authRepository.ts` | `test/auth.test.ts`, `test/authFlow.integration.test.ts` |
| Roles and own-logbook authorisation | `auth/roles.ts`, `api/entries` | `test/auth.test.ts` |
| Second factor (TOTP) required for sign-off | `auth/totp.ts`, `api/entries/[id]/sign.ts` | `test/totp.test.ts`, `test/authFlow.integration.test.ts` |
| Signer private keys wrapped at rest | `auth/signingKeys.ts` | `test/auth.test.ts` |
| Security log of logins and step-ups | `db/schema.sql`, `db/authRepository.ts` | `test/authFlow.integration.test.ts` |

## Scope and limitations

This is the backend. It includes accounts, authentication with a second factor for sign-off, the flight and FSTD logbook endpoints, the validation and the PDF rendering. The column layout, the multi-flight rule and the FSTD session were checked against the text of AMC1 FCL.050 (the August 2020 Easy Access Rules consolidation). What is not here yet: a client application, and a full structured data export for backup and retention beyond the PDF. National rules specific to a given competent authority are not reflected unless that authority's guidance has been read. The software does not validate a pilot's licence privileges or currency, and it does not decide whether a particular flight was lawfully conducted as PICUS or SPIC; it records the claim and the countersignature and leaves the judgement to the people responsible for it. The PDF reproduces the column layout and the totals faithfully, but the exact typography of any one published paper logbook will differ in small ways.

## Glossary

- PIC: pilot in command.
- PICUS: pilot in command under supervision. Credited as PIC, requires the supervising commander to countersign.
- SPIC: student pilot in command. A student acting as commander under instruction. Credited as PIC, requires the instructor to countersign.
- Dual: instruction received, logged by the student.
- Block time: from the moment the aircraft first moves under its own power for the purpose of taking off, to the moment it comes to rest at the end of the flight. Used here as the total time of flight.
- IFR: instrument flight rules.
- AMC1 FCL.050: the Acceptable Means of Compliance describing how flight time is recorded in a logbook under Part-FCL.
- FSTD: flight simulation training device (a simulator). FNPT I and FNPT II are flight and navigation procedures trainers, lower-fidelity devices, recorded in the same column.
