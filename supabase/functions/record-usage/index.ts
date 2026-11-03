// RavMizAI — record-usage
//
// Debits a member's wallet after a conversation. Voice is charged in seconds,
// so a 40-second call costs 40 seconds rather than a rounded minute.
//
// The caller is identified from their own JWT, never from the request body:
// otherwise a page could charge, or credit, someone else's wallet. The page
// may say how much was used, but not who used it.
//
// The browser cannot write the wallet directly — RLS has no insert/update
// policy on wallets or wallet_ledger, and record_usage() is service-role only.
// This function holds the service key and is the only way through.
//
// Deploy:
//   npx supabase functions deploy record-usage
//
// NOTE: nothing calls this yet. The conversation runs inside Delphi's embedded
// iframe, which does not report session length back to the page. Until Delphi
// exposes session events (a webhook, or a JS API on the embed), there is no
// trustworthy source for the seconds to send here. See USAGE-TRACKING.md.

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

// A single call cannot plausibly exceed this; a larger number means a bug or a
// tampered request, and silently draining a wallet would be worse than failing.
const MAX_SECONDS = 4 * 60 * 60;   // 4 hours
const MAX_CHATS = 500;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceKey) {
    console.error('missing env: SUPABASE_URL / ANON / SERVICE_ROLE');
    return json({ error: 'Server is not configured.' }, 500);
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

  // 2. What are they reporting?
  let body: any = {};
  try { body = await req.json(); } catch { /* empty body is fine */ }

  const seconds = Math.floor(Number(body?.seconds ?? 0));
  const chats = Math.floor(Number(body?.chats ?? 0));

  if (!Number.isFinite(seconds) || !Number.isFinite(chats) || seconds < 0 || chats < 0) {
    return json({ error: 'Invalid usage amount.' }, 400);
  }
  if (seconds > MAX_SECONDS || chats > MAX_CHATS) {
    console.warn('implausible usage rejected:', userData.user.id, seconds, chats);
    return json({ error: 'Usage amount out of range.' }, 400);
  }
  if (seconds === 0 && chats === 0) {
    return json({ ok: true, skipped: true });
  }

  // A short label, for the ledger row the member sees.
  const raw = typeof body?.description === 'string' ? body.description.trim() : '';
  const description = (raw || (seconds ? 'Voice usage' : 'Text messages')).slice(0, 80);

  // 3. Debit, with the service role.
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data, error } = await admin.rpc('record_usage', {
    p_user_id: userData.user.id,
    p_seconds: seconds,
    p_chats: chats,
    p_description: description,
  });

  if (error) {
    console.error('record_usage failed:', error.message);
    return json({ error: 'Could not record usage.' }, 500);
  }

  const row = Array.isArray(data) ? data[0] : data;
  return json({
    ok: true,
    seconds_left: row?.seconds_left ?? null,
    chats_left: row?.chats_left ?? null,
  });
});
