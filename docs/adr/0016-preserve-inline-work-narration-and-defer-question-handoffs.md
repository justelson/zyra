# ADR-0016: Preserve inline Work narration and defer Question handoffs

- **Status:** Accepted and implemented
- **Date:** 2026-09-04

## Context

The assistant timeline exposed provider and tool mechanics as the primary hierarchy. User-facing progress narration must remain in its original chronological position, while consecutive operations need a quieter summary than a stack of exposed rows. The earlier “last five” disclosure hid an arbitrary subset, command evidence repeated wrapper text, and reads could reopen newer file state instead of making the captured range explicit. Skills, web results, browser work, computer control, and agent assignments also collapsed into generic tool cards.

`request_user_input` had a separate lifecycle problem. The tool originally blocked the active model turn until the form was answered. A later inline presentation ended the provider turn but placed the questionnaire in the timeline, while stale global command state could still disable Submit with “Finish the current work.” The answer continuation already had a reserved user-message identity, but resolved Q&A was presented as a questionnaire boundary instead of its linked user Turn. Approvals and questions therefore still looked more alike than their product semantics warranted.

## Decision

A Turn projects work through this hierarchy:

1. **Work summary** — one collapsible duration and action-count row;
2. **Work narration** — the assistant's original user-facing progress text in arrival order;
3. **Action batch** — one collapsed block for consecutive operations between narration boundaries;
4. **Action** — one compact typed operation row inside the batch or standing alone;
5. **Evidence** — event-time output opened from that Action.

Work narration remains verbatim and inline. It uses the same readable typography as a final assistant response without gaining final-answer timestamps or copy controls, and it is never rewritten into an Action label. An Action batch starts closed, exposes no arbitrary preview subset, and reveals every captured Action when opened. While work is active, its short `-ing` title follows the currently running Action and uses the same full-label shimmer as Chat title regeneration. After every Action settles, the batch uses a short agent-declared block intent. The hidden `begin_action_batch` declaration is consumed before timeline transport and copied onto subsequent Action payloads so canonical replay preserves it; older history and missing declarations fall back to operation-derived titles. Failed Actions count as settled and keep their visible failed state inside the batch. A lone Action can remain one direct clickable row.

The typed middle contract distinguishes commands, reads, edits, local searches, web searches, web fetches, skills, agent operations, workflows, Browser operations, and computer-control operations. Labels describe the actual operation with short `-ing` phrases such as `Running tests`, `Reading app.ts`, or `Loading diagnose`; narration never supplies those labels. Existing activity IDs remain replay identities. Captured read output, read-range metadata, patches, structured web results, agent run IDs, and canonical history-body references remain attached to the activity payload. Oversized payload compaction preserves the small identifying and evidence fields.

Command rows use reduced header and evidence padding, and settled output grows only as tall as its content up to a bounded maximum. Read previews use the shared file-preview shell and Monaco source surface while showing only the captured output at its original line-number offset. Skill previews use the same shell, parse front matter into a readable title, description, and metadata section, render the instruction body as Markdown, and keep literal YAML/source behind `View source`. Web evidence renders page-specific favicon pills with title and hover detail. Agent rows derive the same assigned internal identity and avatar as the Agents inspector, and selecting a row opens that existing inspector run.

Only normal final assistant Markdown opts into inline response media. Images retain the existing click-to-expand path. Links to supported video files become aspect-preserving native players with controls, metadata preload, and no autoplay. Work narration and Action rows suppress media projection.

The Desktop agent guide teaches Markdown image syntax and video links using verified absolute `file:///` URLs with encoded path characters. Bare or code-formatted paths remain file chips. Local media paths are decoded once before conversion to the existing file protocol, including when no project root is available. The page policy permits HTTPS media while retaining its script, frame, and connection restrictions. An emitted media link is not proof of successful playback.

A **Question handoff** is durable state outside the completed assistant Turn:

- the assistant explains why input is needed before calling `request_user_input`, and that explanation remains visible as final-response-styled handoff text after any collapsed Work;
- the tool emits the question set and terminates the current tool turn;
- Desktop places the questionnaire in the composer area immediately after the settled assistant Turn, with Submit governed by a dedicated response request rather than stale global command state;
- all questions appear in one form and reserve no virtualized timeline row;
- submission resolves the set, reserves a linked user-message ID, and sends formatted answers through the normal prompt path as a new Turn;
- the linked user Turn renders as a normal user bubble marked `Responded to agent question`, with one concise Q&A preview, `Show more` for multiple answers, and a dedicated full-response modal;
- reconnecting surfaces can reconstruct the continuation from persisted questions even if the original bridge process is gone.

Approvals remain blocking authorization actions inside the current Turn. They do not use the Question-handoff continuation path.

## Consequences

- Original user-facing narration survives replay in the same position relative to its Actions.
- Consecutive Actions occupy one quiet block without reviving an arbitrary last-five view.
- Historical evidence is auditable without silently substituting current files or pages.
- New action families can add a typed renderer while legacy generic activities continue to replay.
- Pending questions become an immediate composer-owned handoff instead of an active timeline form.
- Answer messages are ordinary linked user prompts, so turn authority, persistence, recovery, pagination, and canonical replay use the established path.
- The TUI multiplexes question focus and composer focus with Tab because a terminal has one keyboard input channel.

## Alternatives

### Rewrite narration into Action headings

Rejected because it deletes the assistant's original progress voice, makes Action labels long and speculative, and erases the chronological boundary between consecutive Action batches.

### Show the latest five Actions while collapsed

Rejected because five is arbitrary. A closed batch shows only its current Action while running or its declared shared intent after settlement; an opened batch shows every Action.

### Resume the same model turn after questions

Rejected because the user answer would remain a tool result rather than a real conversation message, the composer would stay blocked, and turn outcomes would depend on a long-lived bridge callback.

### Convert approvals into Question handoffs

Rejected because an approval authorizes an in-flight action and must remain tied to that action and Turn.

## Verification

- `test:work-timeline-v2` covers verbatim final-style narration, current-Action and settled declared batch titles, title-regeneration shimmer reuse, all-or-none Action disclosure, compact command rows, exact shared Read previews, structured Skill parsing/presentation, structured web evidence and favicons, agent identities, control actions, and linked Q&A previews.
- `test-assistant-action-batch-intent.ts` covers hidden declaration projection and replay persistence; the agent-surface contract covers tool registration and approval-free execution.
- User-input contracts cover composer ownership, zero-height timeline handoff rows, linked answer-message persistence, deferred tool termination, reconnect fallback, TUI flat-form rendering, TUI/composer multiplexing, and continuation through a real prompt.
- Markdown renderer contracts cover final-response image/video opt-in, video controls, and the no-autoplay boundary.
- `test:assistant-response-media` executes the actual Desktop prompt injector and renders its examples, covering encoded Windows filenames and page media policy. `test:assistant-response-media-playback` loads that rendered output in a hidden, isolated Electron window and verifies metadata, playback, seeking, and no autoplay through the real file protocol.
- Activity, display-mode, lifecycle, history, pagination, switching, virtualization, and main/renderer TypeScript checks preserve existing turn and replay behavior.
