/**
 * Stripe client and config helpers.
 *
 * The Stripe SDK is created lazily from the env so that a request that does
 * not need Stripe doesn't pay the cost of pulling in the library, and so
 * that handlers can render a clear "billing not configured" 503 instead of
 * crashing when STRIPE_SECRET_KEY is missing (typical on a fresh deploy
 * before the env vars are filled in).
 */

import Stripe from "stripe";

export interface StripeConfig {
  secretKey: string;
  priceId: string;
  webhookSecret: string | null;
}

class StripeNotConfiguredError extends Error {
  status = 503 as const;
  constructor(missing: string) {
    super(`Billing is not configured on this deployment (${missing} missing).`);
    this.name = "StripeNotConfiguredError";
  }
}

export function getStripeConfig(): StripeConfig {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const priceId = process.env.STRIPE_PRICE_ID;
  if (!secretKey) throw new StripeNotConfiguredError("STRIPE_SECRET_KEY");
  if (!priceId) throw new StripeNotConfiguredError("STRIPE_PRICE_ID");
  return {
    secretKey,
    priceId,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? null,
  };
}

let cached: Stripe | null = null;
export function getStripe(): Stripe {
  if (cached) return cached;
  const { secretKey } = getStripeConfig();
  cached = new Stripe(secretKey, { apiVersion: "2025-02-24.acacia" });
  return cached;
}

export { StripeNotConfiguredError };
