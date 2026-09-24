# Dragon Math on Google Cloud Run

Both public environments run in project `honorable-502113` (`Dragon Math Test`),
region `us-central1`. They use separate services, service accounts, secrets, and
Supabase databases:

| environment | hostname | service | runtime identity |
| --- | --- | --- | --- |
| test | `test.mydragonmath.com` | `dragon-math-test` | `dragon-math-test-runner@honorable-502113.iam.gserviceaccount.com` |
| production | `mydragonmath.com`, `www.mydragonmath.com` | `dragon-math-prod` | `dragon-math-prod-runner@honorable-502113.iam.gserviceaccount.com` |

The former test host on `camelot` and production host on `sondapor` were
decommissioned on 2026-09-21. Cloud Run is the only deployment; rollback is a
traffic change between revisions, described under [Release](#release) below.

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

To show the web "Continue with Apple" button, also pass
`_VITE_APPLE_SERVICES_ID` and `_VITE_APPLE_REDIRECT_URI` in `--substitutions`
(both public, like the Google client ID) and add the Services ID to the
service's `APPLE_CLIENT_IDS`. Left out, they default to empty and the button
stays hidden. See [docs/APPLE_SIGN_IN.md](../../docs/APPLE_SIGN_IN.md).

Build only a clean, reviewed checkout. The image records the current commit;
uncommitted source would make that identifier misleading.

## Release

The service's runtime configuration and secret bindings are already installed.
If the release changes [the database schema](../../server/db/schema.js), apply
that schema to the target environment from the same clean, reviewed commit
**before** updating the service image; the database procedure and safety guard
are owned by [deploy/README.md](../README.md). This ordering keeps a new revision
from starting against an older schema. A release with no schema change updates
only the immutable image:

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
