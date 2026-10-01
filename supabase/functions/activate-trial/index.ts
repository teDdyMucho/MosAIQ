// RavMizAI — activate-trial
//
// Grants the signed-in user a one-time 3-day trial.
//
// This exists because the browser must NOT be able to grant itself a
// membership: the RLS policy in 002 blocks that on purpose. The service-role
// key lives here, server-side, where a visitor cannot reach it.
//
// The caller is identified from their own JWT, never from the request body --
// otherwise anyone could activate a trial for any account by passing someone
// else's id.
//
// Deploy:
//   npx supabase functions deploy activate-trial
//
// When Stripe is connected, that webhook takes over and this can be removed.

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
  if (!url || !anonKey || !serviceKey) {
    console.error('missing env: URL/ANON/SERVICE_ROLE');
    return json({ error: 'Server is not configured.' }, 500);
  }

  // 1. Who is calling? Read it from the caller's own token.
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return json({ error: 'Not signed in.' }, 401);
  }

  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: userData, error: userErr } = await asCaller.auth.getUser();
  if (userErr || !userData?.user) {
    return json({ error: 'Your session has expired. Please sign in again.' }, 401);
  }
  const user = userData.user;

  // 2. Grant the trial with the service role, which bypasses RLS.
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data, error } = await admin.rpc('start_trial', { target_user: user.id });
  if (error) {
    console.error('start_trial failed:', error.message);
    return json({ error: 'Could not activate the trial. Please try again.' }, 500);
  }

  // start_trial returns a single row: { ok, reason, trial_ends }
  const row = Array.isArray(data) ? data[0] : data;

  if (!row?.ok) {
    const reason = row?.reason ?? 'unavailable';
    const message =
      reason === 'trial already used' ? 'You have already used your free trial.'
      : reason === 'already a member'  ? 'Your membership is already active.'
      : 'This trial is not available for your account.';
    return json({ ok: false, reason, message }, 409);
  }

  console.log('trial activated for', user.id);
  return json({ ok: true, trial_ends: row.trial_ends });
});
