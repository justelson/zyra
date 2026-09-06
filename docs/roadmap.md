# Zyra roadmap

**Status: Proposed. Last reviewed: 2026-09-06.**

This is the public, maintained backlog for upcoming Zyra releases. Add newly reported issues here as they arrive, and update their status as work progresses. Detailed execution notes and private diagnostics stay outside the public repository.

Planning starts from v0.6.1. See [published releases](https://github.com/justelson/zyra/releases) for shipped changes. A roadmap entry does not mean a fix is implemented or a release date is committed.

## Release targets

| Target | Focus | Planning state |
| --- | --- | --- |
| v0.6.2 | A stabilization batch across Desktop and TUI, including file opening, responsiveness and other confirmed issues added during triage. | Open for additional fixes. |
| v0.6.3 | Compatible fixes to update preparation, process ownership, installer preflight and update feedback. | Proposed; scope and compatibility review required. |
| Later, potentially v0.7.0 | Versioned runtime activation and rollback design that changes installation or compatibility contracts. | Design required; no release commitment. |

CLI/runtime and Desktop versions remain in lockstep. Roadmap targets do not change package versions. Follow the [release version rule](../RELEASE.md#version-rule): new installation workflows or meaningful compatibility boundaries require a new pre-1.0 line. Do not silently expand a patch release to include those changes.

## v0.6.2: stabilization

Keep this release open to additional confirmed bugs. The entries below are an initial backlog, not a frozen release checklist.

| ID | Kind / status | Issue or work item | Completion evidence |
| --- | --- | --- | --- |
| FIX-001 | Reported; needs reproduction and diagnosis | A packaged Windows file-open check did not reveal the preview and recorded sustained renderer CPU. Root cause and affected configurations remain unconfirmed. | A minimal reproduction, scoped fix and regression test. A real installed app opens a synthetic file in the dedicated maximized viewer, renders its content, and closes without leaving a busy test process. |
| FIX-002 | Candidate; behavior decision needed | Installing Desktop can replace an existing standalone TUI launcher. Review command precedence and repair behavior when both distributions are installed. | Document the intended launcher owner against the current release contract, then verify the supported install orders, updates, PATH resolution and fallback behavior. Do not silently change launcher policy. |
| QA-001 | Planned regression coverage | Check startup, file-preview and Chat responsiveness, including idle CPU and memory after closing windows. | Compare focused measurements against the [Desktop resource budget](performance/desktop-resource-budget.md). Add separate bug entries for distinct reproducible regressions. |
| QA-002 | Planned regression coverage | Recheck Project creation and naming, folderless Projects, cancellation, Chat scope, Plugin availability and revocation after stabilization fixes. | Focused tests preserve the existing [domain model](../CONTEXT.md), saved state and permission boundaries. Run installed-path checks where packaging affects behavior. |

QA entries describe coverage to retain; they do not claim that each listed flow is broken. Promote additional reports into separate FIX entries after triage, even if they were not part of the original file-viewer investigation.

### Release readiness

- Resolve confirmed release-blocking issues, or explicitly defer them with a reason and a reviewed release decision.
- Give each completed fix a reproduction or regression test and a PR or commit reference.
- Check the actual installed app for affected packaging, file-opening or launcher behavior. A package version, successful build or registry entry alone is insufficient.
- Preserve existing Chats, Projects, profiles, credentials and permission choices. Keep migrations and compatibility changes behind their own design review.
- Run the scoped checks first, then the required [release gates](../RELEASE.md). Keep local heavyweight checks serial and use CI for the native platform matrix.

## v0.6.3: safer update handling

These are proposed changes to the existing update architecture. Review their release-version impact before implementation.

### UPD-001: prepare before starting the installer

Extend the main-owned [update manager](../desktop/src/main/update/manager.ts) and [update state machine](../desktop/src/main/update/update-machine.ts). Add explicit preparing, blocked and installing states. Complete preparation before calling `quitAndInstall()`.

Reuse the existing shutdown persistence work in the [main lifecycle](../desktop/src/main/index.ts). Add an authenticated, installation-scoped maintenance handshake with the [agent server](architecture/agent-server.md) to block new work and reconnections during preparation, flush state and await worker shutdown acknowledgements. Let users wait or cancel when active or unsaved work blocks installation. Normal client disconnection must retain its current semantics.

### UPD-002: identify runtime ownership correctly

Use a trusted runtime root, installation identity, version, process ID and creation time to identify update blockers. A worker can use a cached Node executable while loading code from the application being replaced. Executable-path checks alone miss that case, and process IDs can be reused.

Preserve unrelated development instances and independent TUI sessions. Any legacy discovery fallback must establish ownership before requesting shutdown.

### UPD-003: check the installation directory once

Keep Chat Working roots, temporary files and logs outside the application directory, as required by the [domain invariants](../CONTEXT.md#migration-invariants). Use subprocess stdio controls instead of shell-dependent output suppression that can create reserved-name files such as `NUL`.

Run a bounded preflight for file locks, reserved names and permissions. Report the exact blocker. Preserve legacy files before repair and obtain approval for destructive repair steps. Avoid repeatedly moving the whole installed file tree to rediscover the same failure.

### UPD-004: respect resources and report real progress

Run one install operation at a time, with conservative CPU and disk priority. Expose the current phase, failure reason and recovery action. Bound retries and avoid concurrent scans, builds and installer attempts.

Distinguish a helper timeout from the native installer's actual state. A timeout must not launch a competing installer or claim success. Cancellation must account for any files already moved by the current operation.

### UPD-005: settle Desktop and TUI launcher ownership

Use FIX-002's agreed behavior as the contract. Give the stable command an explicit owner and preserve the user's supported distribution choice across repairs and updates. Check actual PATH resolution, not only the version reported by a fallback launcher.

### UPD-006: test the upgrade, including the older updater

Add a native upgrade test starting from the previous packaged release. Cover an open Desktop, detached cached-Node workers, a TUI, reserved-name files, active work and unsaved state. Verify shutdown choices, preserved data, the selected terminal launcher, current versions and file opening after installation.

Desktop-side preparation added in v0.6.3 only runs after v0.6.3 is installed. Test the transition onto that release using the older updater as well as later upgrades using the new preparation code. Do not rely on the incoming Desktop code to shut down the outgoing version.

Retain the existing one-commit, native-build, asset-checksum, remote-readback and publication gates. Automate repeated release handoffs without weakening those gates or treating a source-only smoke test as an installed-app health check.

## Design backlog: versioned runtime activation

**DESIGN-001. Proposed; separate design and release-version review required.**

Investigate extending the standalone TUI's versioned installation pattern to immutable shared runtime packages. Keep a stable launcher and verified active-version pointer, and retain the previous runtime until the new version passes health checks.

Decide runtime protocol compatibility, package verification, launcher ownership, old-version cleanup and data-migration behavior before implementation. Retaining old binaries does not guarantee that data can be rolled back. This work must not silently replace the current packaged-runtime contract or become a promised v0.6.3 feature without review.

## Adding and maintaining notes

1. Add a stable ID, observable symptom, affected version/platform and proposed target. Link a public issue when one exists.
2. Use **Reported**, **Planned**, **In progress**, **Verified** or **Deferred**. Mark candidates and design questions explicitly; do not present a hypothesis as a confirmed cause.
3. Include a minimal reproduction or the next diagnostic step, expected behavior and the evidence needed to close the item.
4. When a fix lands, add its PR or commit and test result. Mark it shipped only after publication, with a release link. Move unfinished items forward with a reason rather than dropping them.
5. Keep raw logs, private paths, screenshots, session IDs, account details and credentials out of this file and public issue reports. Publish only sanitized reproductions and conclusions.

For a new report, copy this structure into the relevant release section or propose an unassigned target:

```text
ID and title:
Kind / status:
Affected version and platform:
Observed behavior:
Expected behavior:
Reproduction or next diagnostic step:
Proposed release:
Completion evidence:
Issue / PR / commit:
```

Keep this roadmap current in follow-up PRs so release planning does not depend on remembering a conversation. Follow the [contribution guide](../CONTRIBUTING.md) and [focused validation workflow](development/fast-validation.md).
