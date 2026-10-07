# Desktop onboarding and device preferences

**Status:** Current

**Owner:** Zyra Desktop main process

## Contract

A fresh Zyra Desktop install cannot mount normal routes until the main process records a completed onboarding checkpoint. The local Browser client reads that same state and shows a Desktop-required blocking screen until completion. Renderer storage is never authoritative for completion.

The setup sequence is fixed and ordered:

1. Welcome
2. Connect ChatGPT or an OpenAI API key
3. Appearance
4. Optional chat folder
5. Review

Each successful Continue writes the next checkpoint. Closing, restarting, or crashing resumes at `currentStep`; forward navigation cannot skip an unfinished step. Back navigation is limited to completed steps. Back and Continue remain in a fixed viewport action dock while only the step body scrolls. Appearance keeps mode separate from palette: the user selects System, Light, or Dark and configures one validated light theme and one validated dark theme. System follows the local OS appearance and switches between those saved halves. One dropdown is shown for the currently resolved appearance; switching the mode exposes the other catalog without crowding the page. Every option row projects the complete Zyra token palette. Theme changes save immediately through the constrained onboarding API without advancing the step, so a restart or review exit retains the selection. Fresh installs and Appearance reset use Bricolage Grotesque for the interface while explicit existing font and accent choices remain intact.

Web access is not an onboarding decision. New installs start with both search and page fetching enabled; users can change the new-chat default later in Settings → Assistant. Existing explicit settings remain authoritative.

The chat-folder choice is optional. Continuing without choosing a folder creates `Zyra` inside Electron's OS-resolved Documents directory, including redirected or localized Documents locations, and saves that effective path in the setup checkpoint. The screen shows the actual default path. A user-selected existing bounded folder remains authoritative. Clearing the shared folder preference restores the Documents/Zyra fallback; it does not delete either folder. Preference reads and unrelated setting writes only resolve paths. The default folder is created when setup accepts it or before the assistant connects a chat using that configured workspace, so unavailable Documents access does not block unrelated settings.

Working directories and project associations are separate. A Desktop chat with no `projectPath`, `projectId` or project chat scope remains projectless even when its canonical runtime catalog identifies its storage/working directory as a project. Its greeting stays neutral, and its selector, header and sidebar show **No project**. Explicit legacy `projectPath` associations and project-scoped chats retain their identities; new canonical CLI imports retain their explicit project. This change does not migrate chat data or modify CLI project identity.

A completed device remains completed if its OpenAI credential later expires. Normal connection handling can ask the user to reconnect, but auth expiry does not recreate the first-run gate.

### Interaction design evidence

| Reference | Evidence role | Applied anatomy |
| --- | --- | --- |
| [Linear onboarding screenshots](https://www.saasui.design/pattern/onboarding/linear) | Visual-only, seven real screens | One meaningful decision per screen, narrow content, restrained hierarchy, low-position progress |
| [Raycast onboarding flow](https://www.lazyweb.com/flow/raycast/onboarding) | Visual-only, current multi-screen flow | Clear primary action and advanced choices kept secondary; mobile geometry was not copied |
| [Linear](https://supademo.com/user-flow-examples/linear) and [Notion](https://supademo.com/user-flow-examples/notion) onboarding analyses | Sequence/category evidence | Optional configuration should not block activation; setup should reduce decisions before first value |
| [T3 Themes](https://t3themes.com/) and its [public registry source](https://github.com/SunkenInTime/t3-themes) | Schema/category evidence inspected at `4935154c023d8539b83160af5fbdca48245be58f` | Separate appearance support from palette identity; show palette evidence at selection time |
| [T3Code theme halves](https://github.com/pingdotgg/t3code) | MIT-licensed architecture reference | Store independent light/dark halves and resolve System locally rather than treating one literal theme ID as all light mode |

The T3 Themes gallery has no repository-wide license, so Zyra does not redistribute its community JSON themes or gallery code. The paired model informed an independent implementation using Zyra's semantic tokens and original light palettes. Zyra retains its ASCII mark, window chrome, and mandatory main-owned checkpoints.

## Main-owned files

All paths are relative to Electron's `app.getPath('userData')`:

| Path | Contents | Credential policy |
| --- | --- | --- |
| `setup/onboarding.json` | Schema/flow version, revision, status, exact step, completed steps, timestamps, and non-secret selections | Never contains API keys, OAuth tokens, or encrypted credential blobs |
| `setup/device-preferences.json` | Versioned shared preferences and separate Desktop/Browser surface buckets | Secret and OS-owned keys are rejected |
| `setup/device-secrets.bin` | Groq/Gemini hosted-provider keys encrypted by Electron `safeStorage` | Browser relay cannot invoke this API |
| Existing Pi auth storage | ChatGPT OAuth and OpenAI API-key credentials | Reused through the narrow `src/desktop-openai-auth.mjs` boundary; onboarding stores only method and verification time |

### Atomicity and concurrency

Onboarding, preferences, and encrypted secret writes use a sibling temporary file, flush the file, close it, and atomically rename it over the destination. POSIX directory handles are flushed after rename; Windows skips only the unsupported directory-fsync operation. Temporary files are removed after failed writes.

Onboarding and preference mutations are serialized in the main process. Callers provide `expectedRevision`; a stale write returns `REVISION_CONFLICT` instead of overwriting newer state. Successful changes increment the revision and publish typed change events.

### Corruption and newer versions

- Invalid or malformed current onboarding data is renamed to `onboarding.json.<reason>-<timestamp>.bak`, and setup starts again from Welcome.
- Flow version 1 records migrate atomically to flow version 2. Completed devices remain completed, and an unfinished removed `web-access` step resumes at Projects.
- A newer onboarding schema or flow version is left byte-for-byte untouched. Desktop stays gated and asks for a newer Zyra version.
- A newer preference schema is also left untouched. The renderer reports the load failure and does not fall back to writable renderer state.
- Unreadable secret data fails closed; it is never copied into plaintext storage.

## Authorization and startup

Before completion:

- Desktop renders only the setup chrome and full-window wizard. There is no route, backdrop, Escape, or maximize bypass; minimize and close remain available.
- Assistant IPC, normal preference mutation, hosted-secret replacement/removal, account inspection/disconnect, Browser Assistant/events, Browser Voice/events, Browser file content, and protected Browser devscope actions return `ONBOARDING_REQUIRED`.
- Browser devscope permits only `onboarding.getState` and browser-scoped `preferences.get`, which are needed to render and live-update the blocking screen.
- Browser callers cannot select the `desktop` preference surface, supply Desktop legacy settings, mutate onboarding, or invoke secret APIs.
- Assistant construction and updater startup are deferred. The Browser host still starts so it can show the blocking state.
- File/folder shell-launch intent is queued. It is replayed after completion instead of hiding or bypassing setup.

The application menu is suppressed during setup. The custom setup title bar exposes only the allowed window controls.

## OpenAI verification

The OpenAI step uses Pi's real auth machinery through a narrow Desktop boundary:

- **ChatGPT:** `loginZyraAuth('openai-codex')` supplies Pi's complete OAuth callback contract, selects its browser method through `onSelect`, opens the provider URL through Electron, waits for Pi's browser callback, and saves the returned OAuth credential in Pi auth storage. A previously completed browser login is accepted when its stored token is still valid; onboarding does not block on the slower ChatGPT usage endpoint.
- **API key:** `configureZyraOpenAIApiKey` verifies the key with OpenAI before writing it through Pi auth storage. A previously stored key is verified with the provider before it is accepted.

Pi auth imports, token work, and provider verification run in `desktop-openai-auth-worker.mjs`, outside Electron's main and renderer event loops. The worker is prewarmed only while mandatory setup or setup review is visible, and bounded non-login requests fail with a recoverable timeout. Desktop never imports the full `zyra-sdk.mjs` runtime for these account actions.

The connection is checked when leaving the OpenAI step and again at final completion. A short main-owned cache reuses a just-verified result so an immediate Continue does not repeat the same work. A renderer success flag alone cannot complete setup.

After completion, Desktop Account Settings reuses the same main-owned auth service for Connect, Replace, Retry, Disconnect, and new-chat provider switching. Disconnecting an expired or unwanted credential opens account recovery without replaying onboarding. Browser shows the connection state but deliberately directs credential mutations to Desktop. Destructive OpenAI disconnects and encrypted hosted-key removal carry explicit confirmation through the main-process contract; renderer-only confirmation state is insufficient.

## Preference ownership

`desktop/src/shared/preferences/contracts.ts` is the key-level ownership source of truth.

### Shared across Desktop and Browser

Appearance intent, the validated `appearanceLightTheme`/`appearanceDarkTheme` pair, fonts, accessibility, project roots, editor/terminal defaults, Git defaults, Assistant creation defaults, and the new-chat web defaults (`assistantDefaultWebSearch`, `assistantDefaultWebFetch`). A write from either surface publishes a revision event; both surfaces refresh from main. Desktop and Browser may resolve different active halves when their local system appearances differ.

### Surface-local

Window/layout and presentation choices such as sidebars, Browser view/content layout, fullscreen panel state, usage/streaming presentation, reconnect, history prefetch, diagnostics, and transcription presentation. These values live in separate `surfaces.desktop` and `surfaces.browser` buckets.

### OS-owned

`startWithWindows` and `startMinimized` remain owned by Electron login-item settings and are not written to the preference JSON.

### Secret

`groqApiKey` and `geminiApiKey` are handled only by `DeviceSecretsService` and Electron `safeStorage`. IPC returns configuration booleans, never decrypted stored keys; Git provider handlers resolve encrypted credentials inside main. If secure OS storage is unavailable, writes fail with an explicit error and the Desktop v4 renderer record is retained so migration can be retried without credential loss.

### Derived

`settingsSchemaVersion`, resolved `theme`, and `appearanceResolvedMode` are compatibility/derived values, not independently persisted main-owned preferences.

## Desktop v4 migration

Only the Electron renderer may offer its existing v4 `devscope-settings` record to main. Main partitions and sanitizes recognized keys, records `desktopLegacyV4CompletedAt`, and never runs that import again. Existing main-owned values win over a late legacy import.

Hosted-provider keys migrate separately into `safeStorage`. Renderer legacy keys are cleared only after the encrypted secret migration confirms completion. Browser requests are forcibly scoped to `surface: 'browser'` and cannot trigger the Desktop migration.

## New-chat web defaults

The settings are creation defaults rather than live global switches:

1. Main-owned preferences provide the current booleans to `AssistantService`.
2. Every newly-created session/thread snapshots them into `AssistantThread.webSearch` and `AssistantThread.webFetch`.
3. SQLite persists nullable `web_search` and `web_fetch` columns.
4. Runtime connect and prompt payloads carry the per-thread values through the Desktop worker and shared agent server.
5. `src/zyra-ui-bridge.mjs` applies and stores them in canonical chat config.

When no explicit preference exists, both web defaults resolve to `true`. Changing Settings affects later chats only. Existing chats reload their persisted thread/canonical configuration. Null values identify legacy chats whose canonical runtime remains authoritative.

## Reviewing setup

Desktop Settings → General → **Review setup** reopens the same flow. Review mode preserves `status: completed`, so Browser and protected main authorization remain valid. **Exit review** restores the completed checkpoint. The service supports invalidating completion only when a caller sends both `invalidateCompletion: true` and explicit confirmation; the current UI does not expose that destructive action.

## Focused verification

Run from the repository root:

```text
bun desktop/scripts/test-onboarding-state.ts
bun desktop/scripts/test-device-preference-ownership.ts
bun desktop/scripts/test-onboarding-renderer-gate.ts
bun desktop/scripts/test-onboarding-browser-authorization.ts
bun desktop/scripts/test-assistant-web-defaults.ts
npm --prefix desktop run typecheck
npm --prefix desktop run typecheck:browser-runtime
npm --prefix desktop run test:browser-assistant-bridge
npm --prefix desktop run test:browser-client-host
npm --prefix desktop run test:browser-devscope-live
npm --prefix desktop run test:assistant-realtime-voice
npm --prefix desktop run test:assistant-new-chat
npm --prefix desktop run test:assistant-startup
npm --prefix desktop run test:settings
```
