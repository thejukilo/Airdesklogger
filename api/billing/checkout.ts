import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireUser, AuthError } from "../../src/http/auth.js";
import { getUserById } from "../../src/db/authRepository.js";
import { setStripeIds } from "../../src/db/subscriptionRepository.js";
import { getStripe, getStripeConfig, StripeNotConfiguredError } from "../../src/billing/stripe.js";

/**
 * Open a Stripe Checkout Session for the signed-in pilot. Returns the URL
 * to redirect the browser to. The session is in `subscription` mode bound
 * to the single CHF 5.99/month price; Stripe creates the Customer record
 * on demand if we don't have one yet for this pilot, and pushes the
 * customer id back in the success webhook.
 *
 * The pilot is redirected back to /billing/success or /billing/cancelled
 * on the SPA depending on the outcome; the success page polls /api/account
 * a couple of times to pick up the new subscription_state once the
 * webhook lands.
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
    const stripe = getStripe();
    const { priceId } = getStripeConfig();

    // Re-use the existing Customer record when we have one, so renewals,
    // updates and the Customer Portal all attach to the same Stripe entity.
    let customerId = user.stripeCustomerId ?? null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        ...(user.email ? { email: user.email } : {}),
        name: user.name,
        metadata: { pilotId: user.id },
      });
      customerId = customer.id;
      await setStripeIds(user.id, { customerId });
    }

    const origin = (req.headers.origin as string | undefined) ?? `https://${req.headers.host ?? "log.airdeck.ch"}`;
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/billing/cancelled`,
      allow_promotion_codes: true,
      // payment_method_types is intentionally omitted so Stripe shows every
      // method enabled on the account (cards, TWINT if available, PayPal, ...).
      billing_address_collection: "auto",
      automatic_tax: { enabled: false },
      metadata: { pilotId: user.id },
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    if (err instanceof StripeNotConfiguredError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : "Could not open checkout." });
  }
}
