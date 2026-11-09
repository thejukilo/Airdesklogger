# Staging environment

A full copy of the app for testing features before they reach production, with
its **own database and secrets** so it can never touch real pilot data.

## Topology

| Piece | Production | Staging |
|-------|-----------|---------|
| Git branch | `claude/easa-flight-log-app-TwTiM` (Vercel "Production Branch") | `staging` (+ any feature branch → Preview) |
| Vercel env | Production | Preview |
| Database | production Supabase project | **separate** `airdecklog-staging` Supabase project |
| URL | `log.airdeck.ch` | the Preview URL (optionally pinned to `staging.airdeck.ch`) |

The one rule that keeps them isolated: **production secrets are scoped to the
Production environment only, and the staging secrets (incl. the staging
`DATABASE_URL`) live in the Preview environment.** A Preview deploy therefore
migrates and writes to the staging database, never production.

## Environment variables (Vercel → Settings → Environments)

Set on **Preview** (staging values), separate from Production:

- `DATABASE_URL` — staging Supabase **transaction pooler** URL (port 6543)
- `PGPOOL_MAX=1`
- `AUTH_JWT_SECRET`, `AUTH_SIGNING_MASTER_KEY` — **different** values from prod
- `CRON_SECRET`, `ADMIN_BOOTSTRAP_TOKEN`
- `APP_BASE_URL` — the staging URL
- `STRIPE_*` — Stripe **test-mode** keys (only if testing billing)
- `SMTP_*` — a catch-all inbox, or leave unset (signing links are returned in the
  API response instead of emailed)

## Workflow

```
feature branch  ──▶  Vercel Preview (staging DB)  ──▶  merge to `staging`
                                                          ──▶  promote to the
                                                               production branch
```

One production deploy per production push; staging deploys only on staging pushes.

## First-time database setup

The schema is created automatically — every deploy runs `npm run migrate`
against whatever `DATABASE_URL` that environment holds. Reference data (airports,
aircraft, ICAO types, simulators) must be seeded once. From a clone of the repo,
pointed at the **staging** connection string:

```bash
export DATABASE_URL='<staging pooled URL>'   # session pooler (5432) is fine for this one-off
export PGPOOL_MAX=1
npm ci
npm run seed:airports
npm run seed:aircraft          # or: npm run seed:aircraft-europe
npm run seed:icao-types
npm run seed:simulators
npm run demo                   # optional: sample pilots + flights
```

(Seeders read bundled CSVs under `src/data/`, so no external URLs are needed.)
Alternatively, seed via the deployed app's admin endpoints
(`/api/admin/seed-*`) after bootstrapping an admin with `ADMIN_BOOTSTRAP_TOKEN`.

## Verify isolation

Register a test pilot on the staging URL and confirm the row appears in the
**staging** Supabase `pilots` table and **not** in production.

> Never load real pilot data into staging — use the seed/demo scripts, which
> generate synthetic data.
