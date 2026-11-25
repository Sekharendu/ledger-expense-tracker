# Ledger

Android expense tracking with optional Gmail imports. React Native / Expo frontend, Supabase Auth and PostgreSQL, and Vercel-hosted API functions.

## User flow

1. Sign in with Google to create or find an account. This requests identity scopes only.
2. Use the dashboard and enter expenses immediately.
3. Optionally connect Gmail in Settings. Read-only inbox access is requested separately.
4. The backend extracts INR expenses and payment evidence from email bodies and text PDFs, deduplicates records, and saves them under that account. Clear full-payment evidence with a document date creates a paid record; uncertain imports enter review.
5. Signing out ends the app session. Gmail tracking continues until disconnected. Disconnect stops future scans, revokes Google access, and preserves existing expenses.

## Hosted deployment

Customers only need the mobile app. The developer configures Supabase and Vercel once; customers do not run a server or database.

- Create a Supabase project and apply `supabase/migrations/20261123145758_ledger_accounts_and_gmail.sql`.
- Enable Google in Supabase Auth, with identity scopes only. Add the app's web and `ledger://auth/callback` redirect URLs to Supabase's allowlist.
- Import this GitHub repository into Vercel. Its `vercel.json` builds the web preview and hosts the Gmail API.
- Set the variables described in `.env.example` (public app configuration) and `.env.server.example` (private Vercel configuration). Never expose the Supabase secret key or Google client secret to Expo.
- Register `https://YOUR_DEPLOYMENT/api/oauth/google/callback` with the Google OAuth client used for optional Gmail authorization.
- Set a random 32-byte base64 `TOKEN_ENCRYPTION_KEY` and a random `CRON_SECRET` in Vercel. Generate them without logging them. Keep the encryption key stable; existing Gmail credentials depend on it.

Supabase holds `auth.users`, account profiles, expenses, encrypted Gmail connections, OAuth attempts, and sync history. RLS enforces per-user expense ownership and active sessions. Gmail credentials are accessible only to the backend. Atomic PostgreSQL functions prevent concurrent scans and reject imports after disconnect.

The checked-in Vercel cron runs daily at 00:15 UTC. It processes due mailboxes within one function's execution budget; larger deployments need a more frequent scheduler or durable fan-out. No paid-plan upgrade is assumed. Each scan handles a page of 25 matching billing messages from the last 90 days, with persisted pagination. Users can scan additional pages manually.

See [Gmail setup and limits](GMAIL_SETUP.md).

## Development

Requires Node 24 and npm. Use the hosted Supabase project for application data.

```powershell
npm ci
# Populate ignored .env and .env.server using the templates.
npm run email
# In a second terminal:
npm run web
```

For local web development, set `EXPO_PUBLIC_EMAIL_API_URL=http://localhost:8787` and allow `http://localhost:8081` in `ALLOWED_ORIGINS`. Production Android builds use the deployed HTTPS API URL. Use an Android development build to test the `ledger://` sign-in callback.

## Validation

```powershell
npm run typecheck
npm run lint
npm test
npm run build:web
npx expo export --platform android
```

Database tests use an embedded PostgreSQL engine and do not require Docker. They verify account isolation, revoked-session access, blocked credential tables, scan leases, duplicate imports and disconnect cancellation. API tests simulate Google and Supabase accounts; a real OAuth/hosted smoke test remains necessary after credentials are configured.

## Current limits

English billing labels and INR only. No OCR, scanned/image invoices, password-protected PDFs or currency conversion. Ambiguous totals and statements are skipped. Invoices and receipts without matching references can still require manual duplicate review. There is no automatic migration of the old device-only prototype's records into a signed-in account.

`server/app.mjs` and `server/vault.mjs` retain the original prototype implementation for regression tests; production and `npm run email` use `server/hosted.mjs`.
