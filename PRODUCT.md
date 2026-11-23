# Ledger

<!-- impeccable:product-schema 1 -->

## Platform

android

## Users

People tracking personal expenses in Indian rupees on an Android phone.

## Product Purpose

Help people understand monthly spending, review expense records, and see unpaid bills. Success means accurate, understandable amounts and straightforward entry and correction.

## Operating Context

An Expo / React Native app using Expo Router. Overview, Inbox, Upcoming, and Settings are the existing destinations. The account implementation targets hosted Supabase Auth/PostgreSQL and Vercel API functions; live provider credentials and deployment must be verified separately.

## Capabilities and Constraints

- Preserve manual entry and correction, categories, paid/unpaid/review status, refunds, monthly summaries, fictional sample imports, CSV text sharing, and local deletion.
- All amounts are INR, represented internally in integer paise. Only paid records enter monthly spending totals; refunds reduce them. Unpaid dates are due dates and must become payment dates when confirming payment.
- Email ingestion was a future milestone in the approved design brief. Concurrent work has since added a Gmail connection/import interface and supporting email service. Preserve that work; actual mailbox use requires the separately configured service and Google credentials. This design pass has not validated a live Gmail connection.
- Google sign-in identifies the account; Gmail consent is optional and separate. Expenses belong to that account in PostgreSQL. Sign-out ends the app session, while Gmail tracking continues until explicitly disconnected. Gmail tokens are encrypted server-side. No notifications or offline expense editing are implemented.
- Sample records must remain explicitly fictional. Do not fabricate production integrations or financial claims.

## Brand Commitments

Ledger. The user approved a classy, minimalist redesign with an approximate 60% cream, 30% dark chocolate, and 10% caramel color balance. Preserve existing workflows.

## Evidence on Hand

The repository README documents the prototype. `src/expenses.ts` defines the expense rules and fictional sample records. `src/LedgerScreen.tsx` implements the current workflows. `src/email/` and `server/` contain the concurrent Gmail implementation; their presence does not establish configured provider credentials or live extraction accuracy.

## Product Principles

- Make spending and outstanding obligations clearly distinct.
- Let people inspect and correct records.
- Be precise about storage, sources, and unavailable capabilities.
- Keep routine personal bookkeeping easy to scan and operate.
