# Ledger privacy notice — draft for owner review

This draft describes the implemented data flow. It is not ready for public publication until the operator/contact and retention items below are completed and checked against the deployed service.

## Operator and contact — required before publication

- Legal name or business operating Ledger: **owner to supply**.
- Public privacy/support contact address: **owner to supply**.
- Effective date and public policy URL: **owner to confirm**.
- Any legal retention requirement, provider backup/log retention, and applicable regional disclosures: **owner to confirm**.

## Information Ledger processes

When you sign in with Google, Supabase Auth processes the Google identity information needed to create or find your Ledger account, including your account identifier, email address and available profile name. Sign-in does not itself connect your inbox.

Ledger stores expenses you enter or correct, such as merchant, amount, currency, date, category, payment state and notes. Expense data is associated with your Ledger account.

Connecting Gmail is optional and requests read-only access. When connected, Ledger's backend searches recent billing messages and processes matching email text/HTML and supported text PDF attachments to identify receipts, invoices and refunds. It stores extracted expense fields and source metadata, including sender, message subject, message/thread identifiers, attachment name when applicable and a source link. Scan history includes progress, counts, errors and metadata for messages needing attention.

The current backend processes raw email bodies and PDF files in memory; it does not intentionally persist those raw bodies or attachments. It stores Google access/refresh credentials encrypted in the account database so scheduled scans can continue. Hosting, authentication and database providers may process operational request information, such as network addresses, timestamps and error information, under their own terms.

## How information is used

Ledger uses account information to sign you in and separate your records from other accounts. It uses expense data to show spending, categories, outstanding bills and records needing review. Optional Gmail access is used to identify billing records and maintain the connection for later scans. The implemented deterministic parser does not send email content to an external AI model.

## Services involved

Google handles Google sign-in and Gmail permission. Google Cloud Pub/Sub delivers mailbox-change metadata (email address and history identifier) to the backend when enabled. Supabase provides account authentication, PostgreSQL storage and recovery scheduling. Vercel runs the hosted backend and invoice processing. Ledger retains handled message IDs and extraction-version metadata to avoid repeatedly parsing the same emails. The Android app stores its sign-in session using device SecureStore; the browser preview uses sessionStorage. Server Google credentials are not embedded in the mobile app.

The operator must verify the final providers, hosting regions and any additional analytics/support services before publishing this notice.

## Your controls

You can use manual expense tracking without connecting Gmail. Clear full-payment evidence and a document date allow Ledger to mark an import paid automatically. Uncertain imports remain in review. You can inspect and correct any record and its extracted payment evidence.

Signing out ends that app session and keeps your expense account and any connected Gmail tracking. Disconnecting Gmail stops future scans and requests revocation of Google access. If Google is temporarily unavailable, tracking remains disabled while revocation is retried. Previously imported expenses remain until you delete them.

Deleting expense records removes those expense records; related scan-history metadata can remain until account deletion. Settings → Delete Ledger account requests deletion of the account and its associated active database records. Gmail access is revoked first, then app sessions are revoked and the account is deleted. If Gmail revocation cannot complete, the account is kept so deletion can be retried, while scans remain stopped.

Account deletion does not delete your Google account or original emails. Provider backups and operational logs may have separate retention rules; the operator must confirm and disclose those rules before publishing a final policy.

## Retention and publication review — unresolved

The current application keeps account records until the user deletes them or the operator applies an approved retention rule. No automatic expiry for retained expense/scan history is implemented. Before release, specify the operator's retention policy and verify backup/log deletion behavior, security controls, user request handling and the accuracy of Google/Play disclosures.

## Sources used for the release requirements

- [Google Play account deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111)
- [Supabase administrative account deletion](https://supabase.com/docs/reference/javascript/auth-admin-deleteuser)
