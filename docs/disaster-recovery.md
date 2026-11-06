# Airdeck Log — Disaster Recovery Runbook

**Audience:** whoever operates Airdeck Log (today: Jukilo). Written to be usable by
a competent engineer who has *never seen this system before*, because in a real
disaster that may be who is holding it.

**Golden rule:** the logbook and its legal validity do **not** depend on any single
vendor. The source code lives in Git, the data lives in standard PostgreSQL, and
the integrity proofs are standard cryptography (Ed25519 + SHA-256). Any one of
Vercel, Supabase, or Claude can disappear without losing the logbook or its
evidential value — provided the **three crown jewels** below are safe.

---

## 0. The three crown jewels (protect these above all else)

| # | Asset | Where it lives | If lost… |
|---|-------|----------------|----------|
| 1 | **Source code** | GitHub `thejukilo/Airdesklogger` (+ every local clone) | Rebuild from any clone. Low risk if anyone has cloned it. |
| 2 | **Database contents** | Supabase PostgreSQL (`DATABASE_URL`) | **Pilot logbooks lost** unless a recent `pg_dump` exists. This is the highest-value asset. |
| 3 | **Secrets**, above all `AUTH_SIGNING_MASTER_KEY` | Vercel project env vars | See below — losing the master key disables *new* sign-offs. |

### Why `AUTH_SIGNING_MASTER_KEY` is special
Every instructor/examiner has an Ed25519 **private** signing key. It is stored in
the DB **wrapped (encrypted) with `AUTH_SIGNING_MASTER_KEY`** (64 hex chars / 32
bytes). Consequences:

- **Lose the master key →** no existing signer can produce *new* sign-offs (their
  wrapped private keys can never be unwrapped again). Pilots must re-enrol signing
  keys. **However, all _existing_ signatures remain fully valid and verifiable**,
  because each signature row stores the signer's **public** key in clear.
- **Leak the master key →** an attacker who also has a DB dump could forge sign-offs.
  Treat it like a root key.

> **Readiness action:** keep `AUTH_SIGNING_MASTER_KEY` and `AUTH_JWT_SECRET` in a
> password manager / offline vault that is **independent of Vercel**. You cannot read
> them back out of Vercel once set. Do the same for the Stripe and SMTP secrets.

---

## 1. System at a glance

```
            ┌───────────────────────────────────────────────┐
  Browser / │  React 18 SPA (web/ → web/dist, static)        │
  iOS app   │  Vercel serverless functions (api/*.ts, Node)  │  ← Vercel
            └───────────────────────┬───────────────────────┘
                                    │  pg (DATABASE_URL)
                          ┌─────────▼─────────┐
                          │ PostgreSQL        │  ← Supabase (plain Postgres)
                          └───────────────────┘
  External: Stripe (billing) · SMTP (email) · Google Maps (address lookup) · OSM tiles
```

- **Monorepo layout:** `web/` (SPA), `api/` (Vercel functions), `src/` (shared domain,
  DB, auth, PDF, crypto). Schema: `src/db/schema.sql`.
- **Build (Vercel):** `npm run typecheck && npm run migrate && npm run build:web`,
  output `web/dist`. Migrations are idempotent (`IF NOT EXISTS`/`OR REPLACE`,
  advisory-lock guarded) and run on every deploy via `tsx src/db/migrate.ts`.
- **Production:** branch `claude/easa-flight-log-app-TwTiM` → `log.airdeck.ch`.
- **Native app:** Capacitor iOS, bundle id `ch.airdeck.logger`, ships a frozen copy
  of `web/dist` and calls the API at `log.airdeck.ch`.
- **Cron:** Vercel cron hits `/api/cron/expire-trials` daily (auth: `CRON_SECRET`).

### Environment variables / secrets (full surface)
| Variable | Purpose | Criticality |
|----------|---------|-------------|
| `AUTH_SIGNING_MASTER_KEY` | Wraps pilots' Ed25519 private signing keys (64 hex) | **Critical** |
| `AUTH_JWT_SECRET` | Signs session JWTs (issuer/audience `airdesklogger`, ≥32 chars) | **Critical** |
| `DATABASE_URL` (or `PGHOST`/`PGPOOL_MAX`) | PostgreSQL connection | **Critical** |
| `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET` | Billing | High |
| `SMTP_HOST/PORT/USER/PASS/SECURE/FROM` | Transactional email (verification, resets, sign-off invites) | High |
| `CRON_SECRET` | Authenticates the trial-expiry cron | Medium |
| `ADMIN_BOOTSTRAP_TOKEN` | One-time admin bootstrap | Medium |
| `APP_BASE_URL` | Absolute links in emails | Low |
| `AIRCRAFT_CSV_URL`, `AIRPORTS_CSV_URL` | Reference-data seed sources | Low (re-seedable) |
| Google Maps API key | Client-side address autocomplete (`web/src/lib/placesAutocomplete.ts`) | Low |

---

## 2. Readiness checklist (do these NOW, before any disaster)

- [ ] **Automated DB backups are ON** and tested. Supabase: enable daily backups +
      Point-in-Time Recovery on your plan. **Additionally**, take a weekly
      `pg_dump` to cold storage you control (see §4) — never rely on the vendor's
      backups alone.
- [ ] **Secrets are vaulted off-Vercel** (password manager / offline). Especially
      `AUTH_SIGNING_MASTER_KEY` and `AUTH_JWT_SECRET`.
- [ ] **At least two people** can access: GitHub, Vercel, Supabase, the domain
      registrar (DNS for `airdeck.ch`), Stripe, and the Apple Developer account.
- [ ] **The repo is cloned** on at least one machine outside the cloud (bus-factor).
- [ ] This document is printed / exported to PDF and stored with the vaulted secrets.
- [ ] You have verified you can run, from a clean clone: `npm ci`, `npm run typecheck`,
      `npm run build:web`, and `npm run migrate` against a throwaway Postgres.

---

## 3. Scenario A — Vercel is gone / unsupported

**Impact:** hosting + serverless API + cron are down. The DB and data are unaffected
(they're in Supabase). The native app keeps showing its frozen UI but its API calls
fail until the backend is re-hosted at the same hostname.

**Why this is recoverable:** the API is standard Node (`@vercel/node` handler
signature: `(req, res)`), the frontend is static files, and there is no Vercel-only
runtime feature in the business logic. Only three Vercel-specific things exist:
the build command, cron scheduling, and the handler signature.

**Recovery steps:**
1. **Stand up a Node host** — any of: Netlify, Render, Fly.io, Railway, Cloudflare
   (with an adapter), or a plain VPS running Node 20.
2. **Frontend:** build `web/dist` (`npm run build:web`) and serve it as static files
   with SPA fallback (all non-`/api` routes → `index.html`; see the `rewrites` in
   `vercel.json`).
3. **API:** the functions in `api/**` are thin `(req, res)` handlers. On a VPS, wrap
   them in a tiny Express/Fastify app that maps each file path to a route and passes
   `req`/`res` through. On Netlify/Render, use their Node-function adapter. Budget a
   day for this shim; the handler logic itself does not change.
4. **Set all environment variables** (§1 table) on the new host.
5. **Re-create the cron:** schedule a daily authenticated `POST`/`GET` to
   `/api/cron/expire-trials` with header `Authorization: Bearer $CRON_SECRET`
   (any scheduler: cron, GitHub Actions, Render cron, Supabase pg_cron + http).
6. **Security headers / CSP:** the headers in `vercel.json` must be reproduced on the
   new host (CSP, X-Frame-Options, etc.) or set in the web server config.
7. **DNS:** repoint `log.airdeck.ch` to the new host and re-issue TLS (Let's Encrypt
   or the host's managed cert).
8. **Native app:** no rebuild needed *if* the hostname stays `log.airdeck.ch`. If the
   API hostname changes, you must rebuild the Capacitor app (`npm run cap:sync` →
   Xcode → App Store/TestFlight) and point it at the new host.

**Rollback/verify:** hit `/api/health`-style endpoints, log in, open an entry, and
generate a PDF export before announcing recovery.

---

## 4. Scenario B — Supabase is gone / unsupported

**Impact:** total outage — no reads or writes. This is the most dangerous scenario
because it is about **data**, not code.

**Why this is recoverable:** the app uses **plain PostgreSQL** via the `pg` driver and
a `DATABASE_URL`. There is **no Supabase SDK, no Supabase Auth, no RLS, no Storage**
dependency (auth is the app's own JWT/argon2id/TOTP). Migrating databases is a dump,
a restore, and a connection-string change.

**Prevention (do this regularly, not during the disaster):**
```bash
# Weekly full logical backup to storage YOU control (encrypt at rest):
pg_dump "$DATABASE_URL" --format=custom --no-owner --file=airdecklog_$(date +%F).dump
# Verify it restores into a scratch database before trusting it.
```

**Recovery steps:**
1. **Provision a new PostgreSQL 15+** anywhere: AWS RDS, Google Cloud SQL, Neon,
   Crunchy, self-hosted, etc. (Version must support `gen_random_uuid()` / `pgcrypto`
   and `pg_advisory_xact_lock`.)
2. **Restore the newest dump:**
   ```bash
   pg_restore --no-owner --dbname "$NEW_DATABASE_URL" airdecklog_YYYY-MM-DD.dump
   ```
   If you have no dump but Supabase is only *degraded*, first try Supabase PITR /
   their backup download.
3. **Re-apply schema (safe, idempotent)** to pick up any migrations:
   `DATABASE_URL=$NEW_DATABASE_URL npm run migrate`.
4. **Re-seed reference data if needed** (not user data): `npm run seed:airports`,
   `seed:aircraft`, `seed:icao-types`, `seed:simulators`.
5. **Point the app at the new DB:** update `DATABASE_URL` in Vercel (or the host from
   Scenario A) and redeploy.
6. **Verify integrity after restore** (critical — see §6): run the signature and
   hash-chain verification over a sample of entries to prove nothing was corrupted in
   transit. The immutability triggers (`forbid_mutation`) are recreated by `migrate`.

**Data model you are protecting** (all in one Postgres DB): `pilots`,
`flight_entries`, append-only `flight_entry_versions`, `signatures`, the chained
`audit_ledger`, immutable `account_events`, plus billing (`stripe_events`), imports,
and reference tables (`airports`, `aircraft`, `icao_types`, `fstd_devices`,
`simulators`).

---

## 5. Scenario C — Claude is gone / unsupported, and code changes are needed

**Impact:** none on the running system. Claude is a *development* tool, not a runtime
dependency. The app contains **no Anthropic/Claude API calls** in production.

**What you lose:** the assistant that has been writing changes. Everything needed to
develop by hand (or with any other tool/engineer) is already in the repo.

**How to keep developing without Claude:**
1. **Clone and run locally:**
   ```bash
   git clone https://github.com/thejukilo/Airdesklogger && cd Airdesklogger
   npm ci
   npm run typecheck            # tsc for web + api
   npm run test                 # vitest
   npm run build:web            # Vite build → web/dist
   ```
2. **Local backend:** provide a local/throwaway Postgres and the env vars from §1,
   then `npm run migrate`. Use `npm run demo` / the seed scripts for data.
3. **Make changes** with any editor/engineer/AI assistant. The codebase is ordinary
   TypeScript (React 18 + Vite frontend, `@vercel/node` functions, `pg`, `jose`,
   `argon2`, `node:crypto`). Key domains to understand:
   `src/domain/` (hash chain, signatures, local time), `src/db/` (schema + repos),
   `src/auth/` (tokens, passwords, TOTP, signing-key wrapping), `api/` (endpoints).
4. **Deploy** by pushing to the production branch (`claude/easa-flight-log-app-TwTiM`),
   which triggers the Vercel build above. Preview branch: `claude/redesign-preview`.
5. **Attribution/CI:** nothing in the pipeline requires Claude. Remove any
   Claude-specific commit trailers at your discretion; they have no functional effect.

**Bottom line:** Scenario C is a staffing/tooling change, not a technical outage. No
emergency action is required to keep the service running.

---

## 6. Scenario D — Accident investigation: authorities request **all** records for pilot X

A crash investigation (e.g. SUST/STSB in Switzerland, or a foreign authority) asks for
the complete, authentic flight log of a specific pilot. You must (a) produce everything,
and (b) **prove it wasn't altered**. The system is designed for exactly this.

### 6.1 Identify the pilot
```sql
SELECT id, email, first_name, last_name, date_of_birth, license_number, address
FROM pilots
WHERE lower(email) = lower('pilot@example.com');   -- or match by name + DOB + licence
-- Note the returned id → :pilot_id for the queries below.
```

### 6.2 Produce the human-readable record (official format)
Preferred: the built-in **FOCA-format PDF export with audit appendix**
(`/api/export/logbook`, "Generate logbook PDF" in the app), signed in as — or acting
for — pilot X. It includes the change log and any post-48h deletions. Hand this to the
authority as the primary document.

### 6.3 Produce the complete raw record (for forensic/independent review)
Export every row tied to the pilot. These are append-only and immutable at the DB level
(`forbid_mutation` triggers), so what you extract is the full, unaltered history:

```sql
-- 1. The pilot (identity)
SELECT * FROM pilots WHERE id = :pilot_id;

-- 2. Every entry, including voided ones (voids are part of the audit trail)
SELECT * FROM flight_entries WHERE pilot_id = :pilot_id ORDER BY created_at;

-- 3. Every version (append-only snapshots: the full edit history)
SELECT v.* FROM flight_entry_versions v
JOIN flight_entries e ON e.id = v.entry_id
WHERE e.pilot_id = :pilot_id
ORDER BY v.entry_id, v.version_no;

-- 4. Every sign-off (Ed25519 signatures + the signer's public key)
SELECT s.* FROM signatures s
JOIN flight_entries e ON e.id = s.entry_id
WHERE e.pilot_id = :pilot_id
ORDER BY s.entry_id, s.version_no;

-- 5. The tamper-evident ledger slice for the pilot's entries
SELECT l.* FROM audit_ledger l
JOIN flight_entries e ON e.id = l.entry_id
WHERE e.pilot_id = :pilot_id
ORDER BY l.seq;

-- 6. Account events (MFA, sign-offs, lifecycle) — immutable
SELECT * FROM account_events WHERE user_id = :pilot_id ORDER BY created_at;
```
Deliver as CSV/JSON alongside the PDF. Keep the `content_hash`, `signature`,
`public_key`, `prev_hash`, and `record_hash` columns — they are the proof.

### 6.4 Prove authenticity — independently of Airdeck, Vercel and Supabase
Two cryptographic guarantees, both verifiable with standard tools:

1. **Each sign-off is a real Ed25519 signature** by the signer, over a fixed canonical
   payload `JSON.stringify([entryId, contentHash, signerId, signerRole, signedAt])`,
   using the **public key stored in the signature row**. Verifiable with OpenSSL,
   Node `node:crypto`, or Python `cryptography` — no app required. The signed
   `contentHash` must equal the SHA-256 (over canonical JSON) of the exact version
   content being attested. See `src/domain/signature.ts`.
2. **The whole logbook is a hash chain** (`audit_ledger`): `record_hash` chains via
   `prev_hash` from a genesis hash; any inserted/edited/removed event breaks the chain.
   See `src/domain/hashChain.ts` (`verifyChain`).

**Easiest authoritative method — use the repo's own verifiers** (they survive in Git,
so they outlive the service). From a clone, with the extracted rows:

```ts
import { verifySignature } from "./src/domain/signature";   // returns true/false
import { verifyChain } from "./src/domain/hashChain";        // checks seq + prev/record hashes
// For each signatures row: verifySignature({ entryId, contentHash, signerId,
//   signerRole, signedAt, signature, publicKey }) must be true.
// For the ordered audit_ledger rows: verifyChain(rows) must report { valid: true }.
```

Write the one-off driver that reads your CSV/JSON dump and calls these, and include its
output (all signatures valid, chain intact) in the evidence pack. Because verification
uses only the **public** keys and standard crypto, the authority's own experts can
reproduce it without any Airdeck credentials, servers, or vendor cooperation.

### 6.5 Chain of custody
- Record who extracted the data, when, from which database (host + point-in-time), and
  the SHA-256 of each delivered file.
- Note that `flight_entry_versions`, `signatures`, `audit_ledger` and `account_events`
  are **append-only and DB-trigger-protected**; the extract is the full history, with
  edits represented as additional versions and voids recorded explicitly (never deletions).
- Do **not** attempt to "clean up" or re-sign anything. The evidential value is in the
  untouched chain.

---

## 7. Quick reference — recovery priorities

| Lost | First action | Data at risk? |
|------|--------------|---------------|
| Vercel | Re-host Node app + static `web/dist`, repoint DNS (§3) | No |
| Supabase | Restore newest `pg_dump` to any Postgres, repoint `DATABASE_URL` (§4) | **Yes if no backup** |
| Claude | Nothing urgent; develop from the clone (§5) | No |
| `AUTH_SIGNING_MASTER_KEY` | Re-enrol signer keys; old signatures still verify (§0) | Partial (new sign-offs only) |
| A pilot's records requested | PDF export + raw SQL extract + independent crypto verification (§6) | No |

---

*Keep this file in Git **and** as an offline PDF stored with the vaulted secrets, so it
is readable even when the systems it describes are down. Review it whenever the stack,
hostnames, or secrets change.*
