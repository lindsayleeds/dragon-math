# Dragon Math on Google Cloud Run

Both public environments run in project `honorable-502113` (`Dragon Math Test`),
region `us-central1`. They use separate services, service accounts, secrets, and
Supabase databases:

| environment | hostname | service | runtime identity |
| --- | --- | --- | --- |
| test | `test.mydragonmath.com` | `dragon-math-test` | `dragon-math-test-runner@honorable-502113.iam.gserviceaccount.com` |
| production | `mydragonmath.com`, `www.mydragonmath.com` | `dragon-math-prod` | `dragon-math-prod-runner@honorable-502113.iam.gserviceaccount.com` |

The former test host on `camelot` and production host on `sondapor` are retained
only as rollback sources. Routine releases must target Cloud Run.

## Runtime contract

- Image repository: `us-central1-docker.pkg.dev/honorable-502113/dragon-math`
- Test blocks indexing, disables scheduled jobs, and stubs email.
- Production allows indexing, enables real email and scheduled jobs, and runs
  with one minimum/maximum instance plus always-allocated CPU. The single
  always-on process preserves the existing in-process cron contract without
  duplicating weekly mail or letting timers stall between requests.
- Runtime files are ephemeral, so admin
  uploads must not be treated as durable until they are moved to object storage.

The database and application credentials live in Secret Manager. Never put
their values in this repository, a build substitution, or a Cloud Run plain-text
environment variable.

## Build

The frontend Google OAuth client ID is public configuration, but Vite needs it
at image-build time. Read it from the deployed service so it does not have to be
duplicated in shell history:

```bash
PROJECT=honorable-502113
REGION=us-central1
SERVICE=dragon-math-test # or dragon-math-prod
SHA=$(git rev-parse HEAD)
SHORT=$(git rev-parse --short HEAD)
COMMIT_DATE=$(git log -1 --format=%cI HEAD)
IMAGE="$REGION-docker.pkg.dev/$PROJECT/dragon-math/$SERVICE:$SHORT"
GOOGLE_CLIENT_ID=$(
  gcloud run services describe "$SERVICE" \
    --project "$PROJECT" --region "$REGION" --format=json \
  | jq -r '.spec.template.spec.containers[0].env[] |
      select(.name == "GOOGLE_OAUTH_CLIENT_ID") | .value'
)

test -n "$GOOGLE_CLIENT_ID" && test "$GOOGLE_CLIENT_ID" != null
gcloud builds submit \
  --project "$PROJECT" \
  --config deploy/gcp/cloudbuild.yaml \
  --substitutions \
"_IMAGE=$IMAGE,_DM_COMMIT=$SHA,_DM_COMMIT_DATE=$COMMIT_DATE,_VITE_GOOGLE_OAUTH_CLIENT_ID=$GOOGLE_CLIENT_ID" \
  .
```

Build only a clean, reviewed checkout. The image records the current commit;
uncommitted source would make that identifier misleading.

## Release

The service's runtime configuration and secret bindings are already installed,
so a routine release changes only the immutable image:

```bash
gcloud run services update "$SERVICE" \
  --project honorable-502113 \
  --region us-central1 \
  --image "$IMAGE"
```

Cloud Run keeps earlier revisions. Roll back by listing revisions and sending
traffic to the selected healthy revision; do not rebuild an old tag.

## Verify

```bash
HOST=test.mydragonmath.com # or mydragonmath.com
curl --fail --silent --show-error "https://$HOST/api/health" | jq
curl --fail --silent --show-error "https://$HOST/version.json" | jq
curl --fail --silent --show-error "https://$HOST/robots.txt"
```

The health and version commits must match and database health must be `ok`.
Test's `robots.txt` must disallow all crawlers; production's must allow them and
must not return `X-Robots-Tag: noindex`.
