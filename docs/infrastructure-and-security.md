# Airdesk Logger — Infrastructure & Security Description

**Purpose.** This document describes, for the FOCA technical expert, how and
where Airdesk Logger stores and protects flight-logbook data, what cryptography
it uses, and how a licence holder's records are produced for the authority on
request. It is written to be verifiable: every technical claim cites the file in
the source repository that implements it.

**Status of facts.** Statements about *code behaviour* are taken directly from
the source and are exact. Statements about *the live production deployment*
(hosting region, backup retention, the production domain, sub-processors) depend
on operational configuration and are marked **[confirm]** where they must be
checked against the actual Supabase/Vercel project before this document is
handed over. Nothing in this document contains secrets or credentials.

Last reviewed against source: **2026-10-19**.

---

## 1. Architecture at a glance

| Layer | Technology | Hosting | Notes |
|---|---|---|---|
| Web client | React 18 SPA (Vite build) | Vercel static CDN | No data stored on device beyond the session token in memory |
| Application / API | Node.js serverless functions (`api/**.ts`) | Vercel | Stateless; one function per request |
| Database | PostgreSQL | Supabase (managed) | Single source of truth for all records |
| Email | SMTP (nodemailer) | **[confirm provider]** | Sign-off invitations, verification, password reset only |

The three layers are separate. The client holds no durable copy of the logbook;
the application servers are stateless; all state lives in PostgreSQL and in the
holder's signed session token.

---

## 2. Database

| Property | Value |
|---|---|
| Engine | PostgreSQL |
| Hosting | Supabase (managed PostgreSQL) |
| Region / data residency | Switzerland / EU **[confirm exact region in the Supabase project settings]** |
| Driver | `pg` 8.x from a serverless-sized connection pool (`src/db/pool.ts`) |
| Connection | Via `DATABASE_URL`; production points at a pooled endpoint (pgbouncer) |
| Schema | Single idempotent file, `src/db/schema.sql`, applied through Supabase |

**Transport to the database.** For any non-local connection the pool enables
TLS. The provider certificate is currently **not** verified
(`ssl: { rejectUnauthorized: false }`, `src/db/pool.ts:25–30`) — this is the
common managed-Postgres default and the traffic is still encrypted, but the
server certificate is not pinned or validated. Certificate pinning can be
enabled without code change to the data model; see §15 (hardening items).

**Access to the database.** Application access is through the pooled service
credential in `DATABASE_URL`. Direct human access is limited to the Supabase
project owners. The application never exposes raw SQL to end users; every write
goes through the domain/validation layer (§9).

---

## 3. Application servers

| Property | Value |
|---|---|
| Runtime | Node.js (Vercel default runtime) |
| Form | Serverless functions, one per `api/**.ts` file |
| Hosting | Vercel |
| Region | **[confirm Vercel function region; align with the database region to keep data in-jurisdiction]** |
| State | None. Each invocation is stateless; session state is the holder's JWT + the database |
| Background workers | None. The import path processes synchronously, max 200 items per request |

Because functions are stateless and short-lived, there is no server-side session
store to breach, and a cold start carries no residual data.

---

## 4. Data in transit (transport security)

- **HTTPS only**, with HSTS on the production domain (Vercel default).
- Session authentication uses a **Bearer JWT** in the `Authorization` header —
  **no cookies**, therefore **no CSRF surface** (`src/auth/tokens.ts`,
  submission doc §13).
- The import API is bearer-token only, no cookies.
- **CORS**: same-origin only by default; no credentialed cross-origin paths.
- Database traffic is TLS-encrypted (certificate not yet verified — §2).

---

## 5. Data at rest (encryption)

Airdesk Logger encrypts the three sensitive secret materials independently of
the database, so that a database leak alone exposes none of them in usable form.

| Item | Technology | Detail | Source |
|---|---|---|---|
| Account passwords | **Argon2id** (WASM, OWASP params) | 3 iterations, ~19 MiB memory, parallelism 1, 32-byte output, 16-byte random salt; cost encoded in the stored hash. Min password length 12. Cleartext never stored or logged. | `src/auth/passwords.ts` |
| Second-factor (TOTP) secret | **AES-256-GCM** wrapped | Stored only in wrapped form (`mfa_secret_wrapped`); unwrapped in memory only to verify a code. | `src/db/authRepository.ts`, `src/auth/signingKeys.ts` |
| Signer private keys | **AES-256-GCM** wrapped | 12-byte random IV, GCM authentication tag, versioned self-describing string. Unwrapped only at the moment of signing, after the signer passes the second factor. | `src/auth/signingKeys.ts:27–43` |
| Public signing keys | Not secret | Stored in clear (PEM SPKI) and retained forever so historical signatures stay verifiable. | `src/db/authRepository.ts` |
| Database storage (disk) | Provider-managed encryption at rest | Supabase encrypts storage and backups at rest. **[confirm in the Supabase project]** | — |

**Master key.** The AES-256-GCM wrapping key (`AUTH_SIGNING_MASTER_KEY`, a
32-byte value supplied as 64 hex characters) is held in the application
environment, **not** in the database (`src/config.ts:20–26`). A database leak
therefore cannot unwrap any private key or TOTP secret.

---

## 6. Cryptographic sign-off (certification of entries)

When an instructor, examiner, ATO/DTO, supervising PIC or airport certifies an
entry, the act is bound cryptographically, not merely recorded.

| Property | Value |
|---|---|
| Algorithm | **Ed25519** (RFC 8032), Node.js built-in `crypto` — no third-party crypto dependency |
| Keys | One key pair per signer. Public key kept forever; private key wrapped (AES-256-GCM) |
| Signed payload | Canonical JSON array `[entryId, contentHash, signerId, signerRole, signedAt]`, fixed field order |
| Binding | The signature commits to the **exact content hash** of the version signed; substituting any other version breaks verification |
| Lock | A valid signature flips `flight_entries.locked = true`; a database trigger then refuses any further version of that entry |
| Stored with | The signer's public key *as it was at signing time*, so verification never depends on the signer's current key |
| Second factor | The signer must pass TOTP step-up at the moment of signing |
| Drawn signature | A hand-drawn signature image is also captured and shown on the PDF; the Ed25519 signature is the cryptographic binding |

Source: `src/domain/signature.ts`, `src/auth/signingKeys.ts`,
`src/db/schema.sql` (lock-on-sign trigger).

---

## 7. Tamper-evident audit trail

Every mutation of any entry — CREATE, MODIFY (new version), SIGN, VOID — appends
one record to a single global **hash-chained ledger** (`audit_ledger`).

| Field | Meaning |
|---|---|
| `seq` | Contiguous sequence number (genesis = 0) |
| `prevHash` | The previous record's hash (genesis predecessor = 64 zeros) |
| `eventType` | CREATE / MODIFY / SIGN / VOID |
| `entryId` | The entry affected |
| `payloadHash` | SHA-256 content hash of the version/event attested |
| `actorId` | Who performed the action |
| `recordedAt` | Server UTC instant |
| `recordHash` | SHA-256 over the canonical JSON of all the above |

- **Chaining**: each record's `prevHash` is the prior record's `recordHash`.
  Altering or removing any past record changes every subsequent record's hash,
  so tampering is detectable.
- **Canonical JSON**: object keys are recursively sorted so the hash is stable
  and reproducible (`src/domain/hashChain.ts:38–52`).
- **Serialised append**: records are appended inside a transaction holding a
  Postgres advisory lock, so sequence numbers and links cannot race.
- **Offline verification**: `verifyChain()` is a pure function; given an export
  of the ledger, an auditor can re-verify the whole chain **without trusting the
  operator** and is told the first record where any break occurs.
- **Immutability at the database**: append-only is also enforced by per-table
  Postgres triggers, independent of the application (`src/db/schema.sql`).

An administrator endpoint, `GET /api/audit/verify`, recomputes the chain and
reports whether it is intact and, if not, where it broke (`api/audit/verify.ts`).

---

## 8. Authentication, authorisation, identity

| Control | Implementation |
|---|---|
| Session tokens | JWT **HS256** (`jose`), 8-hour expiry, issuer/audience pinned, secret ≥32 chars from `AUTH_JWT_SECRET`. Carries user id, roles, email (`src/auth/tokens.ts`) |
| Second factor | **TOTP** (RFC 6238 / RFC 4226), 6 digits, 30-second step, ±1 step tolerance, 160-bit secret, constant-time comparison (`src/auth/totp.ts`). Verified against the official RFC test vectors |
| Password hashing | Argon2id (§5) |
| Roles | Stored in `pilot_roles`, resolved at token-issue time; holder, instructor, examiner, supervising PIC, ATO/DTO/HOT, airport, admin (`src/auth/roles.ts`) |
| Admin scope | Admin can seed reference data and perform support tasks but **cannot read holder entries** |
| Identity binding | Forename, surname, date of birth and address are required at registration and lock once a flight is logged; login is refused until the email address is verified (FOCA 2.1.3). **Note:** the licence number is self-entered and not cross-checked against an authority registry — see §15 |

---

## 9. Input validation and immutability enforcement

- Every external boundary (web form, import API, sign-off) parses through **Zod**
  schemas before any domain logic runs.
- The compliance logic (`src/domain/**`) is pure and independently unit-tested
  (158 unit tests plus integration suites).
- **Immutability** is enforced in two layers: the application never edits in
  place (it appends a new version), and Postgres triggers independently forbid
  overwriting a version and forbid any new version of a locked (signed) entry.
- Database-level validation beyond immutability is currently limited to those
  triggers and a few CHECK constraints; the heavy validation is in the
  application layer (see §15).

---

## 10. How records are retrieved when an authority asks

Airdesk Logger does **not** give the authority a direct login or a pull API into
the live database. The retrieval model is **holder-initiated export**, which is
the form FOCA expects for submission:

1. **The holder exports their logbook** — `GET /api/export/logbook`,
   authenticated and scoped to the holder's own account, with optional
   `from`/`to` date filtering (`api/export/logbook.ts`). The result is a PDF.
2. **The PDF is complete and self-contained**, carrying:
   - the AMC1 FCL.050 grid (category-specific columns, per-page totals,
     brought-forward / carried-forward);
   - a **sign-off appendix** — one block per signed entry with signer name,
     role, licence number, place, time, and the drawn-signature image. Each
     signature is **re-verified at export time** and marked valid or INVALID;
   - an **attributes appendix** (structured, e.g. HESLO cycles), and
   - a **change-log appendix** — every post-48-hour amendment with a full
     before/after snapshot of the row, and every post-48-hour deletion
     (FOCA 2.3.7).
3. **The audit ledger can be verified offline.** Given a database export of
   `audit_ledger` and `signatures`, `verifyChain()` and the per-signature
   Ed25519 verification let an auditor independently confirm the record's
   integrity without trusting the operator (§7).
4. **The holder keeps a portable copy.** Because the export is a PDF the holder
   downloads, the record survives independently of the service (§11).

In short: the authority receives a signed, self-verifying PDF from the holder;
the cryptographic ledger is available for independent offline verification if a
deeper audit is required.

---

## 11. Backups, disaster recovery, business continuity

- **Backups**: Supabase provides encrypted daily backups with point-in-time
  recovery within the configured window. **[confirm retention window]**
- **Reference data** is re-seedable from the repository (`src/db/seed*.ts`).
- **Source of truth for the code** is the Git repository on GitHub; frontend
  assets are immutable per build.
- **Cryptographic recoverability**: the ledger and signatures are self-verifying,
  so integrity can be re-established from any database export (§7).
- **Record longevity / vendor independence**: the holder's on-demand PDF export
  is a portable, self-contained copy that outlives the service. A single hosting
  region is used today (no multi-region failover), and an account-closure /
  data-handover flow is pending — see §15.

---

## 12. Privacy & data residency (GDPR posture)

| Data | Handling |
|---|---|
| Name, DOB, address, licence number | On the holder's own row; visible only to the holder, to a signer at sign-time (a subset), and to admin on a support path. Identity fields lock once a flight is logged |
| Password | Argon2id hash only |
| TOTP secret | Encrypted at rest (§5) |
| Signer private key | AES-256-GCM wrapped (§5) |
| Email | Verified at sign-up; used only for sign-off invitations, verification, password reset |
| Flight content | Holder-only by default; a countersigner sees only the entry they are asked to sign |
| Imported entries | Identity (name, DOB) is never accepted from an import payload |

Data-subject rights: **access** via the PDF export; **rectification** via the
edit/amend flow (logged after 48 h); **erasure** via voiding (the immutable
audit trail is retained as the regulation requires). Region: CH/EU **[confirm]**.

---

## 13. Logging & monitoring

| Stream | Where |
|---|---|
| Entry audit (who changed what, when) | `audit_ledger` (hash-chained, append-only) — the regulatory source of truth |
| Account events (login, MFA step-up, reset) | `account_events` |
| Import attempts | `import_tokens.last_used_at`, `entry_imports` |
| Application logs | Vercel function logs — operational aid only, no PII in production |

---

## 14. Secrets & key management

| Secret | Purpose | Storage | Rotation |
|---|---|---|---|
| `AUTH_JWT_SECRET` | Signs session JWTs (HS256), ≥32 chars | Application environment | Set a new value; all sessions invalidate |
| `AUTH_SIGNING_MASTER_KEY` | Wraps signer private keys & TOTP secrets (AES-256-GCM), 64 hex | Application environment, never in DB | Re-wrap all stored keys under the new master key (one-shot migration) |
| `DATABASE_URL` | Postgres connection (pooled) | Application environment | Rotate the DB credential at the provider |
| `ADMIN_BOOTSTRAP_TOKEN` | One-shot first-admin bootstrap | Application environment | Operational only; not in the regulatory critical path |
| SMTP credentials | Transactional email | Application environment | Rotate at the provider |

Secrets are supplied by the environment and validated at first use; a
misconfigured deployment fails loudly rather than running insecurely
(`src/config.ts`).

---

## 15. Trust model & known hardening items (stated honestly)

These are the points a technical reviewer is most likely to probe. They are
listed here deliberately rather than omitted.

1. **Database TLS certificate not verified.** Traffic to Postgres is encrypted,
   but the provider certificate is not currently pinned/validated
   (`src/db/pool.ts`). Enabling strict verification (CA pinning) is a
   configuration change. **Recommended before submission.**
2. **Operator trust for the audit ledger.** The hash chain proves internal
   consistency and detects alteration *relative to an independently held
   copy*. An operator with full database control could in principle rebuild the
   entire chain from scratch and it would still self-verify. Mitigation options:
   periodic signed exports held by the holder and/or the authority, or anchoring
   the chain head to an external witness. **No external anchor exists today.**
3. **Operator trust for signing.** Whoever holds `AUTH_SIGNING_MASTER_KEY` can
   unwrap a signer's private key and could forge a sign-off. Access to the
   environment is therefore security-critical; a hardware KMS / HSM for the
   master key is a possible future step.
4. **Database-level validation.** Strong validation is in the application layer;
   the database enforces immutability and a few constraints only (§9). Direct DB
   writes bypassing the application are not fully constrained (FOCA 2.3.6 is
   tracked as PARTIAL).
5. **Reference-data completeness.** Aerodrome/aircraft/FSTD reference tables are
   seeded from curated sources; the operational load of the full datasets is
   pending (FOCA 2.3.2 PARTIAL). The bundled FSTD list in particular is
   demonstration data and must be replaced with the authoritative EASA list
   before go-live.
6. **Licence-number verification.** The licence number is self-entered and not
   cross-checked against an authority registry.
7. **Single hosting region; account-closure flow pending** (§11, §12).

---

## 16. Items to confirm before handing this document to FOCA

- [ ] Exact Supabase **region** and that it matches the intended data residency.
- [ ] Exact Vercel function **region**.
- [ ] Backup **retention window** and point-in-time-recovery window.
- [ ] Production **domain name** and confirmation HSTS is active there.
- [ ] Email/SMTP **provider** and its data-processing terms.
- [ ] List of **sub-processors** (Supabase, Vercel, email provider) for the GDPR record.
- [ ] Whether database-TLS **certificate verification** has been enabled (§15.1).
- [ ] That production reference data has been **loaded** (not the demo seed) (§15.5).

---

## Appendix A — Source references

| Concern | File |
|---|---|
| Connection pool / DB TLS | `src/db/pool.ts` |
| Schema, immutability & lock triggers | `src/db/schema.sql` |
| Password hashing (Argon2id) | `src/auth/passwords.ts` |
| TOTP second factor | `src/auth/totp.ts` |
| Session JWT | `src/auth/tokens.ts` |
| Secret loading / validation | `src/config.ts` |
| Private-key / TOTP wrapping (AES-256-GCM) | `src/auth/signingKeys.ts` |
| Ed25519 sign-off | `src/domain/signature.ts` |
| Hash-chained audit ledger | `src/domain/hashChain.ts` |
| Logbook PDF export (authority-facing) | `api/export/logbook.ts`, `src/pdf/logbook.ts` |
| Offline ledger verification endpoint | `api/audit/verify.ts` |
| Roles & authorisation | `src/auth/roles.ts` |

## Appendix B — Cryptography summary

| Use | Primitive |
|---|---|
| Passwords | Argon2id (3 iters, ~19 MiB, p=1, 32-byte out) |
| Secret wrapping (signer keys, TOTP) | AES-256-GCM |
| Entry sign-off | Ed25519 (RFC 8032) |
| Audit chain & content hashing | SHA-256 over canonical JSON |
| Session tokens | JWT HS256 |
| Second factor | TOTP (RFC 6238 / RFC 4226, HMAC-SHA-1) |
| Transport | TLS (HTTPS/HSTS); DB TLS without cert verification (§15.1) |
