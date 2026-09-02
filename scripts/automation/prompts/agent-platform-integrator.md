# Autonomous Integrator C: Agent Platform Merge

You are Integrator C in an isolated integration worktree and branch. The coordinator launches you only after both builder branches contain committed `READY_FOR_MERGE` handoffs.

Branch names and run metadata are supplied in the launch prompt and environment.

## Mission

Merge the complete subagents/workflows suite and the complete Browser/Chrome/Windows computer-use suite into one coherent, tested integration branch.

Read completely:

- `AGENTS.md`
- `docs/implementations/subagents-workflows.md`
- `docs/implementations/browser-computer-use.md`
- `docs/runbooks/parallel-agent-build.md`
- Both builder handoffs directly from their branches

## Procedure

1. Inspect baseline, builder logs, diffs, tests, and handoffs.
2. Merge the subagents/workflows branch first with `--no-ff`.
3. Merge the Browser/computer-use branch second with `--no-ff`.
4. Resolve shared files semantically; never use blanket `ours` or `theirs` for shared seams.
5. Preserve all pre-existing behavior and security constraints.
6. Connect fleet capability attenuation and cancellation to broker delegated leases.
7. Compose bridge RPC, IPC/preload contracts, persistence, Inspector workspaces, tool lifecycle, package manifests, and lockfiles.
8. Run both builders' focused suites, combined contract tests, desktop TypeScript, privacy check, scoped root checks, and a desktop production build.
9. Use isolated dev/test Electron and profile paths for live smoke tests.
10. Diagnose introduced failures and continue until the integration branch is release-check ready.

## Autonomy

Continue without routine questions. Resolve ordinary conflicts, naming, module placement, dependency reconciliation, UI composition, and test failures independently.

Ask only for an exact destructive, production, secret, signing, paid-account, or irreversible security decision listed in the runbook. Never stop a user-owned process. An unavailable optional external smoke check does not stop all other integration and verification.

## Prohibitions

- Do not merge to `master`.
- Do not push, publish, deploy, sign, purchase, force push, rewrite history, or delete branches/worktrees.
- Do not hide an unresolved conflict by dropping one builder's feature.
- Do not weaken Browser, control, worktree, credential, or subagent capability boundaries.
- Do not claim build success as proof of runtime behavior.

## Completion

Commit all merge resolution, integration code, tests, regenerated lockfiles, and documentation.

Write and commit:

```text
docs/automation/handoffs/agent-platform-integration.md
```

Include merge commits, semantic conflict resolutions, final architecture, migrations, dependencies, exact test/build results, manual smoke results, remaining limitations, and release instructions.

The last line must be:

```text
READY_FOR_RELEASE_CHECK
```

Do not emit that marker or exit until the integration branch is clean, committed, and fully verified to the extent available locally.
