# Deploying to Netlify

The site is static, so Netlify is a good fit. One thing makes it not a pure
drag-and-drop job: `assets/supabase-config.js` holds the project credentials and
is gitignored, so it is not in the repo. Netlify regenerates it at build time
from environment variables — that is what `netlify.toml` and `build-config.js`
are for.

## 1. Push to Git

There is no git repository yet. Create one:

```bash
git init
git add .
git commit -m "RavMizAI v4.1"
git remote add origin https://github.com/YOU/ravmizai.git
git push -u origin main
```

`.gitignore` already keeps `.env` and `assets/supabase-config.js` out. **Verify
before pushing:**

```bash
git status --short | grep -E '\.env$|supabase-config'
```

That must print nothing. If `.env` appears, stop — it holds your database
password and Supabase access token.

> **Avoid the drag-and-drop deploy.** Dropping the folder on Netlify ignores
> `.gitignore` and would upload `.env`. Use Git, or `netlify deploy` from a
> clean checkout.

## 2. Create the Netlify site

New site → Import from Git → pick the repo. `netlify.toml` already sets:

- **Build command:** `node build-config.js`
- **Publish directory:** `.`

## 3. Environment variables

Site configuration → Environment variables. Add exactly two:

| Key | Value |
|---|---|
| `SUPABASE_URL` | `https://ujqrmjoklinyxbnvyswa.supabase.co` |
| `SUPABASE_ANON_KEY` | the **anon public** key from Supabase → Settings → API |

**Do not add** `SUPABASE_DB_PASSWORD` or `SUPABASE_ACCESS_TOKEN`. The site does
not use them, and they grant full control of the project. `build-config.js`
refuses to build if a `service_role` key is passed as the anon key.

The build fails with a clear message if either variable is missing, so a
misconfigured deploy never ships a broken site.

## 4. Point Supabase at the new domain — required

Auth breaks without this. Supabase → **Authentication → URL Configuration**:

- **Site URL:** `https://your-site.netlify.app`
- **Redirect URLs:** add both
  - `https://your-site.netlify.app/**`
  - `https://your-deploy-preview--your-site.netlify.app/**` (for previews)

Keep `http://localhost:5173/**` if you still develop locally.

## 5. Check after deploying

1. Open the site — the header should show **Log in**, not a blank page.
2. Sign up with a real address → should land in `/app/home`.
3. Press **Call** → should go to the subscribe page.
4. Activate the trial → Call and Text should both open.
5. Sign out → should return to login and stay out.

If the auth pages fall back to the prototype (the `111111` hint appears), the
environment variables did not reach the build. Check the deploy log for
`build-config: wrote assets/supabase-config.js`.

## Before taking real users

These are still open and are **not** fixed by deploying:

1. **Email confirmation is OFF.** Anyone can sign up with someone else's address.
   Turn it back on in Authentication → Providers → Email, and add a real SMTP
   provider (the built-in mailer sends ~3 emails/hour).
2. **No payment processor.** The card form sends nothing anywhere — any number
   is accepted and every visitor can claim a free trial. Connect Stripe before
   charging anyone.
3. **`/app/*` pages are gated client-side.** Static hosting serves the HTML to
   anyone who asks; member *data* is protected by RLS, which is the part that
   matters, but the pages themselves are not private.
4. **The Delphi channel id is public** in `app/chat.html`. Confirm with Delphi
   whether that is acceptable for a production embed.
