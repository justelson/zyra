# Zyra Parallel Agent Build and Merge Runbook

**Purpose:** Run two autonomous implementation agents in isolated Git worktrees, then launch a third integration agent after both produce committed merge handoffs.

**Builder A:** Complete subagents and workflows.

**Builder B:** Complete Browser, paired Chrome, and Windows computer use.

**Integrator C:** Merge both branches semantically, resolve shared seams, run combined verification, and leave one reviewable integration branch.

---

## 1. Execution contract

All three agents operate autonomously.

They must continue through routine design decisions, implementation phases, dependency setup, tests, debugging, documentation, and commits without asking whether to continue.

A question is allowed only for:

- Destructive user data, production data, or Git history operations.
- Force push, protected-branch merge, deployment, publication, purchase, or signing with a private identity.
- A missing secret, paid account, external store identity, or production credential.
- Stopping a user-owned process when no isolated test process can substitute.
- One genuinely contradictory requirement with irreversible security or compatibility consequences.

When an optional external smoke test is unavailable, the agent must complete deterministic coverage and every other test, record the exact limitation, and continue.

No builder may declare completion with only contracts, scaffolding, UI mockups, protocol types, or TODO markers for later phases.

---

## 2. Why a snapshot branch is required

The source workspace contains substantial intended tracked and untracked work. A normal `git worktree add` from current `HEAD` would omit uncommitted Browser, Inspector, streaming, persistence, and documentation changes.

The launcher therefore creates a synthetic snapshot commit using a temporary Git index:

- It does not change `master`.
- It does not stage the user's real index.
- It excludes ignored/private/generated files.
- It provides one identical parent commit for all three branches.
- It makes later merges meaningful.

Excluded examples:

- `.zyra/` local memory and sessions.
- Dependency directories.
- Build and release output.
- `.env` files.
- Logs and databases.
- `desktop/NUL`.
- Timestamped generated Vite configuration artifacts.
- Private chat-goal scratch documents.
- The autonomous worktree directory itself.

The snapshot branch is an automation anchor. It is not merged to `master` automatically.

---

## 3. Branch and worktree topology

For run ID `<run-id>`:

```text
automation/<run-id>-baseline
  ├─ feature/<run-id>-subagents-workflows
  │    └─ .zyra-worktrees/<run-id>/subagents-workflows
  ├─ feature/<run-id>-browser-computer-use
  │    └─ .zyra-worktrees/<run-id>/browser-computer-use
  └─ integration/<run-id>-agent-platform
       └─ .zyra-worktrees/<run-id>/integration
```

The user's current branch and dirty worktree remain untouched.

Each builder commits only inside its own branch. Builders never merge, rebase, cherry-pick, reset, or edit another worktree.

---

## 4. Ownership

### Builder A owns

```text
docs/implementations/subagents-workflows.md
src/agents/**
src/workflows/**
src/tui/components/*agent*
src/tui/components/*workflow*
agent/workflow definition discovery
Codex fleet model routing
child Pi sessions
fleet persistence and recovery
workflow sandbox and scheduler
TUI agent/workflow surfaces
desktop fleet projection
Subagents Inspector workspace
fleet tests and handoff
```

### Builder B owns

```text
docs/implementations/browser-computer-use.md
src/agent-control/**
desktop/src/shared/agent-control/**
desktop/src/main/agent-control/**
extensions/zyra-browser-control/**
native/zyra-computer-use/**
Browser control driver and guest registration
Chrome pairing and extension
Windows sidecar
Control Center UI
control tests, packaging hooks, and handoff
```

### Integrator C owns

- Shared-file composition.
- Final package and lockfile state.
- Fleet-to-control lease wiring.
- Combined bridge and IPC protocol.
- Inspector workspace union.
- Combined migrations and persistence initialization.
- Final tests, build, privacy review, and integration handoff.

---

## 5. Expected shared-file collisions

Both builders may need these files for end-to-end integration:

```text
package.json
desktop/package.json
desktop/package-lock.json
src/zyra-sdk.mjs
src/zyra-ui-bridge.mjs
src/agent-surface.mjs
src/tool-contracts.mjs
desktop/src/main/assistant/zyra-pi-runtime.ts
desktop/src/main/assistant/service.ts
desktop/src/main/assistant/service-runtime-events.ts
desktop/src/main/index.ts
desktop/src/main/ipc/handlers.ts
desktop/src/preload/index.ts
desktop/src/shared/contracts/devscope-api.ts
desktop/src/shared/assistant/contracts/index.ts
desktop/src/renderer/src/pages/assistant/AssistantDiffPanel.tsx
desktop/src/renderer/src/pages/assistant/AssistantInspectorNewTab.tsx
desktop/src/renderer/src/pages/assistant/AssistantInspectorSidebar.tsx
```

Builders may edit a shared file when required for a working vertical slice. They must keep changes narrow and explain them in their handoff.

Integrator C must merge these files semantically. It must never resolve a shared-file conflict by blindly taking all of `ours` or all of `theirs`.

Special merge rules:

- Preserve every existing Browser security gate.
- Preserve both Subagents and Control Inspector workspace kinds.
- Preserve both fleet and control bridge message types.
- Preserve existing tool-start lifecycle boundaries.
- Preserve existing history payload bounds and streaming cadence.
- Compose preload adapters rather than replacing one.
- Regenerate lockfiles from the merged manifests when lock conflicts are non-trivial.
- Preserve the global Browser partition and data-clear behavior.

---

## 6. Builder handoffs

Builder A writes and commits:

```text
docs/automation/handoffs/subagents-workflows.md
```

Builder B writes and commits:

```text
docs/automation/handoffs/browser-computer-use.md
```

Each handoff contains:

1. Summary of completed behavior.
2. Commit list.
3. Files/modules added and changed.
4. Persistence or migration details.
5. Shared-file collision notes.
6. Dependencies and lockfiles.
7. Exact test commands and outcomes.
8. Manual smoke checks and outcomes.
9. Tests that remain unproven and why.
10. Security/privacy review.
11. Integration instructions.
12. Final marker.

Success marker:

```text
READY_FOR_MERGE
```

Failure marker:

```text
BLOCKED_FOR_MERGE: <one concrete reason>
```

The wrapper validates that the handoff exists in the branch's `HEAD`, the marker is present, the worktree is clean, and the Zyra process exited successfully. If validation fails, it automatically launches a recovery attempt in the same branch.

---

## 7. Coordinator protocol

The third Windows Terminal tab runs a loopback-only coordinator.

It:

- Binds to `127.0.0.1` on an ephemeral port.
- Uses a random per-run bearer token stored in a local temporary run directory.
- Accepts bounded signals only from the two wrapper processes.
- Tracks `started`, `heartbeat`, `done`, and `failed` states.
- Writes an atomic state snapshot.
- Does not receive source code, prompts, credentials, or raw agent output.
- Launches Integrator C only after both builders report validated `done` states.

The wrappers send heartbeats independently of model behavior, so coordination does not depend on an agent remembering to ping.

---

## 8. Retry behavior

Each builder receives up to three autonomous attempts.

Attempt 1 executes the full builder brief.

Later attempts are recovery runs and must:

- Inspect the existing branch and worktree.
- Read the prior transcript/session state when useful.
- Run status and tests.
- Continue incomplete phases.
- Fix failures.
- Commit remaining work.
- Produce the required handoff.

A retry does not reset or discard work.

The coordinator launches Integrator C only after both branches validate.

Integrator C also receives up to three attempts. Later integration attempts continue from the existing integration worktree and never reset completed merge work.

---

## 9. Integrator procedure

Integrator C reads:

```text
docs/implementations/subagents-workflows.md
docs/implementations/browser-computer-use.md
docs/runbooks/parallel-agent-build.md
```

It then:

1. Inspects both branch logs and diffs against the baseline.
2. Reads both handoffs directly from their branches.
3. Merges the subagents/workflows branch first with `--no-ff`.
4. Merges the Browser/computer-use branch second with `--no-ff`.
5. Resolves conflicts semantically.
6. Connects fleet capability attenuation to broker delegated leases.
7. Reconciles bridge duplex RPC and runtime events.
8. Reconciles Inspector workspaces.
9. Reconciles package manifests and regenerates lockfiles when needed.
10. Runs focused suites from both builders.
11. Runs desktop TypeScript and scoped root checks.
12. Runs the privacy check.
13. Runs the desktop production build because the integration is structurally broad.
14. Runs isolated live smoke tests without terminating a user-owned process.
15. Writes and commits `docs/automation/handoffs/agent-platform-integration.md`.

Integrator C must not merge to `master`, push, publish, package an installer for distribution, delete feature branches, delete worktrees, or rewrite history.

Final success marker:

```text
READY_FOR_RELEASE_CHECK
```

---

## 10. Required combined behavior

The integration branch must prove source-to-surface behavior for:

### Fleet

```text
agent definition
  -> Codex-only model route
  -> child Pi session
  -> durable fleet event
  -> TUI/desktop projection
  -> bounded parent result
```

### In-app Browser control

```text
user grant
  -> main-owned target
  -> current observation revision
  -> bounded agent tool
  -> broker policy
  -> Browser driver
  -> verified next observation
  -> redacted audit
```

### Delegated control

```text
root grant
  -> AgentFleetController attenuation
  -> child principal lease
  -> AgentControlBroker subset proof
  -> child action
  -> parent cancellation
  -> lease revocation
```

### Chrome

```text
user pairing gesture
  -> rotating loopback credential
  -> exact tab token
  -> grant
  -> bounded extension observation/action
  -> revoke/expiry
```

### Windows

```text
user-selected window
  -> sidecar target identity
  -> UIA/capture observation
  -> current revision action
  -> integrity policy
  -> verified state
  -> emergency stop
```

---

## 11. Test policy

Builders run the narrowest meaningful checks while implementing, then their full affected suites before handoff.

Integrator runs the union.

A passing build proves compilation and bundling. It does not replace runtime tests.

A deterministic fake-driver test proves policy behavior. It does not replace the listed manual Chrome/Windows smoke checks.

Known unrelated baseline failures must be separated from introduced failures with exact evidence. Agents do not weaken checks or delete unrelated files merely to produce green output.

No agent may claim success while a test process is still running.

---

## 12. Dependency handling in nested worktrees

The automated worktrees live under the ignored `.zyra-worktrees/` directory so root CLI dependencies can resolve through the repository's existing `node_modules` while the autonomous Zyra host starts.

Each builder may install dependencies inside its own worktree when required.

If a worktree uses a temporary junction to the base desktop `node_modules`:

- Treat it as read-only.
- Remove only the junction, never its target, before installing changed desktop dependencies locally.
- Do not let one branch's package install mutate another branch or the user's base dependencies.

Integrator regenerates final lockfiles in its own worktree.

---

## 13. User-owned process safety

Builders and Integrator C may launch their own isolated dev/test processes.

They must not:

- Kill an existing Electron process.
- Reuse the user's Browser profile for destructive tests.
- Clear the user's Browser data.
- Close a user terminal.
- Bind a public network interface.

Test Electron processes use an isolated dev user-data path. Tests clear only data created under that path.

---

## 14. Completion state

After success, the repository has:

```text
feature/<run-id>-subagents-workflows       READY_FOR_MERGE
feature/<run-id>-browser-computer-use      READY_FOR_MERGE
integration/<run-id>-agent-platform        READY_FOR_RELEASE_CHECK
```

`master` remains unchanged and the original dirty worktree remains available.

A human or later release agent can inspect the integration branch and decide whether to merge it.
