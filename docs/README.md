# Zyra Documentation

This directory contains public, durable guidance, architecture records, implementation contracts, and automation records. One-off plans, research, handoffs, QA evidence, and working prompts belong in ignored `docs.local/`.

Status words used below:

- **Current** — maintained guidance or source-of-truth documentation.
- **Draft** — forward-looking work that is not an implemented contract.
- **Historical** — retained implementation evidence or research, not current instructions.
- **Superseded** — preserved context replaced by a newer path or implementation.

## Current guidance

- [Repository map](repository-map.md) — **Current.** Ownership and cleanup policy for every top-level Zyra surface.
- [Subagents and workflows](guides/subagents-workflows.md) — **Current.** User/developer guide for fleet and workflow behavior.
- [Model support](guides/model-support.md) — **Current.** Supported providers/models and deferred compatibility work.
- [Agent-control security and operations](security/agent-control.md) — **Current.** Authority, approval, transport, and incident boundaries.
- [Product analytics setup](guides/product-analytics-setup.md) — **Current.** Opt-in PostHog credentials, endpoint validation, and local status.
- [Product analytics security and privacy](security/product-analytics.md) — **Current.** Data prohibition, process boundaries, and incident response.
- [Parallel agent build runbook](runbooks/parallel-agent-build.md) — **Current.** Procedure still consumed by the autonomous coordinator scripts.
- [Desktop performance budget](performance/desktop-resource-budget.md) — **Current.** Reproducible startup, chat latency, CPU, memory, and profile-growth budgets with the latest measured baseline.

## Architecture

- [Agent server](architecture/agent-server.md) — **Current.** Shared server authority, persistence, and client flow.
- [Canonical chat integrity](architecture/canonical-chat-integrity.md) — **Current.** Cross-client identity, indexed history, metadata, recovery, and migration safety.
- [Local chat search ADR](adr/0012-use-a-derived-fts-projection-for-local-chat-search.md) — **Accepted and implemented.** Canonical eligibility, FTS5 projection ownership, worker isolation, bounded fallback, and exact-message navigation.
- [Agent surfaces](architecture/agent-surface.md) — **Current.** Desktop/TUI semantic projection boundaries.
- [Assistant browser](architecture/assistant-browser.md) — **Current.** Integrated Electron Browser ownership and visual-control architecture.
- [Local browser client](architecture/local-browser-client.md) — **Current.** Same-device Chrome runtime, transport, security, and capability boundary.
- [Assistant resources](architecture/assistant-resources.md) — **Current.** Resource indexing and presentation ownership.
- [Desktop theme contract](architecture/desktop-theme-contract.md) — **Current.** Shared shell surfaces, accessible palette resolution, specialized renderers, and validation.
- [Desktop onboarding and device preferences](architecture/desktop-onboarding-and-device-preferences.md) — **Current.** Mandatory setup gate, checkpoint recovery, preference ownership, migration, and per-chat web defaults.
- [Product analytics](architecture/product-analytics.md) — **Current.** Main-owned transport, shared event catalog, privacy contract, and validation.
- [Voice-agent architecture](architecture/voice-agent/README.md) — **Draft specification.** Product Phase One defines direct strong-agent Chat, optional realtime Voice, exclusive foreground routing, deterministic task control, selective speech, and resumable continuity. Optional Product Phase Two adds a relationship-first Zyra Home, scoped work threads, hybrid Inbox, and voice-led focus visits while retaining Phase One. A linked Betum-informed research note explores evidence-owned adaptive coaching beyond these committed phases.

## Architecture decisions

- [Decision record index](adr/README.md) — **Current record format.** Accepted design decisions and their implementation status.
- [Voice-agent ADRs](adr/README.md#voice-agent-decisions) — **Accepted design; implementation pending.** Canonical Voice identity, two model roles, deterministic ledgers, central narration, continuity, permission separation, product-profile coexistence, relationship focus, retrieval-first escalation, and attention visits.

## Implementation records

- [Browser and computer use](implementations/browser-computer-use.md) — **Historical.** Build plan and acceptance record for the control subsystem.
- [Chrome visual browser use](implementations/chrome-visual-browser-use.md) — **Historical.** Chrome implementation contract retained for design evidence.
- [Subagents and workflows](implementations/subagents-workflows.md) — **Historical.** Original fleet/workflow implementation plan.
- [Windows isolated computer use](implementations/windows-isolated-computer-use.md) — **Historical.** Windows sidecar implementation record.

## Automation inputs and records

- [Agent-platform integrator prompt](../scripts/automation/prompts/agent-platform-integrator.md) — **Current.** Coordinator-owned dispatch input.
- [Browser/computer-use builder prompt](../scripts/automation/prompts/browser-computer-use-builder.md) — **Current.** Builder dispatch input.
- [Subagents/workflows builder prompt](../scripts/automation/prompts/subagents-workflows-builder.md) — **Current.** Builder dispatch input.
- [Automation handoffs](automation/handoffs/) — **Historical.** Public records required by the branch-validation workflow.

## Conventions

- Keep maintained how-to material in `guides/` and source-of-truth security policy in `security/`.
- Keep architecture separate from implementation evidence and forward plans.
- Move one-off execution briefs, plans, research, handoffs, and local design evidence to ignored `docs.local/`.
- Keep automation-owned public prompts under `scripts/automation/prompts/` and automation-required committed records under `docs/automation/`.
- Do not commit generated build output, local sessions, private exports, or credentials as documentation.
