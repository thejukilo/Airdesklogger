# Airdesk Flight School → Airdesk Logger — installation playbook

Step-by-step guide for rolling out the export integration on the Airdesk Flight
School (`*.airdeck.ch`) side. Reads top-to-bottom as a checklist.

Sibling document: `docs/integration-airdeck-fs.md` — the field-by-field mapping
reference. That doc is the contract; this doc is the procedure to ship it.

> **On mapping UIs.** This integration does **not** need an admin UI where
> tenants pin their columns to ours. The Airdesk FS schema is fixed across all
> tenants, so the mapping is hard-coded once in the transformer (see §3.2).
> The admin UI in §4 only configures things the FS schema doesn't carry today
> (balloon groups, multi-pilot flag) plus monitoring. Don't build a
> field-picker — it's overhead with no payoff and a footgun if a tenant
> mis-maps a regulatory field.

---

## Architecture in one picture

```
Albis Wings tenant (one of N flight schools)
┌──────────────────────────────────────────────────────────────────┐
│ flights.flight_end transitions NULL → NOT NULL  ─── trigger ──┐  │
│                                                                │  │
│ NOTIFY airdesk_push (flight_id, pilot_ids[])                  │  │
│         │                                                       │ │
│         ▼                                                       │ │
│ Push worker  ─── pulls token + label from airdesk_credentials ─┘ │
│         │                                                         │
│ Calls SOURCE_SQL → buildPayload() → POST https://log.airdeck.ch/.│
│         │                                                         │
│ Writes airdesk_pushes(flight_id, user_id, status, http_status,    │
│                       response, pushed_at)                        │
└──────────────────────────────────────────────────────────────────┘
                            │
                            ▼ (Authorization: Bearer airdesk_pat_…)
                airdesk.ch — Import API v1
```

---

## Phase 0 — Get a test pilot account

There is no separate staging host. Testing is done against
`https://log.airdeck.ch/api/import/v1` using `?dryRun=1` (validates without
writing) and a dedicated test pilot account whose logbook you can scrub between
runs.

Before you touch any code:

1. Create a test pilot account on `log.airdeck.ch` (or ask the Airdesk Logger
   team to provision one). Generate a PAT under **Account → Import tokens**.
   Confirm the three preferences match what you expect to be the default for
   your typical tenant (`UTC` source, `UTC` store, TMG filed as `AEROPLANE`).
   You can issue several PATs to cover other combinations later.
2. Smoke test with curl, from a developer laptop, to confirm the network path:

   ```bash
   curl -sS -X POST "https://log.airdeck.ch/api/import/v1/entries?dryRun=1" \
     -H "Authorization: Bearer airdesk_pat_TEST..." \
     -H "Content-Type: application/json" \
     -d '{
       "externalId": "SMOKE-0001",
       "sourceLabel": "Smoke Test",
       "kind": "FLIGHT",
       "entry": {
         "aircraft": { "registration": "HBPNT", "makeModelVariant": "Cessna 172S",
                       "engineClass": "SE", "multiPilot": false, "category": "AEROPLANE" },
         "legs": [{ "departurePlace": "LSZH", "departureTime": "2026-05-28T07:45:00Z",
                    "arrivalPlace": "LSGG",   "arrivalTime":   "2026-05-28T08:55:00Z" }],
         "picName": "SELF", "landings": { "day": 1, "night": 0 },
         "conditions": { "night": 0, "ifr": 0 },
         "function": { "primary": "PIC", "instructor": 0 },
         "remarks": ""
       }
     }'
   ```

   Expected response: `{ "status": "validated", "externalId": "SMOKE-0001" }`.
   Drop the `?dryRun=1` once you're ready to write real rows into the test
   pilot's logbook (you can void them later from the Logger SPA).
3. **Never use a real pilot's PAT for integration testing.** Even with
   `?dryRun=1`, the request shows up in their token's last-used timestamp and
   they may wonder what's going on.

If step 2 fails, **stop**. Network/proxy/firewall first — the rest of the
phases assume the path works.

---

## Phase 1 — Database migrations

Three new tables (credentials, push log, aircraft-type metadata columns) plus
one trigger, all in the `public` schema. Same schema for every tenant — no
per-tenant variations.

**Everything in this phase is idempotent — safe to copy-paste and re-run any
time.** Every `CREATE TABLE` is `if not exists`, every column add is `add
column if not exists`, and §1.1 carries a guarded migration that rewrites the
older `pat_encrypted` shape to the current `pat` shape if you ran an earlier
draft. You can run the whole phase end-to-end on a fresh database or on a
half-migrated one and end up in the same place.

### 1.1 Credentials

> **This block is idempotent and safe to re-run.** If you already ran the
> earlier draft that had `pat_encrypted`, run this again — the migration block
> at the bottom renames the column, clears any encrypted blobs, and aligns the
> table with the current model. After this, you can delete any `encryption.ts`
> / `AIRDESK_PAT_ENCRYPTION_KEY` you added on the Node side; the PAT is stored
> as plain text now and is its own credential. See §1.1.bis below for the
> Node-side cleanup.

```sql
create table if not exists public.airdesk_credentials (
  tenant_id            uuid        not null references public.tenants(id) on delete cascade,
  user_id              uuid        primary key references public.users(id) on delete cascade,
  pat                  text,                                      -- raw airdesk_pat_... value; NULL when revoked
  pat_prefix           text        not null,                      -- display only, e.g. "airdesk_pat_8f2a"
  source_label         text        not null default 'Airdeck',
  export_enabled       boolean     not null default false,
  last_used_at         timestamptz,
  last_status          int,
  consecutive_failures int         not null default 0,            -- circuit-breaker — auto-disables at >= 5
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  revoked_at           timestamptz
);

-- Migration from the earlier-draft schema: if the column is still called
-- pat_encrypted (was bytea or text holding an AES blob), rename it to pat,
-- make it nullable, and wipe any stored secrets so pilots are forced to
-- re-paste under the simpler model.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'airdesk_credentials'
       and column_name  = 'pat_encrypted'
  ) then
    execute 'alter table public.airdesk_credentials alter column pat_encrypted type text using pat_encrypted::text';
    execute 'alter table public.airdesk_credentials alter column pat_encrypted drop not null';
    execute 'alter table public.airdesk_credentials rename column pat_encrypted to pat';
    execute $u$update public.airdesk_credentials
                  set pat = null,
                      export_enabled = false,
                      revoked_at = coalesce(revoked_at, now()),
                      consecutive_failures = 0$u$;
  end if;
end $$;

create index if not exists airdesk_credentials_tenant_idx
  on public.airdesk_credentials (tenant_id);

alter table public.airdesk_credentials enable row level security;
```

**Notes**
- The PAT is the per-pilot credential — treat it like any stored secret:
  restrict who can `SELECT pat` from this table, redact it from any audit
  log or error report, and never echo it back to a UI. No application-level
  encryption is required; the PAT itself is the secret and it can be revoked
  instantly from Airdesk on compromise.
- `pat` is nullable: NULL means "no token saved" (initial state) and also
  "pilot disabled and forgot the token". A non-NULL `pat` with
  `export_enabled = false` means "paused but PAT still on file".
- `pat_prefix` is purely for the admin / pilot UI ("currently using
  `airdesk_pat_8f2a…`"); 16 chars max.
- `consecutive_failures` is for circuit-breaking: when ≥ 5, auto-flip
  `export_enabled = false` and email the pilot to re-paste their PAT.

### 1.1.bis Node-side cleanup if you already wrote encryption code

If you ran the earlier draft, you probably have an `encryption.ts` helper and
an `AIRDESK_PAT_ENCRYPTION_KEY` env var. Both can be deleted:

1. Delete the helper file (e.g. `src/lib/airdesk/encryption.ts`).
2. Remove `AIRDESK_PAT_ENCRYPTION_KEY` from your `.env`, `.env.example`, the
   secrets manager, and any CI / deploy configuration.
3. In the credentials repo, change the write path from
   `pat_encrypted: encrypt(raw, key)` to `pat: raw`, and the read path from
   `decrypt(row.pat_encrypted, key)` to `row.pat`.
4. Update any tests that mocked the encryption helper — they can just compare
   strings now.
5. Search the codebase for the env var name and the helper's exports to make
   sure nothing dangling references them: `grep -r AIRDESK_PAT_ENCRYPTION_KEY .`

### 1.2 Push status

```sql
create table if not exists public.airdesk_pushes (
  tenant_id    uuid        not null references public.tenants(id) on delete cascade,
  flight_id    uuid        not null references public.flights(id) on delete cascade,
  user_id      uuid        not null references public.users(id)   on delete cascade,
  status       text        not null,                                -- 'created' | 'duplicate' | 'rejected' | 'error' | 'source-incomplete'
  http_status  int         not null,                                -- 0 when the request never went out (e.g. source-incomplete)
  response     jsonb       not null default '{}'::jsonb,
  attempts     int         not null default 1,
  pushed_at    timestamptz not null default now(),
  primary key (flight_id, user_id)
);

create index if not exists airdesk_pushes_tenant_pushed_idx
  on public.airdesk_pushes (tenant_id, pushed_at desc);

create index if not exists airdesk_pushes_status_idx
  on public.airdesk_pushes (tenant_id, status)
  where status in ('rejected', 'error', 'source-incomplete');

alter table public.airdesk_pushes enable row level security;
```

- `UPSERT` on `(flight_id, user_id)`; the partial index speeds the admin
  dashboard's "recent failures" view.
- `source-incomplete` is for pre-flight rejections that never hit the network —
  e.g. a balloon flight whose `aircraft_types.airdesk_balloon_group` is NULL
  (see §4.1). The worker writes this status with `http_status = 0` so the
  admin sees the row in §4.3 and knows to fix the metadata.
- `on delete cascade` matches the credentials table: if you delete a flight,
  user, or tenant in the school, the push log row goes with them.

### 1.3 Aircraft-type metadata (the only mapping config)

Fields Airdesk needs but the FS schema doesn't carry today. Edited via the
admin UI in §4.

```sql
ALTER TABLE public.aircraft_types
  ADD COLUMN IF NOT EXISTS airdesk_engine_class text
    CHECK (airdesk_engine_class IN ('SE','ME')),
  ADD COLUMN IF NOT EXISTS airdesk_multi_pilot boolean,
  ADD COLUMN IF NOT EXISTS airdesk_balloon_group text
    CHECK (airdesk_balloon_group IN ('A','B','C','D')),
  ADD COLUMN IF NOT EXISTS airdesk_category_override text
    CHECK (airdesk_category_override IN ('AEROPLANE','HELICOPTER','SAILPLANE','BALLOON','TMG'));
```

`airdesk_category_override` is rarely used: only when the default mapping
(§3.1 of the integration guide) is wrong for an unusual type. Leave NULL
otherwise — the default mapping applies.

### 1.4 Trigger

```sql
CREATE OR REPLACE FUNCTION enqueue_airdesk_push() RETURNS trigger AS $$
BEGIN
  -- A flight transitioned from open to closed: fan out to any opted-in crew member.
  IF NEW.flight_end IS NOT NULL AND (OLD.flight_end IS NULL OR OLD.flight_end IS DISTINCT FROM NEW.flight_end) THEN
    PERFORM pg_notify('airdesk_push', NEW.id::text);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_flights_airdesk_push
  AFTER INSERT OR UPDATE OF flight_end ON flights
  FOR EACH ROW EXECUTE FUNCTION enqueue_airdesk_push();
```

Use `pg_notify` if you already have a worker listening on Postgres NOTIFY;
otherwise emit to your existing queue (BullMQ / SQS / whichever). Either way,
**don't push synchronously inside the trigger** — the trigger only enqueues.

---

## Phase 2 — Backend services

### 2.1 The transformer (`buildPayload`)

Copy the skeleton from `integration-airdeck-fs.md` §6 verbatim into your
codebase. Three helpers it depends on:

| Helper | Location | Notes |
|---|---|---|
| `mapAircraft(r)` | new file, e.g. `src/airdesk/mapAircraft.ts` | Uses §4.1 of the integration guide, applies any `aircraft_types.airdesk_*` overrides from §1.3. |
| `mapFunction(r)` | new file | §4.2 of the integration guide. |
| `legTimes(date, blockStart, blockEnd)` | new file | §4.3 of the integration guide. **No per-tenant variation.** Always sends UTC; the pilot's token decides whether to store as UTC or local. |
| `normaliseTrack(jsonb)` | new file | §4.4. Returns `null` for unparseable input; we drop the field rather than send garbage. |

The transformer is pure: input is a `SOURCE_SQL` row, output is a JSON
payload. **Unit-test it exhaustively** — every branch of every helper. This
is the only code in your codebase that touches the EASA logbook, so the bar
is high.

### 2.2 The worker

A single subscriber on `airdesk_push` (or the equivalent queue):

```ts
async function onFlightClosed(flightId: string, tenantId: string) {
  // Find all pilots on this flight who have an active credential.
  const { rows: pilots } = await db.query(
    `SELECT fp.user_id
       FROM flight_pilots fp
       JOIN airdesk_credentials c
         ON c.user_id = fp.user_id AND c.tenant_id = fp.tenant_id
      WHERE fp.flight_id = $1
        AND fp.tenant_id = $2
        AND c.export_enabled = true
        AND c.revoked_at IS NULL`,
    [flightId, tenantId],
  );

  for (const { user_id } of pilots) {
    await pushFlight(db, flightId, user_id, tenantId); // §6 of the integration guide
  }
}
```

**Backoff and retry policy**

| HTTP | Action |
|---|---|
| `200` / `201` | Persist `airdesk_pushes`, reset `consecutive_failures` to 0. Done. |
| `207` | Walk each `entries[].status`; same per-item handling. |
| `401` / `403` | Set `consecutive_failures = 999`, flip `export_enabled = false`, email the pilot to re-paste their PAT. Stop. |
| `422` | Persist the failure with the `issues` array, email the pilot a digest at most once per 24 h. **Do not retry** with the same body. |
| `429` | Sleep `retryAfterSeconds`, then retry once. If it 429s again, drop to the nightly catch-up. |
| `5xx` | Exponential backoff: 2 s, 4 s, 8 s, 16 s, 30 s. After the 5th failure, drop to nightly catch-up. |

### 2.3 Nightly catch-up cron

Runs once per night (e.g. 02:00 local). Picks up any flight that closed but
has no green `airdesk_pushes` row for an opted-in pilot, and replays it. This
is the safety net for trigger misses, queue drops, and transient 5xx failures.

```sql
SELECT f.id AS flight_id, c.user_id
  FROM flights f
  JOIN flight_pilots fp ON fp.flight_id = f.id
  JOIN airdesk_credentials c
    ON c.user_id = fp.user_id AND c.tenant_id = fp.tenant_id
  LEFT JOIN airdesk_pushes p
    ON p.flight_id = f.id AND p.user_id = c.user_id
 WHERE f.tenant_id = :tenant_id
   AND f.flight_end IS NOT NULL
   AND c.export_enabled = true
   AND c.revoked_at IS NULL
   AND (p.flight_id IS NULL OR p.status IN ('error','rejected') AND p.attempts < 10)
 ORDER BY f.flight_date DESC
 LIMIT 500;
```

Push each row through the same worker code path. The Airdesk API's
idempotency on `(token, externalId)` makes the retries safe.

---

## Phase 3 — The bits that are not configurable

These belong in code, **not** in an admin UI:

- The column-to-payload mapping in `integration-airdeck-fs.md` §3.
- The four conversions in §4 (aircraft class, function, time, track).
- The set of fields you send (`counters`, `provenance`, etc.) and the set
  you drop (`fuel_type`, `instructor_minutes`, ...).
- The set of attribute keys (`go_around`, etc.).

A tenant admin **cannot** change any of these from the UI. If a tenant needs a
mapping change, it's a code change in your codebase, reviewed and rolled out
through your normal release process, not a per-tenant config edit. (This is on
purpose: the FOCA logbook is regulated; a runtime field re-map is the kind of
mistake nobody catches until an audit.)

---

## Phase 4 — Admin UI

One page in the tenant admin panel, three sub-views.

### 4.1 Aircraft-type metadata

A table of `aircraft_types` with editable cells for the four Airdesk-specific
columns from §1.3. Pre-fill the defaults from §4.1 of the integration guide
(SEP → SE, single-pilot, etc.) and let the admin override per type. Save inline.

```
┌────────────────────────────────────────────────────────────────────────┐
│ Type                Engine    Multi-pilot   Balloon group   Cat. override│
├────────────────────────────────────────────────────────────────────────┤
│ Aquila A210 AT01    [SE  ▾]   [ ]           —               (default)   │
│ Diamond DA40        [SE  ▾]   [ ]           —               (default)   │
│ Diamond DA42        [ME  ▾]   [ ]           —               (default)   │
│ Cameron O-105       —         [ ]           [A  ▾]          (default)   │
│ Cameron Z-180       —         [ ]           [B  ▾]          (default)   │
│ EC135 (Rega)        [ME  ▾]   [✓]           —               (default)   │
└────────────────────────────────────────────────────────────────────────┘
```

`Balloon group` is required for balloon types — block the row save with a
toast if the admin leaves it NULL. **No balloon flight should export until
its type has a group assigned**; the worker should refuse to push and log a
`source-incomplete` error in `airdesk_pushes` so the admin sees it in §4.3.

### 4.2 Pilot opt-in monitor

A table of users with the export-relevant state:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Pilot               PAT       Enabled   Last sync          Recent errors │
├──────────────────────────────────────────────────────────────────────────┤
│ Epp Sascha          ✓ (8f2a…) ✓         2026-05-28 14:02   0             │
│ Beispiel Erika      ✓ (3c91…) ✓         2026-05-27 09:11   2 (last 422)  │
│ Müller Peter        —         —         never              —             │
└──────────────────────────────────────────────────────────────────────────┘
```

The admin **cannot see the PAT itself**, only its prefix. They can:
- Open the pilot's profile page in a new tab (§5).
- See aggregate error counts and click into the detail view in §4.3.
- Disable export for a pilot in case of incident (this just sets
  `export_enabled = false` server-side; doesn't touch the PAT).

The admin **cannot** create or paste a PAT on behalf of a pilot. PATs are
secrets only the pilot can see — they generate them on `log.airdeck.ch` and
paste them into their own profile.

### 4.3 Push dashboard

A reverse-chronological view of `airdesk_pushes`, filterable by status,
pilot, and date range. Per row, show the response body so the admin can see
exactly what Airdesk said. For 422 errors, the `issues` array is
human-readable; surface it verbatim in a collapsible section.

A small daily summary card at the top:

```
Today: 47 pushed   2 duplicated   1 rejected (422)   0 errors
This week: 312 pushed   8 duplicated   3 rejected   1 error (cleared)
```

---

## Phase 5 — Pilot UI

A new section on the pilot's profile page in the FS UI. Three controls.

### 5.1 Personal access token

```
┌──────────────────────────────────────────────────────────────────────┐
│ Auto-export to Airdesk Logger                                         │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│ 1. Generate a token at https://log.airdeck.ch → Account → Import tok. │
│    Choose your time-zone and TMG preferences when you create it.      │
│                                                                       │
│ 2. Paste it here:                                                     │
│    [ airdesk_pat_••••••••••••••••••••••••••• ]   [ Test connection ]  │
│                                                                       │
│ 3. Source label (shown next to imported flights in your Airdesk       │
│    logbook):                                                          │
│    [ Albis Wings                                                    ] │
│                                                                       │
│ [✓] Auto-export every closed flight                                   │
│                                                                       │
│ Last sync: 2026-05-28 14:02 (created)                                 │
│ Recent attempts:  ✓ ✓ ✓ ✓ ✓                                            │
│                                                                       │
│ [ Replace token ]   [ Disable & forget my token ]                     │
└──────────────────────────────────────────────────────────────────────┘
```

**Behavior**

- When the pilot pastes a PAT, the server calls `POST /entries?dryRun=1` with
  a minimal valid payload to verify the token works. Green pill if `validated`,
  red pill with the API's error message otherwise.
- On save: store the raw PAT in `airdesk_credentials.pat` and the first
  16 chars as `pat_prefix`. Never log the raw value.
- The textbox is **show-once**: after save the value masks to the prefix.
  "Replace token" wipes and re-prompts.
- "Disable & forget my token" sets `revoked_at = now()`, wipes `pat` to
  NULL, and stops future pushes.
- "Recent attempts" shows the last 10 `airdesk_pushes` rows for this user
  as little colored dots — green for created/duplicate, red for
  rejected/error. Hover for the response body.

### 5.2 What pilots see when something breaks

- **422** on a push → in-app banner "Airdesk Logger rejected your last flight
  because: <issue list>. Edit the flight to fix it, then close it again to
  retry." (The export trigger fires on close, so re-closing replays.)
- **401** on a push → "Your Airdesk Logger token has been revoked or has
  expired. Generate a new one and paste it above." Auto-disables export
  to prevent error spam.
- **5xx** on a push → silent; the nightly catch-up handles it.

### 5.3 Privacy and consent copy

Include this verbatim on the profile section, especially if you're in the EU
(GDPR Art. 13):

> By enabling auto-export you authorise this system to send the flight data
> from each closed flight you fly here to your personal Airdesk Logger
> account. We send the flight details, aircraft data, your function on the
> flight, the times, landings, counters, and any track recorded by the
> aircraft. We do **not** send your name, address, licence number, or any
> other profile data — Airdesk Logger already holds those, attached to the
> token. You can disable export at any time, and revoking the token on the
> Airdesk side stops imports immediately even if you forget to disable here.

---

## Phase 6 — Sandbox testing protocol

Before you point the worker at production:

1. **Pure-function unit tests for the transformer.** Every branch of every
   helper, including: cross-midnight flight, ZZZZ aerodromes, multi-pilot
   instructor flight, balloon flight with and without a group, helicopter
   with sling-load, TMG aircraft (confirm we send `category: "TMG"`),
   missing `flight_end`.
2. **Integration test against the sandbox** with `?dryRun=1` for every
   fixture in your test fleet. Any 422 fails the build.
3. **Idempotency test.** Run the same export job twice; the second run must
   be 100 % `200 duplicate`.
4. **Trigger test.** Open a fixture flight, close it, watch the worker pick
   it up within 5 s. Verify the `airdesk_pushes` row is `created`.
5. **Opt-out regression.** Set `export_enabled = false`, close a flight,
   confirm no push happens and no `airdesk_pushes` row appears.
6. **Token revocation drill.** Set the credential's `revoked_at = now()`,
   close a flight, confirm no push.
7. **PAT corrupt drill.** Mangle a credential's `pat` value (test env
   only — e.g. append a junk character). Close a flight, confirm the worker
   sees `401`, flips `export_enabled = false`, and the pilot sees the in-app
   warning.
8. **Bulk catch-up drill.** Disable the worker, close 20 flights, re-enable
   the nightly cron. Confirm all 20 land within one cron cycle.

If any of these regress on a later code change, fail your CI.

---

## Phase 7 — Production rollout

1. **Canary one tenant** for two weeks. Pick a small school with one or two
   active pilots. Watch the dashboard daily. Resolve any 422 by either
   fixing the transformer (most likely) or escalating a schema mismatch to
   Airdesk.
2. **Roll to all tenants** after the canary is clean for 14 consecutive
   days. There's no per-tenant code branch; the same migration and worker
   serve everyone.
3. **Backfill (optional).** If pilots want their historic flights pushed,
   provide an admin one-shot: `for each flight in last 12 months → push`.
   The `(token, externalId)` idempotency means it's safe to run more than
   once. Default the backfill window to **30 days** — anything longer
   should be opt-in per pilot, because they may have already manually
   logged the flights in Airdesk and a backfill would just generate noise
   (200 duplicate, but still 200s).
4. **Decommission the manual "export to Airdesk" PDF**, if one existed.

---

## Phase 8 — Operations

### Monitoring

| Metric | Alert threshold |
|---|---|
| `airdesk_pushes` rows with `status = 'error'` per hour | > 5 in the last hour, tenant-wide |
| Median push latency (close → 201) | > 10 s |
| `consecutive_failures` per credential | ≥ 5 (auto-disables; alert ops) |
| Nightly catch-up size | > 100 flights replayed in a single run (suggests the trigger is missing) |
| `airdesk.ch` reachability | 95th-percentile latency > 2 s for > 5 min |

### Logging

- Log the request **without** the `Authorization` header.
- Log the response status code and body.
- Don't log full payloads in production except at debug level — they contain
  pilot PII. Hash the `externalId` for redacted production logs.

### Runbook entries

- "How do I disable export for a tenant?" → run
  `UPDATE airdesk_credentials SET export_enabled = false WHERE tenant_id = ?`;
  notify their admin.
- "How do I retry a single failed push?" → run
  `DELETE FROM airdesk_pushes WHERE flight_id = ? AND user_id = ?`;
  next cron picks it up.
- "How do I force every pilot at a tenant to re-issue their PAT?" → run
  `UPDATE airdesk_credentials SET revoked_at = now(), pat = NULL, export_enabled = false WHERE tenant_id = ?`;
  email all affected pilots with the link to Airdesk → Account → Import tokens.
  Their old PATs continue to work on the Airdesk side until each pilot revokes
  them there too.

---

## Phase 9 — What you'll need from Airdesk Logger before shipping

Tick these before you call it done:

- [ ] Production base URL confirmed.
- [ ] Rate-limit ceiling confirmed (current spec: 100 req/min, 5 000/day per
      token — bump if a tenant has more than a few hundred active pilots).
- [ ] Status-page link to add to your incident runbook.
- [ ] A contact channel for 422 issue triage (some 422s will be schema-edge
      cases that need a contract amendment).
- [ ] OpenAPI changelog subscription so you find out about non-breaking
      additions.

---

## What this playbook deliberately does **not** include

- **A field-mapping UI.** The mapping is hard-coded; see the rationale at
  the top.
- **A per-tenant feature flag.** All tenants get the same code at the same
  time. Per-tenant gating would multiply the test matrix without earning
  anything.
- **A "preview before send" step.** The dry-run in §6 already covers this,
  pre-production. Adding a per-flight preview in production slows the close
  flow and adds a click pilots won't read.
- **Sign-off support.** Airdesk's sign-off flow is MFA-gated and tied to a
  drawn signature; the FS system has no way to satisfy it. Imported flights
  arrive unsigned and the pilot invites their instructor via Airdesk's
  email-link flow. The FS side's `instructor_signed_at` goes into
  `provenance` as information only.
