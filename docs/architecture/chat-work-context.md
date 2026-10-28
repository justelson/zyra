# Agent-reported work context

The Agent Inbox Chat card can show the folder where substantial work is taking place, with its project artwork or a work-related Lucide icon. This is display metadata, separate from Project membership and the execution directory.

## Ownership and flow

The foreground conversation model receives `set_work_context` through the SDK and a per-turn snapshot of its saved work context. The tool accepts only `folderPath` and a fixed `kind` category. It has no Chat target, icon path, arbitrary icon name, permission fields or navigation action.

The bridge publishes `session_work_context` for its own session. The canonical server binds the event to that session's canonical Chat ID, serializes updates in arrival order and persists them in catalog metadata. Metadata-only notifications refresh the Desktop projection without invalidating the loaded transcript. The normal session projection and SQLite metadata cache preserve the value for cold attachment and reopening.

Supporting workers do not inherit the parent's controller. Memory workers, private Voice-primary workers and no-session bridge requests do not receive this UI metadata tool. They cannot overwrite the parent Chat's badge through it.

## Agent behavior

- Report the main work folder when substantial work begins or genuinely changes.
- Use an existing absolute directory. No icon discovery or artwork search is needed.
- Use a null folder for work without a specific directory. The app falls back to that Chat's agent cwd, then its working root.
- Keep the context stable through incidental reads, temporary shell directory changes and task completion.
- Leave untouched conversations neutral until work is reported. Do not narrate metadata updates.

Supported categories are coding, debugging, research, music, audio, video, design, writing, data, planning and general.

## Permissions and presentation

The executor checks readable folder scope, including canonical symlink boundaries in scoped modes. Full access retains its existing folder policy. Reporting metadata never requests or consumes a folder grant. A missing directory, file path, cancelled request or invalid category cannot become a successful folder update. Duplicate reports do not republish metadata; a failed submission can be retried.

The existing project presentation cache, icon overrides and artwork resolver receive the reported path. A real custom project icon takes priority. Missing or broken artwork falls back to the current work category, not an unrelated framework logo. Late artwork from a previous folder cannot replace the new context. The compact settled row retains the same icon policy.

The card title, model row, Project filters, grouping, ordering, selected Chat, composer focus, filesystem authority and runtime cwd remain unchanged. The full folder path is available on hover. Invalid legacy cached metadata falls back to the existing neutral presentation.

## Verification

Run `npm run test:work-context` at the repository root, or `npm --prefix desktop run test:assistant-work-context` for presentation/cache checks only.

Coverage includes strict tool inputs, read-only and symlink boundaries without new grants, cancellation, real SDK/provider execution, hidden TUI replay, real server/client Chat ownership, ordered updates, next-turn context, catalog restart, SQLite cold reads and normal session projection. The disposable hidden Electron fixture exercises the real Inbox components and artwork effect with delayed replies, loaded images, broken images, changed categories, per-Chat fallback, retained focus/selection and unchanged Project/cwd. Its providers and filesystem metadata are synthetic; it never focuses or restarts the user's app.

The feature is locally verified source, not an installed activation claim. Existing workers and the running Desktop need a separately authorized update before this behavior appears there. No production build or installation is part of these checks.
