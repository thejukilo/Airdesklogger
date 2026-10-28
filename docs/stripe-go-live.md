# Stripe go-live checklist — single plan, CHF 5.99 / month

Everything in code is in place: Stripe Checkout (`api/billing/checkout.ts`), a
signature-verified, idempotent webhook (`api/billing/webhook.ts`), the Customer
Portal (`api/billing/portal.ts`), the 3-day trial and the write-gate
(`src/db/subscriptionRepository.ts`), and the SPA banners and Account billing
card.

Going live is therefore **configuration in Stripe and Vercel**, then a
verification pass. Do it first in **test mode**, confirm the full flow, then
repeat the key steps in **live mode**.

---

## 1. Product and price (Stripe Dashboard)

1. Product catalogue → **Add product** → name it (e.g. "Airdesk Logger").
2. Add a **recurring price**: CHF 5.99 / month.
3. Copy the price id (`price_...`). You get a **test** price id now and a
   separate **live** price id later.

## 2. Payment methods

Settings → **Payment methods**: enable the methods you want — **Cards** and,
for Swiss users, **TWINT** (PayPal optional). Checkout shows whatever is
enabled on the account; the code does not restrict them.

## 3. Customer portal (required)

Settings → Billing → **Customer portal** → activate it, and allow: update
payment method, view invoices, cancel subscription. The "Manage payment /
cancel" button calls the portal and will error until this is activated.

## 4. Webhook endpoint

Developers → **Webhooks** → **Add endpoint**:

- **URL:** `https://log.airdeck.ch/api/billing/webhook`
- **Events:**
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.paid`
  - `invoice.payment_failed`
- Copy the **signing secret** (`whsec_...`).

(API version: the code now reads the billing period from either the subscription
or its line item, so it works whatever version the endpoint sends. If you want
to be explicit, pin the endpoint to `2025-02-24.acacia`.)

## 5. Environment variables (Vercel, Production scope)

On the Vercel project that serves log.airdeck.ch → Settings → **Environment
Variables** → add for **Production**:

| Variable | Value |
| --- | --- |
| `STRIPE_SECRET_KEY` | `sk_test_...` (test) → `sk_live_...` (live) |
| `STRIPE_PRICE_ID` | the `price_...` from step 1 |
| `STRIPE_WEBHOOK_SECRET` | the `whsec_...` from step 4 |

Env changes only take effect on a new deploy — **redeploy** after saving.

> Note: the production site deploys from the `claude/easa-flight-log-app-TwTiM`
> branch, not `Main`. Make sure the env vars are on the project/environment that
> branch deploys to.

## 6. Verify in test mode

1. Open the app on an account in trial — the amber trial banner shows. Click
   **Subscribe**.
2. Pay with Stripe test card `4242 4242 4242 4242`, any future expiry, any CVC.
3. You land on `/billing/success`; within a few seconds the state flips to
   **active** (the webhook did it). The Account page shows "Renews \<date\>".
4. Click **Manage payment / cancel** → the Stripe portal opens. Cancel → state
   becomes **cancelled**, with access until the period end.
5. In Stripe → Developers → Webhooks → your endpoint, confirm the deliveries
   returned **200**.

## 7. Flip to live

1. Repeat steps 1 and 4 in **live mode**: a live `price_...` and a live
   `whsec_...`.
2. Set the **live** `sk_live_...`, the live price id, and the live webhook
   secret in Vercel; redeploy.
3. Run one real CHF 5.99 subscription end-to-end (you can refund it in Stripe).
   Confirm it reaches **active** and the portal opens.

---

## Good to know

- **The in-app 3-day trial is separate from Stripe.** Subscribing during the
  trial charges immediately and switches to active — there is no Stripe trial
  and no double-charge.
- **State machine:** `trialing → active / past_due / cancelled / read_only`.
  Writes (logging, signing, exporting) are allowed in every state except
  `read_only`; reads and voiding are always allowed.
- **If the state doesn't flip to active after checkout**, it is almost always
  the webhook: wrong secret, wrong URL, or the events above not selected.
  Developers → Webhooks → your endpoint → recent deliveries shows the failure.
- **Trial expiry** runs daily via the `expire-trials` cron (`vercel.json`,
  03:00 UTC): a trial whose end date has passed and that has not subscribed
  flips to `read_only`.
