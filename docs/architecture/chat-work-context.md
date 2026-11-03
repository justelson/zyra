# Agent-reported work context

The Agent Inbox Chat card can show the folder where substantial work is taking place, with its project artwork or a work-related Lucide icon. This is display metadata, separate from Project membership and the execution directory.

## Ownership and flow

The foreground conversation model receives `set_work_context` through the SDK and a per-turn snapshot of its saved work context. New tool reports require a semantic `shortName` (1–24 characters), an optional `folderPath` and a fixed `kind` category. The shared reader also accepts legacy saved metadata without a name. It has no Chat target, icon path, arbitrary icon name, permission fields or navigation action.

The bridge publishes `session_work_context` for its own session. The canonical server binds the event to that session's canonical Chat ID, serializes updates in arrival order and persists them in catalog metadata. Metadata-only notifications refresh the Desktop projection without invalidating the loaded transcript. The normal session projection and SQLite metadata cache preserve the value for cold attachment and reopening.

Supporting workers do not inherit the parent's controller. Memory workers, private Voice-primary workers and no-session bridge requests do not receive this UI metadata tool. They cannot overwrite the parent Chat's badge through it.

## Agent behavior

- Report the main work folder and actual task when substantial work begins or genuinely changes, including a different task in the same folder.
- Supply a very short meaningful name such as `Chat scroll`, `Classic edit` or `Preview build`. Describe the actual work. Never copy timestamps, paths or ambiguous folder basenames, or use a vague label such as `Assistant`.
- Upgrade legacy nameless metadata on the next substantial-work turn even if its folder and category are unchanged. Saved names are included in the next-turn prompt.
- Use an existing absolute directory. No icon discovery or artwork search is needed.
- Use a null folder for work without a specific directory. The app falls back to that Chat's agent cwd, then its working root.
- Keep the context stable through incidental reads, temporary shell directory changes and task completion.
- Leave untouched conversations neutral until work is reported. Do not narrate metadata updates.

Supported categories are coding, debugging, research, music, audio, video, design, writing, data, planning and general.

## Permissions and presentation

The executor checks readable folder scope, including canonical symlink boundaries in scoped modes. Full access retains its existing folder policy. Reporting metadata never requests or consumes a folder grant. A missing directory, file path, cancelled request or invalid category cannot become a successful folder update. Duplicate reports do not republish metadata; a name-only change does. A failed submission can be retried. Names reject control characters, path syntax, number-only timestamps, generic labels and text longer than 24 characters.

The existing project presentation cache, icon overrides and artwork resolver receive the reported path. A real custom project icon takes priority. Missing or broken artwork falls back to the current work category, not an unrelated framework logo. Late artwork from a previous folder cannot replace the new context. The compact settled row retains the same icon policy.

The card leads with the supplied semantic name, independently of its folder/artwork identity, above a quieter Chat title. The work label stays on one line beside recency or the running timer; narrower sidebars use ellipsis without rewriting the saved name or adding another text level. Legacy nameless contexts show their honest category only, never an inferred timestamp or folder name. The full folder path and model are available on the work-label hover tooltip rather than a third visible model line. Recency and status, including the running timer, align to the same right padding. Normal recency shares its slot with hover/focus actions; rows with a status place those actions on the title line below, keeping the status visible. The action anchor stays mounted when a row changes between ready and working. Pin and agent/terminal/mobile indicators remain beside the Chat title. Project filters, grouping, ordering, selected Chat, composer focus, filesystem authority and runtime cwd remain unchanged. Invalid legacy cached metadata falls back to the existing neutral presentation.

## Verification

Run `npm run test:work-context` at the repository root, or `npm --prefix desktop run test:assistant-work-context` for presentation/cache checks only.

Regression cases also cover semantic names for different tasks in the same folder, timestamp-folder independence, name-only duplicate detection, cold persistence/next-turn name transport, legacy upgrade and single-line labels beside ready/running status at 240/280/330/400px fixture widths. These new cases require execution by the owning validation runner; source changes alone do not establish passing or installed acceptance.

Coverage includes strict tool inputs, read-only and symlink boundaries without new grants, cancellation, real SDK/provider execution, hidden TUI replay, real server/client Chat ownership, ordered updates, next-turn context, catalog restart, SQLite cold reads and normal session projection. The disposable hidden Electron fixture exercises the real Inbox components and artwork effect with delayed replies, loaded images, broken images, changed categories, per-Chat fallback, retained focus/selection and unchanged Project/cwd. Its providers and filesystem metadata are synthetic; it never focuses or restarts the user's app.

The feature is locally verified source, not an installed activation claim. Existing workers and the running Desktop need a separately authorized update before this behavior appears there. No production build or installation is part of these checks.
