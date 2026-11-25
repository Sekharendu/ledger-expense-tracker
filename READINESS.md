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
- [x] Integrated validation: 76 tests passed; TypeScript, lint, web export and Android Hermes export passed. This is not an APK/device test.

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

- [x] Gmail API enabled; real authenticated message/attachment reads succeeded (25 November).
- [x] Register the Gmail production callback on the Web OAuth client (owner confirmation, 25 November). Read-only consent is tested separately below.
- [x] Install Gmail client ID, secret and canonical callback in Vercel production through CLI stdin; local ignored server configuration is also loaded. No secret values displayed.
- [x] Fresh GitHub-source deployment `dpl_AjdjRQ6M6pxBfPhNiQPuyZkGvaNU` is READY on commit `670f064`; live health returns databaseConfigured=true and gmailConfigured=true. Anonymous connection requests return401; invalid OAuth callbacks return400.
- [x] Owner approved Gmail access. A real forwarded GST invoice PDF was read and imported through the hosted scan pipeline into PostgreSQL review records (25 November); repeat scan added zero and reported one duplicate.
- [x] Replace daily Vercel scheduling with an enabled fifteen-minute Supabase recovery job calling `/api/cron`. Function duration remains 300 seconds. Scans discover new matching messages first and continue a bounded-time backfill queue.
- [x] Bound Gmail processing to a shared 90-second mailbox deadline, including token refresh, requests, retries and PDF workers. Completed messages resume through an ID-only cursor; zero-progress timeout is explicit and retryable. Five added regressions pass.
- [ ] Verify timing and resume behavior against real attachment-heavy Gmail messages. An exceptionally slow single message can remain pending with a visible timeout and require manual entry.
- [x] Prepare `npm run configure:gmail` for private credential upload; configuration check now passes and credentials are installed. Real consent/import remains pending.

## 5. Test the complete experience

- [x] Simulated tests cover OAuth callbacks, expiry/refresh paths, parsing, PDFs, duplicate detection, and disconnect behavior.
- [x] Embedded PostgreSQL tests cover account isolation, revoked-session access, scan leases, duplicate imports, and disconnect cancellation.
- [x] Verify manual create/edit/delete against the real hosted database using isolated test accounts (`scripts/verify-hosted-data.mjs --run`, 30 checks passed; both temporary accounts removed; no emails sent).
- [x] Verify one real account cannot read or modify another account's expenses; also verified forged-owner insert rejection and private credential-table denials.
- [ ] Verify actual Google login and sign-out, with no previous user's data shown after an account change.
- [x] Verify real Supabase password-test sessions, same-account reads across two clients, backend session validation, and signed-out JWT rejection. This does not replace the actual Google/browser/mobile test above.
- [x] Verify real Gmail PDF import into review and rescan deduplication. Added support for final totals with document-level INR or Indian GST/rupee evidence; no inline symbol is required.
- [x] Verify an owner-selected real invoice with matching full cash-payment evidence is paid automatically; guarded correction changed only its unchanged review record, preserved the single record and verified monthly paid-spending calculation in hosted data.
- [ ] Verify rendered dashboard updates and real refunds/unpaid bills on the installed app.
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

1. Finish the project-specific Google Cloud Pub/Sub setup, verify a live watch/notification and observe a new invoice imported automatically. Gmail consent, a real PDF import, payment detection and duplicate prevention are already verified.
2. Test Google login through the production Vercel URL; local login is now confirmed.
3. Expo login and project linking are complete. Configure public build variables and produce a preview APK within the available allowance, then install and test on Android.
4. App display name is Ledger (owner choice). Collect the public support email and operator details, complete the privacy notice, then finish Google branding and the required review for the intended audience. A custom authentication hostname requires an owner-selected domain and a paid Supabase add-on.

## Current user-dependent items

- A Google sign-in and Gmail grant require the account owner's browser interaction; no agent test substitutes for actual consent.
- Gmail consent, real PDF invoice import and repeat-scan deduplication are verified. Automatic full-payment classification and hosted monthly spending calculation are verified; ambiguous records still require review. Remaining device/disconnect checks are pending.
- Production private secret transfer, GitHub deployment, live database/API validation and temporary-account deletion checks are complete. Gmail configuration is now enabled; real PDF import and duplicate prevention are now verified.
- Expo CLI login succeeded; project `@andromeda-666/ledger-finance-tracker` (`59a4ab3a-372c-4f96-9226-2a164ba457e9`) is linked and verified. No APK/AAB or signing credentials have been generated.
- Privacy-policy operator identity/contact, the intended public audience, and an authorized mobile build/publishing account must be confirmed before claiming public-launch readiness.

## Automatic tracking — 25 November

- [x] Implement authenticated Gmail Pub/Sub receiver, per-mailbox watch registration, daily renewal, safe disconnect and retry behavior. Unit/HTTP tests pass; live Google delivery is tracked separately below.
- [x] Apply private processed-message cache, parser revision tracking, atomic scan commits and watch metadata to hosted Supabase. Client roles cannot access these records.
- [x] Configure the fifteen-minute recovery job in Supabase with its dedicated credential in Vault; safe status reports enabled=true and schedule */15 * * * *. Actual scheduled HTTP completion remains to verify below.
- [x] Implement active-only 30-second saved-expense refresh and Settings metadata refresh, foreground/focus refresh and account/unmount cleanup. Four fake-clock lifecycle tests pass; device/browser observation remains separate.
- [x] Prepare the project-specific Cloud Shell setup script for ledger-expense-tracker-515710; syntax and dry-run plan verified.
- [x] Integrated automatic-tracking regression suite: 76 tests passed; final TypeScript/lint and setup-script dry-run checks passed.
- [ ] Publish and verify the new deployment with the recovery and push settings.
- [ ] Owner runs the Google Cloud Shell setup for topic, publisher permission, dedicated delivery identity and authenticated subscription.
- [ ] Verify a live registered watch and a real Google-signed notification reaches the deployed receiver.
- [ ] Observe a new billing email imported without a manual scan and automatic dashboard refresh.
- [ ] Verify a recovery scheduler HTTP response succeeds and run hosted security advisors.

Pub/Sub is the primary trigger; fifteen-minute recovery covers dropped notifications and watch renewal. Delivery may be delayed. The MVP discovers newest matching billing IDs plus backfill rather than processing every Gmail history event. Existing manual corrections remain preserved. No Cloud billing plan is changed by the app code or Supabase setup.
