# Airdesk Logger — Regulatory Submission Document

**Submission for approval as an electronic pilot logbook under EASA Part-FCL FCL.050 and Swiss FOCA AMC/GM guidance.**

| | |
|---|---|
| System name | Airdesk Logger |
| Service URL | `https://log.airdeck.ch` |
| Software branch | `claude/easa-flight-log-app-TwTiM` |
| Document scope | Functional, technical, security, audit, regulatory mapping |
| Intended audience | Approving authority reviewers; internal QA; integration partners |

> Every claim in this document cites the source path the auditor can read to
> verify it. Paths are relative to the repository root.

---

## 1. Executive summary

Airdesk Logger is a web-based electronic flight logbook for licence holders
operating under EASA Part-FCL. It implements the AMC1 FCL.050 column layout,
the FOCA 2.x guidance for the Swiss application of FCL.050, and BFCL.050 for
balloon flights. The application records flights and synthetic training
sessions, locks them by cryptographic sign-off when a flight instructor,
examiner, ATO or DTO certifies them, exports the official PDF logbook with the
required audit appendix, and admits a narrow write-only import path so partner
school systems can append flights on the holder's behalf without ever obtaining
the holder's credentials.

Three properties carry the regulatory claim:

1. **Immutability of the historical record.** Edits do not overwrite — every
   change appends a new version row alongside the prior version, and append-only
   semantics are enforced by per-table Postgres triggers
   (`src/db/schema.sql:88–107`).
2. **Cryptographic proof of history.** Every mutation appends a record to a
   global hash-chained audit ledger; altering any past record invalidates every
   record after it (`src/domain/hashChain.ts`).
3. **Bound sign-off.** Sign-off uses Ed25519 keys per signer, the signature
   commits to the exact content hash being attested, and a row in `signatures`
   flips `flight_entries.locked = true` (`src/domain/signature.ts`,
   `src/db/schema.sql:55–66` and `:110–124`).

Each property is verifiable from the source.

---

## 2. Regulatory framework — feature map

The application implements the following regulatory references. Each maps to
one or more concrete code paths.

| Regulatory reference | What it requires | Where implemented |
|---|---|---|
| **EASA FCL.050** | Pilot shall keep a reliable record of all flights | Whole application |
| **AMC1 FCL.050 §1** | 12-column layout for aeroplane / helicopter / sailplane / balloon | `src/pdf/logbook.ts`, `src/domain/columns.ts` |
| **AMC1 FCL.050 §2.1** | Standardised logbook columns | Same |
| **FOCA 2.1.3** | Holder's name and address on the export header | `src/pdf/logbook.ts`, `src/db/authRepository.ts` profile fields |
| **FOCA 2.1.4** | One row per flight, category-aware columns | `src/domain/columns.ts`, `src/pdf/logbook.ts` |
| **FOCA 2.2.5** | Sailplane launch method recorded | `src/domain/types.ts` (`LaunchMethod`), `src/pdf/logbook.ts` (sailplane LAUNCH column) |
| **FOCA 2.2.7** | Local-time entries permitted, flagged with "L" | `src/domain/localTime.ts`, `src/http/buildEntry.ts` (`timesLocal`) |
| **FOCA 2.3.2** | Aerodrome codes must be valid ICAO or ZZZZ | `src/http/validateReferences.ts:38–47`, `src/domain/icao.ts` |
| **FOCA 2.3.3** | When using ZZZZ the place must be named in free text | `src/domain/validation.ts:209–217` |
| **FOCA 2.3.4** | Augmented crew share applied to time totals | `src/domain/crew.ts`, `src/domain/totals.ts` |
| **FOCA 2.3.7** | Changes within 48 h of the entry need not appear in the change log; later changes must | `src/db/repository.ts` (`logged` flag on version), `api/entries/[id].ts:44` (`GRACE_MS`), PDF appendix |
| **FOCA 2.5 / 2.5.1** | Export the logbook on demand with the audit appendix and per-period filtering | `api/export/logbook.ts`, `src/pdf/logbook.ts` |
| **BFCL.050** | Balloon groups A/B/C/D and gas balloons separately accounted | `src/domain/types.ts` (`balloonGroup`), `src/domain/validation.ts:283–302` |

---

## 3. System overview

### 3.1 What the system is

A single-tenant pilot logbook served from one domain. The same code base
serves the holder's logbook (HTTP + SPA), the external sign-off page reached
by a single-use email link, and the partner-school import endpoint. There is
no per-school multi-tenancy on the Airdesk Logger side — each pilot's logbook
is private to that pilot.

### 3.2 User roles

| Role | What they can do |
|---|---|
| **Holder** (default for every account) | Log, edit, void (within 48 h freely; after 48 h with a logged record), request sign-off, export PDF, manage personal access tokens |
| **INSTRUCTOR** | Plus countersign training flights bound to their certificate |
| **EXAMINER** | Plus countersign skill tests, proficiency checks, OPC, operator line checks |
| **SUPERVISING_PIC** | Plus countersign PICUS / SPIC time |
| **ATO / DTO / HOT** | Plus countersign course completions and instructor training course entries |
| **AIRPORT** | Plus countersign airport-validated operations |
| **ADMIN** | Reference-data seeding, holder-side support, no access to holder entries |

Roles are stored in a `pilot_roles` table (`src/db/schema.sql`) and resolved
at session-token issue time. The role list rides inside the holder's JWT
(`src/auth/tokens.ts:34`), so server handlers can authorise without an extra
round-trip.

### 3.3 Deployment

| | |
|---|---|
| Frontend | React 18 SPA, built with Vite, served as static assets |
| Backend | Node.js serverless functions on Vercel (`api/**.ts` files) |
| Database | PostgreSQL (Supabase) reached via the `pg` driver from a shared connection pool (`src/db/pool.ts`) |
| Transport | HTTPS only, HSTS on the production domain |
| Region | Switzerland / EU (Supabase) for data residency |

Each function is stateless; session state lives entirely in the holder's
signed JWT and in the database. No long-running background workers; the
import API processes its batches synchronously inside the request lifecycle
(max 200 items per request, `api/import/v1/entries.ts`).

### 3.4 Software stack

| Layer | Library / runtime |
|---|---|
| Language | TypeScript 5.5 (strict mode, `exactOptionalPropertyTypes`) |
| Runtime | Node.js (Vercel default) |
| Web framework | Native Vercel handlers (`VercelRequest` / `VercelResponse`) |
| Schema validation | `zod` 3.23 — every external boundary parses through Zod |
| JWT | `jose` 5.10 — JWT HS256, key from `JWT_SECRET` env |
| Argon2id | `hash-wasm` 4.12 |
| Email | `nodemailer` 6.9 |
| Database driver | `pg` 8.12 |
| Frontend | React 18.3, React Router 6.26 |
| Map (entry detail only) | Leaflet 1.9 loaded at runtime from a CDN |

---

## 4. Functional specification

### 4.1 Logbook entry

The holder logs flights via `web/src/pages/NewEntry.tsx` (POST `/api/entries`).
The form is category-aware: aeroplane, helicopter, sailplane, and balloon
each expose only their relevant attribute set. The server-side parser
(`src/http/parseEntry.ts`) and validator (`src/domain/validation.ts`) reject
malformed or category-inconsistent payloads with a 422 and a list of issues.

Computed fields the holder does not enter directly:
- **Night time** — derived from sunset/sunrise at the departure aerodrome
  (`src/domain/night.ts`).
- **Day vs night landings** — reclassified by arrival-time vs sunset at
  arrival aerodrome (`src/http/buildEntry.ts`).
- **Day/night pattern over the flight** — used on the export.
- **Column totals** — `src/domain/totals.ts` and `src/domain/columns.ts`
  apply augmented-crew sharing per FOCA 2.3.4.

### 4.2 Synthetic training (FSTD) sessions

A simulator session is its own row with the flight columns blank. Logged via
the same form with kind = FSTD (`src/domain/types.ts` `FstdSessionInput`).

### 4.3 Sign-off

The holder requests sign-off from the entry-detail page. A single-use email
link goes to the signer (`api/signoff/[token].ts`, `web/src/pages/Sign.tsx`).
The signer:

1. Authenticates with their own Airdesk account (their role determines whether
   they may countersign in the requested capacity).
2. Passes the second factor (TOTP).
3. Types their place of signing.
4. Draws their signature on a HTML5 canvas (mandatory).
5. The server unwraps their Ed25519 private key with the server master key
   (held only in the environment, never in the database), signs the canonical
   payload, and inserts a row into `signatures`. The insert flips
   `flight_entries.locked = true`. Subsequent attempts to append a version
   are refused by `forbid_version_when_locked` (`src/db/schema.sql:109–124`).

### 4.4 Edit, amend, void

| Action | When | Mechanism |
|---|---|---|
| Edit | Anytime before the lock | Posts a new `flight_entry_versions` row; the current version pointer moves; `logged = false` if within 48 h (FOCA 2.3.7), `logged = true` thereafter |
| Void | Anytime before the lock | Sets `flight_entries.voided = true`, `voided_at = now()`; `void_logged = true` if outside 48 h. A VOID record is appended to the audit ledger. |
| Re-import after void | When the importer pushes the same `externalId` after a void | A new entry is created; the `(token, externalId)` mapping is forwarded to the new entry (`api/import/v1/entries.ts`, `src/db/importTokensRepository.ts:replaceImportTarget`) |

A locked entry **cannot** be edited or voided through any application path,
and the database refuses the version insert directly
(`forbid_version_when_locked`).

### 4.5 Import API

Partner systems (specifically the Airdesk Flight School management product)
post closed flights to `POST /api/import/v1/entries` using a per-pilot
personal access token. The contract is **write-only and append-only** —
neither read, update, sign-off, lookup, nor profile mutations are exposed.
Documented in `docs/api-import-v1.md`, formalised in
`docs/openapi-import-v1.yaml`, and the partner-side integration guide is
`docs/integration-airdeck-fs.md` plus the installation playbook
`docs/install-airdeck-fs.md`.

### 4.6 Export

`GET /api/export/logbook` produces the FOCA PDF (`src/pdf/logbook.ts`). The
PDF contains:

- AMC1 FCL.050 grid for the period covered;
- per-page totals and brought-forward / carried-forward subtotals;
- the sign-off appendix listing every signature with signer name, role,
  licence number, place, time, drawn signature, and the entry it attests;
- the **change log appendix** listing every loggable change and every
  post-48-h void (FOCA 2.3.7);
- the **attributes appendix** listing structured FOCA attributes per entry.

The "Generate logbook PDF" button on the Dashboard and the Logbook page calls
this endpoint.

### 4.7 Dashboard

`web/src/pages/Dashboard.tsx` is the landing page. Stat cards (total time,
landings, last-90-day time, PIC time), three quick actions (Log a flight,
Generate PDF, Open logbook), and a five-row recent-flights preview.

### 4.8 Logbook overview

`web/src/pages/Logbook.tsx` is a paginated, sortable list with category /
source / "Show deleted" filters. Sort key, direction, and page size persist
in `localStorage` so the holder's chosen view survives a reload. Multi-select
allows the holder to request a single sign-off for a batch of unsigned
entries.

---

## 5. Technical architecture

### 5.1 Boundary discipline

Untrusted input enters the system at exactly three places:

| Boundary | Validator | Location |
|---|---|---|
| HTTP request bodies | Zod schemas | `src/http/parseEntry.ts`, every `api/**/*.ts` handler |
| Bearer tokens (session) | `jose.jwtVerify` | `src/auth/tokens.ts:45` |
| Bearer tokens (import API) | SHA-256 hash lookup + constant-time compare | `src/db/importTokensRepository.ts:findActiveTokenByRaw` |

All other code is written under the assumption that values have already been
parsed and bounded.

### 5.2 Time handling — UTC only

The database stores `timestamptz` (UTC) on every column; the application
**refuses** non-UTC input before it ever reaches the database
(`src/db/schema.sql:1–3`, `src/domain/time.ts`, `src/http/parseEntry.ts`).
The two exceptions:

1. **Local-time entries (FOCA 2.2.7)** — the holder may submit wall-clock
   times if the aerodrome IANA zone resolves them; a `timesLocal=true` flag
   travels with the entry and the PDF renders the value with an "L" suffix
   instead of "Z".
2. **Token-driven import time zone** — each personal access token carries
   `sourceTimeZone` and `storeTimeZone` preferences (`UTC | LOCAL`). The
   import handler runs the four-case conversion matrix in
   `src/http/buildEntry.ts`.

### 5.3 Clock-skew protection

Both client and server time are protected:

- **Server clock is the source of truth.** The "no-future-flight" guard
  fires against `Date.now()` server-side (`src/http/buildEntry.ts:133–137`),
  with a 14-hour grace for unresolved local times (UTC+14 maximum offset).
  No client-supplied time can bypass it by setting the workstation's clock.
- **Client clock skew is monitored.** Every HTTP response carries the server
  `Date` header; the SPA records the delta on each request
  (`web/src/lib/clockSkew.ts`). A skew above 5 minutes shows an amber
  warning banner; a skew above 30 minutes blocks new flight saves with a
  red banner.

---

## 6. Data model

The complete schema is `src/db/schema.sql` (455 lines, idempotent: every
statement is `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`, so the same file
runs as both the initial migration and as future column-add patches).

### 6.1 Logbook tables

| Table | Purpose | Append-only? |
|---|---|---|
| `pilots` | Account + holder profile; also stores signers' public keys for life-of-record verification | No (profile may update; identity fields lock once any flight is logged) |
| `flight_entries` | Logical envelope per flight: id, holder, current version pointer, lock flag, void flag | Limited (only `current_version`, `locked`, `voided` mutate) |
| `flight_entry_versions` | Immutable per-version snapshot of the 12-column payload as JSONB, with `content_hash` and a `logged` flag | **Yes** (trigger) |
| `signatures` | One row per countersignature: signer, role, content hash, base64 Ed25519 signature, PEM public key | **Yes** (trigger) |
| `audit_ledger` | Hash-chained record per mutation (CREATE / MODIFY / SIGN / VOID) | **Yes** (trigger) |
| `account_events` | Authentication and second-factor step-up events | Append-only by code; no UPDATE/DELETE path |

### 6.2 Reference data

| Table | Source of truth |
|---|---|
| `airports` | Curated ICAO list (`src/db/seedAirports.ts`) plus on-demand additions |
| `aircraft` | Per-registration row with category, engine type/count, multi-pilot flag, balloon group, valid-from date |
| `icao_types` | ICAO Doc 8643 type designators, used to validate the category against the registration |
| `fstd_devices` | Approved synthetic training devices |
| `simulators` | Aggregate simulator metadata |

### 6.3 Sign-off workflow tables

| Table | Purpose |
|---|---|
| `signoff_requests` | Per-request envelope with `token_hash`, expiry, optional `signer_email` hint, plus the signer name, place, and drawn signature image captured at sign-time |
| `signoff_request_entries` | Many-to-many join: a single request may countersign a batch of entries (FOCA-permitted) |

### 6.4 Import API tables

| Table | Purpose | Mutability |
|---|---|---|
| `import_tokens` | Per-pilot personal access token: name, SHA-256 hash, prefix, scope, last-used, revoked-at, and the three per-token preferences (source/store time zone, TMG filing) | Preferences are editable; the secret cannot be re-shown |
| `entry_imports` | `(token_id, external_id)` → `entry_id` mapping; provides per-token idempotency | Append-only **except** the redirect path used after a void (token_id + external_id immutable, entry_id may be forwarded) |

### 6.5 Append-only enforcement

```sql
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only; % is not permitted', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;
```

(`src/db/schema.sql:88–92`). Bound on `flight_entry_versions`, `signatures`,
and `audit_ledger`. A direct SQL connection that attempts an UPDATE or DELETE
on these tables raises an exception; rollback follows automatically inside
the transaction. There is **no application path** that disables the trigger.

`entry_imports` uses a more permissive trigger
(`forbid_entry_imports_mutation`, `src/db/schema.sql:415–433`) that allows
only the post-void redirect of `entry_id` and freezes the primary key.

### 6.6 Lock-on-sign enforcement

```sql
CREATE OR REPLACE FUNCTION forbid_version_when_locked() RETURNS trigger AS $$
DECLARE is_locked boolean;
BEGIN
  SELECT locked INTO is_locked FROM flight_entries WHERE id = NEW.entry_id;
  IF is_locked THEN
    RAISE EXCEPTION 'Entry % is locked by sign-off; no further edits permitted', NEW.entry_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

(`src/db/schema.sql:110–124`). Fires `BEFORE INSERT` on
`flight_entry_versions`. Once a row exists in `signatures` and
`flight_entries.locked = true`, no further version can be appended.

---

## 7. Identity, authentication, authorisation

### 7.1 Account model

One row in `pilots` per account. Holder, instructor, and examiner are all
the same kind of account; their **role** determines what they may sign for.
Identity fields (forename, surname, date of birth) are **locked** the moment
any flight has been logged to that account, to prevent reassigning a
logbook to a different person.

The identity-lock guard is server-side: any PATCH to a profile that has
flights raises `IdentityLockedError`, which the handler maps to HTTP 409
(`src/db/authRepository.ts:updateProfile`, `api/account/index.ts`). The SPA
mirrors the lock with disabled inputs and an amber banner.

### 7.2 Passwords

Argon2id, parameters chosen for ~150 ms on the target hardware
(`src/auth/passwords.ts:22`). Minimum length 12. Hashes never logged.

### 7.3 Second factor — TOTP

RFC 6238 TOTP, RFC 4226 HOTP underneath (`src/auth/totp.ts`). The holder
opts in from Account; QR code provisioning generated locally; secret stored
encrypted at rest under the master key. The second factor is **mandatory**
for any signing event regardless of whether the holder has chosen to require
it at login (`api/entries/[id]/sign.ts`, `api/signoff/[token].ts`).

### 7.4 Session tokens

JWT (HS256, signed with `JWT_SECRET`) carrying the holder's id, roles, and
email. Verified by `jose.jwtVerify` (`src/auth/tokens.ts`). Sessions are
short-lived; a refresh path is on the roadmap, but currently re-authentication
is required when the JWT expires.

### 7.5 Password reset

Single-use, time-limited token, hashed in the database; only the cleartext
form is emailed (`src/db/schema.sql:158–161`). The reset path requires the
token plus the new password.

### 7.6 Personal access tokens (import API)

`airdesk_pat_<base64url>` strings, 256-bit random. The raw token is shown
**once** at issue, then only its SHA-256 hash is stored (`token_hash` column,
indexed for lookup). Each PAT carries:

- A unique `id`.
- A `name` chosen by the holder ("Albis Wings").
- A `scope` fixed to `entries:append` (the only scope defined).
- Per-token preferences: `source_time_zone`, `store_time_zone`,
  `tmg_category`.
- Optional `revoked_at` — revocation is irreversible; the row is retained
  for the audit trail.

Lookup uses the SHA-256 hash with a constant-time comparison
(`src/db/importTokensRepository.ts:findActiveTokenByRaw`), defensive even
though hash collisions are astronomical.

### 7.7 Account-event log

Every authentication event, every second-factor step-up, every password reset
appends a row to `account_events` (`src/db/schema.sql:172–193`). The table
is append-only by application convention and constrained by a CHECK on the
event-type vocabulary.

---

## 8. Tamper-evident audit trail

### 8.1 What gets recorded

Every mutation of any flight entry — CREATE, MODIFY (i.e. a new version),
SIGN, VOID — appends a record to `audit_ledger` (`src/db/repository.ts`,
`src/domain/hashChain.ts`).

A record contains:

- `seq`: contiguous bigint primary key.
- `prev_hash`: the `record_hash` of the immediately prior record (or the
  `GENESIS_HASH` of 64 zeros for `seq = 0`).
- `event_type`: enum `CREATE | MODIFY | SIGN | VOID`.
- `entry_id`: the entry being mutated.
- `payload_hash`: the content hash of the version being attested
  (CREATE / MODIFY / SIGN) or the void payload (VOID).
- `actor_id`: who performed the action.
- `recorded_at`: server UTC.
- `record_hash`: SHA-256 over the canonical JSON of all fields above.

### 8.2 The chain

`record_hash[n] = sha256(canonical_json(record[n] without record_hash))` and
each subsequent record's `prev_hash` is `record_hash[n]`. Verification walks
forward from genesis: any altered or removed record makes every subsequent
record's `prev_hash` mismatch the predecessor's `record_hash`, and every
subsequent `record_hash` will recompute to a different value.

Canonical JSON is the recursive deterministic JSON in
`src/domain/hashChain.ts:38–48`.

### 8.3 Sequential allocation

Records are appended inside a Postgres transaction holding
`pg_advisory_xact_lock(LEDGER_LOCK_KEY)` (`src/db/repository.ts:70–82`).
Sequence allocation is therefore globally serialised; two concurrent
mutations cannot produce two records with the same `seq` or with a `prev_hash`
that does not match the actual previous record.

### 8.4 Verification

`src/domain/hashChain.ts:verifyChain` walks the ledger from genesis and
reports the first record where the recomputed hash diverges from the stored
hash, or the first `prev_hash` mismatch. The function is pure and
self-contained; an auditor can run it offline against an export of the ledger.

---

## 9. Cryptographic sign-off

### 9.1 Algorithm

Ed25519 (RFC 8032), implemented via Node's built-in `crypto` module
(`src/domain/signature.ts:50–55`). No third-party cryptography dependency
for the signing primitive.

### 9.2 Per-signer keys

Each signer holds their own Ed25519 keypair:

- **Public key** in `pilots.public_key`, retained forever so any historical
  signature stays verifiable even after the signer's account is closed.
- **Private key** wrapped with **AES-256-GCM** under the server master key
  (`src/auth/signingKeys.ts:21–34`). The master key is supplied via
  `AUTH_SIGNING_MASTER_KEY` (32-byte hex). The wrapped form is stored on the
  signer's row; the cleartext private key exists only inside the function
  invocation that performs the signing, never on disk.

### 9.3 Canonical signing payload

```ts
function canonicalPayload(p: SigningPayload): Buffer {
  return Buffer.from(
    JSON.stringify([p.entryId, p.contentHash, p.signerId, p.signerRole, p.signedAt]),
    "utf8",
  );
}
```

(`src/domain/signature.ts:57–63`). Fixed field order — both signer and
verifier serialise identically. The signature commits to the **exact** version
content hash; an attempt to substitute another version (even a syntactically
similar one) yields a different hash, and the signature no longer verifies.

### 9.4 Storage

A `signatures` row records the entry id, version no, signer id, signer role,
content hash, base64 signature, the PEM SPKI public key as it was at signing
time (so verification does not depend on the signer's current key), and the
signing instant. Insert flips `flight_entries.locked = true`. The
`signatures` table is append-only by trigger
(`src/db/schema.sql:99–102`).

### 9.5 Lock semantics

A signed entry is permanently locked. The database refuses any further
version insertion (`forbid_version_when_locked` trigger, §6.6). The
application surfaces no UI for editing a locked entry. To correct a signed
entry, a new entry must be created and the old one annotated in remarks —
this matches the regulatory expectation that the signed record stand.

### 9.6 Drawn signature

Every sign-off captures a **drawn signature image** via an HTML5 canvas
(`web/src/components/SignaturePad.tsx`). The image rides inside the
`signoff_requests` row and is rendered on the PDF appendix next to the
typed-name and the place of signing. The drawn signature is **mandatory**:
the Save button stays disabled until the canvas has ink, the typed name is
non-empty, and the place of signing is non-empty. Same rule on the in-app
sign-off path (`api/entries/[id]/sign.ts`) and on the email-link path
(`api/signoff/[token].ts`).

### 9.7 Sign-off flow — request → sign

1. **Request.** The holder selects one or more unsigned entries on the
   Logbook page, types the signer's email, and submits. The server creates
   a `signoff_requests` row, mints a single-use opaque token, hashes it
   (`token_hash` on the row), and sends the cleartext token in an email
   link.
2. **Sign.** The signer follows the link, lands on `/sign/:token` in the
   SPA, authenticates with their own Airdesk account (which determines
   their role authority), passes TOTP, types the place of signing, draws
   their signature, reviews the entries listed, and submits.
3. **Persist.** The server:
   - Verifies the token (hash lookup + expiry check),
   - Verifies the signer's role is sufficient for every attribute on every
     selected entry (`src/domain/attributes.ts:requiresSignature`),
   - Unwraps the signer's private key with the master key,
   - For each entry: builds the canonical payload, produces an Ed25519
     signature, inserts the `signatures` row, the trigger locks the entry,
     and a SIGN record appends to the audit ledger.

### 9.8 Signature-required rules

The set of attributes and functions that require a signature is centralised
in `src/domain/attributes.ts`:

- **By attribute**: `skill_test`, `proficiency_check`, `licence_proficiency_check`,
  `operator_proficiency_check`, `operator_line_check`, `language_proficiency_check`,
  `refresher_training`, `difference_training`, `familiarization`,
  `course_completed`, `instruction_training_course`,
  `demonstration_of_ability_to_instruct`.
- **By function**: `DUAL`, `PICUS`, `SPIC`.

`requiresSignature(attributes, primaryFunction)` is the single source of truth;
called from both the validator and from `signatureRequired` on the derived
columns so the SPA and the PDF agree.

---

## 10. Import API (write-only path)

### 10.1 Scope

`POST /api/import/v1/entries` is the only endpoint. No `GET`, no `PUT`, no
`DELETE`, no sign-off, no lookup, no profile mutation, no webhook.
Documented in `docs/api-import-v1.md`; OpenAPI 3.1 schema at
`docs/openapi-import-v1.yaml`; partner-side guides at
`docs/integration-airdeck-fs.md` and `docs/install-airdeck-fs.md`.

### 10.2 Authentication

`Authorization: Bearer airdesk_pat_<…>`. Token is hashed on receipt and looked
up in `import_tokens`. A revoked or expired token returns 401; a scope other
than `entries:append` returns 403. The token's `last_used_at` is updated
asynchronously after the request.

### 10.3 Token-driven preferences

Three preferences travel with each token, set by the holder on the Account
page:

- `sourceTimeZone` (UTC | LOCAL) — how to interpret the request's leg times.
- `storeTimeZone` (UTC | LOCAL) — UTC stores ISO instants; LOCAL projects
  the UTC instant to wall-clock at the aerodrome and stamps `timesLocal`.
- `tmgCategory` (AEROPLANE | SAILPLANE) — how to file TMG aircraft when the
  importer sends `aircraft.category = "TMG"`.

The body may override `timeZone` per-request; the store side is always the
token's setting.

### 10.4 Idempotency

`(token_id, external_id)` is the dedup key. A second push with the same
`externalId` returns `200 duplicate` with the original entry id. If the
holder has voided the original entry, the next push with the same
`externalId` creates a fresh entry and forwards the mapping
(`replaceImportTarget`, §4.4). The audit ledger retains both the original
CREATE/VOID and the new CREATE.

### 10.5 Pre-validation by `?dryRun=1`

`POST /api/import/v1/entries?dryRun=1` runs the entire validation pipeline
and returns the same response shapes without writing. Recommended for CI
on the partner side; documented in §6 of the integration guide.

### 10.6 What the import path cannot do

- It cannot create a signature; sign-off is gated by MFA + drawn signature
  inside an authenticated SPA session.
- It cannot modify holder identity (name, DOB).
- It cannot read another pilot's logbook; the token resolves to exactly one
  pilot.
- It cannot bypass the no-future-flight guard; the server clock applies.
- It cannot bypass the `aircraft.category` rule against the
  registration's known category.

---

## 11. Reference data discipline

Aerodromes and aircraft are validated against curated reference tables
(`src/db/referenceRepository.ts`, `src/http/validateReferences.ts`):

- A place that is not `ZZZZ` must be a 4-letter ICAO present in `airports`.
- A registration must be present in `aircraft` (with a `valid_from` date no
  later than the flight date) — matched case- and dash-insensitively
  (`normalizeRegistration`).
- The aircraft's known category must contain the entry's chosen category;
  multi-category types (TMG) are admitted under any of their allowed
  categories.
- A ZZZZ aerodrome must be accompanied by a free-text place name
  (`departurePlaceName` / `arrivalPlaceName`) per FOCA 2.3.3.

Aircraft auto-add and ICAO type lookups (`src/http/aircraftLookup.ts`) keep
the reference table current without admin involvement for common cases.

---

## 12. PDF export

`api/export/logbook.ts` orchestrates the export; `src/pdf/logbook.ts`
renders it. The PDF contains:

| Section | Content |
|---|---|
| Header | Holder name, address, licence number, date of birth, paper size (A4 default, LETTER configurable per holder), generation timestamp (`Generated YYYY-MM-DD HH:MM UTC` on every page) |
| FCL.050 grid | Category-specific column layouts (aeroplane / helicopter / sailplane / balloon) with per-page totals, brought-forward / carried-forward subtotals |
| Sign-off appendix | One block per signed entry: signer name, role, licence number, place, time, drawn signature image, internal link back to the grid row |
| Attributes appendix | One row per (entry, attribute) with structured detail (HESLO cycles, NVIS minutes, etc.) — a table, not free text |
| Change log appendix | One row per logged version change (FOCA 2.3.7) and one row per post-48 h void, with the entry reference, version, when, by, reason, and content-hash prefix |

Only the FCL.050 grid is required by AMC1 FCL.050. The three appendices
implement FOCA 2.5's audit-trail expectations.

Counter values, GeoJSON tracks, and free-form provenance from the import
are **deliberately not included** on the PDF — they are operational data
shown only on the holder's entry-detail view in the SPA.

---

## 13. Transport security

- HTTPS only; HSTS on the production domain (Vercel default).
- Session JWT issued by the server, transmitted from the SPA in the
  `Authorization: Bearer` header. No CSRF surface because no cookie-based
  auth.
- The import API uses bearer tokens only; no cookies.
- CORS: same-origin only by default; cross-origin requests have no
  credentialed paths.

---

## 14. Logging & monitoring

| Stream | Where |
|---|---|
| Flight-entry audit | `audit_ledger` (hash-chained, append-only) |
| Account events | `account_events` (login, logout, MFA step-up, password reset) |
| Import attempts | `import_tokens.last_used_at`, `entry_imports` (idempotency mapping) |
| Application logs | Vercel function logs (no PII in production) |

The audit ledger is the **single source of truth** for the regulator's
"who changed what when" question; the application logs are an operational
aid only.

---

## 15. Backup & disaster recovery

PostgreSQL is hosted on Supabase, which provides daily encrypted backups
with point-in-time recovery within the configured window. Reference data is
re-seedable from the codebase (`src/db/seed*.ts`) and from the curated CSVs
under `data/`. Frontend assets are immutable per build and re-served from
Vercel; the source of truth is the Git repository on GitHub.

Cryptographic recovery: the `audit_ledger` and `signatures` chains are
self-verifying — given a database export, an auditor can run
`verifyChain` and re-verify each signature with the stored public key,
without trusting the operator's word.

---

## 16. Privacy & GDPR posture

| Data category | Handling |
|---|---|
| Holder name, DOB, address, licence number | Stored only on the holder's own `pilots` row; visible only to the holder, to a signer at sign-time (subset), and to ADMIN on a support-bound path. Identity fields lock once any flight is logged. |
| Holder password | Argon2id hash; cleartext never persisted or logged. |
| TOTP secret | Encrypted at rest under the master key. |
| Signer keys | Public key visible; private key wrapped under AES-256-GCM. |
| Email | Verified at sign-up. Used for sign-off invitations and password reset only. |
| Flight content | Holder-only by default. A countersigner sees only the entry they are asked to sign. |
| External imports | Partner sends only what the integration guide specifies; identity (name, DOB) is **never** accepted from the import payload, even if posted. |
| Tracks (GeoJSON) | Optional; entry-detail only; never on the PDF; pilot can void the entry and the row stops appearing. |

GDPR data subject rights:

- **Access** — the PDF export is the holder's data; available on demand.
- **Rectification** — within 48 h, edits leave no permanent record;
  thereafter every change is logged.
- **Erasure** — voiding removes the entry from active views; the audit
  trail retains the immutable history per the regulatory requirement. A
  full account closure (out of scope for v1) would purge live state but
  preserve the audit ledger for the retention period required by the
  regulator.

---

## 17. Software quality

| Practice | Where |
|---|---|
| TypeScript strict mode | `tsconfig.json` (server), `web/tsconfig.json` (SPA) |
| `exactOptionalPropertyTypes: true` | Catches `undefined`-vs-absent confusion at compile time |
| Tests | `test/**/*.test.ts` — 158 unit tests + integration suites (Vitest) |
| End-to-end validation | Zod at every external boundary |
| Schema-as-code | One file, idempotent, hand-reviewed |
| Code review | All changes via pull request on `claude/easa-flight-log-app-TwTiM` → `main` |
| Continuous integration | Vercel build + Vitest |

Unit tests cover: attributes, augmented-crew sharing, day/night
classification, signatures (sign + verify + tamper-detection), hash chain
(create + verify + tamper-detection), TOTP, local-time conversion,
ICAO/aircraft lookup, registration normalisation, multi-flight series,
function-time totals.

---

## 18. Operational procedures

### 18.1 Deployment

`main` branch on GitHub → Vercel → production. Database migrations are the
single `src/db/schema.sql` file applied through Supabase's SQL editor.
Every block is idempotent; re-running on a current database is a no-op.

### 18.2 Reference-data updates

- **Airports** — periodic refresh from the curated list.
- **Aircraft register** — admin-triggered import from the public Swiss /
  European registers (`api/admin/seed-aircraft.ts`, `seed-aircraft-europe.ts`).
- **ICAO types** — Doc 8643 designators (`api/admin/seed-icao-types.ts`).
- **Simulators** — manual curation.

### 18.3 Key rotation

| Key | How |
|---|---|
| `JWT_SECRET` | Rotate by setting a new value; all sessions invalidated. |
| `AUTH_SIGNING_MASTER_KEY` | Re-wrap all stored signer private keys under the new master key in a one-shot migration script. |
| `ADMIN_BOOTSTRAP_TOKEN` | Operational only; not in the regulatory critical path. |

### 18.4 Incident handling

Audit-ledger and signatures are self-verifying — if a leak or compromise is
suspected, an auditor can re-verify the full chain offline against a database
export. Any divergence localises the affected entry.

---

## 19. Known limitations and scope notes

| Item | Status |
|---|---|
| Multi-language UI | Currently English only; backend stores no UI strings. |
| Holder-side delete of an entry **within** 48 h | Leaves no change-log entry, per FOCA 2.3.7. |
| Holder-side delete **after** 48 h | Always logged in the change-log appendix on the PDF. |
| Counter and track fields | Accepted via import, shown on entry-detail UI, **not** on the PDF (operational only). |
| Sign-off via the import API | Not permitted by design. |
| Account closure flow | Pending; data subject can request manually until shipped. |
| Multi-region failover | Single Supabase region; daily backups + PITR. |

---

## 20. Annexes

### A. File index — where to read what

| Concern | Path |
|---|---|
| Database schema | `src/db/schema.sql` |
| Append-only trigger function | `src/db/schema.sql:88–92` |
| Lock-on-sign trigger function | `src/db/schema.sql:110–124` |
| `entry_imports` mutability rule | `src/db/schema.sql:415–433` |
| Hash chain | `src/domain/hashChain.ts` |
| Ed25519 sign-off | `src/domain/signature.ts` |
| Private-key wrapping (AES-256-GCM) | `src/auth/signingKeys.ts` |
| Argon2id passwords | `src/auth/passwords.ts` |
| TOTP | `src/auth/totp.ts` |
| Session JWT | `src/auth/tokens.ts` |
| Boundary parser | `src/http/parseEntry.ts` |
| Time-zone matrix | `src/http/buildEntry.ts` |
| Local-time conversion | `src/domain/localTime.ts` |
| Identity locking | `src/db/authRepository.ts:updateProfile` |
| Reference-data validation | `src/http/validateReferences.ts` |
| Signature-required rules | `src/domain/attributes.ts:requiresSignature` |
| PDF rendering | `src/pdf/logbook.ts` |
| PDF export endpoint | `api/export/logbook.ts` |
| Import API endpoint | `api/import/v1/entries.ts` |
| Import token CRUD | `api/account/import-tokens/*.ts` |
| Sign-off endpoints | `api/entries/[id]/sign.ts`, `api/signoff/[token].ts` |
| Logbook UI | `web/src/pages/Logbook.tsx` |
| Entry detail UI | `web/src/pages/EntryDetail.tsx` |
| Dashboard | `web/src/pages/Dashboard.tsx` |
| Account page | `web/src/pages/Account.tsx` |
| Clock-skew banner | `web/src/lib/clockSkew.ts`, `web/src/components/ClockSkewBanner.tsx` |
| Drawn-signature pad | `web/src/components/SignaturePad.tsx` |
| Track map | `web/src/components/TrackMap.tsx` |

### B. Environment variables (production)

| Name | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `JWT_SECRET` | HS256 session-token key |
| `AUTH_SIGNING_MASTER_KEY` | 32-byte hex; wraps every signer's private key |
| `ADMIN_BOOTSTRAP_TOKEN` | One-shot bootstrap for the first admin |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM` | Transactional email (sign-off invites, password reset, verification) |
| `AIRCRAFT_CSV_URL` | Optional curated aircraft dataset for the bulk-import action |

### C. Glossary

| Term | Meaning |
|---|---|
| Holder | The licence holder whose logbook this is |
| Signer | Anyone who countersigns (instructor, examiner, supervising PIC, ATO, DTO, HOT, airport) |
| FSTD | Flight Simulation Training Device — column 11 of AMC1 FCL.050 |
| TMG | Touring Motor Glider — admitted under either aeroplane or sailplane filing |
| PAT | Personal Access Token (import API) |
| Content hash | SHA-256 over the canonical JSON of a version's content |
| Record hash | SHA-256 over a ledger record (incorporating `prev_hash`) |
| Genesis hash | `"0" * 64` — `prev_hash` for the first ledger record |
| FOCA | Federal Office of Civil Aviation (Switzerland) |
| BFCL.050 | Balloon-specific FCL.050 derivative |

---

*End of submission document.*
