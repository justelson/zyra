# Zyra roadmap

**Status: v0.6.2 release preparation. Last reviewed: 2026-09-18.**

This is the public, maintained backlog for upcoming Zyra releases. Add newly reported issues here as they arrive, and update their status as work progresses. Detailed execution notes and private diagnostics stay outside the public repository.

Planning starts from v0.6.1. See [published releases](https://github.com/justelson/zyra/releases) for shipped changes. A roadmap entry does not mean a fix is implemented or a release date is committed.

## Release targets

| Target | Focus | Planning state |
| --- | --- | --- |
| v0.7.0 | Owned runtime, parallel-work and plugin workflows, and the accumulated post-0.6.2 Desktop/TUI changes. | Draft candidate on `release/0.7.0`; see [candidate scope and remaining gates](releases/0.7.0.md). |
| v0.6.2 | A stabilization batch across Desktop and TUI, including file opening, responsiveness and other confirmed issues added during triage. | Candidate under review. Publication requires native build gates. |
| v0.6.3 | Compatible fixes to update preparation, process ownership, installer preflight and update feedback. | Proposed; scope and compatibility review required. |
| Later line, unassigned | Versioned runtime activation and rollback design that changes installation or compatibility contracts. | Design required; no release commitment. |

CLI/runtime and Desktop versions remain in lockstep. Roadmap targets do not change package versions. Follow the [release version rule](../RELEASE.md#version-rule): new installation workflows or meaningful compatibility boundaries require a new pre-1.0 line. Do not silently expand a patch release to include those changes.

The previously proposed v0.7.0 updater activation/rollback design remains a separate design item; this candidate does not claim to complete it. Earlier candidate entries below retain their recorded evidence and limits.

## v0.6.2: stabilization

The v0.6.2 candidate combines the stabilization work accumulated on `dev`. The maintainer requested a patch bump from 0.6.1 and authorized a version-scoped unsigned publication exception. See [candidate notes and distribution limits](releases/0.6.2.md). Signing and the documented browser security delta are the only exceptions; testing, native builds, checksums and remote artifact readback remain required. Existing chats and installation namespaces are preserved, with no cross-installation takeover.

As of release preparation, the owner's hosted native jobs are rejected before startup. The approved build-helper workflow can supply native evidence for the same candidate SHA. Local Windows checks cannot replace macOS/Linux build evidence. The candidate is not published or installed until the required gates complete.

The entries below retain their individual verification limits. Unresolved candidate issues are not silently declared fixed by the release.

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
| MOB-001 | Android 0.1.14 review APK verified; device acceptance pending | Fixes empty settings/detail sheets, compacts Usage, updates speaking-style icons and adds theme-aware About branding. | See [feature coverage](../mobile/FEATURES.md). Fresh app/unit compilation, 352 Android tests, APK packaging, lint, privacy and 41 native renders pass. Signing continuity and alignment verified; physical-phone acceptance remains pending. |
| QA-001 | Planned regression coverage | Check startup, file-preview and Chat responsiveness, including idle CPU and memory after closing windows. | Compare focused measurements against the [Desktop resource budget](performance/desktop-resource-budget.md). Add separate bug entries for distinct reproducible regressions. |
| QA-002 | Planned regression coverage | Recheck Project creation and naming, folderless Projects, cancellation, Chat scope, Plugin availability and revocation after stabilization fixes. | Focused tests preserve the existing [domain model](../CONTEXT.md), saved state and permission boundaries. Run installed-path checks where packaging affects behavior. |
| FIX-024 | Local fix; focused tests pending runner execution | Child turn limits now count completed turns and reject only when a subsequent turn starts, allowing a final assistant answer on the limit boundary. Fleet Stop cancellation remains isolated from next-turn delegation. | `test:agent-fleet:cancellation` and the subagent contract test cover actual turn event ordering, retained assistant text, cancellation, scoped writer aliasing and shell denial. Runner evidence remains pending. |

| FIX-025 | Local fix and isolated playback verified; not released | Saved voice recordings could not play because the renderer blocked data audio URLs and a React source update interrupted first playback. The compact player now uses managed Blob URLs with one source assignment. | `test:voice-history-playback` exercises the actual settings page under the app CSP in isolated Electron: play, pause, seeking, replay, 10 ms recordings, deletion and late-load/unmount cleanup pass. Saved-recording verification in the user's restarted app remains pending. |
| FIX-026 | Local fix and focused regression verified; not released | Force send attempted to abort a canonical chat missing from the Desktop runtime and repeatedly retried failures. It now reattaches first, preserves interrupt failures, permits one in-flight abort per chat, and pauses the queued prompt for explicit retry. | `test:assistant-force-interrupt` verifies reattachment, connection failure, turn ownership, real React rerenders, preserved prompts, explicit retry and single dispatch. Full Desktop typechecking passes. User app restart and live provider verification remain pending; server crash causation is unconfirmed. |

| FIX-027 | Local fix and focused regressions verified; not released | Assistant Voice replies waited for completion, and later Actions could move above their spoken introduction. | Live transcript, canonical timing and durable reopen checks pass. The hidden timeline fixture verifies streaming message rows above primary-agent activity. Installed-app and live-provider acceptance remain pending. |
| FIX-028 | Local fix and focused regressions verified; not released | Rapid Chat navigation could reuse an Actions-only cache while saved conversation messages were missing. | Store/cache regressions and 24 rapid long/working-short switches in hidden Electron pass without remounting the virtual list. Installed-app acceptance remains pending. |
| FIX-029 | Local implementation and focused regressions verified; not released | Running commands kept completed turns Working, and Stop turn could terminate handed-off servers. | Managed process, exact-turn Stop, child ownership, live Thread Details controls and cleanup failure checks pass. Desktop typechecking passes. Installed-app, live-provider and packaged acceptance remain pending. |

QA entries describe coverage to retain; they do not claim that each listed flow is broken. Promote additional reports into separate FIX entries after triage, even if they were not part of the original file-viewer investigation.

### Plugin connection repair

Local implementation and focused checks are verified; not released or added to the published candidate. Release placement needs compatibility review.

Catalog Install & connect now continues into normal account consent. Mixed native/app connections retain reviewed descriptor limits, old Chats keep exact contribution pins, invalid OAuth tokens clear readiness, and idle connection reuse permits more than eight integrations sequentially. All three Google services use regular API adapters with actual-scope enforcement and safe-read verification. A bounded live Calendar read succeeded using an existing grant without account mutations.

The entire pinned catalog has a public-metadata coverage audit. This is not live verification of every provider. Closed-client registrations, administrator policies and nonportable hosted app references remain explicit limitations. Drive account verification and running-app activation remain pending. See [Plugin architecture](architecture/plugins.md) and the `test:google-api`, `test:plugin-connections`, Desktop `test:google-plugin-api` and `test:plugin-install-connect` targets.

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

### FIX-020: chats stuck at the loading presentation

Fixed locally; not released. Queued timeline frames now read current hydration and startup state, and chat switching preserves the new window's startup callback. This prevents an already-loaded short chat from remaining hidden. Initial viewport backfill and virtual-list reuse are preserved.

The isolated Electron `test:timeline-presentation` target verifies cold chat reveal, reused-list navigation, delayed hydration, initial paging and failed or abandoned requests. Existing history-streaming, pagination and scroll contracts pass. The affected chat was also verified in the running dev app after switching away and back.

### FIX-021: browser presentation and recording

Fixed locally and checked in the development app; not released. Native browser geometry follows inspector animations without idle polling. Recording uses direct native video capture, with a compact toolbar over the page, real microphone choices, tab audio and Windows system audio. Start/stop failures settle, capture releases before saving, and original encoder ownership survives supported tab transfers. Moving the last tab out of its recording window first requires saving the video.

Follow-up: Record Browser opens compact setup with explicit Start and remembered audio choices. Option panels animate their content-sized bounds. App menus and dialogs now use retained native overlay surfaces above the original live page. The temporary video/screenshot presentation path and per-menu capture preparation are removed. Focus, nested menus, late preparation and owner closure share one lifecycle contract; passive previews allow native pointer input through to the page. See [native app overlays](architecture/native-overlays.md).

Focused Electron checks cover moving video with generated tab audio, narrow menus, native layering, transfers and recovery. A live recording saved successfully; its frames exclude the controls, and microphone names, pause/resume, save, panel switching and inspector reopening were verified. Physical microphone and system-loopback recording remain separate device checks. See [browser recording and presentation](development/browser-recording.md).

Browser Backgrounds and History input-scope follow-up: fixed locally, not released. Their native input layer now uses browser bounds instead of covering the entire app. Scoped keyboard handlers leave other app controls alone; app-wide nested dialogs temporarily restore full coverage. `npm --prefix desktop run test:browser-scoped-overlays` passes real Electron bounds/zoom checks, portal lifecycle checks, and both panel interaction fixtures. Shared contract typecheck passes. Live app/OS pointer verification remains pending; the broader native smoke stopped on its guest-animation continuity check. A follow-up reproduced an up-left displacement when renderer HMR ran against a native build that ignored bounds. Renderer offsets now follow acknowledged native coordinates only, with legacy-host and delayed-acknowledgement coverage. Both panels keep their backdrop open on pointer clicks. Native bounds, renderer lifecycle, and panel fixtures pass individually; the combined command hit its overall timeout. The native process still needs an updated build and restart before the running app can provide browser-only input interception.

Background gallery redesign: implemented locally, not released. Backgrounds now uses a History-aligned right drawer without a dimmed backdrop, larger responsive photo previews, theme-aware captions below images, and fixed rotation controls. Connection settings scroll with the gallery instead of consuming the header. Catalog, native-caller, and isolated light/dark/narrow-layout checks pass, including selection, rotation, keyboard source switching and the search callback. The existing native-process restart remains deferred; isolated screenshots do not prove the running app has loaded that earlier fix.

Browser thumbnail follow-up: native capture could return the last painted frame after a hidden tab updated. Hover capture now waits for a delivered compositor frame, deduplicates concurrent requests and releases its subscription on success, error or timeout. Pure lifecycle tests pass, and three consecutive native runs verify fresh hidden-page pixels with unchanged native visibility and focus. Full release validation remains pending; no packaged acceptance is claimed.

Browser tab persistence follow-up: fixed the unsaved initial New Tab case locally. Browser saves its initial workspace snapshot even without navigation; mounting and reconciliation wait for the selected chat's inspector hydration. Focused persistence, inspector-state, New Tab interaction and TSX syntax checks pass. Private tabs remain excluded. Live chat-switch verification is pending.

Inline visualizations: implemented locally, not released. A bundled `visualize` skill supports proactive HTML/CSS/SVG explanations. Assistant messages use unboxed themed sandboxed previews, stream placeholders, incomplete states, inline expansion and sanitized HTML download; existing messages need no migration. A title-adjacent information popup contains the description and controls. View HTML opens a separate source dialog rather than expanding in the message. Focused interaction tests cover hover/click/keyboard access, focus return, escaped source and transparent light/dark rendering; isolated screenshots were inspected. The subsequent timestamp-placement change puts the message time beside the visualization information button and after following text, without repeating a final visualization's timestamp below it. That follow-up was source-reviewed only; tests were not run. Terminal replies show titles and summaries, without a new preview-opening command. Focused parser, TUI, skill/distribution, Markdown/media and Electron CSP/isolation tests pass, as do runtime manifest tests. The full renderer typecheck timed out without diagnostics after two minutes. No app restart or production build was performed. See [inline visualizations](architecture/visualizations.md).

Visualization scroll/reload follow-up, local only: the pinned LegendList web patch now preserves iframe state during DOM reordering; bounded sanitized-HTML caching removes repeated preparation, and initial previews reserve their full height. The isolated 40-chart workload reduced sanitizer calls from 211 to 41 and same-frame scroll reloads from 12 to zero. Focused renderer, dependency reorder, virtual timeline and leaf type checks passed. Live scrolling and the exact prompt-triggered flash remain unverified; a dependency bundle refresh is needed to exercise the patch in an already-running app. No restart or production build was performed. See [benchmark details and caveats](development/visualization-performance.md).

Browser/extension parity follow-up, local only: verified shared visualization imports in the browser and preview behavior under an MV3 extension origin/CSP. Fixed managed-font byte serialization across the browser bridge. The extension footer now has a Settings disclosure with extension settings, a fixed Desktop settings action and read-only account quota; it no longer shows the Desktop updater. Desktop app-menu commands now have a root-level renderer listener and bounded preload buffering through startup/remounts. Focused bridge, menu, font, visualization and syntax checks passed. The reported separate-window warning was traced to browser clients advertising Desktop-owned native overlays. Live and fallback browser adapters now omit those methods, and the HTTP bridge rejects them. A real-adapter regression failed before the fix and passed afterward with no companion-window attempts. The Desktop native-overlay renderer suite also passed. No production builds, client reloads or app restarts were performed. See `npm --prefix desktop run test:browser-surface-parity`.

### FIX-022: native file icons and preview chrome

Implemented locally, not released. Windows associations now use generated Material ICOs and per-extension registrations instead of the app logo. Context menus use normal placement, and upgrades remove the old pinned position. Installed Windows icon extraction verified distinct Markdown, lockfile, command and TSX icons while other applications retained their selected icons. Generated-asset tests and a compile-only NSIS fixture pass; a fresh install/upgrade/uninstall remains release QA. See [Windows file integration](development/windows-file-icons.md).

The standalone file viewer uses one header with the normal Zyra dropdown, filename, file actions and window controls. Loading retains usable controls; reload cannot discard a dirty editor, and close follows the preview's existing guard. Scoped menu-action and shell-window tests pass. Live visual acceptance remains pending.

### FIX-023: live status across runtime instances

Implemented locally, not released. A compatible busy service remains attached while a fingerprint update waits, instead of closing the observing client. Public namespace/instance identity, bounded heartbeats and last-confirmed timestamps distinguish live, stale, disconnected and update-pending status. Desktop, browser renderer, mobile and TUI consume this information; browser sharing also confirms its own broker connection and pins the selected installation. Desktop-owned terminals inherit the correct namespace, and development mobile hosts persist a separate listener port.

Connection, compatibility, idle-replacement, Desktop-worker replay, browser relay/shutdown, extension identity and mobile projection tests pass. Shared Desktop and extension TypeScript checks pass. Android parser/device verification and the live multi-instance matrix remain pending. No production service was stopped to apply this work. This pass does not merge dev/prod authority or introduce a cross-installation active-work directory. See [ADR 0018](adr/0018-separate-runtime-identity-compatibility-and-liveness.md).

### FIX-024: first response delay and submitted model-change marker

Implemented locally, not released. Canonical chat workers now claim one prepared spare instead of reloading the execution graph for every chat. Harness chats share one server-owned local transport, with separate sessions and permission callbacks. New-chat creation prepares the saved composer model in the background without a model request or blocking creation; unused harness services remain cold. Concurrent initialization, failed preparation, exited-transport recovery and shutdown have focused regressions.

Submitting a message records its turn ID and selected model before connection. The same ID reaches the runtime and canonical request, so the model-change divider renders immediately with the submitted prompt. SQLite history preserves earlier models; connection failures and cancellation settle the pending turn. Actual timeline and virtual-list rendering pass in an isolated hidden Electron fixture.

Further local work compiles the exact root schema dependency, loads the extension compiler on demand, overlaps native and worker setup, and delays spare replacement until attachment. A serial alternating offline comparison measured median cold attachment at 7.33 s before schema compilation and 5.93 s after it (19% reduction, six workers per mode; filesystem cache uncontrolled). Runtime schema generation retains its license, version isolation and revision hash. Model discovery now borrows the canonical native transport through private real bridge IPC.

Each chat retains a separate native conversation across matching turns, with history/model/effort/transport invalidation, bounded idle lifetime and failure/Stop cleanup. Authenticated native push events reduce polling; snapshots retain recovery. Managed native sessions skip redundant title generation. A process-local native config plugin prevents startup of unsupported duplicate MCP connections while preserving the user's native config and Zyra-owned tool connections. Actual native read denial reaches execution and returns no denied contents. Desktop staging and standalone resource collection include the plugin; a new packaged binary remains unverified.

Matched short live tasks with low-thinking Sol, high-thinking Luna and fast off measured prepared fresh chats at 6.7–11.0 s for Sol and 6.4–8.1 s for Luna, including attachment; follow-up turns took 3.7–3.9 s and 3.7–5.1 s respectively. Completely cold Sol fell from a repeated 56.3 s sample to 24.4 s after duplicate MCP startup was prevented; cold Luna took 26.0 s. Cold startup remains too slow, and prepared Sol still varies. These small samples establish improvements and remaining gaps, not a latency guarantee, billing reduction or Codex parity. `test:harness-performance`, actual bridge/server integration, runtime/main typechecks and the real marker fixture pass. Installed-app verification is pending; no running user app or service was restarted.

### FIX-027: live Voice replies and narration-before-action ordering

Fixed locally, not released. Chat now shows unfinished assistant speech alongside live user transcripts. Live speech keeps its first timeline anchor when primary-agent or Plugin activity arrives. Canonical commits retain the first speech-delta time separately from completion, so saved history keeps the introduction before later work. Legacy messages without a start time retain their existing timestamps; no history is rewritten.

`test:voice-chat-rail`, recorded dual-stream/interleaving replay, canonical Voice core, durable ledger reopen, streaming and action-boundary regressions pass. The hidden Electron timeline fixture verifies real assistant message rows growing before completion above primary-agent activity, with unrelated Markdown and evidence engines stubbed. Desktop typechecking passes. Installed-app and live-provider verification remain pending; no running user app or service was restarted.

### FIX-028: work-only view after rapid Chat navigation

Fixed locally, not released. A revision-matched cache containing only Actions could satisfy history readiness even when Chat counters showed saved messages. Both retained-window and synchronous-preview readiness now require message content when messages are known to exist, and bootstrap restores the missing conversation. Genuine message-free tool history remains reusable; cached previews are not removed just to hide the symptom.

The switching regression reproduced a skipped bootstrap and work-only view before the fix. Hidden Electron testing covers 24 rapid long/working-short switches, conversation visibility and virtual-list geometry without remounting the list, plus abandoned-page ownership. Switching, paged-history and history-streaming tests and renderer typechecking pass. An initial-scroll assertion failed once during the PR checkpoint. The baseline fixture passed, and the unchanged full fixture subsequently passed with tracing and three consecutive uninstrumented runs. This does not establish that the intermittency is resolved. Installed-app acceptance remains pending; no user app was restarted.

### FIX-029: turn completion, Stop and background process ownership

Implemented locally, not released. Completed and stopped turns no longer remain Working because a managed command is still running. Process lifetime retains the owning worker without reopening the foreground turn. Stop is bound to the active turn ID; its acknowledgement settles a missing provider ending, and late completion or retry cleanup cannot rewrite that terminal outcome. Running commands remain honest background-process evidence rather than keeping Action groups animated.

Stop turn cancels foreground commands and delegated agent work while preserving handed-off background processes. Bash accepts explicit `background: true` for servers and watchers, returns promptly, and avoids perpetual automatic polling. Ordinary yielded commands retain completion polling. Root and delegated Bash share app-owned process tracking with forced child ownership, so child completion does not kill its server or allow controls over another child's processes.

Thread Details reads the live runtime list rather than guessing from saved Actions. It offers individual Stop process controls and a confirmed Stop all processes action scoped to the displayed thread, preserves surviving commands after a stop, rejects stale chat-switch reads, and retains unconfirmed cleanup failures. Runtime shutdown and authority revocation retain full cleanup.

`test:managed-processes` and `test:assistant-background-processes` pass, including actual delegated runtime handoff and isolated hidden Electron controls. Existing managed Bash, force-send, terminal outcome, work-timeline, lifecycle, Browser bridge and Plugin revocation checks pass, along with full Desktop typechecking and whitespace validation. Installed-app, live-provider and packaged verification remain pending; no user app, server or terminal was restarted or stopped for validation.

### Permission-mode separation, 2026-10-01

Full access now bypasses local tool review and approval, as well as single-action and staged control side-effect approvals. Auto review sends deterministic local critical candidates to a separate tool-free reviewer session using the current chat model and connection at low effort; false positives proceed and uncertain or consequential decisions reach chat with their reason. The reviewer follows chat-model changes and is not warmed in Full access. Supervised, Edits only, target identity, observation freshness, cancellation and revocation remain unchanged. Focused permission and synthetic control regression targets cover these changes. Live-session refresh and packaged-release verification remain pending.

### GitHub issue verification, 2026-09-16

- [#14](https://github.com/justelson/zyra/issues/14): `filesystem_access` exposes the effective scope and requests a specific folder through the existing approval UI, including in Full access mode. Grants apply to the same running chat; Allow once covers one matching tool call and longer grants expire at reconnect. Saved read-only limits remain enforced. Recognizes `git -C <folder> status` as a read-only command without treating lowercase `-c` configuration as equivalent. Focused recovery, path-policy, SDK-startup and canonical reconnect checks pass; included in [PR #13](https://github.com/justelson/zyra/pull/13).

- [#7](https://github.com/justelson/zyra/issues/7), [#9](https://github.com/justelson/zyra/issues/9), [#10](https://github.com/justelson/zyra/issues/10): existing development fixes rechecked with scoped computer-tool projection, grant/observation, sidecar acquisition, target cancellation, profile matching and replacement-window recovery tests. No new packaged release or personal-profile replay is claimed.
- [#11](https://github.com/justelson/zyra/issues/11): repair recognizes supported Windows shell path spellings and explains scope denials. Thread Details now shows effective folder access and lets the user review/apply the current Project revision to the same idle Chat. Read-only ceilings and explicit scope updates remain required.
- [#12](https://github.com/justelson/zyra/issues/12): repair uses the actual current main window rather than selecting arbitrary auxiliary windows, buffers preload delivery across UI mount gaps, rejects expired acknowledgements, and settles abandoned requests. Tests cover ownership, cancellation, timeout, remount and closed-inspector reveal; a live Excalidraw mouse-drawing replay is still a separate acceptance check.
- [#1](https://github.com/justelson/zyra/issues/1): macOS/Linux verification is blocked. The latest native CI matrix was rejected before any job steps ran. Restore GitHub runner eligibility and rerun on the candidate commit; local Windows results cannot substitute for these platforms.

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

**DESIGN-002. In progress on dev; not released. Local OpenCode harness as a model provider.**

Instead of shipping another key, Zyra drives the user's already-installed, already-authenticated OpenCode CLI as its intelligence layer: detect the binary on PATH, run a Zyra-owned `opencode serve` on loopback with a per-spawn password, and pipe model turns through its session API. Credentials stay in OpenCode's store; direct Zen HTTP from Zyra remains unsupported (OpenCode-client restriction, see [provider flows](development/provider-and-memory-flows.md)).

Phase 1 (implemented, unreleased): `src/opencode-harness.mjs` owns detection, per-project serve lifecycle (loopback-only, idle stop, no orphans), connected-provider catalog mapping with inner-qualified ids, and a text-only turn pipe (history replayed via noReply messages, final message sent with tools disabled, private session deleted, non-text reply parts rejected loudly). `opencode-harness` provider kind is wired through `src/provider-connections.mjs` with credential-free metadata, Pi extension registration via `streamSimple`, and fleet-catalog `toolUse: false` until delegation is designed. Verification sends no model request (no spend).

Verified live (2026-09-21): one `opencode/big-pickle` turn through a Zyra-owned loopback server replied "OK" at zero cost, with framing parts tolerated, session deleted, and server stopped. See `scripts/test-opencode-harness-live.mjs` (manual gate, never in CI).

Settings UI (implemented, unreleased): Settings > Connections lists an "OpenCode harness" choice with a dedicated opt-in panel. Detection runs on mount and never connects; the harness stays dormant until the user confirms. Startup and registry restore only ever reconnect saved connections. Disconnect removes the saved connection and stops the owned server without touching the OpenCode login.

Turn hardening (implemented, unreleased): a picked harness model could miss the stored catalog when the free lineup rotates between connect and turn, failing with a bare miss. `setModel` now retries harness selectors once against a live re-list (no model request, no spend), converges stored metadata on a hit, and otherwise throws a diagnostic naming the requested key and the available providers. Picker rows show the friendly upstream name with the OpenCode mark and never the slash-qualified address; the full address stays in the option id.

Still pending: setup-wizard entry point (ChatGPT-first stays); fleet routing beyond explicit selection; install-if-missing offer (new install workflow, needs explicit approval UX); full agentic delegation inside Zyra permission scopes (separate approval story). Releasing any of the install/delegation behavior requires a new pre-1.0 line per the [version rule](../RELEASE.md#version-rule).

Completion evidence: `node scripts/test-opencode-harness.mjs` (stub-serve contracts: detection, lifecycle, catalog, pipe, fleet flags, credential-free persistence). Live turn, onboarding UI, and delegation each need their own evidence before they are claimed.

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
