# Gmail setup

Google account sign-in and Gmail mailbox access are separate grants.

## Developer configuration

1. Enable the Google identity provider in Supabase Auth. Register the Supabase callback URL with the identity client, and configure the app's redirect allowlist. Sign-in requests only `openid email profile`.
2. Enable the Gmail API in Google Cloud. Configure the OAuth consent screen and add the read-only scope `https://www.googleapis.com/auth/gmail.readonly`. In testing mode, add the Google accounts allowed to test it.
3. Create a Web application OAuth client named **Ledger Gmail** for the optional Gmail connection. Register the production callback `https://ledger-expense-tracker-sekharendus-projects.vercel.app/api/oauth/google/callback` exactly. Keep this separate from the sign-in client configured in Supabase.
4. Put that client's `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` in Vercel's server environment. Keep them separate from the app's public variables.
5. Configure the Supabase server secret, token encryption key and cron secret using `.env.server.example` as the variable list. Apply the checked-in SQL migration to the intended hosted project.

The backend verifies the Google ID token, nonce and mailbox identity against the signed-in Supabase user, and uses PKCE and one-time state. It encrypts Google tokens before storing them in PostgreSQL. Secrets are not returned to the app. See [Google's server OAuth documentation](https://developers.google.com/identity/protocols/oauth2/web-server) and [Supabase Google sign-in](https://supabase.com/docs/guides/auth/social-login/auth-google).

Gmail read-only is a restricted scope. Public distribution can require Google's verification and security assessment; see [scope requirements](https://developers.google.com/workspace/gmail/api/auth/scopes). With an External audience and Testing publishing status, refresh tokens for Gmail scopes expire after seven days; reconnect during development as needed. See [Google's token-expiration rules](https://developers.google.com/identity/protocols/oauth2/).

## User experience

Sign in with Google, then optionally select **Settings → Connect Gmail**. Denying Gmail permission leaves manual tracking available. Approval triggers the first invoice scan. Additional scans run through Vercel cron while the backend is deployed, including while the user is signed out.

Disconnect immediately disables scans. If Google's revocation endpoint is temporarily unavailable, tracking stays stopped and the app offers a disconnect retry; scheduled processing also retries pending revocations. Existing expenses remain in the account. Signing out does not revoke the Gmail grant.

## Parsing and data handling

Each scan checks 25 recent billing messages. Email text/HTML and text PDFs are supported. HTML conversion does not load tracking images or external links. PDF workers have size, page, memory and time bounds. Message bodies and attachment files are processed in memory, while extracted records, source metadata and scan results are saved in PostgreSQL.

The deterministic parser handles INR, English labels, totals, dates, references, suggested categories and payment state. All imports start in review. Missing dates fall back to delivery date and are flagged. It excludes statements, failed payments, conflicting totals and unsupported currencies. It does not support OCR, scanned or password-protected PDFs, or currency conversion.

Matching message IDs and sender/invoice-reference/amount combinations suppress duplicates without overwriting corrections. Records without matching references can still represent the same purchase; verify their sources before marking both as paid.
