# Zyra roadmap

**Status: Proposed. Last reviewed: 2026-09-09.**

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
| FIX-003 | In progress; local fix and synthetic replay verified | Desktop and TUI reportedly stream much more slowly than Codex. The shared bridge was refreshing filesystem-backed memory/status descriptions during streaming. A local fix reads only the existing usage/context counters. | The [streaming regression](../scripts/test-zyra-streaming-usage.mjs) preserves all events and metadata. In two synthetic replay samples per variant, 32 text chunks improved from 59–64 s to 0.30–0.33 s. This measures the real bridge with a synthetic provider, not live TPS or Codex parity. Packaged-client and matched live-provider checks remain pending; the fix is not released. |
| FIX-004 | Candidate; request-tier propagation needs reproduction | Explicit service-tier selection is absent from the remote chat configuration/prompt fields inspected during FIX-003. A worker may still inherit its saved preference. This does not establish which tier a reported run used. | Trace Desktop and TUI selections to a captured synthetic provider request, including saved/default preferences, before changing the tier contract. Keep this separate from the verified streaming-status fix. |
| FIX-005 | Local implementation and focused tests verified; not released | Catalog preparation now reports file/byte progress inline and survives route navigation. A bounded session-only cache reuses hash-verified file bytes, with fresh tree metadata. Compact review offers Install or explicit Install & new Chat; unsupported contributions remain inactive. | Downloader, controller, native install, authority/revocation, UI contracts and typechecks passed. Browser fixtures verified navigation, cancellation/retry, both install actions, catalog refresh after remount, partial Chat failure and narrow layout. Synthetic repeat file requests fell from 3 to 0; 3 metadata lookups remain. Exact-digest review, disabled-state preservation and existing Chat scopes remain enforced. Packaged-app/live-network performance verification is still pending. |
| FIX-006 | Local fix verified; not released | Fresh TUI picker interaction could repeatedly throw `query is not defined`. Permission-suggestion generation was misplaced inside the function that applies a selected item. | Moved generation into the correct function and added selection tests for models, permission aliases, themes, Skills and commands. Source regression reproduced the error before the fix. The compiled Windows TUI passed headless model/permission picker interaction with no provider requests. |
| FIX-007 | Local installer integration verified; not released | The TUI executable shared Desktop's icon, but its installer did not provide a branded terminal profile/launch entry, leaving generic shell icons visible. | The [Windows integration](guides/windows-tui-integration.md) uses the exact Desktop ICO for its own profile and Start Menu shortcut. Byte-equality, legacy-safe probing, isolated installation, idempotence and untouched user settings are tested. Local fragment icons need Windows Terminal 1.24+; existing shell tabs keep their host icon. |
| FIX-008 | User-confirmed in dev; not released | The New Chat picker repeated each Project for its home and associated folders. | The picker now lists one row per Project, uses its first saved folder's icon, and selects by Project ID. Folder rows and subtitles are removed; existing scope/default-working-root policy is unchanged. Focused tests and renderer typechecking passed; the user confirmed the fix in the development app. |
| FIX-009 | Local fix verified; not released | Read-only installed-app lookup no longer mistakes `Format-List` for disk formatting. Pending approval now marks the Chat as waiting and hides the blocked action from running counts. The approval prompt says the action has not run and explains remembered scope. | Permission classification, gate lifecycle, approval projection, persistence compatibility, prompt rendering and Pi runtime integration pass. Correlation and scope survive storage without a schema migration; late/concurrent events preserve waiting and denial shows a declined action. Full Desktop typechecking passes. |
| FIX-010 | Local and live fix verified; not released | [Computer-use helper lifecycle](https://github.com/justelson/zyra/issues/9): stale cleanup could terminate a newly acquired Windows helper. | Connection generations and acquisition leases preserve fresh work; targeted lifecycle, cancellation, timeout and Emergency Stop regressions pass. Real agent Paint drawing and exact-window reacquisition passed across helper lifetimes. |
| FIX-011 | Local and live fix verified; not released | [Chrome profile-window recovery](https://github.com/justelson/zyra/issues/10): exact names now preserve case, known browser process names reuse existing windows, and matched candidates include bounded title/process details. | Profile/reuse, query-scoped privacy, recovery and bridge regressions pass. Failed UIA trees clear old references; observation retries are bounded to the same exact target. Replaced windows require fresh exact grants; timed-out helpers terminate without replaying input. An isolated real Chrome picker verified case-distinct selection, picker closure and same-turn rediscovery with a fresh exact grant. Personal profile data was not used. |
| FIX-012 | Local and live fixes verified; independent freehand QA 8/10 | Windows pointer feedback follows actual native input across physical/display coordinates. The screen glow has deeper soft falloff and smooth entrance/exit. Native continuous strokes now retain the button across the supplied path. | Real Paint reproduction proved cursor relocation alone lost intermediate drawing; actual uncoalesced mouse motion preserves complete paths. Native ownership/cancellation, physical coordinate normalization, sequence and Desktop regressions pass. The uncoached freehand run scored 8/10 overall and 9/10 for functionality: 23 continuous Pencil strokes, 212 points, no shape tools, 185 seconds including one four-second consent. The earlier shape-based 9/10 does not count toward freehand acceptance. Subsequent empty-setup handling, compact lossless coordinate input and narrower grant-limit regressions pass; no fourth live run was performed. Exact-window grant reuse preserves expiry and remaining authority. Earlier overlay fixtures measured first-show delay from 220 to 15 ms and progress-to-frame median from 33 to 4 ms. Compositor cadence and non-primary-monitor live behavior remain unverified. |
| FIX-013 | Local fix and isolated measurements verified; not released | Opening OpenAI account settings loaded the model/auth SDK on Electron's main thread. An in-flight refresh could also restart polling after leaving the page. Account reads now use the existing auth worker, and polling belongs to the mounted page. | [Worker transport](../desktop/scripts/test-account-worker-transport.ts), [poll lifecycle](../desktop/scripts/test-account-overview-polling.ts), connection/cache contracts and a headless Electron worker import pass. In an isolated offline empty-account workload, the maximum main-loop gap fell from 7.55 s to 22 ms and peak process RSS from 225 to 150 MiB. No claim about live provider latency or whole-app memory; visual and packaged verification remain pending. Reset confirmation, fresh availability checks and single-consumption behavior remain enforced. |
| FIX-014 | Local Settings UI pass and focused checks verified; not released | Review every Settings destination for concise rows, appropriate control placement, direct navigation and usable collections. | All 18 routed pages were reviewed. Voice transcription and Git-generation settings moved to their owning pages with legacy-link preservation; account/provider controls, project/archive/log collections and metadata layouts are more compact. A follow-up arrangement pass exposes every page directly under five groups, redirects old category screens and adds section navigation derived from rendered page content. Sidebar, search, relocation, list-boundary, update-gating and Settings contracts pass, together with a scoped Settings dependency typecheck. No visual or packaged acceptance is claimed. The separate viewer/editor comparison remains research-only. |
| FIX-015 | Real-event reproduction and local fix verified; not released | Voice displayed both physical transcript chunks and logical turns, leaving unfinished prefix/tail bubbles pinned after canonical history. | A microphone-free synthetic-speech capture reproduced five orphan entries. The same recorded sequence leaves zero after the fix; a fresh capture preserves three complete user turns, including an intentional repeat, with zero orphan fragments. The renderer now uses logical turns as each speaker's authoritative stream while retaining turnless fallback. Recorded-event, delayed-commit, repeat, history and scoped type checks pass. No saved messages were deleted; existing temporary fragments clear when Voice restarts. |
| QA-001 | Planned regression coverage | Check startup, file-preview and Chat responsiveness, including idle CPU and memory after closing windows. | Compare focused measurements against the [Desktop resource budget](performance/desktop-resource-budget.md). Add separate bug entries for distinct reproducible regressions. |
| QA-002 | Planned regression coverage | Recheck Project creation and naming, folderless Projects, cancellation, Chat scope, Plugin availability and revocation after stabilization fixes. | Focused tests preserve the existing [domain model](../CONTEXT.md), saved state and permission boundaries. Run installed-path checks where packaging affects behavior. |

QA entries describe coverage to retain; they do not claim that each listed flow is broken. Promote additional reports into separate FIX entries after triage, even if they were not part of the original file-viewer investigation.

### Release readiness

- Resolve confirmed release-blocking issues, or explicitly defer them with a reason and a reviewed release decision.
- Give each completed fix a reproduction or regression test and a PR or commit reference.
- Check the actual installed app for affected packaging, file-opening or launcher behavior. A package version, successful build or registry entry alone is insufficient.
- Preserve existing Chats, Projects, profiles, credentials and permission choices. Keep migrations and compatibility changes behind their own design review.
- Run the scoped checks first, then the required [release gates](../RELEASE.md). Keep local heavyweight checks serial and use CI for the native platform matrix.

## Current integration pass: runtime and provider flows

These changes are implemented locally on `dev`, with the commit recorded in Git history. They are not a published release. See [provider and memory ownership](development/provider-and-memory-flows.md) for the maintained contracts and focused commands.

| ID | Status | Observable change | Verification and limits |
| --- | --- | --- | --- |
| FIX-016 | Local fix verified; not released | Corrected or shortened model snapshots replace prior text across main batching, canonical replay and renderer presentation. Repeated true deltas remain intact. | Snapshot, empty correction, repeated-token, batching and replay regression tests pass. This fixes duplication; it does not claim higher provider throughput. |
| FIX-017 | Local fix and isolated rendering verified; not released | Inspector geometry belongs to one frame before lazy content loads. File text remains readable during Monaco initialization, and editor warming follows the selected workspace. | Hidden Electron confirms monotonic opening, full-height content and inert zero-width closure. The supported Monaco loader and language features remain intact. Installed-app latency is not claimed. |
| FIX-018 | Local contracts verified; not released | Desktop idle sessions schedule bounded, cancellable memory consolidation. Settings reads the server data root. Five speaking styles replace built-in learner/builder personas; `/start` is removed. | Idle scheduling, memory extraction/privacy, data-root, preference and TUI tests pass. Existing memory is preserved; live personal memory extraction was not inspected. |
| FIX-019 | Local integration verified; not released | Setup and Settings support Zen keys, Claude API keys and custom endpoints, with ChatGPT recommended. Saved connections flow through model selection, title fallback and fleet inheritance. | Synthetic verification and real Pi runtime persistence, existing-session refresh and credential removal pass. Public OpenCode free access rejected the Zyra client; no-key access is not advertised. Live user API accounts and packaged setup remain unverified. |

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

## Development verification requirement

Use [targeted tests first](development/fast-validation.md) for every scoped fix. Keep helper/component tests independent of SDK and app startup, provide direct test commands, and run broader checks only at justified integration/release checkpoints. Do not repeatedly require app closures or whole-Desktop checks for routine edits. Release gates remain mandatory.

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
