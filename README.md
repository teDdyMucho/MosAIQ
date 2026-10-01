# RavMizAI V4 — Multi-page website / app prototype

## Pages
Public:
- /index.html — main marketing page
- /about.html — Rabbi Mizrachi / RavMizAI about + FAQ
- /lets-chat.html — public member-access gate (no live conversation before login)
- /login.html
- /signup.html
- /verify.html
- /terms.html
- /privacy.html

Trial funnel:
- /trial/free-trial.html — 3-day trial signup
- /trial/verify.html — email-code step
- /trial/payment.html — credit-card step

Member app:
- /app/home.html
- /app/call-intro.html
- /app/chat.html — styled transcript/call UI
- /app/wallet.html
- /app/billing.html
- /app/preferences.html

Email:
- /email/verification-email.html

## Important production integrations
This package is a functional front-end prototype. LocalStorage is used to demonstrate signup, login, verification, trial activation, wallet state and preferences.

Before production:
1. Replace LocalStorage auth with a real auth system (Supabase/Auth0/Firebase/custom).
2. Connect verification email to Postmark/SendGrid/Resend/AWS SES.
3. Replace prototype card form with Stripe Elements/Checkout or another PCI-compliant processor.
4. Never store raw card numbers in RavMizAI.
5. Connect wallet usage to actual voice/text usage metering.
6. Decide whether the member call page embeds Delphi directly or launches Delphi in a dedicated call route.
7. Confirm final subscription price and trial conversion language.
8. Have counsel review Terms and Privacy; confirm entity, governing state, retention periods and vendor disclosures.

## Delphi
Channel retained from the temporary site:
4a476a80-f754-4ddd-af60-517849ccc799

## Demo verification
The prototype verification code is fixed to 111111.

## V4.1 changes
- Live RavMizAI conversation removed from public pages; conversation is member-only.
- Verification code fixed to 111111.
- English-only Delphi presentation mask added on member call embed.
- Terms and Privacy restyled to match RavMizAI dark visual system.
- Hero phone/archive card overlap corrected at 100% zoom.
- FAQ answers expanded.
