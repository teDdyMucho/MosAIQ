// RavMizAI — billing-portal
//
// Returns a Stripe Billing Portal URL for the signed-in user. The portal is
// Stripe's own hosted page where a member can update their card, see invoices,
// and cancel the subscription.
//
// Building these screens by hand would mean handling card data and cancellation
// logic ourselves; the portal avoids both. Cancellation arrives back here as a
// `customer.subscription.updated` / `.deleted` webhook, so membership state
// stays correct without any extra work.
//
// The caller is identified from their own JWT, never from the request body --
// otherwise anyone could open someone else's billing page and cancel their
// subscription or read their invoices.
//
// Deploy:
//   npx supabase functions deploy billing-portal
//
// Secrets: STRIPE_SECRET_KEY, SITE_URL

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  const siteUrl = (Deno.env.get('SITE_URL') || '').replace(/\/+$/, '');

  if (!url || !anonKey || !serviceKey || !stripeKey || !siteUrl) {
    console.error('missing env; need SUPABASE_*, STRIPE_SECRET_KEY, SITE_URL');
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

  // 2. Their Stripe customer. Read it with the service role so the lookup does
  //    not depend on a client-readable column.
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: profile } = await admin
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', userData.user.id)
    .maybeSingle();

  const customerId = profile?.stripe_customer_id;
  if (!customerId) {
    return json({
      ok: false,
      reason: 'no_customer',
      message: 'You do not have a billing account yet. Start your membership first.',
    }, 409);
  }

  // 3. Hand back a portal session.
  try {
    const res = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + stripeKey,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        customer: customerId,
        return_url: siteUrl + '/app/billing.html',
      }).toString(),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body?.error?.message || 'portal session failed');

    return json({ ok: true, url: body.url });
  } catch (e) {
    const msg = (e as Error).message;
    console.error('portal failed:', msg);
    // The portal needs its settings saved once in the Stripe dashboard; say so
    // rather than returning a generic failure.
    if (/configuration/i.test(msg)) {
      return json({
        error: 'Billing portal is not set up yet in Stripe. Please contact support.',
      }, 500);
    }
    return json({ error: 'Could not open billing. Please try again.' }, 500);
  }
});
