# Helper CI relay setup

The source repository owns code and releases. The public helper repository runs requested checks from an exact source SHA. `scripts/ci/relay/worker.mjs` reports the result to the original commit with a GitHub App; it does not rely on source-account Actions.

## Requests and boundaries

| Event | Work |
| --- | --- |
| Trusted maintainer opens, reopens or updates an in-repository PR | Quick core/privacy checks; Desktop types and available leaf contracts unless changes are docs-only |
| Trusted maintainer adds `ci:quick` | Quick checks |
| Trusted maintainer adds `ci:full` | Existing Windows/macOS/Linux native Desktop validation |
| Trusted maintainer adds `ci:preview` | One personal Windows preview |
| Ordinary comment, tag, schedule, or push with an existing preview label | No installer |

Only configured numeric maintainer IDs and the two exact repositories are accepted. External forks do not execute automatically. Bring an intentional candidate into a source-account branch before requesting it. The worker rechecks the PR head before dispatch. Completion attaches to the tested SHA, never a newer head. Old preview results are not posted as the latest download.

Webhook signatures are verified before persistence. A SQLite-backed Durable Object durably deduplicates deliveries and mode/source-SHA requests. A claim is saved before dispatch. A failed or uncertain HTTP response never automatically redispatches a build. Reporting can poll/retry without rebuilding. Expensive work requires a new explicit request; manual workflow dispatch remains available for an unchanged SHA or expired artifact. Requests/deliveries and failed-event metadata have seven-day retention with daily cleanup. Normal dispatches persist GitHub's returned workflow run ID; result matching also verifies workflow path, dispatch event, control branch and source identity. This is a small two-repository relay, not a general release scheduler.

Candidate jobs have read-only repository tokens, no persisted checkout credentials, no App key, no original-repository write token and no signing secrets. Stable publication is not a relay mode. Original-master merge/protection changes are separate decisions.

## Provision once

1. Put reviewed `helper-checks.yml`, `desktop-ci.yml` and `windows-preview.yml` on the helper's trusted default automation branch. Configure `AUTOMATION_REF` to that branch. Each helper workflow independently enforces `ZYRA_SOURCE_REPOSITORY` (helper repository variable; default `justelson/zyra`). Keep it equal to the worker's `SOURCE_REPOSITORY`. Changing helper automation must not silently change the requested source revision.
2. Deploy with `scripts/ci/relay/wrangler.jsonc` on **Workers Free**, using the `new_sqlite_classes` migration. Do not create a legacy KV Durable Object or upgrade the account. SQLite Durable Objects are available on Free; exceeding free limits stops operations rather than authorizing a paid upgrade. This worker stores coordination metadata, not installers.
3. Register a GitHub App. Homepage: source repository. Webhook: `https://<worker-host>/github`, active, `application/json`, a user-entered high-entropy webhook secret. No OAuth user authorization or callback URL is required.
4. Repository permissions: **Checks read/write**, **Pull requests read/write** (result comments), **Actions read/write** (helper dispatch/result lookup), and mandatory **Metadata read**. No Contents write, administration, secrets or release publication permission. Subscribe to **Pull request** and **Workflow run**. The App must be installable on both accounts; a private App limited to its owning account cannot serve this setup. Install only the selected source/helper repositories. The worker's repository allowlist still rejects any other installation.
5. Generate the App private key yourself. GitHub supplies PKCS1 PEM; convert locally to PKCS8 PEM with `openssl pkcs8 -topk8 -nocrypt -in <downloaded-key.pem> -out <private-pkcs8.pem>`. Enter the result directly into a Cloudflare secret field or your own interactive `wrangler secret put` prompt. Never send keys, webhook secrets or access tokens in chat, source, command arguments or logs. Do not place the key in helper Actions secrets.
6. Set Cloudflare secrets `GITHUB_APP_PRIVATE_KEY` and `GITHUB_WEBHOOK_SECRET`. Set variables `GITHUB_APP_ID`, `SOURCE_INSTALLATION_ID`, `HELPER_INSTALLATION_ID`. Installation IDs are the numeric IDs in the respective App installation URLs, not repository IDs. Public variables `SOURCE_REPOSITORY`, `HELPER_REPOSITORY`, `AUTOMATION_REF`, `MAINTAINER_IDS` live in the reviewed config; adjust them deliberately if ownership/maintainers change.
7. Create `ci:quick`, `ci:full`, `ci:preview` labels on the source repo. Adding a label is the request edge; retaining it does not authorize future installer builds.

CLI deployment from the repository root, after authenticating yourself to the intended free Cloudflare account:

```sh
npx --yes wrangler@4.147.0 deploy --config scripts/ci/relay/wrangler.jsonc
```

The App mints short-lived installation tokens narrowed to one repository and the permissions needed for its role. No token is persisted in relay storage. Source tokens have Checks/Pull requests write; helper tokens have Actions write. GitHub artifacts remain authenticated, one-day downloads.

## Acceptance before requiring checks

Run `npm run test:ci-relay` and inspect `/health` (presence-only configuration check, not authentication proof). Then verify a live signed webhook, a helper quick-check dispatch for the exact PR SHA, a completion from the configured control branch, and a matching original check run. Verify duplicate delivery does not dispatch again and an old head cannot green the current revision. Preview acceptance also requires the built installer/provenance/checksum and user-side install testing; a mocked relay test is not that acceptance.

Do not enable required checks until this live round trip succeeds. Existing source-branch workflows remain in effect until the source infrastructure PR is integrated; a helper/default-branch update does not merge or rewrite original `master`. Keep stable native/signing/notarization/checksum and exact-byte publication approval gates intact.
