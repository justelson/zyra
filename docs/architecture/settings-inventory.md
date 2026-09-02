# Settings inventory and ownership

This document is the source audit for Zyra settings. It deliberately starts from product behavior rather than the current Settings UI.

## Rules

A value belongs in Settings when it is a durable user choice that changes future behavior across chats, projects, or restarts.

A value does **not** belong in Settings when it is:

- current workspace state, such as open tabs, panel widths, the selected project tab, or expanded rows;
- recoverable continuity state, such as drafts and retained Browser/terminal layouts;
- cached data, such as recent project metadata or update-success markers;
- canonical chat data;
- a one-time action, unless Settings is the natural management surface for that action;
- a secret stored in renderer-readable persistence.

Settings controls must have a verified consumer. A persisted field with no behavior consumer must not be shown.

## Persistence owners found in the audit

| Owner | Current storage | Examples | Direction |
| --- | --- | --- | --- |
| Desktop product preferences | `devscope-settings` in renderer `localStorage` | theme, assistant defaults, file preview defaults, Git defaults | Keep one typed store for non-secret desktop preferences; version and sanitize it. |
| Operating-system preferences | Electron main process / Windows login settings | open at login, start hidden | Keep main-owned and reflect the real OS value in Settings. |
| Canonical/project runtime preferences | `<project>/.zyra/preferences.json` | model, thinking, profile, web tools, TUI notifications, interrupt mode, terminal theme, project trust | Expose only through bounded main/canonical APIs with explicit global/project scope. Do not mirror blindly into renderer storage. |
| Skill source preferences | `~/.zyra/skill-sources.json` | enabled compatible folders, source priority, per-name conflict choices | Keep main-owned, bounded, atomic, and available only to trusted Desktop renderers. Existing sessions apply changes through `/reload`; new sessions load them at startup. |
| Secrets | currently mixed into `devscope-settings` | Groq and Gemini API keys | Migrate to encrypted main-process storage in a separately reviewed security change. Never put new secrets in renderer storage. |
| Product analytics | Desktop main and CLI state directories | explicit enable flag, PostHog project key, approved host, random installation ID, bounded queue | Keep outside renderer settings. Desktop exposes only the enable toggle and redacted readiness status; environment values may override persisted configuration. |
| Retired permission memory | legacy `zyra:browser-control-approval-preferences:v1` | unused remembered Browser-control sites and capabilities | Remove during migration. The selected chat mode owns routine grant approval; no per-site permission policy remains. |
| Continuity state | several bounded `localStorage` records | Browser tabs, terminal groups, composer drafts, active project views, panel widths | Keep outside Settings. Add reset/clear actions where useful. |
| Cache and acknowledgement state | local storage and main-process files | recent projects, project view cache, skipped update, seen update success | Keep outside the settings schema; expose narrow maintenance actions. |

## Current central settings audit

### Keep and preserve consumers

- Theme and accent.
- Compact layout and reduced motion.
- Windows startup behavior.
- Default shell and package runtime.
- File-preview fullscreen, mode, Python target, panel defaults, filename layout, and terminal panel height.
- Project roots and project-icon overrides.
- Explorer enablement and the existing project-browser view/content layout.
- Git initialization, author safety, bulk scope, PR defaults, PR guide, and branch behavior.
- Git AI provider and model selection.
- Assistant model, permission, interaction, reasoning effort and summaries, automatic context-compaction limit, service tier, prompt, streaming, tool-output, queue/interrupt, reconnect, history, status, diagnostics, transcription, and account usage display.
- Skill source enablement, source priority, custom user-selected folders, and per-name conflict resolution.

### Remove from the visible settings contract

- `scrollMode`: no product consumer; scrolling paths explicitly choose stable behavior.
- `betaSettingsEnabled`: toggling it changes nothing.
- `gitConfirmPartialPushRange`: no push-flow consumer.
- `assistantPlaygroundTerminalAccessDefault`: no chat-creation consumer.
- `lastDarkTheme`: legacy migration alias only; it seeds `appearanceDarkTheme` and is never shown as a separate setting.
- Legacy Beta controls for Explorer home, project presentation, and Explorer content layout: the referenced fields do not exist in the settings schema and have no product consumers.

Old persisted values may be ignored during migration; they must not be treated as active settings.

### Repair

- `sidebarCollapsed` currently uses a different persistence owner from the actual chat rail. Treat it as the fallback for a first run or after a sidebar-layout reset.
- Project-browser presentation/content controls appeared in General while related dead Explorer controls appeared in Beta. Keep the two real project-browser controls under Projects & Explorer.
- Assistant settings are duplicated by an unmounted `AssistantDefaultsPanel`; delete the stale surface after route checks.
- Appearance, Behavior, and Assistant Experience contain redirect-only legacy components. Keep route redirects centrally rather than maintaining empty page components.

## Durable preferences discovered outside Settings

These are candidates for the typed desktop settings store because a real behavior already exists:

- File editor default word wrap.
- File editor default minimap visibility.
- File editor default font size.
- CSV distinct-color default.
- File diff default layout (`stacked` or `split`).
- Assistant terminal font size, cursor blink, and scrollback.
- Browser workspace restoration policy.
- Voice Lab voice, output modality, and instructions.

These require source-to-render verification before controls are added.

## Continuity state that must stay out of Settings

- Active Browser tabs, URLs, per-tab zoom, color emulation, and device viewport.
- Main-owned Zyra Browser history and omnibox recency.
- Retained terminal groups and active terminal IDs.
- Composer drafts and per-chat composer state.
- Left/right panel widths and per-chat Inspector width.
- Current rail grouping, sorting, filtering, expansion, pinning, and manual order.
- Active project-details tab, Git subview, and activity selection.
- Recent projects and project-view cache.
- Dismissed transient issues and update-success acknowledgements.

Settings may provide **Reset layout**, **Clear retained Browser workspaces**, or similarly bounded actions without moving these records into the settings schema.

## Browser and control management

Settings should make the following existing behavior discoverable:

- Enable or disable Google search suggestions while typing.
- Enable or disable the default-off built-in Ghostery ad blocker; the first passive ad detection may offer the same persistent choice in Browser.
- Choose Off, the 45-image included nature pack, or optional Unsplash BYOK for New Tab backgrounds; category, rotation, and pinning remain in the focused background picker.
- Import sanitized history from explicitly selected external browser profiles.
- Clear Browser history without removing sign-ins.
- Clear Browser cache.
- Clear Browser cookies/authentication.
- Clear the persistent local Browser profile after explicit confirmation.
- Clear retained Browser workspace layouts without touching chats or project files.

Per-tab zoom, device selection, appearance emulation, DevTools, annotation, screenshot, and recording remain in the Browser workspace because they act on the current tab.

## Canonical and TUI project settings

The runtime already persists these under an explicit project root:

- model;
- reasoning/thinking level;
- profile;
- terminal theme;
- web search;
- web fetch;
- status-line mode;
- notification mode;
- interrupt mode;
- Codex service tier;
- project trust.

A Desktop project-settings editor must read and write these through a bounded backend contract. Global Desktop defaults and project overrides must be visually distinct. Project trust is security-sensitive and requires an explicit confirmation path.

## Current navigation

The Settings home and sidebar expose six major destinations. Detailed controls stay one level deeper:

- **App** — General and Appearance.
- **Account & connections** — OpenAI account and Device connections.
- **Assistant** — Defaults, Skills, Voice, and AI providers.
- **Workspace** — Browser, Files & editor, Terminal & runtime, Projects, and Source control.
- **Data & privacy** — Privacy & maintenance, Memory, Archived chats, and Diagnostics.
- **About & updates** — version, updates, terminal command, license, and project links.

The sidebar search and app-wide Cmd/Ctrl+K palette use the same complete setting inventory. A setting result resolves to its detail route and stable row target rather than stopping at the category landing page.

Read-only account status, memory inspection, archives, diagnostics, and About are management surfaces within Settings; they are not persisted preference fields.

## Implementation status

Implemented in the audited Settings pass:

- Settings navigation and content now use the same `zyra-sidebar-surface` token layer as the chat rail.
- One route registry owns the six-category hierarchy, detail destinations, legacy-path matching, search routing, and title-bar labels.
- Legacy Beta navigation now redirects to Projects & Explorer.
- Dead settings and unmounted duplicate page components were removed.
- Chat-rail collapse now uses the typed Settings store instead of a second local-storage owner.
- Editor, CSV, diff, terminal, Browser-restoration, Voice Lab, product-profile, and four-mode assistant permission preferences are discoverable and connected to their real consumers.
- Browser profile maintenance and retained-workspace clearing are exposed as bounded actions. Permission decisions remain chat-owned and are not remembered per site.
- Global last-composer preferences were migrated into Settings and removed; per-chat composer state remains per chat.
- The settings loader now validates and bounds persisted strings, paths, arrays, records, numbers, enum values, and theme/accent selections.
- Cache clearing now targets recent-project and project-view caches instead of accidentally deleting rail-order continuity state.
- Final consumer review confirmed Windows startup remains main/OS-owned, reduced motion applies through the provider-owned body class, and `assistantUsageDisplayMode` recalculates rendered rate-limit percentages and labels.
- Data & privacy > Privacy & maintenance exposes the main-owned product analytics enable toggle and redacted readiness. Project keys and capture hosts stay outside the device preference schema and never enter renderer persistence.
- Setup asks about anonymous diagnostics only on the final review step, using one off-by-default toggle with the full privacy boundary behind an information affordance.
- `desktop/scripts/test-settings-contract.ts` covers malformed persistence and legacy migrations.

Still requiring a separately reviewed change:

- encrypted main-process migration for Groq/Gemini credentials;
- a bounded project-runtime preference API for `.zyra/preferences.json`, including project trust;
- final physical keyboard, screen-reader, and theme-by-theme Settings click-through.

## Security boundary

Groq and Gemini API keys are currently persisted in renderer-readable `localStorage` and sent over IPC for each operation. Moving them requires:

1. encrypted main-process persistence using Electron `safeStorage` when available;
2. a one-time migration that removes plaintext renderer copies only after encrypted verification;
3. typed `save`, `status`, `test`, and `delete` IPC methods that never return the secret;
4. redaction in logs and errors;
5. an explicit fallback policy when OS encryption is unavailable.

Do not combine this migration with visual settings work or silently delete existing keys.
