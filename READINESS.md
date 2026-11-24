# Ledger readiness checklist

Updated: 24 November 2026. An item is checked only after its stated evidence exists. A deployed page or passing simulated test does not establish working Google sign-in, Gmail ingestion, an installable Android build, or public-launch readiness.

## Verified foundation

- [x] Public GitHub repository: https://github.com/Sekharendu/ledger-expense-tracker (`main`).
- [x] Vercel is connected to that GitHub repository.
- [x] Production deployment reached READY from commit `5f99825f0ecba11ac2e58b72675d72f8ad50d4da`.
- [x] Homepage, `/auth/callback`, and `/api/health` returned HTTP 200 using Vercel-authenticated requests.
- [x] Supabase project `oxwrqvpfwgkffppczixx` is healthy; public and backend credentials validated without displaying secrets.
- [x] Ledger's five PostgreSQL tables are created with RLS enabled.
- [x] Google identity sign-in is enabled in Supabase. Local web and native OAuth initiation reach Google with identity scopes only.
- [x] Integrated validation: 37 tests passed; TypeScript, web export and Android Hermes export passed. This is not an APK/device test.

## 1. Finish production sign-in

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
- [ ] Redeploy the intended GitHub commit after environment changes.
- [ ] Verify the live API reports `databaseConfigured: true` and authenticated account requests succeed.

## 3. Allow public production access

- [x] Configure production deployment protection so ordinary users can reach the app and mobile API without a Vercel login; preview protection remains enabled (verified by production agent, 24 November).
- [x] Confirm unauthenticated public HTTP access to the sign-in page, `/auth/callback`, and health endpoint (all HTTP 200).
- [ ] Confirm user data and authenticated API endpoints remain protected by app authentication and ownership checks.

## 4. Enable Gmail tracking

- [ ] Enable the Gmail API in Ledger's Google Cloud project.
- [ ] Configure the separate Gmail OAuth client/consent grant and register `https://ledger-expense-tracker-sekharendus-projects.vercel.app/api/oauth/google/callback`.
- [ ] Install the Gmail client ID, client secret, and callback URL in the private production environment.
- [ ] Verify live `gmailConfigured: true`.
- [ ] Connect a consenting test mailbox and perform a real invoice/receipt import.
- [ ] Verify the scheduled scan configuration and documented cadence against the actual hosting plan and processing limits.

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
- [ ] Check production logs after an end-to-end run; resolve material runtime failures.

## 6. Build and test Android

- [x] Android JavaScript bundle exported successfully.
- [x] Prepare preview APK and production AAB profiles, application/version identifiers and secret-safe mobile upload exclusions (`eas.json`, `.easignore`, `ANDROID_RELEASE.md`).
- [ ] Configure and verify the production public environment variables in the authorized Expo build project.
- [ ] Produce an installable preview APK or signed release AAB using an authorized build account.
- [ ] Install on a physical Android phone and verify Google sign-in deep linking, manual expenses, Gmail connection and disconnect.
- [ ] Verify release signing and version/application identifiers before distribution.

## Public-launch requirements

- [ ] Publish an accurate privacy policy with the operator's real contact information and retention/deletion details.
- [x] Implement account/data deletion endpoint and typed-confirmation app/web controls; simulated tests cover authentication, confirmation, revocation ordering and failed revocation preserving the account. Real hosted deletion test remains pending below.
- [ ] Verify real hosted account deletion and cascading expense removal using a temporary account after redeployment.
- [ ] Determine and complete Google's verification requirements for the intended Gmail scopes and audience.
- [ ] If publishing through Google Play, prepare the store listing, data disclosures, deletion URL and required release review.

## Work allocation

- **Production configuration agent:** Vercel production access, environment/configuration verification and deployed smoke tests.
- **Gmail readiness agent:** ingestion reliability, scan/disconnect behavior, tests and exact external OAuth prerequisites.
- **Android/release agent:** build preparation, privacy/account-deletion implementation and Android validation.
- **Primary agent:** maintain this checklist, coordinate shared-file changes, verify hosted database behavior and integrate/publish the reviewed result.

## Current user-dependent items

- A Google sign-in and Gmail grant require the account owner's browser interaction; no agent test substitutes for actual consent.
- Google Gmail OAuth client credentials are not yet present in the private app configuration.
- Production-only private secret transfer completed without displaying values. A fresh deployment and live configuration check are still required to activate/verify the new environment.
- Expo CLI reports `Not logged in`; no Expo project is linked. No APK/AAB or signing credentials have been generated.
- Privacy-policy operator identity/contact, the intended public audience, and an authorized mobile build/publishing account must be confirmed before claiming public-launch readiness.
