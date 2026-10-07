// RavMizAI — create-checkout
//
// Creates a Stripe Checkout Session for the signed-in user and returns its URL.
//
// Plan: RavMizAI Monthly Membership — 7-day free trial, then $18/month.
//
// The caller is identified from their own JWT, never from the request body:
// otherwise anyone could start a subscription against someone else's account.
// No price or trial length is accepted from the client either — both come from
// server-side config, so a tampered request cannot buy the plan for $0.
//
// Deploy:
//   npx supabase functions deploy create-checkout
//
// Secrets required (npx supabase secrets set ...):
//   STRIPE_SECRET_KEY   sk_test_... or sk_live_...
//   STRIPE_PRICE_ID     price_... (the $18/month recurring price)
//   SITE_URL            https://your-site.netlify.app

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

// Stripe's REST API takes form-encoded bodies, including nested keys.
async function stripe(path: string, key: string, params: Record<string, string>) {
  const res = await fetch('https://api.stripe.com/v1/' + path, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + key,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params).toString(),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body?.error?.message || ('Stripe ' + path + ' failed'));
  }
  return body;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  const priceId = Deno.env.get('STRIPE_PRICE_ID');
  const siteUrl = (Deno.env.get('SITE_URL') || '').replace(/\/+$/, '');

  if (!url || !anonKey || !serviceKey || !stripeKey || !priceId || !siteUrl) {
    console.error('missing env; need SUPABASE_*, STRIPE_SECRET_KEY, STRIPE_PRICE_ID, SITE_URL');
    return json({ error: 'Billing is not configured.' }, 500);
  }

  // 1. Who is calling?
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Not signed in.' }, 401);

  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await asCaller.auth.getUser();
  if (userErr || !userData?.user) {
    return json({ error: 'Your session has expired. Please sign in again.' }, 401);
  }
  const user = userData.user;

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // 2. Already a member? Do not sell a second subscription.
  const { data: profile } = await admin
    .from('profiles')
    .select('stripe_customer_id,stripe_subscription_id,subscription_status,first_name,last_name')
    .eq('id', user.id)
    .maybeSingle();

  if (profile?.subscription_status === 'active' || profile?.subscription_status === 'trialing') {
    return json({ ok: false, reason: 'already_subscribed',
                  message: 'Your membership is already active.' }, 409);
  }

  try {
    // 3. Reuse the Stripe customer if this user has one, so cards and billing
    //    history stay on a single record.
    let customerId = profile?.stripe_customer_id as string | undefined;
    if (!customerId) {
      const name = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ').trim();
      const customer = await stripe('customers', stripeKey, {
        email: user.email ?? '',
        ...(name ? { name } : {}),
        'metadata[supabase_user_id]': user.id,
      });
      customerId = customer.id;
      await admin.rpc('link_stripe_customer', { p_user_id: user.id, p_customer_id: customerId });
    }

    // 4. The Checkout Session. Price and trial length come from server config.
    const session = await stripe('checkout/sessions', stripeKey, {
      mode: 'subscription',
      customer: customerId!,
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': '1',
      'subscription_data[trial_period_days]': '7',
      // If the trial ends with no usable payment method, cancel rather than
      // leaving an unpaid subscription open.
      'subscription_data[trial_settings][end_behavior][missing_payment_method]': 'cancel',
      'subscription_data[metadata][supabase_user_id]': user.id,
      'metadata[supabase_user_id]': user.id,
      payment_method_collection: 'always',
      allow_promotion_codes: 'true',
      client_reference_id: user.id,
      success_url: siteUrl + '/app/home.html?checkout=success',
      cancel_url: siteUrl + '/app/subscribe.html?checkout=cancelled',
    });

    return json({ ok: true, url: session.url });
  } catch (e) {
    console.error('checkout failed:', (e as Error).message);
    return json({ error: 'Could not start checkout. Please try again.' }, 500);
  }
});
