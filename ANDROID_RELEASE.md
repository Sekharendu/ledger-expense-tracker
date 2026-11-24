# Android build and device verification

The app targets Expo SDK 58, Android package `com.ledger.expensetracker`, and the `ledger` URL scheme. Supabase sign-in returns to `ledger://auth/callback` in an installed build.

## Prepared build profiles

- `preview`: an internally distributed, installable APK for an Android phone or emulator.
- `production`: an Android App Bundle for a later Play Store release. It increments the remote app version.

`eas.json` defines those profiles. `.easignore` excludes local credentials, server data and backend-only source from the mobile build upload. Server secrets must never be added to an Expo public variable or mobile build configuration.

## Account setup before the first cloud build

An Expo account and a linked Expo project are required. Check with `npx eas-cli@latest whoami`, then link/create the intended Ledger project using `npx eas-cli@latest init`. Confirm the owner and project before generating signing credentials or starting a build.

Set these public app variables in the Expo `preview` and `production` environments:

```text
EXPO_PUBLIC_SUPABASE_URL
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
EXPO_PUBLIC_EMAIL_API_URL
```

The API URL is `https://ledger-expense-tracker-sekharendus-projects.vercel.app`. Supabase's redirect allowlist must include `ledger://auth/callback`. The backend must be accessible without Vercel owner authentication for a phone to call it.

No private Supabase key, Google client secret, encryption key or cron secret belongs in the mobile build. They stay in Vercel.

## Build commands

After account/project linkage and environment verification:

```powershell
npx eas-cli@latest build --platform android --profile preview
```

This produces an APK when the cloud build succeeds. Record its build ID, status and artifact URL; source-bundle export alone is not an installable app.

For a separately authorized Play release, the production profile produces an AAB:

```powershell
npx eas-cli@latest build --platform android --profile production
```

Starting a cloud build, producing an artifact, installing it and testing it are separate checklist items. No Play Store submission is performed by these commands.

## Real-device smoke test

- Install the preview APK and launch it.
- Complete Google sign-in in the system browser and verify that the callback reopens Ledger.
- Create a manual expense, close/reopen the app, and verify the expense remains in the same account.
- Sign out and verify another signed-in account cannot see the first account's expenses.
- Deny optional Gmail permission and verify manual tracking remains available.
- Grant Gmail permission with a test account and verify scan/review, duplicate handling and source links.
- Sign out and verify the configured server schedule continues while Gmail is connected.
- Disconnect Gmail and verify future scans stop while existing expenses remain.
- Use Settings → Delete Ledger account, type DELETE, and verify the account and its data are removed.

Current source checks and simulated API tests cannot establish that these device steps pass. Record results only after observing them on an installed build.

## References

- [Expo SDK 58](https://docs.expo.dev/versions/v58.0.0/)
- [Build profiles](https://docs.expo.dev/build/eas-json/)
- [Installable Android APKs](https://docs.expo.dev/build-reference/apk/)
