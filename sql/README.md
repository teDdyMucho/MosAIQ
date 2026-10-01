# RavMizAI — auth setup

The login, signup and verify pages run against **Supabase Auth**. Until you add
project credentials they fall back to the original LocalStorage prototype, so
the package still demos offline with code `111111`.

## 1. Create the database objects

Supabase dashboard → **SQL Editor** → paste `001_schema.sql` → **Run**.

Or from a terminal:

```bash
psql "$DATABASE_URL" -f sql/001_schema.sql
```

The script is idempotent (`if not exists` / `or replace`), so re-running it is safe.

### What it creates

| Object | Purpose |
|---|---|
| `public.profiles` | First/last name, `call_me`, `is_member`. One row per auth user. |
| `public.trials` | 3-day trial window. Partial unique index allows one *active* trial per user. |
| `public.wallets` | Voice-minute and chat balances. |
| `public.wallet_ledger` | Append-only audit trail behind every balance change. |
| `handle_new_user()` | Trigger on `auth.users` that provisions a profile + wallet on signup. |
| RLS policies | Each user can read only their own rows. |

**There is no `users` table and no password column — this is deliberate.**
Supabase Auth owns credentials in the `auth` schema: it hashes passwords with
bcrypt, issues JWT sessions, and sends the confirmation email. Adding your own
users table would create a second source of truth and a place for plaintext
passwords to leak.

## 2. Configure the project

Get the two values from Settings → **API**. There are two ways to set them.

### Option A — edit the file directly

Fill in `assets/supabase-config.js`:

```js
window.RM_SUPABASE = {
  url: 'https://YOUR-PROJECT.supabase.co',
  anonKey: 'eyJhbGciOi...'
};
```

Simplest, and fine if the repo is private.

### Option B — keep them in `.env`

```bash
cp .env.example .env     # then fill in the two values
node build-config.js     # generates assets/supabase-config.js
```

`.env` and the generated file are both gitignored, so no credentials land in
version control. Re-run `node build-config.js` whenever `.env` changes.

**On a host** (Netlify, Vercel, Cloudflare Pages): set `SUPABASE_URL` and
`SUPABASE_ANON_KEY` in the host's environment settings and use
`node build-config.js` as the build command, publishing this directory. Real
environment variables take precedence over `.env`.

> **Why a build step?** This is a static site — there is no server at runtime, so
> the browser cannot read a `.env` file. Something has to write the values into a
> file the page loads, which is all `build-config.js` does.

### About the anon key

The **anon key belongs in the browser** — it ships in the page, every visitor can
read it, and that is safe *only* because RLS is enabled on every table. The
`service_role` key bypasses RLS entirely and must never appear in `.env`, in
`supabase-config.js`, or anywhere the browser can reach. `build-config.js`
decodes the key and refuses to build if you paste a `service_role` key by
mistake.

## 3. Auth settings

Dashboard → **Authentication → Providers → Email**:

- **Confirm email: ON** — the verify page depends on it.
- **Minimum password length: 10** — matches the client-side rule.
- **Site URL / Redirect URLs** — add the origin you serve from
  (e.g. `http://localhost:5173` in development, plus your production domain).

The default Supabase mailer is rate-limited and fine for testing only. For
production, set a real SMTP provider under **Authentication → Emails**.

### Make the email send a code, not just a link

The verify page asks for a 6-digit code (`verifyOtp`). Supabase's default
confirmation template sends only a link, so edit
**Authentication → Emails → Confirm signup** to include the token:

```html
<p>Your RavMizAI verification code is <strong>{{ .Token }}</strong></p>
```

Leave `{{ .ConfirmationURL }}` in if you also want the one-click link to work.

## 4. Verify it works

Serve the site and sign up with a real address:

```bash
npx serve . -l 5173
```

Expected: the user appears under **Authentication → Users**, and a matching row
appears in `public.profiles` and `public.wallets` (created by the trigger).

## Still open before production

These are unchanged from the main README and are **not** covered by this pass:

1. **`/app/*` pages are not access-controlled.** The gate is client-side — it
   redirects a signed-out visitor, but static hosting still serves the HTML to
   anyone who requests it. Real protection means keeping member *data* behind
   RLS (which the schema does) and, if the pages themselves must be private,
   serving them from an authenticated route rather than as static files.
2. **Payment is still a prototype form.** Replace with Stripe Elements/Checkout
   before accepting a real card. Never store raw card numbers.
3. **Trial and wallet writes are server-side only.** The RLS policies grant the
   browser `select` but no `insert`/`update` on `trials`, `wallets` or
   `wallet_ledger` — write those from a Stripe webhook or metering job using the
   service-role key.
4. **Google sign-in is disabled.** The buttons are greyed out; enable the
   provider in Supabase and wire `signInWithOAuth` to turn them on.
