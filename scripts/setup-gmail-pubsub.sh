#!/usr/bin/env bash
# Run in Google Cloud Shell as the owner of this exact project. No private keys
# are created or downloaded. Default is a plan; --apply provisions the resources.
set -euo pipefail
PROJECT_ID='ledger-expense-tracker-515710'
TOPIC='ledger-gmail-incoming'
SUBSCRIPTION='ledger-gmail-push'
ACCOUNT='ledger-gmail-push'
SERVICE_ACCOUNT="${ACCOUNT}@${PROJECT_ID}.iam.gserviceaccount.com"
ENDPOINT='https://ledger-expense-tracker-sekharendus-projects.vercel.app/api/gmail/notifications'
if [[ "${1:-}" != '--apply' ]]; then
  printf 'Project: %s\nTopic: %s\nSubscription: %s\nPush identity: %s\nEndpoint: %s\n' "$PROJECT_ID" "$TOPIC" "$SUBSCRIPTION" "$SERVICE_ACCOUNT" "$ENDPOINT"
  printf 'Run with --apply to enable APIs, create these resources and grant their scoped permissions.\n'
  exit 0
fi

gcloud projects describe "$PROJECT_ID" --format='value(projectId)' >/dev/null
gcloud services enable pubsub.googleapis.com iam.googleapis.com iamcredentials.googleapis.com --project="$PROJECT_ID"
gcloud beta services identity create --service=pubsub.googleapis.com --project="$PROJECT_ID" >/dev/null

if ! gcloud pubsub topics describe "$TOPIC" --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud pubsub topics create "$TOPIC" --project="$PROJECT_ID"
fi
gcloud pubsub topics add-iam-policy-binding "$TOPIC" --project="$PROJECT_ID" \
  --member='serviceAccount:gmail-api-push@system.gserviceaccount.com' --role='roles/pubsub.publisher' >/dev/null

if ! gcloud iam service-accounts describe "$SERVICE_ACCOUNT" --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$ACCOUNT" --display-name='Ledger Gmail push delivery' --project="$PROJECT_ID"
fi
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
gcloud iam service-accounts add-iam-policy-binding "$SERVICE_ACCOUNT" --project="$PROJECT_ID" \
  --member="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com" \
  --role='roles/iam.serviceAccountTokenCreator' >/dev/null

if gcloud pubsub subscriptions describe "$SUBSCRIPTION" --project="$PROJECT_ID" >/dev/null 2>&1; then
  EXISTING_TOPIC="$(gcloud pubsub subscriptions describe "$SUBSCRIPTION" --project="$PROJECT_ID" --format='value(topic)')"
  if [[ "$EXISTING_TOPIC" != "projects/${PROJECT_ID}/topics/${TOPIC}" ]]; then
    printf 'Existing subscription has a different topic; no subscription changes made.\n' >&2
    exit 1
  fi
  gcloud pubsub subscriptions modify-push-config "$SUBSCRIPTION" --project="$PROJECT_ID" \
    --push-endpoint="$ENDPOINT" --push-auth-service-account="$SERVICE_ACCOUNT" --push-auth-token-audience="$ENDPOINT"
else
  gcloud pubsub subscriptions create "$SUBSCRIPTION" --project="$PROJECT_ID" --topic="$TOPIC" \
    --push-endpoint="$ENDPOINT" --push-auth-service-account="$SERVICE_ACCOUNT" --push-auth-token-audience="$ENDPOINT" \
    --ack-deadline=120 --expiration-period=never --min-retry-delay=10s --max-retry-delay=600s
fi
printf '\nPUBSUB_SETUP_OK\n'
printf 'GMAIL_PUBSUB_TOPIC=projects/%s/topics/%s\n' "$PROJECT_ID" "$TOPIC"
printf 'GMAIL_PUBSUB_SUBSCRIPTION=projects/%s/subscriptions/%s\n' "$PROJECT_ID" "$SUBSCRIPTION"
printf 'GMAIL_PUBSUB_SERVICE_ACCOUNT=%s\nGMAIL_PUBSUB_AUDIENCE=%s\n' "$SERVICE_ACCOUNT" "$ENDPOINT"
