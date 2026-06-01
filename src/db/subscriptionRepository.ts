/**
 * Subscription / trial state.
 *
 * Single plan: CHF 5.99/month. New accounts start in `trialing` for 3 days,
 * after which a daily cron flips them to `read_only` unless they have
 * subscribed. Payment integration (Stripe / Datatrans) lands later; for now
 * the state machine only covers the free-trial side, which is enough to gate
 * writes and surface the countdown banner.
 *
 * States that allow writes (logging flights, signing off, exporting PDF,
 * accepting imports): trialing, active, past_due, cancelled-before-period-end.
 * Read-only blocks every write but never blocks reads or voiding existing
 * entries; the holder can always clean up and view their own data.
 */

import { getPool } from "./pool.js";

export type SubscriptionState =
  | "trialing"
  | "active"
  | "past_due"
  | "cancelled"
  | "read_only";

export interface SubscriptionSnapshot {
  state: SubscriptionState;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  subscriptionStartedAt: string | null;
  subscriptionPeriodEnd: string | null;
  /** Convenience: minutes from now until the trial ends. Negative means past. Null when not trialing. */
  trialMinutesRemaining: number | null;
}

function snapshotFromRow(r: {
  subscription_state: string;
  trial_started_at: string | null;
  trial_ends_at: string | null;
  subscription_started_at: string | null;
  subscription_period_end: string | null;
}): SubscriptionSnapshot {
  const state = r.subscription_state as SubscriptionState;
  const trialEndsAt = r.trial_ends_at ? new Date(r.trial_ends_at).toISOString() : null;
  const minutes = trialEndsAt && state === "trialing"
    ? Math.round((new Date(trialEndsAt).getTime() - Date.now()) / 60000)
    : null;
  return {
    state,
    trialStartedAt: r.trial_started_at ? new Date(r.trial_started_at).toISOString() : null,
    trialEndsAt,
    subscriptionStartedAt: r.subscription_started_at ? new Date(r.subscription_started_at).toISOString() : null,
    subscriptionPeriodEnd: r.subscription_period_end ? new Date(r.subscription_period_end).toISOString() : null,
    trialMinutesRemaining: minutes,
  };
}

const COLS =
  "subscription_state, trial_started_at, trial_ends_at, subscription_started_at, subscription_period_end";

export async function getSubscription(userId: string): Promise<SubscriptionSnapshot | null> {
  const { rows } = await getPool().query(
    `SELECT ${COLS} FROM pilots WHERE id = $1`,
    [userId],
  );
  return rows[0] ? snapshotFromRow(rows[0]) : null;
}

/**
 * Capability check used by every write endpoint. The states that allow writes
 * are kept in one place so adding new endpoints can't accidentally bypass the
 * trial gate. read_only is the only state that blocks writes today; once the
 * payment integration lands, past_due will keep writes during the 14-day
 * grace and cancelled will keep writes until the period ends.
 */
export function canWrite(state: SubscriptionState): boolean {
  return state === "trialing" || state === "active" || state === "past_due" || state === "cancelled";
}

export async function userCanWrite(userId: string): Promise<boolean> {
  const s = await getSubscription(userId);
  return s ? canWrite(s.state) : false;
}

/**
 * Daily cron: any trial whose trial_ends_at has passed and which hasn't moved
 * to active flips to read_only. Returns the count flipped so the cron handler
 * can log it. Idempotent - re-running on a day with nothing to expire is a
 * no-op.
 */
export async function expireFinishedTrials(): Promise<number> {
  const { rowCount } = await getPool().query(
    `UPDATE pilots
        SET subscription_state = 'read_only'
      WHERE subscription_state = 'trialing'
        AND trial_ends_at IS NOT NULL
        AND trial_ends_at < now()`,
  );
  return rowCount ?? 0;
}

/**
 * Admin overview row, one per pilot, joined with a count of flights and the
 * last activity. Sorted by signup date descending so new accounts are at the
 * top of the admin list.
 */
export interface AdminUserRow {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  emailVerified: boolean;
  mfaEnabled: boolean;
  roles: string[];
  subscription: SubscriptionSnapshot;
  flightCount: number;
  lastFlightAt: string | null;
  lastLoginAt: string | null;
}

export async function listUsersForAdmin(): Promise<AdminUserRow[]> {
  const { rows } = await getPool().query(
    `SELECT
        p.id, p.email, p.name, p.created_at, p.email_verified, p.mfa_enabled, p.roles,
        p.subscription_state, p.trial_started_at, p.trial_ends_at,
        p.subscription_started_at, p.subscription_period_end,
        (SELECT count(*) FROM flight_entries fe WHERE fe.pilot_id = p.id AND fe.voided = false) AS flight_count,
        (SELECT max(v.content->'columns'->>'date') FROM flight_entry_versions v
           JOIN flight_entries fe ON fe.id = v.entry_id
          WHERE fe.pilot_id = p.id AND fe.voided = false) AS last_flight_at,
        (SELECT max(created_at) FROM account_events ae
          WHERE ae.user_id = p.id AND ae.event_type = 'LOGIN_SUCCESS') AS last_login_at
       FROM pilots p
      ORDER BY p.created_at DESC NULLS LAST`,
  );
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    createdAt: new Date(r.created_at).toISOString(),
    emailVerified: Boolean(r.email_verified),
    mfaEnabled: Boolean(r.mfa_enabled),
    roles: r.roles ?? [],
    subscription: snapshotFromRow(r),
    flightCount: Number(r.flight_count ?? 0),
    lastFlightAt: r.last_flight_at ?? null,
    lastLoginAt: r.last_login_at ? new Date(r.last_login_at).toISOString() : null,
  }));
}
