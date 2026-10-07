# Stripe setup — RavMizAI Monthly Membership

**Plan:** 7-day free trial, then **$18/month**, cancel anytime.

Checkout is hosted by Stripe, so card details never touch this site or your
server. Membership is granted only by the webhook, never by the browser.

---

## 1. Create the product in Stripe

Dashboard → **Product catalogue** → Add product.

| Field | Value |
|---|---|
| Name | `RavMizAI Monthly Membership` |
| Description | Access to RavMizAI's AI-powered Torah voice and text experience, including personalized conversations, saved preferences, transcripts, and member features. Includes a 7-day free trial, then $18/month automatically until canceled. Cancel anytime before the trial ends to avoid being charged. |
| Price | `18.00` USD, **Recurring**, **Monthly** |

Copy the **price id** (`price_...`) — not the product id (`prod_...`).

> The 7-day trial is set by `create-checkout`, not on the price. Leave the
> price's own trial setting empty, or the trial would be applied twice.

## 2. Add the secrets to Supabase

```bash
npx supabase secrets set \
  STRIPE_SECRET_KEY=sk_test_xxx \
  STRIPE_PRICE_ID=price_xxx \
  SITE_URL=https://your-site.netlify.app \
  --project-ref ujqrmjoklinyxbnvyswa
```

Use `sk_test_...` until the whole flow works, then repeat with `sk_live_...`.

**The secret key must never reach the browser.** It belongs only in Supabase
secrets. The site needs no Stripe key at all — Checkout is a redirect.

## 3. Run the schema

Supabase SQL Editor → paste `sql/004_stripe.sql` → Run.

Adds the Stripe columns, the `stripe_events` table (webhook idempotency), and
`apply_stripe_subscription()` — the single place membership is written.

## 4. Deploy the functions

```bash
npx supabase functions deploy create-checkout --project-ref ujqrmjoklinyxbnvyswa
npx supabase functions deploy stripe-webhook --no-verify-jwt --project-ref ujqrmjoklinyxbnvyswa
```

`--no-verify-jwt` is required on the webhook: Stripe has no Supabase token. It
is not a hole — the function verifies Stripe's own signature instead, and
rejects anything unsigned.

## 5. Register the webhook

Stripe → **Developers → Webhooks → Add endpoint**.

**URL:**
```
https://ujqrmjoklinyxbnvyswa.supabase.co/functions/v1/stripe-webhook
```

**Events to send:**
- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_failed`

Copy the **signing secret** (`whsec_...`) and add it:

```bash
npx supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_xxx \
  --project-ref ujqrmjoklinyxbnvyswa
```

Without this the webhook rejects every event and nobody becomes a member.

## 6. Test with a test card

1. Sign in, press **Call** → subscribe page.
2. **Start 7-day free trial** → redirects to Stripe.
3. Card `4242 4242 4242 4242`, any future expiry, any CVC.
4. Should return to `/app/home.html?checkout=success` with Call and Text open.

Check `Authentication → Users` and:

```sql
select u.email, p.subscription_status, p.is_member, p.subscribed_until
  from public.profiles p join auth.users u on u.id = p.id;
```

Expected: `trialing`, `is_member = true`, `subscribed_until` ≈ 7 days out.

Other useful test cards:

| Card | Behaviour |
|---|---|
| `4242 4242 4242 4242` | succeeds |
| `4000 0000 0000 9995` | declined — trial should not start |
| `4000 0025 0000 3155` | requires 3D Secure |

## 7. Going live

- [ ] Swap `sk_test_` → `sk_live_`, and the price id for the live-mode one
- [ ] Register the webhook again in **live mode** (separate `whsec_`)
- [ ] Set `SITE_URL` to the real domain
- [ ] Activate the Stripe account (business details, bank account)
- [ ] Turn email confirmation back on in Supabase
- [ ] Check Terms and Privacy state $18/month and the 7-day trial

---

## How it fits together

```
subscribe.html
   └─ create-checkout  (reads caller from JWT; price/trial from server config)
        └─ Stripe hosted Checkout
             └─ stripe-webhook  (verifies signature, then grants)
                  └─ apply_stripe_subscription()  →  profiles.is_member
```

Two properties worth keeping:

1. **The browser cannot grant itself a membership.** The RLS policy from `002`
   blocks writes to `is_member`, and `apply_stripe_subscription()` is
   service-role only. A tampered request cannot buy access.
2. **Price and trial length are server-side.** `create-checkout` ignores
   anything the client sends, so the plan cannot be bought for $0.

## What changed from the pre-Stripe build

`activate-trial` granted a 3-day trial with no payment method, because there
was no processor. Stripe now runs the trial, so that path must not stay
reachable — otherwise anyone could skip checkout. `004_stripe.sql` revokes
`start_trial()` from the service role.

**Remove the old function after Stripe works:**

```bash
npx supabase functions delete activate-trial --project-ref ujqrmjoklinyxbnvyswa
```
