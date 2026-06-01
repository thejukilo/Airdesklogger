import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireUser, AuthError } from "../../src/http/auth.js";
import { getUserById } from "../../src/db/authRepository.js";
import { getStripe, StripeNotConfiguredError } from "../../src/billing/stripe.js";

/**
 * Open the Stripe-hosted Customer Portal where the pilot can update their
 * card, see invoices, and cancel the subscription. Stripe handles every UI
 * surface from this point until the portal redirects back, so the SPA owns
 * none of the form rendering.
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
    if (!user.stripeCustomerId) {
      res.status(400).json({ error: "No subscription yet. Subscribe first to manage it here." });
      return;
    }
    const stripe = getStripe();
    const origin = (req.headers.origin as string | undefined) ?? `https://${req.headers.host ?? "log.airdeck.ch"}`;
    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${origin}/account`,
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
    res.status(500).json({ error: err instanceof Error ? err.message : "Could not open the portal." });
  }
}
