# ADR-0016: Use purpose-led Work steps and deferred Question handoffs

- **Status:** Accepted and implemented
- **Date:** 2026-09-03

## Context

The assistant timeline exposed provider and tool mechanics as the primary hierarchy. Intermediate narration looked like ordinary assistant messages, long tool runs gained a second “last five” disclosure, command evidence repeated wrapper text, and reads could reopen newer file state instead of making the captured range explicit. Skills, web results, browser work, computer control, and agent assignments also collapsed into generic tool cards.

`request_user_input` had a separate lifecycle problem. The tool blocked the active model turn until the form was answered. Desktop replaced the composer with a question wizard, and the answer resumed the old tool call instead of becoming a user-authored continuation turn. Approvals and questions therefore shared blocking behavior despite representing different product concepts.

## Decision

A Turn projects work through this hierarchy:

1. **Work summary** — one collapsible duration and action-count row;
2. **Work step** — a purpose derived from the stable intermediate narration message;
3. **Action** — one compact typed operation row;
4. **Evidence** — event-time output opened from that Action.

Narration inside a Work summary is a purpose source, not a visible message with timestamp and copy controls. A one-Action Work step inherits its purpose directly into the Action row. Multi-Action steps render one purpose heading followed by every Action. There is no nested “last five” disclosure. Legacy history without narration falls back to typed Action labels.

The typed middle contract distinguishes commands, reads, edits, local searches, web searches, web fetches, skills, agent operations, workflows, Browser operations, and computer-control operations. Existing activity IDs remain replay identities. Captured read output, read-range metadata, patches, structured web results, agent run IDs, and canonical history-body references remain attached to the activity payload. Oversized payload compaction preserves the small identifying and evidence fields.

Read previews show only the captured output and its original line range. Skill previews split YAML front matter from the Markdown body. Web evidence renders page-specific favicon pills with title and hover detail. Agent rows derive the same assigned internal identity and avatar as the Agents inspector, and selecting a row opens that existing inspector run.

A **Question handoff** is durable state outside the completed assistant Turn:

- the assistant explains why input is needed before calling `request_user_input`;
- the tool emits the question set and terminates the current tool turn;
- Desktop and TUI keep the normal composer available while the form is pending;
- all questions appear in one form;
- submission resolves the set to `Answered N questions`, reserves a linked user-message ID, and sends formatted answers through the normal prompt path as a new Turn;
- reconnecting surfaces can reconstruct the continuation from persisted questions even if the original bridge process is gone.

Approvals remain blocking authorization actions inside the current Turn. They do not use the Question-handoff continuation path.

## Consequences

- Provider wording and raw transport envelopes no longer define the visible timeline hierarchy.
- Historical evidence is auditable without silently substituting current files or pages.
- New action families can add a typed renderer while legacy generic activities continue to replay.
- Pending questions no longer monopolize Desktop or TUI composition.
- Answer messages are ordinary user prompts, so turn authority, persistence, recovery, pagination, and canonical replay use the established path.
- The TUI multiplexes question focus and composer focus with Tab because a terminal has one keyboard input channel.

## Alternatives

### Improve generic tool-card labels only

Rejected because it leaves purpose, evidence ownership, replay identity, and question-turn semantics implicit.

### Persist a separate Work-step table

Rejected for now because narration messages already provide stable IDs and ordering. A bounded legacy fallback is sufficient without adding another persistence stream.

### Resume the same model turn after questions

Rejected because the user answer would remain a tool result rather than a real conversation message, the composer would stay blocked, and turn outcomes would depend on a long-lived bridge callback.

### Convert approvals into Question handoffs

Rejected because an approval authorizes an in-flight action and must remain tied to that action and Turn.

## Verification

- `test:work-timeline-v2` covers stable purpose projection, one-row-per-Action rendering, command-envelope removal, exact read ranges, skill parsing, structured web evidence and favicons, agent identities, control actions, and pending/resolved question forms.
- User-input contracts cover Desktop timeline placement, linked answer-message persistence, deferred tool termination, reconnect fallback, TUI flat-form rendering, TUI/composer multiplexing, and continuation through a real prompt.
- Activity, display-mode, lifecycle, history, pagination, switching, virtualization, and main/renderer TypeScript checks preserve existing turn and replay behavior.
