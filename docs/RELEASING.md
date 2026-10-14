# Releasing

A release passes a person three times:

1. **Release** (Actions → *Release* → Run workflow, on `main`). It runs the tests and
   `check:zip`, builds `seo-bw-extension-X.Y.Z.zip` from the commit you name (default
   `main`), and creates the GitHub release `vX.Y.Z` with the zip, its SHA-256, the
   "What's new" block from `docs/CWS-LISTING.md` §6 and GitHub's list of merged pull
   requests. It stops if `vX.Y.Z` already exists. It doesn't touch the store.
2. **Submit to Chrome Web Store** (Actions → *Submit to Chrome Web Store* → Run
   workflow, on `main`, version `X.Y.Z`). Starting this run is the approval. It
   downloads that release's zip, checks the version inside it, uploads it, and
   submits it for review as a **staged publish**. If a submission is already in
   review it stops instead of replacing it. Mode *upload* uploads without
   submitting; *check* signs in and shows the status without changing anything.
3. **Publish** in the Developer Dashboard once Google has approved it. Until then
   the store keeps serving the previous version.

The API changes the package only. Listing text (`docs/CWS-LISTING.md`), screenshots
and promo tiles (`store-assets/`) and the privacy answers are still entered in the
Developer Dashboard by hand, before step 2 if they changed.

Why two workflows: this repository is private on GitHub's Free plan, which has no
environment approval gates. A separate run that only the owner starts is the gate.
(On GitHub Team, an environment with required reviewers could replace it.)

## One-time setup (owner, about 15 minutes)

No Google key is created or stored anywhere. GitHub proves to Google that the
run is `store-submit.yml` on `main` in this repository (Workload Identity
Federation), and Google gives the run a token for that service account that
lasts 15 minutes.

You need the `gcloud` CLI signed in as the Google account that owns the Chrome Web
Store publisher (2-step verification on). Replace `PROJECT_ID` with a new or
existing Google Cloud project ID.

```bash
PROJECT_ID=seobw-release
REPO=seo-bandwagon/seobw-extension

# 1. Project and APIs
gcloud projects create "$PROJECT_ID"            # skip if it exists
gcloud services enable chromewebstore.googleapis.com iamcredentials.googleapis.com \
  sts.googleapis.com --project "$PROJECT_ID"
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')

# 2. The service account the run acts as (no roles needed in Google Cloud)
gcloud iam service-accounts create cws-release --project "$PROJECT_ID" \
  --display-name "Chrome Web Store release (GitHub Actions)"
SA="cws-release@$PROJECT_ID.iam.gserviceaccount.com"

# 3. Trust GitHub, but only this repository's store-submit.yml on main
gcloud iam workload-identity-pools create github --project "$PROJECT_ID" \
  --location global --display-name "GitHub Actions"
gcloud iam workload-identity-pools providers create-oidc seobw-store-submit \
  --project "$PROJECT_ID" --location global --workload-identity-pool github \
  --issuer-uri https://token.actions.githubusercontent.com \
  --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.workflow_ref=assertion.workflow_ref" \
  --attribute-condition "assertion.repository == '$REPO' && assertion.workflow_ref == '$REPO/.github/workflows/store-submit.yml@refs/heads/main'"
gcloud iam service-accounts add-iam-policy-binding "$SA" --project "$PROJECT_ID" \
  --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/$REPO"

echo "GCP_WORKLOAD_IDENTITY_PROVIDER=projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/providers/seobw-store-submit"
echo "GCP_SERVICE_ACCOUNT=$SA"
```

4. **Chrome Web Store Developer Dashboard → Account**: add the service account's
   email (`cws-release@….iam.gserviceaccount.com`) under *Service account*. A
   publisher can have only one.
5. Note the **Publisher ID** (Developer Dashboard → Account) and the **item ID**
   (the 32-letter ID in the extension's store URL).
6. **GitHub → the repository → Settings → Secrets and variables → Actions →
   Variables** (repository variables; none of these is a secret):

   | Name | Value |
   |---|---|
   | `GCP_WORKLOAD_IDENTITY_PROVIDER` | from step 3 |
   | `GCP_SERVICE_ACCOUNT` | from step 3 |
   | `CWS_PUBLISHER_ID` | from step 5 |
   | `CWS_ITEM_ID` | from step 5 |

7. Check it: run *Submit to Chrome Web Store* on `main` with mode **check** (any
   version). It signs in and prints what's published and what's in review, and
   changes nothing.

To revoke: delete the provider (`gcloud iam workload-identity-pools providers delete
seobw-store-submit …`) or remove the service account in the Developer Dashboard.

## Locally

```bash
npm run zip        # manifest.json lib/ src/ (from inside extension/) → seo-bw-extension.zip
npm run check:zip  # same, plus: every file the manifest and pages reference is in it
npm run bump -- patch   # or minor / x.y.z — see ROADMAP.md's versioning policy
```
