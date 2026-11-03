# Usage tracking — voice and text

**Mike's question (#8):** *"how do you track voice minutes and text? Let's
ensure we track voice to a second (not minute)."*

## The honest answer today

**Nothing tracks usage yet.** Balances only ever went up, from the trial grant.
Nothing has ever debited a wallet, so the numbers on the wallet page were true
but frozen.

The backend for it now exists and is tested. What is missing is a trustworthy
source for *how long a call actually lasted* — see "What is still blocked".

## What was built

### Seconds, not minutes

`sql/008_usage_seconds.sql` — applied.

| | |
|---|---|
| `wallets.seconds_balance` | the balance, in seconds |
| `wallet_ledger.seconds` | each movement, in seconds |

The old `minutes` columns are kept and derived, so nothing that still reads
them breaks. A 40-second call now costs 40 seconds — not a rounded minute, and
not nothing.

### Two functions, one path

- `record_usage(user, seconds, chats, description)` — debits and writes the
  matching ledger row together, so a balance can never drift from its history.
  Clamps at zero: an overrunning call is still recorded, never negative.
- `grant_credit(user, seconds, chats, description)` — the credit side, for
  trial activation and renewals.

Both are **service-role only**. The browser cannot call them, and RLS gives it
no write access to `wallets` or `wallet_ledger` either.

### The entry point

`supabase/functions/record-usage/index.ts` — deployed.

Identifies the caller from their own JWT, never from the request body, so a
page cannot charge or credit someone else's wallet. Rejects negative and
implausible amounts (over 4 hours, over 500 chats).

```
POST /functions/v1/record-usage
Authorization: Bearer <user jwt>
{ "seconds": 40, "chats": 0, "description": "Voice usage" }

-> { "ok": true, "seconds_left": 3560, "chats_left": 120 }
```

## What is still blocked

**Nothing calls `record-usage` yet, because nothing knows how long a call was.**

The conversation runs inside Delphi's embedded iframe (`delphi.ai/embed.js` in
`app/chat.html`). The iframe does not report session start, end or duration
back to the page, and a cross-origin iframe cannot be measured from outside.

Three ways forward, in order of how much we would trust the number:

1. **A Delphi webhook** — Delphi calls us when a session ends, with its own
   duration. Most trustworthy: the figure never passes through the browser.
   Needs Delphi to offer one.
2. **A Delphi JS API on the embed** — the page listens for session events and
   reports the duration. Workable, but the number comes from the browser, so a
   determined member could under-report. Mitigated by the caps already in the
   function.
3. **Time the page** — start a timer when the member opens the call and stop on
   leave. Least trustworthy and wrong in ordinary cases: a backgrounded tab, a
   dropped connection or a closed laptop all mis-measure it.

**This is the question to put to Delphi: do they expose session events or a
webhook with call duration?** Until that is answered, any number we record is a
guess, and charging a paying member against a guess is worse than not charging
at all.

Text messages have the same gap: the embed does not report how many were sent.

## Verified

Against the live database, 11/11:

- 40-second call debits exactly 40 seconds; 7 seconds debits 7
- Ledger total reconciles exactly with the balance
- Negative amounts rejected (400); implausible amounts rejected (400)
- No auth rejected (401); direct RPC from the browser rejected (403)
- Overrun clamps to zero, never negative
