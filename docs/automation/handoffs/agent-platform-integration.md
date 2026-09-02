# Agent Platform Integration Handoff

## Status

Integration branch: `integration/20260725-170750z-013fd2-agent-platform`

Baseline: `1912078` (`fix: harden autonomous suite launcher`), based on automation snapshot `91a00e2`.

The complete Subagents + Workflows and Browser/Chrome/Windows computer-use suites are merged, composed at their shared authority seams, tested, production-built, packaged unpacked, and exercised in isolated live processes. This branch has not been merged to `master`.

## Merge order and commits

The required merge order was preserved with non-fast-forward merges:

1. `44a5be6bc3845a9eef22c2715b4202735d1b6be4` — `merge: integrate subagents and workflows builder`
   - first parent: `1912078470911c098e8b7c96672fe5153cb7495b`
   - builder head: `c78930b56e6130143d6ca5b7905fed1b9cd04d25`
2. `c3c95f3fbcef61144d761dea0d726bb9ba9e8581` — `merge: integrate browser and computer control builder`
   - first parent: `44a5be6bc3845a9eef22c2715b4202735d1b6be4`
   - builder head: `0af2fec7c763204591a04ce5bf78c33e92683a2d`
3. `32984ea` — `chore: ignore generated agent-control artifacts`

## Semantic conflict resolutions

Shared files were resolved by composing both features rather than selecting either parent wholesale:

- `desktop/package.json` retains the fleet contract suite and all agent-control tests, extension packaging, sidecar build, and Windows packaging hooks.
- `package.json` retains the subagent/workflow scripts and root checks while adding the combined `test:agent-platform-integration` contract.
- `src/zyra-sdk.mjs` initializes the persistent fleet/workflow runtime and passes the desktop control bridge into fleet authority; root control tools and root-only orchestration remain distinct.
- `src/zyra-ui-bridge.mjs` retains fleet operation/snapshot projection while carrying correlated agent-control bridge traffic and delegated lease state.
- `desktop/src/main/assistant/zyra-pi-runtime.ts` retains fleet event/operation routing and binds both root and delegated control requests to main-process broker authority.
- `desktop/src/renderer/src/pages/assistant/AssistantDiffPanel.tsx`, Inspector contracts, and `desktop/src/shared/contracts/devscope-api.ts` preserve both Agents/Workflows and Control Inspector surfaces.
- Root and desktop package lock changes preserve the Pi `0.80.6` upgrade and `quickjs-emscripten@0.32.0` while retaining the computer-control packaging graph.

No unresolved conflict marker or dropped builder surface remains.

## Final architecture and security composition

### Root orchestration and child control

- `agent` and `workflow` remain root-only tools. Children cannot recursively spawn agents or workflows.
- Browser/computer control remains denied to children by default. A child receives `browser_control` or `computer_control` only when the root explicitly supplies a bounded `controlLease` and a connected desktop broker exists.
- The fleet creates a child principal containing the fleet ID, agent run ID, and parent thread ID. Principal binding travels in trusted bridge/runtime state, outside model-controlled tool arguments.
- Only a root principal may call `delegate_lease`. The broker verifies that the child belongs to the current root thread and returns a grant bound to that exact child principal and target.
- Child target enumeration is restricted to targets covered by active grants for that principal. Child principals cannot list/select Windows targets, request grants, widen/renew leases, or redelegate authority.
- Child control tools use a principal-bound bridge client. Even if model-supplied grant or target identifiers are altered, broker principal, target, capability, expiry, revision, origin/application, and action-policy checks remain authoritative.
- The Agents Inspector displays the delegated lease target, capabilities, state, and expiry without moving grant authority into renderer state.

### Attenuation and budgets

- Delegated capabilities, target, origin scope, executable identity scope, expiry, and action count must be subsets of the approved parent grant.
- Active child leases reserve their remaining action budgets so sibling/root activity cannot overcommit the parent grant.
- Every delegated action also consumes the ancestor grant's action budget. Parent expiry, revocation, or consumption invalidates descendants.
- A failed target-policy validation revokes the just-created delegated grant before returning the error.

### Cancellation and revocation

- Agent completion, failure, cancellation, queued-run stop, spawn failure, fleet disposal, and parent cancellation all converge on delegated-principal revocation.
- Cancellation cleanup is registered against the fleet cancellation tree and also runs from the executor `finally` path. Revocation is idempotent and reflected in the fleet snapshot.
- Broker revocation is audited with the child principal and reason. No child lease survives a completed or cancelled run in the integration contract.

### Chrome pairing lifecycle

- Explicit extension disconnect sends `session.disconnect`, clears all exact-tab grants from `chrome.storage.session`, clears pairing credentials, and stops polling.
- The pairing server removes the session, emits `session.disconnected`, returns pairing state to `stopped` when no session remains, and causes paired targets and their broker grants to be removed.
- Extension startup without a valid pairing and poll/session failure both clear stale local exact-tab grants.
- The extension still has no persistent host access or `debugger` permission. Pairing remains loopback-only and exact-tab authority remains a separate user gesture.

### Existing boundaries retained

- Main-process target registration, grant approval, action queues, stale-observation checks, side-effect policy, redaction, audit bounds, Browser webview isolation, and emergency stop remain authoritative.
- Workflows remain in the forked QuickJS/WASM sandbox with no Node, filesystem, shell, credential, import, time/random, or network APIs.
- Child filesystem tools remain path/symlink scoped; worktrees are retained and never auto-merged or auto-deleted.
- The Windows sidecar remains current-user named-pipe authenticated and revalidates the selected window/process/integrity boundary for each operation.

## Integration fixes made after merging

- Added the fleet-to-broker delegated lease path and combined integration contract.
- Added parent action reservation/consumption and delegated lifecycle validation.
- Added completion/cancellation revocation and fixed an already-aborted-signal race found by repeat testing.
- Added explicit Chrome extension disconnect and stale exact-tab cleanup on startup/session loss.
- Fixed the live-discovered missing `sendEvent` import in the extension service worker.
- Fixed Windows `spawn EINVAL` in `desktop/scripts/maint/package-win-release.mjs` by using the command shell only for `.cmd`/`.bat` executables.
- Added ignore rules for generated extension packages, sidecar artifacts/resources, control artifacts, and unpacked release output. Generated outputs are not committed.

## Persistence, migrations, and dependencies

- Fleet authority uses append-only local JSONL plus bounded snapshots/per-run records; workflow sublogs and deterministic cache records remain local.
- Desktop fleet persistence adds queryable SQLite tables with `CREATE TABLE IF NOT EXISTS`. The existing assistant persistence version and legacy assistant rows are not rewritten. No destructive database migration is required.
- Agent-control grants and observations remain in-memory authority. Audit persistence is bounded/redacted and excludes credentials, typed text, grant secrets, and observation bodies.
- Chrome pairing credentials and exact-tab grants remain in extension session storage only and are deleted on disconnect.
- Dependency changes inherited from the builders are Pi `0.80.6`, `quickjs-emscripten@0.32.0`, Electron extension packaging, and the dependency-free `.NET 8` Windows sidecar. Lockfiles are included in the merge commits.
- Release packaging requires a working `.NET 8` SDK for sidecar publication. Signing remains optional at build time and was not configured in this run.

## Automated verification

All commands below passed on Windows in the integration worktree:

- `npm run check`
  - syntax/privacy/doctor and existing root regression coverage
  - subagent, workflow, fleet TUI/desktop, and combined platform contracts
- `npm run test:subagents-workflows`
  - focused subagent, workflow, TUI fleet, and desktop fleet contracts
- `npm run test:agent-control`
  - shared wire contract, policy, revisions, bridge, audit, pairing, extension tests, `.NET` build, and deterministic sidecar tests
- `npm run test:agent-platform-integration`
  - delegated observation under a child principal
  - child target filtering and grant-request denial
  - parent action-budget consumption
  - completion revocation
  - cancellation revocation
- The combined integration contract also passed five consecutive executions after the cancellation-race fix.
- `bun run --cwd desktop typecheck`
- `npm run privacy-check`
- `git diff --check`
- `npm --prefix extensions/zyra-browser-control test`
  - five extension security/lifecycle checks, including session-storage cleanup
- `.NET` sidecar build/tests and `node native/zyra-computer-use/scripts/smoke-sidecar.mjs`
  - owned WinForms target, UI Automation structure, selected-window capture, and semantic typing
- `bun run --cwd desktop build`
  - production main, preload, and renderer bundles completed successfully
- `node desktop/scripts/maint/package-win-release.mjs unpacked`
  - extension build/package, Release sidecar publish, desktop production build, and unpacked Electron packaging completed successfully

## Isolated live smoke

Live verification used only owned processes and temporary profiles. No user-owned Electron or Chrome process was restarted or stopped.

- Launched the packaged Zyra application with an isolated Electron profile.
- Confirmed the assistant Inspector rendered both Agents/Workflows and Control surfaces.
- Launched Chrome-for-Testing with a temporary `--user-data-dir` and the unpacked Zyra extension. Chrome-for-Testing was used because branded Chrome 137+ ignores command-line `--load-extension`.
- Completed a real loopback pairing and verified the extension retained only its declared permissions plus loopback access.
- Granted exactly one active ordinary HTTP tab/document and verified exactly one paired target registered.
- Verified pairing and tab registration did not implicitly create a broker control grant; grant count remained zero until an explicit broker approval path is used.
- Disconnected through the extension lifecycle and verified pairing state `stopped`, zero paired targets, zero grants, inactive control state, and empty extension session storage.
- Removed temporary profiles/scripts and generated sidecar publish output after the smoke. No integration-owned Electron process remained.

This smoke proves packaged renderer availability and the real extension/pairing/target/disconnect path. The deterministic integration contract separately proves delegated child authority and revocation without making a paid model call.

## Remaining limitations and release gates

- No paid authenticated live child-model call was made. Provider/account availability and a real child-model delegated-control turn still require release-check confirmation.
- Windows binaries and the Electron package were not signed because signing credentials were not supplied.
- Chrome Web Store publication and automatic extension installation are outside this branch; developer unpacked loading and deterministic ZIP packaging are implemented.
- The selected-window capture provider currently uses bounded Win32 `PrintWindow` behind the opaque capture interface. Windows Graphics Capture remains a documented follow-up when an approved WinRT projection dependency is available.
- `electron-vite preview` attempted `localhost:5174` and returned `ERR_CONNECTION_REFUSED`; the supported packaged runtime launched and passed the smoke.
- The unpacked runtime logged a missing `resources/app-update.yml`; update metadata is a release-channel artifact and did not affect runtime behavior tested here.
- Windows UI Automation traversal of the Electron renderer exceeded 90 seconds, so isolated loopback CDP was used to inspect the packaged renderer. The separate owned WinForms sidecar smoke passed UI Automation coverage.

## Release-check instructions

1. Review this branch and the two builder handoffs without merging to `master` yet.
2. Re-run the automated commands above on the release-check machine, including the production build and unpacked packaging wrapper.
3. Perform one authenticated child-model run. If delegated control is included, approve a short-lived root grant, delegate the narrowest target/capability/action scope, and confirm the child lease is revoked on completion and cancellation.
4. Repeat the packaged Chrome pairing/disconnect click-through and one selected-window Windows sidecar smoke on the target release environment.
5. Supply release signing credentials and update metadata only through the approved release process; verify signatures and packaged `app-update.yml` before distribution.
6. After release-check approval, merge `integration/20260725-170750z-013fd2-agent-platform` into `master` with preserved merge history. Do not delete builder branches/worktrees until the coordinator confirms the release checkpoint.

READY_FOR_RELEASE_CHECK
