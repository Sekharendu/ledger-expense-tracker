# Ledger readiness checklist

Updated: 25 November 2026. An item is checked only after its stated evidence exists. A deployed page or passing simulated test does not establish working Google sign-in, Gmail ingestion, an installable Android build, or public-launch readiness.

## Verified foundation

- [x] Public GitHub repository: https://github.com/Sekharendu/ledger-expense-tracker (`main`).
- [x] Vercel is connected to that GitHub repository.
- [x] Production deployment reached READY from commit `3e2806084614fa245a79d44abe40289f4d329d98`.
- [x] Homepage, `/auth/callback`, and `/api/health` returned HTTP 200 using Vercel-authenticated requests.
- [x] Supabase project `oxwrqvpfwgkffppczixx` is healthy; public and backend credentials validated without displaying secrets.
- [x] Ledger's five PostgreSQL tables are created with RLS enabled.
- [x] Google identity sign-in is enabled in Supabase. Local web and native OAuth initiation reach Google with identity scopes only.
- [x] Integrated validation: 42 tests passed; TypeScript, lint, web export and Android Hermes export passed. This is not an APK/device test.

## 1. Finish production sign-in

- [x] Local Google sign-in completed and account visible in PostgreSQL (owner confirmation, 25 November). Production login and returning-account checks below remain separate.

- [ ] Set the Supabase production Site URL to `https://ledger-expense-tracker-sekharendus-projects.vercel.app`.
- [ ] Allow `https://ledger-expense-tracker-sekharendus-projects.vercel.app/auth/callback` in Supabase redirect URLs.
- [x] Preserve local web redirect `http://localhost:8081/auth/callback` and native redirect `ledger://auth/callback` (confirmed by user screenshot).
- [ ] Complete an actual Google sign-in through the deployed app and return to the dashboard.
- [ ] Verify a returning Google user opens the same account and expenses.

## 2. Configure the hosted backend

- [x] Native/web clients use only public Supabase configuration; private server credentials are excluded from Git.
- [x] Backend encryption and cron secrets exist in ignored `.env.server`.
- [x] Securely install `SUPABASE_SECRET_KEY`, `TOKEN_ENCRYPTION_KEY`, and `CRON_SECRET` in Vercel's production environment (CLI stdin transfer succeeded; all three verified as sensitive, production-only variables).
- [ ] Verify `SUPABASE_URL`, approved production web origins, and the mobile API URL point at the intended services.
- [x] GitHub push automatically deployed commit `3e28060` to production; Vercel reported READY.
- [x] Live health reports `databaseConfigured: true`; real authenticated account requests with the production Origin succeeded.

## 3. Allow public production access

- [x] Configure production deployment protection so ordinary users can reach the app and mobile API without a Vercel login; preview protection remains enabled (verified by production agent, 24 November).
- [x] Confirm unauthenticated public HTTP access to the sign-in page, `/auth/callback`, and health endpoint (all HTTP 200).
- [x] Live connection and cron endpoints reject anonymous requests with HTTP 401; authenticated data isolation checks passed.

## 4. Enable Gmail tracking

- [ ] Enable the Gmail API in Ledger's Google Cloud project.
- [ ] Configure the separate Gmail OAuth client/consent grant and register `https://ledger-expense-tracker-sekharendus-projects.vercel.app/api/oauth/google/callback`.
- [ ] Install the Gmail client ID, client secret, and callback URL in the private production environment.
- [ ] Verify live `gmailConfigured: true`.
- [ ] Connect a consenting test mailbox and perform a real invoice/receipt import.
- [x] Deployed enabled cron `/api/cron` uses `15 0 * * *` on Vercel Hobby: daily, nominally 05:45 IST with timing variation within an hour. Function duration is 300 seconds. Source selects up to 20 accounts and 25 messages per mailbox per scan.
- [x] Bound Gmail processing to a shared 90-second mailbox deadline, including token refresh, requests, retries and PDF workers. Completed messages resume through an ID-only cursor; zero-progress timeout is explicit and retryable. Five added regressions pass.
- [ ] Verify timing and resume behavior against real attachment-heavy Gmail messages. An exceptionally slow single message can remain pending with a visible timeout and require manual entry.
- [x] Prepare `npm run configure:gmail` for private credential upload; current check reports missing Google client ID and secret. Credentials and real consent remain pending.

## 5. Test the complete experience

- [x] Simulated tests cover OAuth callbacks, expiry/refresh paths, parsing, PDFs, duplicate detection, and disconnect behavior.
- [x] Embedded PostgreSQL tests cover account isolation, revoked-session access, scan leases, duplicate imports, and disconnect cancellation.
- [x] Verify manual create/edit/delete against the real hosted database using isolated test accounts (`scripts/verify-hosted-data.mjs --run`, 30 checks passed; both temporary accounts removed; no emails sent).
- [x] Verify one real account cannot read or modify another account's expenses; also verified forged-owner insert rejection and private credential-table denials.
- [ ] Verify actual Google login and sign-out, with no previous user's data shown after an account change.
- [x] Verify real Supabase password-test sessions, same-account reads across two clients, backend session validation, and signed-out JWT rejection. This does not replace the actual Google/browser/mobile test above.
- [ ] Verify real Gmail import, review/confirmation, rescan deduplication, refunds and unpaid bills.
- [ ] Verify signing out leaves enabled Gmail tracking intact.
- [ ] Verify disconnect stops scans, revokes access, and keeps existing expenses.
- [ ] Check production logs after a complete Google/Gmail run. The current runtime-error summary reported none; individual log lookup returned a provider error, so full log review is not claimed.

## 6. Build and test Android

- [x] Owner created an Expo account, completed private CLI browser sign-in, and linked existing Ledger source to `@andromeda-666/ledger-finance-tracker`; project ID verified via EAS project info (25 November).

- [x] Android JavaScript bundle exported successfully.
- [x] Prepare preview APK and production AAB profiles, application/version identifiers and secret-safe mobile upload exclusions (`eas.json`, `.easignore`, `ANDROID_RELEASE.md`).
- [ ] Configure and verify the production public environment variables in the authorized Expo build project.
- [ ] Produce an installable preview APK or signed release AAB using an authorized build account.
- [ ] Install on a physical Android phone and verify Google sign-in deep linking, manual expenses, Gmail connection and disconnect.
- [ ] Verify release signing and version/application identifiers before distribution.

## Public-launch requirements

- [ ] Publish an accurate privacy policy with the operator's real contact information and retention/deletion details.
- [x] Implement account/data deletion endpoint and typed-confirmation app/web controls; simulated tests cover authentication, confirmation, revocation ordering and failed revocation preserving the account. Real hosted deletion test remains pending below.
- [x] Real hosted account deletion, cascading expense removal and deleted-session rejection passed using a temporary account. Both test accounts removed; no emails sent. First request exceeded the verification script 30-second timeout; retry using the app 60-second timeout passed.
- [ ] Determine and complete Google's verification requirements for the intended Gmail scopes and audience.
- [ ] If publishing through Google Play, prepare the store listing, data disclosures, deletion URL and required release review.

## Work allocation

- **Production configuration agent:** Vercel production access, environment/configuration verification and deployed smoke tests.
- **Gmail readiness agent:** ingestion reliability, scan/disconnect behavior, tests and exact external OAuth prerequisites.
- **Android/release agent:** build preparation, privacy/account-deletion implementation and Android validation.
- **Primary agent:** maintain this checklist, coordinate shared-file changes, verify hosted database behavior and integrate/publish the reviewed result.

## Next work, in order

1. Enable Gmail API and create the Ledger Gmail Web OAuth client in Google Cloud; put its client ID and secret in ignored `.env.server`. Upload through the prepared helper, redeploy, then test one real import, duplicate rescan and disconnect.
2. Test Google login through the production Vercel URL; local login is now confirmed.
3. Expo login and project linking are complete. Configure public build variables and produce a preview APK within the available allowance, then install and test on Android.
4. App display name is Ledger (owner choice). Collect the public support email and operator details, complete the privacy notice, then finish Google branding and the required review for the intended audience. A custom authentication hostname requires an owner-selected domain and a paid Supabase add-on.

## Current user-dependent items

- A Google sign-in and Gmail grant require the account owner's browser interaction; no agent test substitutes for actual consent.
- Google Gmail OAuth client credentials are not yet present in the private app configuration.
- Production private secret transfer, GitHub deployment, live database/API validation and temporary-account deletion checks are complete. Gmail is still unconfigured.
- Expo CLI login succeeded; project `@andromeda-666/ledger-finance-tracker` (`59a4ab3a-372c-4f96-9226-2a164ba457e9`) is linked and verified. No APK/AAB or signing credentials have been generated.
- Privacy-policy operator identity/contact, the intended public audience, and an authorized mobile build/publishing account must be confirmed before claiming public-launch readiness.
