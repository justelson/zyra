# Zyra Subagents and Workflows Implementation Plan

**Status:** Implemented on `feature/20260725-170750z-013fd2-subagents-workflows` (2026-07-25)

**Revision:** 1

**Scope:** Shared subagent and workflow runtime, Zyra TUI, and Zyra desktop

**Current runtime baseline:** Pi `0.80.6`

**Model boundary:** Codex models available through `openai-codex/*`

---

## 1. Goal

Build production-grade subagents and executable workflows for Zyra.

The result should let a user:

- Delegate a focused task to an isolated specialist.
- Keep talking to the root agent while background work continues.
- Run parallel or phased workflows without flooding the root conversation.
- Inspect, steer, stop, retry, and resume every child agent.
- Recover incomplete workflow work after a process or app restart.
- Use the same authoritative fleet state from the TUI and desktop.
- Route workers across current and previous Codex model generations.
- Keep parallel writes safe through declared scopes and worktree isolation.
- Import useful Claude Code agent definitions without inheriting unsupported models, legacy tools, or unsafe prompt behavior.

The root Zyra session remains responsible for the user-facing answer. Child agents return evidence, changes, artifacts, and bounded results.

---

## 2. Non-goals

The first release will not:

- Route subagents to Anthropic models.
- Route subagents to generic third-party providers.
- Treat `openai/*` API models as fleet candidates. The fleet router is Codex-only.
- Give subagents Browser, paired Chrome, or Windows control by default.
- Allow recursive agent trees without an explicit depth policy.
- Automatically merge worktrees or rewrite Git history.
- Let a workflow script access Node.js, the filesystem, the shell, credentials, or the network directly.
- Copy Claude Code's private persistence format or depend on the Claude binary.
- Put raw child chatter into the root conversation.
- Automatically trust project-local agent or workflow definitions.

Agent teams with unrestricted peer-to-peer collaboration are also deferred. The initial system is root-mediated: children report to the root or workflow controller.

---

## 3. Verified current Zyra constraints

### 3.1 Existing model catalog

The installed Pi model registry currently knows these previous-generation Codex models:

| Provider/model | Intended fleet use |
|---|---|
| `openai-codex/gpt-5.5` | Strong previous-generation general fallback |
| `openai-codex/gpt-5.4` | General previous-generation fallback |
| `openai-codex/gpt-5.4-mini` | Fast bounded work and inexpensive fan-out |
| `openai-codex/gpt-5.3-codex-spark` | Fast search, extraction, and narrowly specified work |

Zyra additionally registers the current GPT-5.6 family:

| Provider/model | Current Zyra state | Intended fleet use |
|---|---|---|
| `openai-codex/gpt-5.6-sol` | Registered; still subject to auth and live availability | Root orchestration, difficult synthesis, high-risk specialist review |
| `openai-codex/gpt-5.6-terra` | Registered; still subject to auth and live availability | General implementation, debugging, and verification |
| `openai-codex/gpt-5.6-luna` | Registered but currently marked `Pi support pending` | Fast worker only after the installed Pi transport officially supports it |

The spelling is **Terra**, not `Tera`.

A model being present in the registry does not prove that the current account and transport can run it. Fleet selection must use the existing live availability layer and reject models marked blocked or unavailable.

### 3.2 Existing runtime seams

Zyra already has:

- A per-root-chat Pi bridge in `src/zyra-ui-bridge.mjs`.
- Persistent Pi JSONL session trees with IDs and parent IDs.
- A custom TUI component host.
- Specialized message and tool rendering.
- Slash-command discovery and completion.
- Desktop child-thread fields including parent IDs, depth, nickname, and role.
- Desktop runtime projection for provider-created subagent threads.
- Timeline subagent cards.
- A dedicated but currently unavailable Subagents Inspector tile.
- Review, Explorer, Resources, Terminal, and Browser surfaces that future agents can reference without duplicating presentation logic.

### 3.3 Existing risks

The implementation must preserve these boundaries:

- The repository already has a large unrelated dirty worktree.
- Main/preload, SQLite/IPC, Pi dependency, and bridge integration require a controlled Electron restart.
- Renderer-only and standalone contract work can be staged without restarting the active Electron thread.
- Browser, Chrome, and Windows-control capabilities are denied to subagents by default.
- Existing assistant database rows must not be rewritten to add fleet support.

---

## 4. Claude Code research translated into Zyra requirements

Claude Code separates several concepts that Zyra should also keep distinct.

| Concept | Owner of orchestration | Zyra equivalent |
|---|---|---|
| Subagent | Root agent | `AgentRun` managed by `AgentFleetController` |
| Skill | Root context | Existing or future reusable Zyra instruction resource |
| Dynamic workflow | Executable script | Sandboxed `WorkflowRun` |
| Agent team | Lead plus peer task list | Deferred, but the event model remains extensible |

Useful behavior to reproduce:

- Child agents have independent contexts and transcripts.
- Background agents do not block the root input surface.
- Users can invoke a named agent directly or let the root delegate naturally.
- Running agents are visible in a compact summary and an inspectable detail view.
- Workflows can use `agent()`, `parallel()`, `pipeline()`, and `phase()`.
- Workflow scripts own loops and intermediate values instead of placing all orchestration reasoning in the root context.
- Completed calls are cached and reused when a workflow resumes with unchanged inputs.
- Worktree isolation is available for editing workers.
- Large runs show explicit projected-usage warnings.
- The user can inspect, pause, stop, resume, restart, and save workflows.

Local Claude configuration also exposed migration hazards that Zyra must handle:

- Legacy tool names.
- Read-only roles without enforceable tool restrictions.
- Broken skill links.
- Child prompts that attempt to control how the parent presents their result.
- Background jobs whose terminal job state and task records disagree.
- Large token multiplication when a workflow has weak budgets.

These observations become validation, persistence, reconciliation, and budget requirements below.

---

## 5. Product concepts

### 5.1 Agent definition

A reusable specialist definition.

```markdown
---
version: 1
name: code-reviewer
description: Review a bounded change for correctness and regressions
role: reviewer
model: terra
effort: high
tools: [read, grep, find, bash]
disallowedTools: [edit, write]
permissionMode: read-only
background: true
isolation: shared
maxTurns: 12
color: violet
---

Review only the delegated scope. Return evidence-backed findings with file and line references.
```

An agent definition describes defaults. The controller still applies the current project policy, live model availability, global limits, and capability attenuation.

### 5.2 Agent run

One execution of an agent definition or dynamically generated role.

An `AgentRun` owns:

- Stable fleet, agent, parent, and provider IDs.
- Delegated goal and success criteria.
- Independent Pi session and transcript.
- Selected Codex model and effort.
- Tool and capability policy.
- Declared read/write scope.
- Optional worktree.
- Current status, heartbeat, attempt, usage, and result.
- Artifact, Resource, transcript, and diff references.

### 5.3 Workflow definition

A reusable orchestration program.

```javascript
export const meta = {
  version: 1,
  name: "review-changes",
  description: "Review every changed file and independently verify findings",
  phases: ["discover", "review", "verify", "synthesize"],
};

const changed = await phase("discover", () =>
  agent("Return the changed source files as structured JSON.", {
    model: "luna",
    fallbackModels: ["gpt-5.4-mini", "gpt-5.3-codex-spark"],
    tools: ["read", "grep", "find", "bash"],
    schema: changedFilesSchema,
  }),
);

const reviews = await phase("review", () =>
  pipeline(changed.files, (file) =>
    agent(`Review ${file} for concrete defects.`, {
      model: "terra",
      fallbackModels: ["gpt-5.5", "gpt-5.4"],
      agent: "code-reviewer",
      label: file,
    }),
  ),
);

const verified = await phase("verify", () =>
  pipeline(reviews.filter(Boolean), (finding) =>
    agent(`Independently verify this finding:\n${finding}`, {
      model: "terra",
      fallbackModels: ["gpt-5.5", "gpt-5.4"],
      label: "verifier",
    }),
  ),
);

return phase("synthesize", () =>
  agent(`Deduplicate and rank these verified findings:\n${verified}`, {
    model: "sol",
    fallbackModels: ["terra", "gpt-5.5"],
  }),
);
```

The Luna call above does not run on Codex subscription while Luna remains Pi-support-pending. The router skips it and chooses the first live compatible fallback.

### 5.4 Workflow run

A durable execution of a workflow definition.

It owns:

- Definition revision and script hash.
- User arguments and originating thread.
- Approval and trust decisions.
- Phases, calls, dependencies, attempts, and cached outputs.
- Running and projected usage.
- Pause, resume, cancellation, and recovery state.
- Final result and linked artifacts.

---

## 6. Definition locations and precedence

```text
<zyra-install>/agents/                  Built-in public agents
%USERPROFILE%/.zyra/agents/             Personal local agents
<project>/.zyra/agents/                 Project-local agents
session overrides                       Temporary definitions

<zyra-install>/workflows/               Built-in public workflows
%USERPROFILE%/.zyra/workflows/          Personal local workflows
<project>/.zyra/workflows/              Project-local workflows
session-generated workflows             Unsaved temporary definitions
```

Precedence:

```text
session > project > personal > built-in
```

Rules:

- Project definitions require project trust before execution.
- A higher-precedence duplicate shadows, but does not delete, a lower definition.
- The UI shows the active source and every shadowed source.
- `/reload` refreshes definitions.
- Definitions are validated before appearing as runnable.
- A project definition cannot widen global capabilities.
- Generated workflows remain temporary until the user explicitly saves them.

---

## 7. Codex-only model architecture

### 7.1 Do not use generic provider-neutral tiers

Agent definitions and workflow scripts must not store values such as `opus`, `sonnet`, `haiku`, `quality`, or `balanced` as executable model IDs.

Supported selectors are:

```text
inherit
sol
terra
luna
openai-codex/<exact-model-id>
```

Structured selector:

```yaml
model:
  prefer: terra
  fallbacks:
    - openai-codex/gpt-5.5
    - openai-codex/gpt-5.4
  allowPreviousGenerations: true
```

The aliases `sol`, `terra`, and `luna` resolve to the newest live compatible Codex model carrying that tier. Exact IDs bypass tier aliasing but still pass policy and availability checks.

### 7.2 Live candidate filter

A worker model is eligible only when all are true:

1. `provider === "openai-codex"`.
2. The model exists in the active model registry.
3. Authentication is configured.
4. It is not marked `Pi support pending`.
5. The availability layer has not classified it as unavailable.
6. Its tool/reasoning/context capabilities satisfy the task.
7. It is allowed by user, project, agent, workflow, and budget policy.

An inconclusive availability probe may retain a model in the picker, but the fleet router should prefer a positively available candidate when comparable options exist.

### 7.3 Initial generation-aware routing table

These are routing preferences, not claims that every account exposes every model.

| Task envelope | Preferred current model | Previous-generation fallbacks |
|---|---|---|
| Root orchestration and final difficult synthesis | Sol | `gpt-5.5`, then `gpt-5.4` |
| Security, architecture, broad ambiguity, failed-worker recovery | Sol | Terra, `gpt-5.5`, `gpt-5.4` |
| Scoped feature implementation and debugging | Terra | `gpt-5.5`, `gpt-5.4`, then Sol if escalation is justified |
| Code review and independent verification | Terra | `gpt-5.5`, `gpt-5.4`, then Sol for high-risk disputes |
| File inventory, extraction, bounded search, simple checks | Luna | `gpt-5.4-mini`, `gpt-5.3-codex-spark`, then Terra |
| Mechanical edits with exact acceptance criteria | Luna or Terra according to risk | `gpt-5.4-mini`, `gpt-5.4`, `gpt-5.5` |
| Final high-risk review | Sol | Terra, `gpt-5.5` |

While `openai-codex/gpt-5.6-luna` remains blocked, Luna routes start at `gpt-5.4-mini` or `gpt-5.3-codex-spark` according to the required context and tools.

The router records:

- Requested alias or exact model.
- Selected exact model.
- Candidates considered.
- Rejection reasons.
- Fallback or escalation reason.
- Incremental usage estimate.

### 7.4 Root and worker eligibility

Keep orchestration policy separate from transport effort.

- **Explicit delegation:** available to a compatible root when the user or root invokes the agent tool.
- **Proactive Ultra orchestration:** initially enabled only for GPT-5.6 Sol and Terra roots.
- **Manual saved workflow execution:** can be started from older compatible roots because the workflow controller, rather than the root model, owns scheduling.
- **Worker eligibility:** all live compatible Codex models, including previous generations.
- **Luna worker eligibility:** false until the Pi-support-pending marker is gone.

`ultra` remains a Zyra orchestration mode. It must not be sent upstream as a provider reasoning value unless Pi and the Codex transport officially support that exact value. Current stable transport effort remains bounded by Zyra's documented model capability handling.

### 7.5 Escalation

Automatic escalation is bounded:

```text
fast fallback -> Terra/general fallback -> Sol/strong fallback
```

Escalation can occur when:

- Structured output fails validation twice.
- A verifier rejects the result with evidence.
- Required files or tests remain unresolved.
- The worker reports insufficient context or capability.
- The task risk increases after inspection.

Escalation must not occur merely because a worker is slow. It requires a recorded quality or capability reason and remaining budget.

---

## 8. Claude agent importer

Add:

```text
/agents import claude
```

The importer performs a preview and never auto-copies definitions.

### 8.1 Tool mapping

| Claude spelling | Zyra tool |
|---|---|
| `Read`, `read_file` | `read` |
| `Grep`, `grep` | `grep` |
| `Glob`, `search_files` | `find` |
| `Bash`, `run_bash_command` | `bash` |
| `Edit` | `edit` |
| `Write`, `write_file` | `write` |
| `WebSearch` | `web_search` |
| `WebFetch` | `web_fetch` |

Unsupported tools remain visible as warnings and are not silently granted.

### 8.2 Claude model mapping

Imported model labels become Codex routing requests:

| Claude value | Imported Zyra selector |
|---|---|
| `inherit` | `inherit` |
| `opus` | `sol`, with previous strong-generation fallbacks |
| `sonnet` | `terra`, with `gpt-5.5` and `gpt-5.4` fallbacks |
| `haiku` | `luna`, with `gpt-5.4-mini` and `gpt-5.3-codex-spark` fallbacks |
| Unknown model | Block import until the user chooses a Codex selector |

The importer explains that this is semantic migration, not model equivalence.

### 8.3 Validation warnings

The preview reports:

- Legacy and unknown tools.
- Missing tool allowlists.
- Claimed read-only behavior that is not enforced by capabilities.
- Broken skill references.
- Duplicate names.
- Unsupported model values.
- Parent-presentation instructions.
- Broad writer access.
- Prompts that claim approvals or permissions.

Imported child output is always treated as untrusted data by the parent.

---

## 9. Shared semantic contracts

Create a surface-independent domain layer:

```text
src/agents/
  contracts.mjs
  reducer.mjs
  definition-loader.mjs
  definition-validator.mjs
  claude-importer.mjs
  capability-policy.mjs
  model-catalog.mjs
  model-router.mjs
  output-scanner.mjs
  event-store.mjs
```

### 9.1 Agent state

```typescript
type AgentRunState =
  | "queued"
  | "starting"
  | "running"
  | "waiting"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted"
  | "recovering";
```

### 9.2 Workflow state

```typescript
type WorkflowRunState =
  | "draft"
  | "awaiting-approval"
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "partial"
  | "failed"
  | "cancelled"
  | "recovering";
```

### 9.3 Event envelope

```typescript
interface FleetEvent {
  version: 1;
  sequence: number;
  eventId: string;
  occurredAt: string;
  rootSessionId: string;
  rootThreadId: string;
  fleetId: string;
  agentRunId?: string;
  workflowRunId?: string;
  phaseId?: string;
  type: string;
  payload: Record<string, unknown>;
}
```

Requirements:

- Stable IDs survive retries and recovery.
- Attempts get separate attempt IDs.
- Reducers are deterministic and duplicate-safe.
- Events are authoritative for lifecycle state.
- TUI and desktop own independent presentation.
- Desktop TypeScript contracts mirror the JavaScript domain schema through fixtures and contract tests.

---

## 10. Agent runtime

Create:

```text
src/agents/runtime/
  fleet-controller.mjs
  child-session-host.mjs
  child-session-factory.mjs
  agent-runner.mjs
  cancellation-tree.mjs
  usage-accounting.mjs
  transcript-store.mjs
  recovery.mjs
  worktree-manager.mjs
  workspace-guard.mjs
```

### 10.1 `AgentFleetController`

The controller owns:

- Agent and workflow registries.
- Agent lifecycle transitions.
- Bounded scheduling.
- Child messaging.
- Model routing.
- Capability attenuation.
- Usage and budget enforcement.
- Heartbeats and stale-worker detection.
- Workflow linkage.
- Cancellation trees.
- Worktree and write-scope coordination.
- Event persistence and replay.

Initial policy:

```text
Maximum sessions including root: 4
Maximum child depth: 1
Parallel reads: allowed
Shared-worktree writes: serialized by declared scope
Parallel writes: isolated worktrees
Browser/Chrome/Windows control: denied
Merge/deploy/destructive Git: explicit approval
```

The architecture may support up to 16 concurrent workflow agents later, but the shipped default remains four total sessions until resource and recovery tests prove higher values safe.

### 10.2 Child Pi sessions

Each normal child receives:

- Its own managed Pi `AgentSession`.
- Its own `SessionManager` and JSONL transcript.
- A focused child system prompt.
- The delegated task and success criteria.
- Project instructions such as `AGENTS.md`.
- An exact Codex model selected by `ModelRouter`.
- An explicit tool allowlist.
- A linked parent/fleet identity.

It does not automatically receive:

- The complete root transcript.
- Root layered memory.
- Unrelated prior tool output.
- Browser credentials.
- Another child's transcript.
- Agent-control capabilities.

A context-forked `/subtask` is a separate mode. It deliberately branches the current Pi session tree and records that it inherited root context.

### 10.3 Root-callable tools

Expose two tools rather than embedding controller behavior in prompts.

#### `agent`

Actions:

```text
spawn
send
wait
status
stop
retry
resume
```

#### `workflow`

Actions:

```text
run
pause
resume
status
stop
restart
save
```

A background spawn returns immediately with fleet and agent IDs. Foreground mode waits for a bounded result.

Subagents do not receive the `agent` or `workflow` tools by default.

---

## 11. Workflow runtime

Create:

```text
src/workflows/
  contracts.mjs
  loader.mjs
  validator.mjs
  compiler.mjs
  sandbox-host.mjs
  runtime.mjs
  scheduler.mjs
  cache.mjs
  approval.mjs
  builtins.mjs
```

### 11.1 Restricted JavaScript execution

Workflow scripts must not execute as unrestricted Node.js.

Use a sandboxed JavaScript runtime in a dedicated child process with:

- No `require`.
- No `process`.
- No Node globals.
- No direct filesystem or network access.
- No shell access.
- Memory ceiling.
- CPU timeout.
- Maximum script size.
- Parent-controlled termination.

Expose only:

```text
args
agent()
parallel()
pipeline()
phase()
```

The sandbox sends structured requests to the controller. The controller validates every model, capability, path, budget, and concurrency request again.

`node:vm` alone is not a security boundary and must not be presented as one. The implementation spike should choose a no-Node sandbox, such as a bounded QuickJS/WASM host, before model-generated workflows are enabled.

### 11.2 Workflow primitives

```typescript
agent(prompt, {
  agent?: string;
  label?: string;
  model?: "inherit" | "sol" | "terra" | "luna" | `openai-codex/${string}`;
  fallbackModels?: string[];
  effort?: string;
  tools?: string[];
  schema?: JsonSchema;
  cwd?: string;
  isolation?: "shared" | "worktree";
  writeScope?: string[];
  phase?: string;
});

parallel(tasks, {
  concurrency?: number;
  failFast?: boolean;
});

pipeline(items, mapper, {
  concurrency?: number;
  key?: (item: unknown) => string;
});

phase(name, operation);
```

### 11.3 Deterministic resume cache

Every `agent()` call gets a fingerprint from:

- Workflow script hash.
- Workflow input hash.
- Phase and stable pipeline key.
- Prompt.
- Agent definition revision.
- Exact selected model policy.
- Tools, capabilities, isolation, and structured schema.

On resume:

- Completed calls with identical fingerprints return persisted results.
- Changed calls execute again.
- Failed calls retry only under workflow policy or user action.
- Calls that were running during a crash restart.
- Completed child transcripts remain available even when their result is reused.

### 11.4 Limits

```text
Default concurrent sessions: 4 including root
Configurable workflow concurrency: 1–16 after hardening
Recommended workflow size: fewer than 15 agents
Warning threshold: 25 projected agents
Projected token warning: 1.5 million
Hard total calls per run: 1,000
Maximum workflow source: 256 KiB
Maximum direct child result returned to parent: 50 KiB
Maximum depth: 1 initially
```

A run also gets an explicit token or request budget. When exhausted, the controller stops scheduling new calls, lets already-completed results remain valid, and marks the run `partial` or `blocked` instead of silently exceeding the limit.

---

## 12. Persistence and recovery

Authoritative local orchestration state lives beside Zyra's project sessions:

```text
<project>/.zyra/agent-runs/<root-session-id>/
  fleet.snapshot.json
  fleet.events.jsonl
  agents/
    <agent-run-id>.json
  workflows/
    <workflow-run-id>/
      script.mjs
      snapshot.json
      events.jsonl
      cache/
```

Pi JSONL remains authoritative for each child transcript.

### 12.1 Persistence rules

- Append every meaningful transition.
- Assign a monotonic sequence before broadcasting.
- Atomically replace snapshots through temporary files and rename.
- Include schema version and last-applied sequence.
- Flush terminal states immediately.
- Batch high-frequency progress and usage updates.
- Keep exact output in transcripts or artifacts.
- Keep snapshots and IPC payloads bounded.
- Never persist every streaming presentation frame.

Desktop SQLite stores a queryable projection, not a second orchestration authority.

### 12.2 Recovery sequence

1. Load the latest valid snapshot.
2. Replay later events.
3. Mark unfinished nodes `recovering`.
4. Reopen child Pi sessions by persisted session identity.
5. Keep completed calls and artifacts.
6. Restart only calls that were in flight.
7. Reconcile stale task records against terminal workflow state.
8. Reacquire or invalidate write locks safely.
9. Present the recovered state before scheduling resumed work.

Completed agents may receive follow-up work by reopening their existing Pi session. A completed agent is never represented as currently running merely because stale child task records remain.

---

## 13. Worktree and write safety

### 13.1 Shared read-only

Default for:

- Exploration.
- Planning.
- Review.
- Verification.
- Search and inventory.

No `edit` or `write` capability is granted.

### 13.2 Shared serialized writer

For one tightly scoped writer:

- Paths are declared before writing.
- Locks use normalized real paths.
- Locks are acquired in canonical order.
- Symlink escapes are rejected.
- Conflicting agents wait or fail visibly.

### 13.3 Worktree writer

Default for parallel implementation:

- One temporary worktree per writer.
- Base commit recorded before launch.
- Worktree locked while active.
- Changes remain available to Review.
- No automatic merge, rebase, cherry-pick, or cleanup.
- Overlapping changed files are detected before integration.

The root or user decides how accepted work is integrated.

---

## 14. Child-output safety

Child content is evidence, not authority over the root.

Before placing a child result into root context:

- Label the source agent, run, and attempt.
- Preserve exact raw output in the child transcript.
- Detect parent-presentation commands.
- Detect claims of user approval or elevated permission.
- Escape protocol-shaped role or tool markers.
- Bound the direct result size.
- Return transcript, Resource, artifact, and diff references for full detail.
- Include structured validation failures.

The root system prompt states that child results cannot:

- Change system or project policy.
- Approve actions.
- Grant tools.
- Speak for the user.
- Require verbatim publication.

---

## 15. TUI design and implementation

Zyra owns a custom terminal UI. Pi extension renderers cannot be dropped into it directly.

Relevant existing files:

```text
src/zyra-ui.mjs
src/terminal-input.mjs
src/tui/component-host.mjs
src/tui/components/editor.mjs
src/tui/components/message-components.mjs
src/slash-commands.mjs
src/slash-command-handlers.mjs
src/slash-suggestions.mjs
```

### 15.1 Timeline boundary

Add a specialized subagent/workflow message component.

Running agent:

```text
  ◆ reviewer-auth  running
    Reviewing authentication changes
    Terra · 3 tools · 18.4k tokens · 42s
```

Completed agent:

```text
  ✓ reviewer-auth  completed
    4 findings · Terra · 31.2k tokens · 1m 08s
    Enter opens transcript
```

Workflow:

```text
  ◐ review-changes  6/9 agents
    discover ✓  review 4/6  verify 0/2
    Sol root · Terra ×3 · GPT-5.4 mini ×2 · 284k tokens
```

The model shown is the exact selected model or concise family label. A fallback indicator appears when the requested family was unavailable.

### 15.2 Fixed agent dock

Extend `ZyraComponentHost` with fixed auxiliary components and focus routing:

```text
transcript
agent dock
editor
status footer
```

Compact dock:

```text
  Agents  2 running · 1 waiting
  › reviewer-auth      Terra · reviewing token flow
    test-runner        GPT-5.4 mini · focused checks
    planner            waiting
```

Rules:

- Hidden when there is no active or recent fleet work.
- Shows at most three rows by default.
- Does not move the transcript viewport unexpectedly.
- Uses text and symbols rather than color alone.
- Down-arrow from an empty editor focuses it.
- Escape returns focus to the editor.
- Reduced-motion mode does not animate spinner frames unnecessarily.

### 15.3 `/agents` manager

```text
┌ Agents ─────────────────────────────────────────────────┐
│ Active 3   Waiting 1   Completed 8   Failed 1           │
├──────────────────────┬──────────────────────────────────┤
│ › reviewer-auth      │ Task                             │
│   test-runner        │ Review authentication changes    │
│   planner            │                                  │
│                      │ Recent activity                  │
│                      │ read src/auth/session.ts          │
│                      │ grep token refresh                │
│                      │                                  │
│                      │ Terra · high · 18.4k tokens       │
└──────────────────────┴──────────────────────────────────┘
↑↓ select · Enter inspect · s steer · x stop · r retry · Esc close
```

Responsive behavior:

- Wide terminal: list and detail columns.
- Narrow terminal: one pane at a time.
- Every line is width-bounded.
- Detail transcript is paged and cached.
- Selected state survives redraws and resizes.

### 15.4 `/workflows` manager

```text
┌ Workflows ──────────────────────────────────────────────┐
│ › review-changes             running       6/9 agents   │
│   deep-research              completed     12 agents    │
├─────────────────────────────────────────────────────────┤
│ ✓ discover       1 agent       12.3k       18s          │
│ ◐ review         4/6 agents    184k         2m 04s      │
│ ○ verify         0/2 agents    —            —           │
│ ○ synthesize     waiting       —            —           │
└─────────────────────────────────────────────────────────┘
Enter drill in · p pause · x stop · r restart · s save · Esc close
```

Drill-down:

```text
workflow run -> phase -> agent -> transcript
```

### 15.5 Invocation

Commands:

```text
/agents
/agent code-reviewer review the current diff
/subtask draft tests using this conversation context
/workflows
/workflow review-changes
/workflow review-changes {"scope":"src/auth"}
```

Natural invocation:

```text
Use the code-reviewer agent on the auth changes.
Use a workflow to review every changed file.
ultracode: audit all routes and independently verify every finding.
```

Agent mentions:

```text
@agent-code-reviewer
@agent-bug-analyzer
```

File mentions and agent mentions must coexist. Completion items carry a type so `@agent-*` cannot be interpreted as a filesystem path.

### 15.6 TUI files

```text
src/tui/components/subagent-message.mjs
src/tui/components/workflow-message.mjs
src/tui/components/agent-dock.mjs
src/tui/components/agent-manager.mjs
src/tui/components/workflow-manager.mjs
```

Existing host, editor, slash-command, and UI files receive focused integration changes rather than a second terminal framework.

---

## 16. Desktop design and implementation

### 16.1 Reuse existing authority

Keep:

- Existing child-thread persistence fields.
- Existing runtime child-thread projection.
- Sessions rail hierarchy.
- Timeline subagent cards.
- Review as the diff authority.
- Resources as the artifact/link/image read model.
- Explorer as the file/worktree navigation surface.

### 16.2 Enable the Subagents Inspector

Add:

```text
desktop/src/renderer/src/pages/assistant/
  AssistantSubagentsWorkspace.tsx
  AssistantSubagentList.tsx
  AssistantSubagentDetail.tsx
  AssistantSubagentTranscript.tsx
  AssistantWorkflowRuns.tsx
  AssistantWorkflowDetail.tsx
  AssistantAgentLibrary.tsx
```

Workspace modes:

```text
Agents | Workflows | Library
```

#### Agents

- Nested root/child tree.
- Active, waiting, blocked, failed, and completed groups.
- Exact model and fallback reason.
- Task, effort, usage, elapsed time, attempt, and worktree.
- Transcript, task, changes, and Resources tabs.
- Steer, stop, retry, resume, and open-thread controls.

#### Workflows

- Run list and status filters.
- Phase progress.
- Agent and model counts.
- Usage and large-run warnings.
- Pause, resume, stop, restart, and save.
- Read-only raw script view.
- Cached, live, retried, and escalated call markers.

#### Library

- Built-in, personal, project, and temporary definitions.
- Active source and shadowed definitions.
- Validation warnings.
- Create, edit, duplicate, disable, and import-Claude actions.
- Model resolution preview using the live Codex catalog.

### 16.3 UI responsibility map

| Surface | Responsibility |
|---|---|
| Root timeline | Delegation boundary and concise result |
| Sessions rail | Child transcript hierarchy and navigation |
| Subagents Inspector | Live fleet/workflow control |
| Review | Authoritative diffs and integration review |
| Resources | Linked reports, images, and web resources |
| Explorer | Worktree and file navigation |

Child event streams do not become hundreds of root timeline rows.

---

## 17. Bridge, IPC, and desktop projection

### 17.1 Bridge operations

```text
agents.listDefinitions
agents.listRuns
agents.spawn
agents.send
agents.stop
agents.retry
agents.resume
agents.getTranscript

workflows.listDefinitions
workflows.listRuns
workflows.run
workflows.pause
workflows.resume
workflows.stop
workflows.restart
workflows.save
workflows.getScript
```

### 17.2 Runtime events

```text
agent.definition.changed
agent.created
agent.state.changed
agent.activity
agent.message.delta
agent.message.completed
agent.usage.updated
agent.result.completed
agent.failed

workflow.created
workflow.approval.requested
workflow.started
workflow.phase.changed
workflow.agent.linked
workflow.usage.updated
workflow.paused
workflow.completed
workflow.failed
```

### 17.3 Desktop persistence

Add bounded projection tables for:

- Agent runs.
- Workflow runs.
- Workflow phases and calls.
- Agent/workflow relationships.
- Artifact references.
- Usage summaries.

Existing assistant rows are not rewritten. Child transcripts continue through the existing thread/message/activity model and paged history.

The renderer receives summaries first and pages detail on demand.

---

## 18. Implementation sequence

### Phase 0 — Baseline and Pi checkpoint

- [ ] Freeze current model, effort, session, and bridge fixtures.
- [ ] Record current Pi `0.80.3` behavior.
- [ ] Prepare the controlled move to Pi `0.80.6`.
- [ ] Verify GPT-5.6 Sol, Terra, and Luna compatibility markers.
- [ ] Verify previous-generation Codex registry entries.
- [ ] Keep subagents unavailable in product UI.

**Gate:** Current behavior is reproducible and model availability tests distinguish registered, blocked, unavailable, and live models.

### Phase 1 — Contracts and deterministic reducer

- [ ] Add versioned agent, workflow, phase, call, result, usage, and artifact contracts.
- [ ] Add duplicate-safe deterministic reducers.
- [ ] Add recovery/checkpoint codecs.
- [ ] Add bounded event serialization.
- [ ] Add JavaScript/TypeScript cross-surface fixtures.

**Gate:** Snapshot plus replay produces identical state under duplicates, delayed batches, and restart fixtures.

### Phase 2 — Codex model catalog and router

- [ ] Restrict candidates to `openai-codex/*`.
- [ ] Add Sol, Terra, Luna, exact-ID, and inherit selectors.
- [ ] Add previous-generation fallback groups.
- [ ] Reuse live model availability and compatibility state.
- [ ] Add task envelopes, routing explanations, and bounded escalation.
- [ ] Exclude Luna while Pi support is pending.

**Gate:** Routing is deterministic, availability-aware, generation-aware, and never emits an Anthropic or generic API model.

### Phase 3 — Agent definitions and Claude importer

- [ ] Implement built-in, personal, project, and session discovery.
- [ ] Add validation and precedence.
- [ ] Add Claude tool alias migration.
- [ ] Map Claude model labels to Codex selectors.
- [ ] Add prompt and capability warnings.
- [ ] Add `/agents doctor` and import preview.

**Gate:** Local Claude definitions can be previewed with every unsupported tool, model, skill, and permission mismatch visible before import.

### Phase 4 — Single child-agent vertical slice

- [ ] Create an isolated managed Pi child session.
- [ ] Share auth/model registry resources safely.
- [ ] Keep child context and transcript independent.
- [ ] Stream child lifecycle events.
- [ ] Return a bounded, labeled result to the root.
- [ ] Support cancellation and terminal failure.
- [ ] Render the child in the TUI timeline.

**Gate:** One named agent can inspect a bounded scope, complete, and return evidence without polluting root history.

### Phase 5 — Background fleet lifecycle

- [ ] Implement `AgentFleetController`.
- [ ] Add queueing, concurrency, heartbeat, usage, and cancellation trees.
- [ ] Add send, wait, status, stop, retry, and resume.
- [ ] Persist child identities and attempts.
- [ ] Add the TUI dock and `/agents` manager.
- [ ] Keep the root editor responsive.

**Gate:** Two background agents can run while the user continues chatting; each remains inspectable, steerable, and stoppable.

### Phase 6 — Write scopes and worktrees

- [ ] Add read-only, serialized-writer, and worktree-writer modes.
- [ ] Normalize and lock declared paths.
- [ ] Detect overlapping scopes and resulting files.
- [ ] Add safe worktree lifecycle tracking.
- [ ] Route changes through Review.
- [ ] Require explicit integration action.

**Gate:** Parallel writers cannot silently overwrite one another or the existing dirty worktree.

### Phase 7 — Workflow sandbox and scheduler

- [ ] Select and integrate a no-Node JavaScript sandbox.
- [ ] Implement `agent`, `parallel`, `pipeline`, and `phase`.
- [ ] Add source validation and approval.
- [ ] Add deterministic call fingerprints and cache.
- [ ] Add usage projection and hard budgets.
- [ ] Add pause, resume, stop, and restart.

**Gate:** A four-phase workflow resumes without rerunning completed calls and cannot access Node or the filesystem directly.

### Phase 8 — TUI workflow experience

- [ ] Add workflow timeline rows.
- [ ] Add workflow summaries to the dock.
- [ ] Add `/workflows` drill-down.
- [ ] Add script review, save, pause, stop, resume, and restart controls.
- [ ] Add model/fallback/escalation display.
- [ ] Add typed agent mentions without breaking file mentions.

**Gate:** A workflow remains visible and controllable while the root prompt remains responsive and stable during resize and streaming.

### Phase 9 — Desktop renderer

- [ ] Enable the Subagents Inspector tile.
- [ ] Add Agents, Workflows, and Library views.
- [ ] Reuse existing child-thread and activity data for the first read-only vertical slice.
- [ ] Add controls behind typed APIs.
- [ ] Add responsive narrow-Inspector layout.
- [ ] Keep Inspector motion and resize behavior unchanged.

**Gate:** Renderer fixtures display the same fleet truth as TUI fixtures.

### Phase 10 — Main/preload/SQLite integration

- [ ] Upgrade Pi at the controlled restart checkpoint.
- [ ] Add bridge operations and event forwarding.
- [ ] Add main-process fleet retention.
- [ ] Add typed IPC and preload methods.
- [ ] Add bounded SQLite projections.
- [ ] Preserve selected-chat and background-worker behavior.

**Gate:** Switching chats does not stop unrelated active workers, and reconnecting shows authoritative current state.

### Phase 11 — Recovery and reconciliation

- [ ] Replay event logs after restart.
- [ ] Reopen child Pi sessions.
- [ ] Restore cached workflow calls.
- [ ] Restart only interrupted calls.
- [ ] Reconcile stale task states.
- [ ] Recover or invalidate worktree locks.
- [ ] Add crash and forced-process-exit fixtures.

**Gate:** Killing Zyra during a workflow and restarting it does not replay completed calls or leave false running agents.

### Phase 12 — Hardening and release

- [ ] Add child-output scanning and credential redaction.
- [ ] Add project-definition trust prompts.
- [ ] Add large-run warnings and hard budgets.
- [ ] Add Windows process-tree cancellation.
- [ ] Add performance, chaos, privacy, and release tests.
- [ ] Complete TUI and desktop manual smoke tests.

**Gate:** Every acceptance criterion below passes and no hidden subagent or workflow surface is required to stop active work.

---

## 19. File map

```text
src/
  agents/
    contracts.mjs
    reducer.mjs
    definition-loader.mjs
    definition-validator.mjs
    claude-importer.mjs
    capability-policy.mjs
    model-catalog.mjs
    model-router.mjs
    output-scanner.mjs
    event-store.mjs
    runtime/
      fleet-controller.mjs
      child-session-host.mjs
      child-session-factory.mjs
      agent-runner.mjs
      cancellation-tree.mjs
      usage-accounting.mjs
      transcript-store.mjs
      recovery.mjs
      worktree-manager.mjs
      workspace-guard.mjs
  workflows/
    contracts.mjs
    loader.mjs
    validator.mjs
    compiler.mjs
    sandbox-host.mjs
    runtime.mjs
    scheduler.mjs
    cache.mjs
    approval.mjs
    builtins.mjs
  tui/components/
    subagent-message.mjs
    workflow-message.mjs
    agent-dock.mjs
    agent-manager.mjs
    workflow-manager.mjs

scripts/
  test-zyra-agent-definitions.mjs
  test-zyra-agent-import.mjs
  test-zyra-agent-runtime.mjs
  test-zyra-agent-recovery.mjs
  test-zyra-workflow-runtime.mjs
  test-zyra-workflow-sandbox.mjs
  test-zyra-worktree-isolation.mjs
  test-zyra-agent-output-safety.mjs
  test-zyra-agents-tui.mjs

desktop/src/shared/assistant/
  contracts/agent-runtime.ts
  contracts/workflow-runtime.ts

desktop/src/main/assistant/
  fleet-projection.ts
  fleet-persistence.ts
  fleet-runtime-events.ts

desktop/src/renderer/src/pages/assistant/
  AssistantSubagentsWorkspace.tsx
  AssistantSubagentList.tsx
  AssistantSubagentDetail.tsx
  AssistantSubagentTranscript.tsx
  AssistantWorkflowRuns.tsx
  AssistantWorkflowDetail.tsx
  AssistantAgentLibrary.tsx
```

Existing large modules should only contain integration seams. Runtime, persistence, policy, and presentation remain modular by responsibility.

---

## 20. Verification plan

### 20.1 Focused contract tests

```text
scripts/test-zyra-agent-definitions.mjs
scripts/test-zyra-agent-import.mjs
scripts/test-zyra-agent-runtime.mjs
scripts/test-zyra-agent-recovery.mjs
scripts/test-zyra-workflow-runtime.mjs
scripts/test-zyra-workflow-sandbox.mjs
scripts/test-zyra-worktree-isolation.mjs
scripts/test-zyra-agent-output-safety.mjs
scripts/test-zyra-agents-tui.mjs

desktop/scripts/test-assistant-agent-contract.ts
desktop/scripts/test-assistant-workflow-contract.ts
desktop/scripts/test-assistant-agent-persistence.ts
desktop/scripts/test-assistant-agent-switching.ts
desktop/scripts/test-assistant-subagents-workspace.tsx
```

### 20.2 Model-routing fixtures

Cover:

- Sol available.
- Sol unavailable and Terra available.
- Luna blocked by Pi-support-pending.
- Luna later supplied by an official Pi registry entry.
- Only `gpt-5.5` and `gpt-5.4` available.
- Only mini/Spark fast fallbacks available.
- Exact model denied by project policy.
- Inconclusive probe versus positively available fallback.
- `tera` rejected with a spelling correction.
- Non-Codex provider excluded.
- Imported `opus`, `sonnet`, and `haiku` selectors resolving only to Codex candidates.

### 20.3 Recovery fixtures

Cover:

- Crash before child start.
- Crash during tool execution.
- Crash after child completion but before workflow checkpoint.
- Duplicate terminal events.
- Missing or corrupt snapshot with valid event log.
- Stale task records after workflow completion.
- Worktree still present after process death.
- Parent cancelled while children are running.

### 20.4 Performance fixtures

Cover:

- 200 historical agents.
- 1,000 workflow calls.
- 16 concurrent agents in a test-only configuration.
- Large child transcripts with paged loading.
- 100,000 fleet events.
- Repeated pause and resume.
- Rapid child tool updates.

UI goals:

- Root input remains responsive.
- Fleet summaries remain bounded.
- No full transcript hydration for a collapsed agent.
- No SQL export for each visual frame.
- TUI resize and streaming remain stable.

### 20.5 Manual smoke tests

- Invoke a named agent naturally.
- Invoke it through `/agent`.
- Use an agent mention and a file mention in the same prompt.
- Continue chatting during background work.
- Steer and stop an agent.
- Run a phased workflow.
- Pause, restart the app, and resume it.
- Inspect a child transcript in TUI and desktop.
- Review a worktree diff.
- Verify Luna fallback while Pi support is pending.
- Verify exact model and escalation reasons are visible.
- Verify no Browser, Chrome, or Windows capability reaches a child.

---

## 21. Acceptance criteria

The implementation is complete when:

- [ ] TUI and desktop consume the same versioned fleet semantics.
- [ ] Every active agent is visible, inspectable, and stoppable.
- [ ] The root remains responsive while background agents and workflows run.
- [ ] Child transcripts remain independent and can be paged later.
- [ ] Child output enters root context only as a bounded labeled result.
- [ ] Named agents can be loaded from built-in, personal, project, and temporary scopes.
- [ ] Claude definitions can be imported only after validation and confirmation.
- [ ] The fleet router selects only `openai-codex/*` models.
- [ ] Sol, Terra, and Luna selectors resolve through the live catalog.
- [ ] Luna is skipped while its Codex Pi transport remains support-pending.
- [ ] Previous generations remain valid fallbacks rather than disappearing behind GPT-5.6 aliases.
- [ ] Exact model, fallback, and escalation reasons are inspectable.
- [ ] Completed workflow calls are not replayed after resume.
- [ ] Stale task records cannot keep a terminal workflow visually running.
- [ ] Parallel reads run concurrently.
- [ ] Conflicting shared writes serialize or fail visibly.
- [ ] Parallel writers use isolated worktrees.
- [ ] Merge, deploy, destructive Git, and capability elevation require explicit approval.
- [ ] Child agents receive no Browser, Chrome, or Windows control by default.
- [ ] A root cancellation leaves no untracked active child process.
- [ ] Focused syntax, contract, runtime, recovery, TUI, renderer, and privacy checks pass.

---

## 22. Controlled restart boundary

Work that can be completed without restarting the active Electron app:

- Architecture and contracts.
- Deterministic reducers.
- Definition loader and Claude importer.
- Codex model-router fixtures.
- Standalone persistence and recovery codecs.
- Workflow sandbox and scheduler tests.
- TUI implementation and tests in a separate process.
- Desktop renderer Subagents workspace using existing data.

The following work crosses the Electron restart boundary:

- Pi `0.80.6` dependency upgrade.
- Managed child sessions in the live desktop bridge.
- Main-process fleet retention.
- New IPC/preload methods.
- SQLite fleet projection.
- Live workflow and child-control actions from desktop.

An autonomous builder does not stop the implementation at this boundary. It must use a separate dev/test Electron process and isolated test profile, continue through integration and testing, and leave any user-owned Electron process untouched. If live verification cannot run without terminating a user-owned process, complete every deterministic check and record only that specific smoke test as unproven. Do not stop or restart an existing Electron process implicitly.

---

## 23. Recommended first implementation slice

Implement one complete narrow path before building dynamic workflows:

1. Add agent contracts and deterministic reducer.
2. Add the Codex-only live model catalog and router.
3. Load one validated personal agent definition.
4. Spawn one read-only child Pi session.
5. Stream its lifecycle into a compact TUI row.
6. Stop it through the controller.
7. Persist and reopen its transcript.
8. Project the same fixture into the desktop Subagents Inspector.

This slice proves source of truth, model selection, child isolation, cancellation, persistence, and both surfaces. Workflow scheduling then builds on a working agent primitive instead of becoming a separate prototype.

---

## 24. Autonomous builder mandate

This document is intended to be executable by one isolated builder agent from start to finish.

The builder must:

- Read this entire plan, `AGENTS.md`, and the referenced architecture files before editing.
- Implement every phase, including runtime, persistence, TUI, desktop, tests, and documentation.
- Continue through phase gates without asking for routine confirmation.
- Make reasonable engineering decisions from repository evidence.
- Diagnose and fix its own test failures.
- Use deterministic fixtures when an external provider or GUI surface is temporarily unavailable.
- Keep exact notes about any manual behavior that remains unproven.
- Commit coherent checkpoints to its assigned feature branch.
- Finish with a clean worktree and a merge handoff containing commit IDs, changed modules, migrations, test commands and results, manual checks, and known limitations.

The builder must not ask questions about naming, internal module layout, ordinary dependency choices, test organization, UI microcopy, or whether to continue to the next phase. It should choose the safest maintainable option and proceed.

A question is justified only when continuing would require one of these exact actions:

- Deleting or rewriting user data, Git history, branches, or unrelated files.
- Stopping a user-owned Electron process when an isolated test instance cannot substitute.
- Using a missing secret, account, signing identity, paid service, or production credential.
- Deploying, publishing, purchasing, force-pushing, merging to a protected branch, or changing production data.
- Resolving genuinely contradictory requirements where either choice creates an irreversible compatibility or security outcome.

When one optional live check is blocked, the builder should continue all other implementation and tests rather than stopping the whole task.

The final branch handoff must end with one of:

```text
READY_FOR_MERGE
```

or:

```text
BLOCKED_FOR_MERGE: <one concrete blocking reason>
```

`READY_FOR_MERGE` requires all intended code and tests to be committed. It does not permit hidden unfinished phases behind TODO-only scaffolding.

---

## 25. Source basis

Official Claude Code behavior used for the product comparison:

- [Subagents](https://code.claude.com/docs/en/sub-agents)
- [Dynamic workflows](https://code.claude.com/docs/en/workflows)
- [Agent teams](https://code.claude.com/docs/en/agent-teams)
- [Worktrees](https://code.claude.com/docs/en/worktrees)
- [Skills](https://code.claude.com/docs/en/skills)

Local Zyra implementation evidence:

- `src/zyra-sdk.mjs`
- `src/model-order.mjs`
- `src/model-availability.mjs`
- `src/model-compatibility.mjs`
- `src/zyra-ui.mjs`
- `src/zyra-ui-bridge.mjs`
- `src/tui/component-host.mjs`
- `src/tui/components/editor.mjs`
- `src/tui/components/message-components.mjs`
- `desktop/src/main/assistant/zyra-pi-runtime.ts`
- `desktop/src/main/assistant/service-runtime-events.ts`
- `desktop/src/renderer/src/pages/assistant/AssistantTimelineSubagentActivityCard.tsx`
- `desktop/src/renderer/src/pages/assistant/AssistantInspectorSidebar.tsx`
- `docs/guides/model-support.md`

The implementation should reproduce the useful workflow behavior while keeping Zyra's runtime, model catalog, privacy boundaries, and presentation architecture authoritative.
