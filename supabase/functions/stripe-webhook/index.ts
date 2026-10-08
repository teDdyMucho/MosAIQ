// RavMizAI — stripe-webhook
//
// The only thing that grants or revokes membership. Stripe calls this when a
// subscription is created, renewed, updated or cancelled.
//
// Two defences matter here:
//
//   1. Signature verification. Without it, anyone who knows the URL could POST
//      a fake "subscription active" event and get free access. The signature
//      is checked before the body is trusted for anything.
//
//   2. Idempotency. Stripe retries deliveries and can send the same event
//      twice. Each event id is recorded first; a duplicate is a no-op.
//
// Deploy (must skip JWT verification -- Stripe has no Supabase token):
//   npx supabase functions deploy stripe-webhook --no-verify-jwt
//
// Secrets:
//   STRIPE_SECRET_KEY
//   STRIPE_WEBHOOK_SECRET   whsec_... from the Stripe webhook endpoint

import { createClient } from 'jsr:@supabase/supabase-js@2';

const enc = new TextEncoder();

// Constant-time compare, so a timing side channel cannot leak the signature.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Verifies Stripe's `Stripe-Signature` header: t=<timestamp>,v1=<hmac>.
async function verify(body: string, header: string, secret: string): Promise<boolean> {
  const parts = Object.fromEntries(
    header.split(',').map(p => p.split('=')).filter(p => p.length === 2) as [string, string][],
  );
  const t = parts['t'];
  const v1 = parts['v1'];
  if (!t || !v1) return false;

  // Reject old timestamps so a captured request cannot be replayed later.
  const age = Math.abs(Date.now() / 1000 - Number(t));
  if (!Number.isFinite(age) || age > 300) return false;

  const expected = await hmacSha256Hex(secret, `${t}.${body}`);
  return safeEqual(expected, v1);
}

const iso = (unix: unknown) =>
  typeof unix === 'number' && unix > 0 ? new Date(unix * 1000).toISOString() : null;

// Records the brand and last four digits of the card now on file, so the
// billing page can show something real. Nothing sensitive is stored, and a
// failure here must never fail the webhook -- the subscription state matters
// more than the display detail.
async function refreshCardSummary(admin: any, stripeKey: string, customerId: string) {
  const get = (path: string) =>
    fetch('https://api.stripe.com/v1/' + path, {
      headers: { 'Authorization': 'Bearer ' + stripeKey },
    }).then(r => r.json());

  try {
    let card: any = null;

    // 1. The customer's default, when one is set (portal changes land here).
    const cust = await get(
      `customers/${customerId}?expand[]=invoice_settings.default_payment_method`,
    );
    card = cust?.invoice_settings?.default_payment_method?.card ?? null;

    // 2. Checkout attaches the card to the subscription rather than setting a
    //    customer default, so look there next.
    if (!card?.last4) {
      const subs = await get(
        `subscriptions?customer=${customerId}&limit=1&expand[]=data.default_payment_method`,
      );
      card = subs?.data?.[0]?.default_payment_method?.card ?? null;
    }

    // 3. Otherwise fall back to whatever card is attached to the customer.
    if (!card?.last4) {
      const pms = await get(`payment_methods?customer=${customerId}&type=card&limit=1`);
      card = pms?.data?.[0]?.card ?? null;
    }

    if (!card?.last4) return;
    await admin.rpc('set_card_summary', {
      p_customer_id: customerId,
      p_brand: card.brand ?? null,
      p_last4: card.last4,
    });
  } catch (e) {
    console.warn('card summary skipped:', (e as Error).message);
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  const whSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!url || !serviceKey || !stripeKey || !whSecret) {
    console.error('missing env; need SUPABASE_*, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET');
    return new Response('Not configured', { status: 500 });
  }

  const raw = await req.text();
  const sigHeader = req.headers.get('Stripe-Signature') ?? '';
  if (!sigHeader || !(await verify(raw, sigHeader, whSecret))) {
    console.warn('rejected: bad signature');
    return new Response('Invalid signature', { status: 400 });
  }

  let event: any;
  try { event = JSON.parse(raw); }
  catch { return new Response('Bad payload', { status: 400 }); }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Idempotency: first writer wins. A duplicate delivery stops here.
  const { error: dupe } = await admin
    .from('stripe_events')
    .insert({ id: event.id, type: event.type });
  if (dupe) {
    if (dupe.code === '23505') {
      console.log('duplicate event ignored:', event.id);
      return new Response('ok (duplicate)', { status: 200 });
    }
    console.error('event log failed:', dupe.message);
    return new Response('Storage error', { status: 500 });
  }

  try {
    const obj = event.data?.object ?? {};

    switch (event.type) {
      // Checkout finished. The subscription object carries the real status, so
      // fetch it rather than assuming the session means "active".
      case 'checkout.session.completed': {
        const subId = obj.subscription;
        const userId = obj.client_reference_id || obj.metadata?.supabase_user_id || null;
        if (!subId) break;

        const res = await fetch('https://api.stripe.com/v1/subscriptions/' + subId, {
          headers: { 'Authorization': 'Bearer ' + stripeKey },
        });
        const sub = await res.json();
        if (!res.ok) throw new Error(sub?.error?.message || 'subscription fetch failed');

        await admin.rpc('apply_stripe_subscription', {
          p_customer_id: sub.customer,
          p_subscription_id: sub.id,
          p_status: sub.status,
          p_period_end: iso(sub.trial_end ?? sub.current_period_end),
          p_user_id: userId,
        });
        await refreshCardSummary(admin, stripeKey, sub.customer);
        console.log('checkout completed:', sub.id, sub.status);
        break;
      }

      // Trial converted, renewed, upgraded, paused, cancelled -- all arrive here.
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const status = event.type.endsWith('deleted') ? 'canceled' : obj.status;
        await admin.rpc('apply_stripe_subscription', {
          p_customer_id: obj.customer,
          p_subscription_id: obj.id,
          p_status: status,
          p_period_end: iso(obj.trial_end ?? obj.current_period_end),
          p_user_id: obj.metadata?.supabase_user_id ?? null,
        });
        // A card change in the Billing Portal arrives as subscription.updated.
        if (!event.type.endsWith('deleted')) {
          await refreshCardSummary(admin, stripeKey, obj.customer);
        }
        console.log('subscription', status, obj.id);
        break;
      }

      // Renewal failed. Stripe will also send subscription.updated with
      // past_due, but acting here closes the gap sooner.
      case 'invoice.payment_failed': {
        if (!obj.subscription) break;
        await admin.rpc('apply_stripe_subscription', {
          p_customer_id: obj.customer,
          p_subscription_id: obj.subscription,
          p_status: 'past_due',
          p_period_end: null,
          p_user_id: null,
        });
        console.log('payment failed:', obj.subscription);
        break;
      }

      default:
        // Acknowledge anything else so Stripe stops retrying it.
        break;
    }

    return new Response('ok', { status: 200 });
  } catch (e) {
    // Return 500 so Stripe retries. The event row is removed first, otherwise
    // the idempotency guard would swallow the retry.
    await admin.from('stripe_events').delete().eq('id', event.id);
    console.error('handler failed:', (e as Error).message);
    return new Response('Handler error', { status: 500 });
  }
});
