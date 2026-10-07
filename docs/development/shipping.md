# Checks, personal previews and releases

Source changes and installer publication are separate operations. Use short-lived branches and small PRs. Keep runtime imports and generated changes separate from product changes. A merge does not publish an installer.

## Choose the right work

| Request | Work | Installer |
| --- | --- | --- |
| PR update | Quick checks and relevant regression tests | No |
| Ordinary comment | None | No |
| Explicit Windows preview request | Native Windows build, package validation and provenance | Yes |
| Full validation request | Core/Desktop checks and native platform checks | No by default |
| Approved stable candidate | Complete release, signing and acceptance gates | Separate publication approval |

[Fast validation](fast-validation.md) names the owning tests. Quick checks are not full release acceptance. Unknown or cross-platform behavior needs explicit broader validation; do not claim it passed from a focused test.

## Personal Windows preview

Run `windows-preview.yml` in the configured helper repository. Supply the public source repository and its full 40-character commit SHA. Optionally supply `source_pr` to scope cancellation to that PR and `request_id` to identify an explicit relay request in provenance; neither is required for direct dispatch. Request IDs accept letters/digits and `.`, `_`, `:`, `-`, up to 128 characters starting with a letter or digit. `target` defaults to the only supported target, `windows-x64`. The workflow checks out that commit, not the helper branch's app code. Its own workflow revision is recorded separately.

Previews are request-only. No push, PR event, ordinary comment, schedule or automatic retry creates an installer. A newer explicit request cancels an older build only for the same source repository, PR and target. Direct requests without a PR use the exact source SHA as their scope. Requests for other PRs continue independently. Only Windows x64 builds by default; no macOS, Linux or ARM installer is implied.

The helper's trusted automation branch must contain the workflow on its default branch before manual dispatch is available. Update it without rewriting history. The original repository remains the source/release home. Do not run the preview workflow in the source repository.

The requested commit must contain the preview isolation implementation. A dirty local checkout cannot be built by hosted CI; commit and push the intended source first. Do not silently apply an unrecorded patch to another commit and report it as an exact-source build.

The build derives `-dev.<workflow-run-number>` versions in the runner's four package/lock root entries. For a `0.7.0` source, run 4 produces `0.7.0-dev.4`; this does not change the source base version or promise a future stable version. Failed and cancelled workflow runs count toward that number. Reruns retain the version but have a different run attempt and artifact identity. Counters belong to the helper workflow; forks and other workflows can reuse a version string. Identify a build by source repository/SHA, helper workflow SHA, target, run ID and attempt, not version alone.

Those metadata changes do not change the source commit. The compiled app retains its exact source SHA/repository and run ID. `preview.json` and the Actions summary additionally distinguish the original source version, derived package version, `dev` channel, source PR, target, helper workflow SHA, run number and attempt. A future stable candidate must name the approved source SHA explicitly and pass its own final-version build gates; moving branch HEAD is not the identity of an approved preview.

Token-bearing requests use the run title `Preview <source_sha> request:<request_id>`. Direct/legacy requests without a token retain `Preview <source_sha>`. The request token separates an explicit same-commit retry from a previous run; it does not change the PR/target cancellation scope.

The installer creates **Zyra Preview**, with a separate application identifier, fixed per-user installation directory, settings/history profile, Chromium session storage and runtime namespace. It does not replace stable's Explorer actions, global `zyra` command or installed-Desktop locator. It cannot use stable's automatic update feed. Install the next explicitly requested preview manually.

The public channel is **Dev**; `preview` remains the internal distribution identity for compatibility. Setup shows “Dev channel” and its package version before installation, identifies the unsigned test build, and explains the separate profile and manual updates. The existing application ID, product/executable name, one-click/per-user installer layout and Preview profile are unchanged, so existing Preview installations keep their state. All PR previews still share that profile; they are not separate installations per PR. An older preview is not guaranteed to read data migrated by a newer one; preserve a backup before testing a downgrade.

The deterministic branding generator reuses the approved mark with a black background for dev icons. Normal generation preserves stable's deep-blue artwork. Hosted preview generation uses `brand:release-assets -- --preview` to stage black icons for both packaging and the packaged app's existing runtime icon filenames, without changing main/renderer lifecycle code. Source artwork remains unchanged.

A preview can still edit projects you deliberately open and invoke tools you approve. Isolation is not a sandbox for arbitrary project changes. It starts with its own app state; it does not automatically migrate stable history or credentials. Shared external provider accounts remain external accounts.

Dev packaging includes the compiled Desktop application, runtime resources and production dependencies. Raw Desktop source/build scripts and JavaScript/CSS source maps are omitted; the separate agent runtime source and its dependencies remain intact. This reduces installation payload without removing features or changing stable packaging. Previews retain the compact 7z package format; ZIP's larger download did not demonstrate a consistent speed improvement in the measured small-file sample.

On the hosted Windows runner, the job also silently installs the exact generated Preview installer, validates the installed runtime and launch, then reinstalls it through the update path. A Preview profile sentinel must survive both operations, and a stale installed file must disappear. Installation timings and Desktop archive size are reported in the build log. This exercises the generated installer on a clean runner; it does not establish older-version migration or installation speed on a user's PC. The install probe refuses local/self-hosted execution or a pre-existing Preview installation. No stable installer is executed.

The job validates the actual packaged launch and embedded runtime before uploading:

- one personal Windows installer;
- `preview.json`, including source/run identity, installer size and SHA-256;
- `SHA256SUMS`, covering the installer and provenance record.

The Actions summary links to the artifact ZIP. GitHub login is required to download it. Extract it, verify the installer against `SHA256SUMS`, then install Preview beside stable. The artifact expires after seven days; the installed application does not expire. Record problems with the source SHA from About, target, version and build link. Retention is not a durable public download or permission for automatic rebuilds.

Personal previews may be unsigned only with explicit maintainer approval. They must say so and may trigger Windows SmartScreen. This permission does not apply to stable publication or establish DRM, live-provider, migration or upgrade acceptance.

## Relay rollout

[Helper CI relay setup](ci-relay.md) owns the GitHub App/Cloudflare configuration, request labels and live acceptance checklist. `helper-checks.yml` is the dispatch-only quick lane; `desktop-ci.yml` retains the native matrix as a separate explicit full-check request. Neither builds an installer. The source workflow trigger change takes effect only after its infrastructure PR is integrated; updating helper automation is not a source merge.

The manual preview workflow is usable before the webhook relay. The relay belongs outside the billing-blocked source account's Actions execution path. It must authenticate GitHub webhook signatures, allowlist repositories and maintainer requests, and report checks against the exact requested source commit.

An explicit preview label request may dispatch a preview. Keeping that label on a PR must not make later pushes rebuild installers. Ordinary comments do nothing. Duplicate webhook deliveries and retained mode/source-SHA requests must not dispatch repeats. Reporting retries are not permission to retry installer dispatch.

Keep App keys in Cloudflare secret bindings. Do not put them in source, logs, chat or build jobs. Candidate-code jobs have no signing secrets or original-repository write credentials. A successful helper workflow is not a check on the helper's app revision when it checked out a different source SHA.

Enable required external checks only after live reporting is verified. Do not mark billing-blocked checks as passed. The initial shipping PR does not grant permission to merge source PRs, change protection, publish stable, install software or buy services.

## Stable publication

[RELEASE.md](../../RELEASE.md) owns lockstep versioning, native packaging, signing/notarization, checksum and acceptance requirements. Stable still needs a separately approved candidate and publication. A beta-to-stable version change needs a new final-version build, not renamed beta files.

Keep one active stable candidate. If its source changes, build and validate a new candidate. Never combine files from different candidates or runs, replace a published installer, or reuse a prior unsigned exception without fresh approval.

Use published release assets for durable product distributions. Keep review screenshots and disposable preview installers out of stable release assets. Keep Actions artifact retention short; public standard-runner compute and artifact storage have different billing rules.
