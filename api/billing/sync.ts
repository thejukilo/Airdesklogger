import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireUser, AuthError } from "../../src/http/auth.js";
import { getUserById } from "../../src/db/authRepository.js";
import { applyStripeSubscription } from "../../src/db/subscriptionRepository.js";
import { getStripe, StripeNotConfiguredError } from "../../src/billing/stripe.js";

/**
 * Reconcile the signed-in pilot's subscription state directly from Stripe,
 * without waiting for a webhook.
 *
 * The webhook (api/billing/webhook.ts) is still the canonical path for ongoing
 * lifecycle events (renewals, cancellations, failed payments), but relying on
 * it alone means a missed, delayed or not-yet-configured webhook leaves a paid
 * account stuck in `trialing`/`read_only`. This endpoint reads the customer's
 * subscriptions straight from Stripe and applies the governing one with the
 * exact same logic the webhook uses.
 *
 * Called by the post-checkout success page (so a payment activates the account
 * immediately) and by a "Refresh status" button on the Account page.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }
  try {
    const claims = await requireUser(req);
    const user = await getUserById(claims.sub);
    if (!user) {
      res.status(404).json({ error: "Account not found." });
      return;
    }
    // No Stripe customer means this account never started a checkout; there is
    // nothing to reconcile, which is a normal state, not an error.
    if (!user.stripeCustomerId) {
      res.status(200).json({ state: null, synced: false });
      return;
    }

    const stripe = getStripe();
    const subs = await stripe.subscriptions.list({
      customer: user.stripeCustomerId,
      status: "all",
      limit: 10,
    });

    // Prefer a subscription that currently governs access over a cancelled or
    // expired one; otherwise fall back to the most recent (the list is newest
    // first).
    const active = ["active", "trialing", "past_due", "unpaid", "incomplete"];
    const governing = subs.data.find((s) => active.includes(s.status)) ?? subs.data[0];
    if (!governing) {
      res.status(200).json({ state: null, synced: false });
      return;
    }

    const state = await applyStripeSubscription(
      user.id,
      governing as unknown as Parameters<typeof applyStripeSubscription>[1],
    );
    res.status(200).json({ state, synced: true });
  } catch (err) {
    if (err instanceof StripeNotConfiguredError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : "Could not sync subscription." });
  }
}
