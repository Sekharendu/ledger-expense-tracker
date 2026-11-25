# Gmail setup

Google account sign-in and Gmail mailbox access are separate grants.

## Developer configuration

1. Enable the Google identity provider in Supabase Auth. Register the Supabase callback URL with the identity client, and configure the app's redirect allowlist. Sign-in requests only `openid email profile`.
2. Enable the Gmail API in Google Cloud. Configure the OAuth consent screen and add the read-only scope `https://www.googleapis.com/auth/gmail.readonly`. In testing mode, add the Google accounts allowed to test it.
3. Use the existing Web application OAuth client, or create a dedicated client named **Ledger Gmail**. Register the production callback `https://ledger-expense-tracker-sekharendus-projects.vercel.app/api/oauth/google/callback` exactly. If reusing the sign-in client, retain its existing Supabase `/auth/v1/callback` redirect too. The app still requests Gmail permission separately when the user chooses Connect Gmail; normal sign-in requests identity scopes only.
4. Put that client's `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` in Vercel's server environment. Keep them separate from the app's public variables.
5. Configure the Supabase server secret, token encryption key and cron secret using `.env.server.example` as the variable list. Apply the checked-in SQL migration to the intended hosted project.

The backend verifies the Google ID token, nonce and mailbox identity against the signed-in Supabase user, and uses PKCE and one-time state. It encrypts Google tokens before storing them in PostgreSQL. Secrets are not returned to the app. See [Google's server OAuth documentation](https://developers.google.com/identity/protocols/oauth2/web-server) and [Supabase Google sign-in](https://supabase.com/docs/guides/auth/social-login/auth-google).

Gmail read-only is a restricted scope. Public distribution can require Google's verification and security assessment; see [scope requirements](https://developers.google.com/workspace/gmail/api/auth/scopes). With an External audience and Testing publishing status, refresh tokens for Gmail scopes expire after seven days; reconnect during development as needed. See [Google's token-expiration rules](https://developers.google.com/identity/protocols/oauth2/).

## Secure production configuration

For the already-linked Ledger Vercel project, place `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in ignored `.env.server`, then run `npm run configure:gmail -- --check`. The helper defaults the callback to the production URL above, rejects a different callback and reports missing variable names without values. Once ready, `npm run configure:gmail` uploads only the Gmail variables through CLI standard input; a new production deployment is still required. It requires the owner's existing Vercel CLI login. It does not enable the Gmail API, grant consent, or change Google Cloud settings.

## Google sign-in branding

In the same Google Cloud project, open **Google Auth Platform → Branding**, set the app name to **Ledger**, and supply the owner's public support email, homepage and privacy-policy URL. Complete Google's brand verification to display the app name/logo on its consent screen. Changing the Supabase project's display name does not rename its API hostname.

To replace the actual `oxwrqvpfwgkffppczixx.supabase.co` hostname, use a Supabase custom domain such as `auth.example.com` on a domain you own. This is a paid add-on on a paid plan. Before activating it, register `https://auth.example.com/auth/v1/callback` in the Google **sign-in** OAuth client's authorized redirects while retaining the existing callback. This Supabase identity callback is separate from Ledger's `/api/oauth/google/callback` for optional Gmail access.

Sources: [Google branding and verification](https://support.google.com/cloud/answer/15549049), [Supabase Google consent branding](https://supabase.com/docs/guides/auth/social-sign-in/auth-google#setup-consent-screen-branding), [Supabase custom domains](https://supabase.com/docs/guides/platform/custom-domains).

## User experience

Sign in with Google, then optionally select **Settings → Connect Gmail**. Denying Gmail permission leaves manual tracking available. Approval triggers the first invoice scan. Additional scans run through Vercel cron while the backend is deployed, including while the user is signed out.

Disconnect immediately disables scans. If Google's revocation endpoint is temporarily unavailable, tracking stays stopped and the app offers a disconnect retry; scheduled processing also retries pending revocations. Existing expenses remain in the account. Signing out does not revoke the Gmail grant.

## Parsing and data handling

Each scan checks up to 25 recent billing messages within a 90-second mailbox processing budget. If time runs out after completed messages, those records are saved and the next scan resumes at the unfinished message; the continuation stores message IDs and provider pagination only. If no message completes, Ledger returns an explicit retryable timeout rather than reporting an empty success. Email text/HTML and text PDFs are supported. HTML conversion does not load tracking images or external links. PDF workers have size, page, memory and time bounds. Message bodies and attachment files are processed in memory, while extracted records, source metadata and scan results are saved in PostgreSQL.

The deterministic parser handles INR, English labels, totals, dates, references, suggested categories and payment state. Explicit full-payment evidence plus a document date can mark an expense paid automatically. It stores the payment method, paid amount, balance and supporting quote when available. Plain invoices/receipts, partial or conflicting payments and uncertain dates stay in review. Unpaid suggestions and refunds stay in review; partial balances are not treated as full paid expenses. Missing dates fall back to delivery date and are flagged. It excludes statements, failed payments, conflicting totals and unsupported currencies. It does not support OCR, scanned or password-protected PDFs, or currency conversion.

Matching message IDs and sender/invoice-reference/amount combinations suppress duplicates without overwriting corrections. Records without matching references can still represent the same purchase; verify their sources before marking both as paid.

## MVP acceptance check with a consenting mailbox

1. Sign in to Ledger with the same Google account that will connect Gmail. If the Google project is in Testing mode, add that account under **Google Auth Platform → Audience → Test users**.
2. Open **Settings → Connect Gmail**, approve read-only Gmail access, and return to Ledger. Declining must leave manual expenses usable.
3. Confirm the first scan finishes and records appear in the inbox. Use an existing INR receipt or text PDF from the last 90 days. No mail is sent by the importer.
4. Check the extracted merchant, total, date, payment evidence and original Gmail source. Full-payment evidence with a document date should create a paid record and update monthly spending. Plain invoices, partial/pending/ambiguous payments and missing dates must stay in review. A payment email can prove an attachment only when the invoice reference and amount match. Correct records as needed; repeated scans must preserve corrections.
5. Scan again and confirm the same receipt is not added twice. If more mail remains, continue scanning and verify records are preserved across batches.
6. Sign out and back in; expenses and the connected-mailbox status should persist. Scheduled tracking remains enabled while signed out.
7. Disconnect Gmail; verify tracking stops and existing expenses remain. Reconnect only when another test is needed.

Record live results in `READINESS.md`. Unit tests, a configured health endpoint and a saved credential are not substitutes for this real import check.
