import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { Stripe as StripeNs } from "stripe";
import { getStripe, getStripeConfig, StripeNotConfiguredError } from "../../src/billing/stripe.js";
import {
  applyStripeSubscription,
  findUserByStripeCustomer,
  markStripeEventProcessed,
  recordStripeEvent,
} from "../../src/db/subscriptionRepository.js";

/**
 * Stripe webhook endpoint.
 *
 * Body parsing is disabled so we can hand the exact bytes to
 * Stripe.webhooks.constructEvent for signature verification - a parsed body
 * would have its key order and whitespace altered, breaking the signature.
 *
 * The event is recorded in stripe_events (idempotency: a Stripe retry of
 * the same event_id short-circuits to a 200), the subscription state on
 * the holder row is updated from the event, and the row is finally marked
 * processed. Any thrown error during processing flips the row's result
 * column to 'error' but the handler still returns 5xx so Stripe retries.
 */
export const config = {
  api: { bodyParser: false },
};

async function readRawBody(req: VercelRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }
  let cfg;
  try {
    cfg = getStripeConfig();
  } catch (err) {
    if (err instanceof StripeNotConfiguredError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
  if (!cfg.webhookSecret) {
    res.status(503).json({ error: "STRIPE_WEBHOOK_SECRET is not configured." });
    return;
  }
  const sigHeader = req.headers["stripe-signature"];
  const signature = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
  if (!signature) {
    res.status(400).json({ error: "Missing Stripe-Signature header." });
    return;
  }

  const raw = await readRawBody(req);
  const stripe = getStripe();
  let event: StripeNs.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, signature, cfg.webhookSecret);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? `Webhook signature verification failed: ${err.message}` : "Bad signature." });
    return;
  }

  const userId = await resolveUserId(event);
  // Idempotency: if Stripe has retried this event, we recorded it already.
  const fresh = await recordStripeEvent(event.id, event.type, userId, event as unknown);
  if (!fresh) {
    res.status(200).json({ duplicate: true });
    return;
  }

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as StripeNs.Subscription;
        if (!userId) break; // can't apply without a known holder
        await applyStripeSubscription(userId, sub as unknown as Parameters<typeof applyStripeSubscription>[1]);
        break;
      }
      case "invoice.paid":
      case "invoice.payment_failed": {
        // The subsequent subscription.updated event carries the canonical
        // status; we don't need to mirror invoice-level state. Recorded
        // for audit only.
        break;
      }
      default:
        // Unhandled events are still recorded for audit; the handler returns 200.
        break;
    }
    await markStripeEventProcessed(event.id, "applied");
    res.status(200).json({ received: true });
  } catch (err) {
    await markStripeEventProcessed(event.id, "error");
    // Surface 5xx so Stripe retries; the row is now marked error and ops can
    // inspect stripe_events.payload to see what happened.
    res.status(500).json({ error: err instanceof Error ? err.message : "Webhook processing failed." });
  }
}

/**
 * Map an incoming Stripe event back to a pilot row via the customer id that
 * lives on every event of interest. We persist the customer id on first
 * checkout, so by the time the first subscription event arrives the lookup
 * has the row to update.
 */
async function resolveUserId(event: StripeNs.Event): Promise<string | null> {
  const obj = event.data.object as unknown as { customer?: string | { id?: string } };
  const customerId = typeof obj.customer === "string" ? obj.customer : obj.customer?.id;
  if (!customerId) return null;
  return findUserByStripeCustomer(customerId);
}
