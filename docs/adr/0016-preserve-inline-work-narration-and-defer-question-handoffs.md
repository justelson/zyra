# ADR-0016: Preserve inline Work narration and defer Question handoffs

- **Status:** Accepted and implemented
- **Date:** 2026-09-03

## Context

The assistant timeline exposed provider and tool mechanics as the primary hierarchy. User-facing progress narration must remain in its original chronological position, while consecutive operations need a quieter summary than a stack of exposed rows. The earlier “last five” disclosure hid an arbitrary subset, command evidence repeated wrapper text, and reads could reopen newer file state instead of making the captured range explicit. Skills, web results, browser work, computer control, and agent assignments also collapsed into generic tool cards.

`request_user_input` had a separate lifecycle problem. The tool blocked the active model turn until the form was answered. Desktop replaced the composer with a question wizard, and the answer resumed the old tool call instead of becoming a user-authored continuation turn. Approvals and questions therefore shared blocking behavior despite representing different product concepts.

## Decision

A Turn projects work through this hierarchy:

1. **Work summary** — one collapsible duration and action-count row;
2. **Work narration** — the assistant's original user-facing progress text in arrival order;
3. **Action batch** — one collapsed block for consecutive operations between narration boundaries;
4. **Action** — one compact typed operation row inside the batch or standing alone;
5. **Evidence** — event-time output opened from that Action.

Work narration remains verbatim and inline. It does not gain final-answer timestamps or copy controls, and it is never rewritten into an Action label. An Action batch starts closed, exposes no arbitrary preview subset, and reveals every captured Action when opened. Its short `-ing` title follows the currently running Action and shimmers while that Action is live; after settlement it names the latest Action without the shimmer. A lone Action can remain one direct clickable row.

The typed middle contract distinguishes commands, reads, edits, local searches, web searches, web fetches, skills, agent operations, workflows, Browser operations, and computer-control operations. Labels describe the actual operation with short `-ing` phrases such as `Running tests`, `Reading app.ts`, or `Loading diagnose`; narration never supplies those labels. Existing activity IDs remain replay identities. Captured read output, read-range metadata, patches, structured web results, agent run IDs, and canonical history-body references remain attached to the activity payload. Oversized payload compaction preserves the small identifying and evidence fields.

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

- Original user-facing narration survives replay in the same position relative to its Actions.
- Consecutive Actions occupy one quiet block without reviving an arbitrary last-five view.
- Historical evidence is auditable without silently substituting current files or pages.
- New action families can add a typed renderer while legacy generic activities continue to replay.
- Pending questions no longer monopolize Desktop or TUI composition.
- Answer messages are ordinary user prompts, so turn authority, persistence, recovery, pagination, and canonical replay use the established path.
- The TUI multiplexes question focus and composer focus with Tab because a terminal has one keyboard input channel.

## Alternatives

### Rewrite narration into Action headings

Rejected because it deletes the assistant's original progress voice, makes Action labels long and speculative, and erases the chronological boundary between consecutive Action batches.

### Show the latest five Actions while collapsed

Rejected because five is arbitrary. A closed batch shows only its current or latest Action intent; an opened batch shows every Action.

### Resume the same model turn after questions

Rejected because the user answer would remain a tool result rather than a real conversation message, the composer would stay blocked, and turn outcomes would depend on a long-lived bridge callback.

### Convert approvals into Question handoffs

Rejected because an approval authorizes an in-flight action and must remain tied to that action and Turn.

## Verification

- `test:work-timeline-v2` covers verbatim inline narration, current-Action batch titles and shimmer, all-or-none Action disclosure, short `-ing` labels, command-envelope removal, exact read ranges, skill parsing, structured web evidence and favicons, agent identities, control actions, and pending/resolved question forms.
- User-input contracts cover Desktop timeline placement, linked answer-message persistence, deferred tool termination, reconnect fallback, TUI flat-form rendering, TUI/composer multiplexing, and continuation through a real prompt.
- Activity, display-mode, lifecycle, history, pagination, switching, virtualization, and main/renderer TypeScript checks preserve existing turn and replay behavior.
