# Architecture decision records

ADRs preserve Zyra’s load-bearing decisions so later implementation and review do not repeatedly reopen them without new evidence.

Status vocabulary:

- **Proposed** — under discussion.
- **Accepted design; implementation pending** — chosen direction, not yet a runtime claim.
- **Accepted and implemented** — current enforced architecture.
- **Superseded** — replaced by a linked later ADR.
- **Rejected** — considered and declined.

## Voice-agent decisions

- [ADR-0001: Voice is a mode of the canonical conversation](0001-voice-is-a-canonical-conversation-mode.md)
- [ADR-0002: Use two model roles with bounded foreground tools](0002-two-model-roles-and-bounded-foreground-tools.md)
- [ADR-0003: Keep task authority in deterministic ledgers](0003-deterministic-task-controller-and-ledgers.md)
- [ADR-0004: Keep one central narrator and exceptional subagents](0004-central-narration-and-exceptional-subagents.md)
- [ADR-0005: Build continuity as a materialized view](0005-continuity-as-a-materialized-view.md)
- [ADR-0006: Separate involvement preferences from permissions](0006-separate-involvement-from-permissions.md)
- [ADR-0007: Keep canonical Chat primary and make Voice an explicit foreground route](0007-canonical-chat-and-explicit-voice-foreground-routing.md)
- [ADR-0008: Offer relationship-first interaction as an optional second phase](0008-offer-relationship-first-interaction-as-an-optional-second-phase.md)
- [ADR-0009: Group Home and work threads with relationship focus](0009-group-home-and-work-threads-with-relationship-focus.md)
- [ADR-0010: Use strong consultation and retrieval-first worker escalation](0010-use-strong-consultation-and-retrieval-first-worker-escalation.md)
- [ADR-0011: Use attention items, focus visits, and Home receipts](0011-use-attention-items-focus-visits-and-home-receipts.md)

## Product and platform decisions

- [ADR-0012: Use a derived FTS projection for local chat search](0012-use-a-derived-fts-projection-for-local-chat-search.md) — **Accepted and implemented.**
- [ADR-0013: Use chat permissions and critical-only Full access escalation](0013-use-chat-permissions-and-critical-only-full-access-escalation.md) — **Superseded by ADR-0014.**
- [ADR-0014: Share four permission modes across chat and control](0014-share-four-permission-modes-across-chat-and-control.md) — **Accepted and implemented.**
- [ADR-0015: Use stable Projects and revisioned Chat scopes](0015-use-stable-projects-and-revisioned-chat-scopes.md) — **Accepted and implemented.**
- [ADR-0016: Preserve inline Work narration and defer Question handoffs](0016-preserve-inline-work-narration-and-defer-question-handoffs.md) — **Accepted and implemented.**

## Format

Each ADR records context, decision, consequences, alternatives, and verification. A changed load-bearing decision creates a refining or superseding ADR rather than silently rewriting accepted history.
