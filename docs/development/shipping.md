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

Run `windows-preview.yml` in the configured helper repository. Supply the public source repository and its full 40-character commit SHA. The workflow checks out that commit, not the helper branch's app code. Its own workflow revision is recorded separately.

Previews are request-only. No push, PR event, ordinary comment, schedule or automatic retry creates an installer. A newer explicit request cancels an older preview build. Only Windows builds by default.

The helper's trusted automation branch must contain the workflow on its default branch before manual dispatch is available. Update it without rewriting history. The original repository remains the source/release home. Do not run the preview workflow in the source repository.

The requested commit must contain the preview isolation implementation. A dirty local checkout cannot be built by hosted CI; commit and push the intended source first. Do not silently apply an unrecorded patch to another commit and report it as an exact-source build.

The build derives `-alpha.<workflow-run-number>` versions in the runner's four package/lock root entries. Those metadata changes do not change the source commit. The compiled app and its provenance record distinguish source SHA, source version, derived package version, helper workflow SHA and run ID.

The installer creates **Zyra Preview**, with a separate application identifier, fixed per-user installation directory, settings/history profile, Chromium session storage and runtime namespace. It does not replace stable's Explorer actions, global `zyra` command or installed-Desktop locator. It cannot use stable's automatic update feed. Install the next explicitly requested preview manually.

A preview can still edit projects you deliberately open and invoke tools you approve. Isolation is not a sandbox for arbitrary project changes. It starts with its own app state; it does not automatically migrate stable history or credentials. Shared external provider accounts remain external accounts.

The job validates the actual packaged launch and embedded runtime before uploading:

- one personal Windows installer;
- `preview.json`, including source/run identity, installer size and SHA-256;
- `SHA256SUMS`, covering the installer and provenance record.

The Actions summary links to the artifact ZIP. GitHub login is required to download it. Extract it, verify the installer against `SHA256SUMS`, then install Preview beside stable. The artifact expires after one day; the installed application does not expire. Record problems with the source SHA from About and the build link.

Personal previews may be unsigned only with explicit maintainer approval. They must say so and may trigger Windows SmartScreen. This permission does not apply to stable publication or establish DRM, live-provider, migration or upgrade acceptance.

## Relay rollout

The manual preview workflow is usable before the webhook relay. The relay belongs outside the billing-blocked source account's Actions execution path. It must authenticate GitHub webhook signatures, allowlist repositories and maintainer requests, and report checks against the exact requested source commit.

An explicit preview label request may dispatch a preview. Keeping that label on a PR must not make later pushes rebuild installers. Ordinary comments do nothing. Duplicate webhook deliveries and completed builds must not dispatch repeats.

Keep App keys in Cloudflare secret bindings. Do not put them in source, logs, chat or build jobs. Candidate-code jobs have no signing secrets or original-repository write credentials. A successful helper workflow is not a check on the helper's app revision when it checked out a different source SHA.

Enable required external checks only after live reporting is verified. Do not mark billing-blocked checks as passed. The initial shipping PR does not grant permission to merge source PRs, change protection, publish stable, install software or buy services.

## Stable publication

[RELEASE.md](../../RELEASE.md) owns lockstep versioning, native packaging, signing/notarization, checksum and acceptance requirements. Stable still needs a separately approved candidate and publication. A beta-to-stable version change needs a new final-version build, not renamed beta files.

Keep one active stable candidate. If its source changes, build and validate a new candidate. Never combine files from different candidates or runs, replace a published installer, or reuse a prior unsigned exception without fresh approval.

Use published release assets for durable product distributions. Keep review screenshots and disposable preview installers out of stable release assets. Keep Actions artifact retention short; public standard-runner compute and artifact storage have different billing rules.
