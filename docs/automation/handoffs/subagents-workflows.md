# Subagents + Workflows Handoff

## Branch

`feature/20260725-170750z-013fd2-subagents-workflows`

## Result

Implemented the complete shared Subagents + Workflows system across the Zyra CLI/TUI and desktop without creating a second renderer-side runtime.

### Runtime and persistence

- Upgraded Pi to `0.80.6` and added `quickjs-emscripten@0.32.0`.
- Added durable event-sourced fleet authority with append-only JSONL, atomically replaced snapshots/per-run records, serialized snapshot writes, truncated-tail recovery, workflow sublogs/cache, and restart reconciliation.
- Added independent persistent Pi child sessions, context-forked `/subtask` sessions, root-reserved concurrency, cancellation propagation, steering/follow-up, retry/resume, paged transcripts, usage accounting, serialized write scopes, and retained Git worktrees.
- Added Codex-only live model routing for Sol/Terra/Luna plus previous-generation fallbacks, explicit candidate rejection/fallback explanations, and reason-gated bounded escalation.
- Added definition discovery/validation and two-step Claude agent import preview/confirmation.
- Added capability attenuation, symlink-aware read/write scope gates, default child denial for shell/browser/Chrome/Windows/computer/recursive control, and child output provenance/scanning/redaction/bounds.

### Workflows

- Added definition discovery, metadata/budget validation, approval policy, deterministic cache fingerprints, phase/call scheduler, pause/resume/stop/restart/save controls, and calls/request/token/cost/concurrency enforcement.
- Workflow JavaScript runs in a forked QuickJS/WASM process with no Node, filesystem, shell, credential, import, time/random, or network APIs; only bounded `phase` and `agent` bridge messages cross the host boundary.
- Added built-in `review-changes` and built-in `code-reviewer` / `bug-analyzer` agents.

### Terminal

- Added root-only `agent` and `workflow` tools and the fleet guide injected into the root system prompt.
- Added `/agents`, `/agent`, `/subtask`, `/workflows`, and `/workflow`, including doctor/import preview and direct control actions.
- Added typed `@agent-*` completion that coexists with normal `@file` mentions.
- Added agent/workflow timeline rows, a fixed dock above the editor, keyboard focus transfer, live managers, steering/stop/retry/pause/restart/save controls, and paged transcript inspection.

### Desktop

- Extended the existing duplex worker with typed fleet operations and redacted bounded record-shaped snapshots.
- Added main-process runtime events, shared contracts/projector state, typed IPC/preload APIs, initial-connect hydration, and a single canonical fleet projection.
- Added separate queryable SQLite fleet tables for runs, workflows, phases, calls, relationships, artifacts, and bounded snapshots. Existing assistant rows and persistence version were not rewritten.
- Added Inspector → Agents with Agents/Workflows tabs, run details, fallback/capability/isolation/worktree/result data, controls, workflow progress, and paged child transcripts.

## Commits

- `dfe3063 feat: add persistent subagent and workflow runtime`
- `e55d4d2 feat: expose fleet controls in TUI and desktop`
- `test: cover and document fleet orchestration` (tests/docs/handoff commit at current HEAD)

## Verification

Passed:

- `npm run check`
  - privacy scan
  - existing auth, agent-surface, memory, Codex mode/reset/usage, managed bash, model availability, prompt error, and TUI rendering regressions
  - new subagent/workflow/TUI/desktop fleet suites
  - CLI doctor
- `npm run test:subagents-workflows`
  - subagents: 9 focused cases
  - workflows: 8 focused cases
  - TUI fleet contract
  - desktop bridge/IPC/SQLite/Inspector contract
- `npm --prefix desktop run typecheck`
- `npm run privacy-check`
- syntax checks for all new/changed agent, workflow, TUI, bridge, and test modules

The focused coverage proves model fallback/escalation, capability and path attenuation, output scanning/redaction, event replay and truncated logs, restart planning, root-reserved concurrency, cancellation/disposal, context forks, transcript paging, QuickJS isolation/cancellation, workflow approval/cache/budgets/concurrency, durable workflow event fan-out, TUI focus/projection, desktop bridge contracts, SQLite projection without legacy-row rewrites, and server-rendered Inspector output.

## Intentional boundaries

- The fleet executes only `openai-codex/*` models. Luna remains skipped while Pi/live availability marks it unsupported; previous Codex generations are used as recorded fallbacks.
- Child agents do not receive unrestricted shell or browser/computer-control authority. Root Zyra remains the place to run checks requiring shell access.
- Worktrees are retained and never auto-merged or auto-deleted.
- Incomplete restart recovery is explicit (`recovering`/retry/resume); Zyra does not silently replay paid calls.
- Temporary/generated and untrusted project workflows require explicit per-run approval.

## Remaining manual proof

No paid live child-model call was made, and no packaged Electron production build was run. Those are intentionally outside the narrow automated verification. Before release, perform one authenticated CLI child run and one Electron click-through after a controlled app restart to confirm provider/account availability and visual behavior on the target machine.

READY_FOR_MERGE