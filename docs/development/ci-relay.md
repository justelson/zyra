# Helper CI relay setup

The source repository owns code and releases. The public helper repository runs requested checks from an exact source SHA. `scripts/ci/relay/worker.mjs` reports the result to the original commit with a GitHub App; it does not rely on source-account Actions.

## Requests and boundaries

| Event | Work |
| --- | --- |
| Trusted maintainer opens, reopens or updates an in-repository PR | Quick core/privacy checks; Desktop types and available leaf contracts unless changes are docs-only |
| Trusted maintainer adds `ci:quick` | Quick checks |
| Trusted maintainer adds `ci:full` | Existing Windows/macOS/Linux native Desktop validation |
| Trusted maintainer adds `ci:preview` | One personal Windows preview |
| Trusted maintainer adds `ci:preview-retry` | One fresh Windows preview attempt for the current SHA, even when its earlier build failed or its link expired |
| Ordinary comment, tag, schedule, or push with an existing preview label | No installer |

Only configured numeric maintainer IDs and the two exact repositories are accepted. External forks do not execute automatically. Bring an intentional candidate into a source-account branch before requesting it. The worker rechecks the PR head before dispatch. Completion attaches to the tested SHA, never a newer head. Old preview results are not posted as the latest download.

Webhook signatures are verified before persistence. A SQLite-backed Durable Object durably deduplicates deliveries and ordinary mode/source-SHA requests. Explicit preview retries add the verified webhook delivery's identity to the request claim; redelivery of that delivery never creates another attempt. A claim is saved before dispatch. A failed or uncertain HTTP response never automatically redispatches a build. Reporting can poll/retry without rebuilding. Requests/deliveries and failed-event metadata have seven-day retention with daily cleanup. Normal dispatches persist GitHub's returned workflow run ID; result matching also verifies workflow path, dispatch event, control branch and source identity. This is a small two-repository relay, not a general release scheduler.

### Retry an unchanged commit

Add `ci:preview-retry` to an open, in-repository PR as a configured maintainer. If the label is already present, remove it and add it again. That new label edge explicitly authorizes one fresh installer attempt; keeping either preview label on the PR does not authorize builds on subsequent pushes. Ordinary `ci:preview` requests still deduplicate the same PR/SHA for seven days. Separate PRs keep independent request and link identities, even when they point at the same commit.

An outstanding build or uncertain dispatch for the same mode/PR/SHA blocks another relay attempt. Inspect the helper first; the relay waits up to 100 minutes for a matching result before marking an unresolved request failed. Once the request is terminal, reapply `ci:preview-retry` to authorize another attempt. Closed PRs, moved heads, forks and unconfigured maintainers remain rejected. Manual workflow dispatch is still available after inspecting an unresolved run.

Every new preview sends `source_pr` (the PR number as a string), `request_id` (the webhook delivery UUID) and `target: windows-x64` in addition to `source_repository` and `source_sha`. The optional request token's workflow grammar is `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`; relay-generated delivery UUIDs are a narrower valid subset. The helper must use the exact run name `Preview <source_sha> request:<request_id>` when that optional token is present; without it, manual/legacy requests keep `Preview <source_sha>`. Delivery identity is persisted before dispatch, and the returned workflow run ID is retained when available. If the dispatch response is lost, reporting can recover a run with this exact token, SHA, workflow path, event and control branch; a plain same-SHA match is never reused for a new preview. Multiple matching candidates remain unresolved. Legacy retry records without a token still require their returned run ID. No ambiguous result automatically sends a replacement dispatch.

### Deliver links independently of builds

A successful preview stores its completed build state and a separate pending report with the exact run ID/attempt. Artifact lookup, temporary artifact invisibility, comment listing and comment write failures leave reporting pending. The alarm retries these operations without invoking another build or changing a successful check to failure.

The relay discovers and updates one PR comment beginning with `<!-- zyra-ci-relay:windows-preview -->`, owned by the configured GitHub App. It searches all comment pages; marked comments from other authors/Apps are ignored. A lost response after an accepted comment POST is recovered by rediscovering that comment. Identical content needs no write. Existing unmarked legacy preview comments remain untouched.

Before publishing, it rechecks that the PR is open, the current head/repository match and no newer preview request for that PR superseded this report. Older pending reports cannot replace the newest request's link. Expired artifacts, or reports still undelivered after seven days, stop polling and remain recorded as expired without rebuilding. Add `ci:preview-retry` when a fresh download is wanted. The helper's preview artifact retention must be seven days; the relay's comment identifies the dev channel and that retention. It does not extend an already expired artifact or publish a public release.

Candidate jobs have read-only repository tokens, no persisted checkout credentials, no App key, no original-repository write token and no signing secrets. Stable publication is not a relay mode. Original-master merge/protection changes are separate decisions.

## Provision once

1. Put reviewed `helper-checks.yml`, `desktop-ci.yml` and `windows-preview.yml` on the helper's trusted default automation branch. Configure `AUTOMATION_REF` to that branch. Each helper workflow independently enforces `ZYRA_SOURCE_REPOSITORY` (helper repository variable; default `justelson/zyra`). Keep it equal to the worker's `SOURCE_REPOSITORY`. Changing helper automation must not silently change the requested source revision.
2. Deploy with `scripts/ci/relay/wrangler.jsonc` on **Workers Free**, using the `new_sqlite_classes` migration. Do not create a legacy KV Durable Object or upgrade the account. SQLite Durable Objects are available on Free; exceeding free limits stops operations rather than authorizing a paid upgrade. This worker stores coordination metadata, not installers.
3. Register a GitHub App. Homepage: source repository. Webhook: `https://<worker-host>/github`, active, `application/json`, a user-entered high-entropy webhook secret. No OAuth user authorization or callback URL is required.
4. Repository permissions: **Checks read/write**, **Pull requests read/write** (result comments), **Actions read/write** (helper dispatch/result lookup), and mandatory **Metadata read**. No Contents write, administration, secrets or release publication permission. Subscribe to **Pull request** and **Workflow run**. The App must be installable on both accounts; a private App limited to its owning account cannot serve this setup. Install only the selected source/helper repositories. The worker's repository allowlist still rejects any other installation.
5. Generate the App private key yourself. GitHub supplies PKCS1 PEM; convert locally to PKCS8 PEM with `openssl pkcs8 -topk8 -nocrypt -in <downloaded-key.pem> -out <private-pkcs8.pem>`. Enter the result directly into a Cloudflare secret field or your own interactive `wrangler secret put` prompt. Never send keys, webhook secrets or access tokens in chat, source, command arguments or logs. Do not place the key in helper Actions secrets.
6. Set Cloudflare secrets `GITHUB_APP_PRIVATE_KEY` and `GITHUB_WEBHOOK_SECRET`. Set variables `GITHUB_APP_ID`, `SOURCE_INSTALLATION_ID`, `HELPER_INSTALLATION_ID`. Installation IDs are the numeric IDs in the respective App installation URLs, not repository IDs. Public variables `SOURCE_REPOSITORY`, `HELPER_REPOSITORY`, `AUTOMATION_REF`, `MAINTAINER_IDS` live in the reviewed config; adjust them deliberately if ownership/maintainers change.
7. Create `ci:quick`, `ci:full`, `ci:preview`, `ci:preview-retry` labels on the source repo. Adding a label is the request edge; retaining it does not authorize future installer builds.

CLI deployment from the repository root, after authenticating yourself to the intended free Cloudflare account:

```sh
npx --yes wrangler@4.147.0 deploy --config scripts/ci/relay/wrangler.jsonc
```

The App mints short-lived installation tokens narrowed to one repository and the permissions needed for its role. No token is persisted in relay storage. Source tokens have Checks/Pull requests write; helper tokens have Actions write. GitHub artifacts remain authenticated, seven-day downloads.

## Acceptance before requiring checks

Run `npm run test:ci-relay` and inspect `/health` (presence-only configuration check, not authentication proof). Then verify a live signed webhook, a helper quick-check dispatch for the exact PR SHA, a completion from the configured control branch, and a matching original check run. Verify duplicate delivery does not dispatch again and an old head cannot green the current revision. Verify an explicit same-SHA preview retry creates a distinct run and updates the same marked comment; reporting recovery must never create a build. Preview acceptance also requires the built installer/provenance/checksum and user-side install testing; a mocked relay test is not that acceptance.

Do not enable required checks until this live round trip succeeds. Existing source-branch workflows remain in effect until the source infrastructure PR is integrated; a helper/default-branch update does not merge or rewrite original `master`. Keep stable native/signing/notarization/checksum and exact-byte publication approval gates intact.

Completed-build delivery retries back off from one minute to a fifteen-minute cap; running builds retain one-minute polling. This never redispatches an installer.
