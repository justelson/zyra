# Assistant Browser Architecture

Zyra’s Assistant Browser is an Inspector workspace for the selected chat project. It completes the local development loop alongside Explorer and Terminal.

## Ownership

The browser keeps presentation and authority separate:

- `desktop/src/main/ipc/handlers/browser-preview-handlers.ts`
  - owns one exact opaque persistent Chromium partition for the local Zyra Browser profile;
  - configures guest permissions, downloads, and user agent policy;
  - clears that profile only through an explicit typed user action;
  - validates URLs opened in the operating system browser.
- `desktop/src/main/browser-view-manager.ts`
  - owns one `WebContentsView` and one stable Chromium `webContents` identity per Browser tab from creation through closure;
  - creates every page in the exact global Browser session with sandboxing, context isolation, Node isolation, web security, and no preload;
  - accepts only typed shell commands and bounded slot reports, attaches only into the authoritative owner window, and reparents the same view after the destination reports an active slot;
  - projects navigation, title, favicon, audible, fullscreen, focus, and failure state to the current shell while retaining Chromium DOM, form, scroll, media, and navigation history through transfers;
  - transfers trusted guest, Agent Control, permission/download, popup, threat-decision, and active developer-tool authority in the same main-process turn.
- `desktop/src/main/index.ts`
  - disables renderer `<webview>` tags in main and utility shell windows;
  - routes foreground/background link dispositions into Zyra tabs and delegates bounded opener-preserving windows to the popup manager.
- `desktop/src/main/browser-popup-manager.ts`
  - adopts Chromium-created popup `WebContents` into isolated `WebContentsView` pages below trusted Zyra chrome without replacing `window.opener`;
  - explicitly retains the global Browser session, blocker, permissions, presentation, history, and durable profile flushing;
  - caps popup trees at four, keeps each shell independently selectable in the taskbar and Alt-Tab, and publishes a bounded owner-only recovery list.
- `desktop/src/main/ipc/handlers/browser-preview-developer-handlers.ts`
  - resolves every guest-targeted developer operation through the trusted owner-window/tab registry;
  - owns bounded DevTools, reload, zoom, color emulation, in-page annotation, capture, and recording operations;
  - starts annotation code in a dedicated Chromium isolated world and captures the marked result before tearing that world down;
  - stores captures under app-owned user data and exposes opaque artifact IDs rather than arbitrary file operations.
- `desktop/src/main/inspectors/process-detector.ts`
  - discovers a bounded set of loopback HTTP(S) listeners, classifies current-project ownership from path-bounded process/ancestor evidence, and never returns process commands to the renderer.
- `desktop/src/main/browser-history-store.ts`
  - owns the private, atomic, bounded Zyra Browser history file; strips URL credentials, deduplicates URLs, serializes visits, and separates metadata refreshes from real visit counts.
- `desktop/src/main/browser-download-service.ts`
  - owns Browser download execution, collision-safe filenames in the operating-system Downloads folder, bounded progress publication, pause/resume/cancel/retry, path-confined open/reveal/delete actions, and a private atomic history of Zyra-originated downloads. Download lists expose metadata and opaque IDs only; an explicit trusted-chrome **Open here** action may resolve one existing, Downloads-confined path for Zyra’s file preview.
- `desktop/src/main/external-browser-history/`
  - discovers known Chromium-, Firefox-, and Safari-family profiles only after explicit user action; keeps paths behind expiring opaque tokens; reads fixed, read-only SQLite schemas; and commits sanitized imports through the existing history store.
- `desktop/src/main/browser-new-tab-service.ts`
  - owns bounded, cached Google suggestion requests and rejects addresses, localhost targets, paths, and credential-shaped input before any remote request; the unofficial endpoint is best-effort and failure leaves local navigation/history suggestions working.
- `desktop/src/main/browser-adblock-service.ts`
  - owns the optional Ghostery rules engine, serialized filter cache, disabled-mode ad detection, local-development exemptions, and protected-media compatibility exceptions.
- `desktop/src/main/browser-background-service.ts`
  - owns optional Unsplash BYOK requests, bounded metadata persistence, URL validation, and required download tracking without exposing the encrypted key.
- `desktop/src/main/protected-media-service.ts`
  - prepares Google Widevine through CastLabs Electron's component updater and reports readiness or a required restart without redistributing the CDM.
- `desktop/src/preload/adapters/projects-adapter.ts`
  - exposes typed Browser configuration, local-server inventory, developer actions, and recording-frame events without exposing Electron `webContents`.
- `desktop/src/renderer/src/pages/assistant/assistant-browser-workspace-state.ts`
  - owns bounded per-chat Browser metadata and URL normalization;
  - persists safe HTTP(S) URLs, bounded favicon references, titles, viewport dimensions/presets, aspect lock, page zoom, color emulation, and active selection.
- `desktop/src/renderer/src/pages/assistant/AssistantBrowserWorkspace.tsx`
  - owns flat Browser chrome, main-frame history projection, omnibox suggestions, annotation-session lifecycle, developer actions, rendered states, and the recovery list for open popup windows; outer Inspector tabs own page selection and closure.
- `desktop/src/renderer/src/pages/assistant/AssistantBrowserPopupWindow.tsx`
  - renders the lightweight theme-matched title bar, navigation controls, address field, shared-profile status, and native menu for one isolated popup page.
- `desktop/src/preload/browser-popup.ts`
  - exposes only popup/window commands and read-only appearance preferences to trusted popup chrome; filesystem, terminal, agent-control, update, and secret operations remain absent.
- `desktop/src/renderer/src/pages/assistant/AssistantBrowserNewTab.tsx`
  - renders the blank-page address workflow plus current-project and other running local servers, with explicit open-here and open-in-new-tab actions.
- `desktop/src/main/ipc/handlers/browser-preview-annotation-script.ts`
  - renders Select, Region, Draw, Erase, Clear, Cancel, comment, and Attach controls directly inside the guest’s dedicated isolated world;
  - has DOM access but no preload, Node, Electron, or Zyra bridge, and returns only a bounded annotation payload;
  - Attach captures the marked crop, stages it under Assistant attachment storage through an opaque `clipboard://` reference, and adds one removable annotation card to the selected chat composer.
- `desktop/src/renderer/src/pages/assistant/AssistantInspectorDeveloperToast.tsx`
  - owns transient Browser results as a correctly proportioned bottom-right image followed by compact artifact buttons.
- `desktop/src/renderer/src/pages/assistant/AssistantBrowserWebview.tsx`
  - renders an inert Browser slot, reports its current bounds/active/visible state, issues typed commands, and projects main-owned page events into tab metadata.

The guest page never receives Zyra’s preload or `window.devscope` bridge.

## Lifecycle

Browser is lazy-loaded after the user selects its Inspector tile. Once opened, the Browser workspace stays mounted while Review, Explorer, or Terminal is selected.

Each Browser page has one outer Inspector tab and one main-owned `WebContentsView`. Shell renderers retain inert slots while main keeps inactive page views attached but hidden, preserving Chromium history, form state, scroll position, and application state during ordinary outer-tab switches. There is no nested Browser tab strip or Browser-only split layout. Inspector tabs expand to a restrained browser-tab maximum, shrink to a readable floor, and track panel-resize frames directly instead of waiting for pointer release. Horizontal reordering uses transform-only sortable previews with one lifted, live-content overlay; sibling tabs react during the gesture while workspace state and persistence commit once on drop. Enter keeps its normal activation behavior, Space provides keyboard reordering, and reduced-motion mode removes drop, sortable, entrance, close, and width interpolation.

Closing a Browser page destroys only that guest. Safe current URLs, reported favicons, viewport settings, and active selection remain in bounded per-chat local persistence. On Inspector remount or refresh, genuinely persisted Browser pages immediately repopulate their outer tabs; a fabricated blank fallback is never restored into an untouched chat. Chromium cookies, local storage, IndexedDB, cache storage, service workers, and HTTP authentication live in one Zyra-wide persistent partition, so ordinary site logins survive Browser, thread, chat-session, project, popup window, and app restarts. Cookie changes schedule a bounded durable flush and clean shutdown waits for cookies and storage to reach disk; Zyra does not capture or save site passwords.

Direct TUI commands can open Browser, Details, Files, Resources, Agents, Diff, and Terminal tabs in one reusable independent Zyra window. The window opens with `showInactive()` unless the user explicitly requests focus, groups contiguous tabs by labeled chat identity plus a deterministic theme-safe color, and persists bounded placement in a main-owned atomic file. Independent and docked tabs render the same Inspector tab component, sizing, lifted preview, close behavior, keyboard semantics, reduced-motion treatment, and shared favicon chain: bounded Chromium-reported icon first, then the current page origin’s `/favicon.ico`, then a bounded main-owned same-origin byte fallback for sites whose `Cross-Origin-Resource-Policy` blocks trusted chrome, and finally the generic Browser icon. The fallback derives `/favicon.ico` from the page origin, follows same-origin redirects only, caps response size and cache memory, and sends no Browser cookies or credentials. Empty title-strip space remains native window-drag space. Multi-chat labels collapse or expand their group with one activation; a single-chat window omits grouping chrome. The shared plus menu adds a real workspace tab for the active chat through sender-scoped IPC. Review, Files, and Resources adapt inside these Inspector-owned workspace frames: wide Files uses a File Explorer layout with a persistent resizable folder-only tree beside a virtualized icon/details surface; bounded main-process subfolder hints keep its disclosure controls accurate before expansion without recursively loading each branch, while shallow root refreshes reconcile around already-loaded children so unrelated open branches never collapse and rehydrate; expanded previews reuse the centered preview’s full files-and-folders navigator, search, and direct create/refresh/collapse/name-layout tools beneath one full-width preview header; Files opens the same centered, window-responsive preview modal used by the main window; Review keeps conversation and changed files stacked in its original rail beside the diff; wide Resources uses a virtualized library with type/source/turn filters and a selection-driven provenance inspector; and narrow tables collapse secondary metadata instead of forcing horizontal overflow.

Browser popup pages remain a separate product surface. They keep their opener-bound hosted page, restricted preload, popup-specific chrome, lifecycle, and taskbar identity; Inspector workspace layout, subtabs, docking, and utility-window composition must not wrap or replace the popup shell.

Ordinary sorting stays horizontal inside the strip. Once the held tab crosses the strip vertically by the deliberate 44px tear-off threshold, main immediately creates a provisional native Electron window at the cursor grab offset. The source tab collapses out of its strip, the native window follows the global cursor until mouse-up, and the floating drag overlay disappears as the OS window takes over. Releasing over a registered strip merges at the cursor insertion point; releasing elsewhere keeps the standalone window; returning to the source strip cancels the provisional detach. Source removal commits only after the destination accepts the tab and reports a real active Browser slot; cancellation or failure restores the source. There is no hover-only detach button. Tabs retain their stable Browser tab ID and canonical owner chat when moved. Main then removes the existing `WebContentsView` from its source `contentView`, attaches that same object to the destination, and changes owner authority without navigating or replacing its `webContents`. Main↔utility and utility↔utility therefore retain the exact page process identity, DOM, unsaved forms, scroll, media, back/forward history, shared profile, and Agent Control target; no reload disclosure is shown.

Other workspace kinds use the approved process-conscious transfer path. Terminal tabs retain one stable main-owned runtime capability, PTY PID, cwd, running process, bounded output, and live event stream across sender/window changes; the destination reconstructs xterm presentation from that runtime. Files, Review/Diff/Turn, Resources, Details, and Agents capture a versioned, bounded state capsule before movement and hydrate it before destination acknowledgement. Capsules retain navigation/selection, expansion, filters, drill-down identity, relevant preview or diff identity, and scroll anchors without storing file contents, raw patches, secrets, or unbounded renderer state. This preserves the 32-tab limit without allocating another Chromium renderer for every static workspace tab.

Authentication, signup, and site-defined popouts remain real top-level windows when they require `window.opener`. Their website page stays sandboxed in a hosted page view while trusted Zyra chrome remains separate. Each window receives its own taskbar and Alt-Tab entry, reports minimized state only to its bound chat thread’s Browser menu, and can be restored from **Open windows**. Switching chats remounts the Browser workspace, so one chat cannot persist or render another chat’s guests or popup recovery rows. Closing the source guest or popup shell tears down both the page view and its recovery entry.

## Navigation

The address field accepts:

- explicit `http://` and `https://` URLs;
- loopback targets such as `localhost:5173` using HTTP;
- public schemeless hostnames using HTTPS;
- plain text as a web search.

Local file, JavaScript, data, browser-internal, and custom protocols are rejected in both renderer normalization and the main-process guest gate.

Back, Forward, Reload/Stop, the outer Inspector page tabs, Downloads, and Open External operate on the active guest. A new download animates a progress-ring control beside the address bar and opens one compact flyout with live byte progress and active-transfer controls. Each completed item has one three-dot menu for **Open here** when Zyra supports the file type, operating-system **Open**, **Show in folder**, and confirmed **Delete**. The header retains **Open Downloads folder**. The same history is available in popup chrome; popup pages omit **Open here** when no Zyra preview owner is present. Zyra records only downloads initiated through its own Browser session; files created by other applications remain visible through the operating-system Downloads folder but are not attributed to Zyra. Page-created foreground/background tabs, Ctrl/Cmd-click, middle-click, and link context-menu actions enter the same bounded tab model. Ctrl/Cmd+T, Ctrl/Cmd+W, Ctrl/Cmd+Shift+T, Ctrl/Cmd+L, reload, numbered selection, cycling, history traversal, and F11 work whether focus is in Browser chrome or the guest. HTML media fullscreen synchronizes the guest, Browser workspace, and native window, preserves the live guest, and restores the prior layout on exit. Main-frame navigation owns loading state, so subframes and late background requests cannot restart the settled refresh indicator. Chromium title, favicon, history, completion, and main-frame failure events update the active tab contract. Blank live and restored pages normalize to **New tab** at both the main-owned page and persisted-state boundaries, so Chromium’s `about:blank` label cannot leak into the tab strip.

A completed main-frame load, back/forward traversal, reload, or in-page navigation creates one Zyra Browser history visit. Failed and blank navigations do not. Late title and favicon events update the existing entry without incrementing its visit count. Empty omnibox focus exposes nothing. Meaningful input opens one rounded omnibox shell that remains mounted while site-clustered local history and optional Google results settle inside it, with one-line primary/metadata hierarchy and unified Arrow/Enter behavior.

New Tab keeps history hidden at rest. Its header places a minute-aligned local clock, background control, and history button beside the title; the history button opens a horizontally animated drawer. The drawer groups exact persisted URLs into one site cluster inside **Today**, **Yesterday**, **Previous 7 days**, and **Earlier**, revealing individual paths only on intent. Empty search results retain a short searching state before settling, avoiding a flash.

New Tab defaults to a bundled 45-image pack: five separately attributed Wikimedia Commons images in each of nine categories. The committed manifest retains source revision, checksums, creator, rights, modifications, focal point, full-image hash, and thumbnail hash. Images are optimized WebP assets with separate low-memory picker thumbnails and work offline. Active attribution is plain text over the image; full credits ship in `THIRD_PARTY_NOTICES.md`. Users can turn backgrounds off, rotate every New Tab, pin an image, choose a category, or opt into Unsplash with their own Access Key. The key is encrypted in main-owned OS storage. Unsplash metadata is bounded on disk, image URLs remain hotlinked with their tracking parameters, selection calls the provider's download endpoint, and the plain themed New Tab remains the network/error fallback.

## Ad Blocking And Protected Media

Built-in blocking uses Ghostery's Electron engine with its full prebuilt ads, tracking, cosmetic, scriptlet, and annoyance configuration. It is disabled by default. While disabled, the same engine passively classifies matching subresource traffic but always permits it; the first qualifying public site can show one restrained in-app choice to turn blocking on or keep it off. The main process commits the runtime transition and both device preferences as one rollback-safe operation. Filter data refreshes after seven days and falls back to the last known-good owner-only cache offline. Localhost, every loopback development page, and Spotify's protected web player bypass network, header, cosmetic, and scriptlet filtering.

YouTube keeps Ghostery's ad-decision, tracking, cosmetic, and response-pruning rules, but shared playback transport has a narrower invariant: HTTPS `googlevideo.com/videoplayback` requests classified as media, XHR/SABR, or other are permitted only when the live requesting frame—or a bounded referrer/top-level fallback when no frame survives—belongs to YouTube, YouTube Kids, or YouTube No-Cookie. The request decision is retained through its response phase, so navigation cannot widen it. Ad telemetry, `initplayback` ad traffic, DoubleClick, and Googlesyndication remain filterable. On top-level YouTube documents, scriptlets are deduplicated, wrapped with an atomic same-origin guard, awaited, and executed in the exact `senderFrame` supplied by Ghostery rather than repeatedly contaminating the main page. Frame-local cosmetic styles wait safely for `DOMContentLoaded`, accumulate by content hash instead of replacing earlier base rules, and include a narrow fallback for explicit YouTube ad-slot, promoted-feed, masthead-ad, and player-ad containers; the fallback never targets the content video or shared playback transport. Changing the blocking toggle reloads open YouTube documents so their preload, observer, and injected-style state match the new setting. Ghostery's current Electron preload does not request cosmetic injection from embedded child frames, so embedded YouTube receives the transport guarantee but remains network-filter-only. This follows mature blockers' separation between shared first-party video delivery and ad decisions while preventing a broken scriptlet or transport false positive from producing a blank player. Thin Browser clients cannot inspect detections or change the Desktop blocker.

Protected audio/video uses CastLabs Electron for Content Security. Widevine is installed and updated by Google's Chromium component updater after Electron becomes ready; Zyra does not bundle the CDM. The Browser session explicitly permits only the HTTP(S)-scoped `mediaKeySystem` permission required for EME while continuing to deny unrelated capture and device permissions. Development ECS binaries can negotiate EME but production services may reject their development VMP identity. Repeated Spotify track skipping is consistent with that documented rejection mode; only real playback from an EVS production VMP-signed build can confirm the cause. Ordinary Browser configuration returns immediately while early component preparation continues; the renderer refreshes readiness every two seconds and displays a precise preparation/restart message without blocking non-DRM pages. macOS permits the downloaded library through the existing hardened-runtime entitlement. Tagged Windows and macOS releases additionally require CastLabs EVS VMP credentials: macOS VMP signing runs before Apple code signing and Windows VMP signing runs after Authenticode; final package verification must produce VMP evidence before assembly. Linux can require one restart after first component installation.

## Local Development Servers

The blank Browser view calls the main-owned `getRunningLocalServers(projectPath)` source. Discovery enumerates real listening processes, considers at most 128 plausible development-server candidates, and includes a listener only after a bounded loopback HTTP or HTTPS response. It supports conventional and arbitrary ports while excluding non-browser TCP services. IPC returns only PID, port, URL, process name, and whether path-bounded process or ancestor evidence associates the listener with the selected project; command lines and paths remain in main.

New Tab separates **This project** from **Other local servers**. Server rows use the same page-identity icon as Browser tabs rather than a terminal/server glyph. Selecting a row opens it in the current blank page; the adjacent plus action creates and selects a distinct outer Browser tab. External process changes require **Refresh running servers**. Terminal output is not a second server-discovery source.

## Local Profile And Data Control

The integrated Browser uses one global local profile. The partition identifier is derived in the main process from a fixed versioned profile key; renderer workspace, thread, session, and project identifiers cannot choose or widen the credential partition. Browser tab metadata remains per chat, while website authentication state is shared across Zyra.

The profile is stored under Electron’s local `userData` directory and is not copied into chat history, Resources, prompts, or website-card metadata requests. Persisted tab metadata uses the same shared URL sanitizer as history, removing userinfo, authentication-shaped query parameters, fragments, and authentication-page titles during migration and every write. Authentication routes and query-only token/assertion flows drop their complete query and reduce titles to the site hostname. Zyra’s own visited-page index is stored separately at `browser-preview/history-v1.json`, capped at 1,000 URL identities, written atomically with owner-only file permissions, and never exposed to Browser clients or providers. The Browser relay hard-rejects history reads, writes, clears, local-server enumeration, and Electron guest controls even when a client crafts a raw bridge request. Page and favicon URLs lose credentials, sensitive authentication query keys, and fragments before persistence.

The Browser menu and Browser settings expose a history-only two-step clear that keeps cookies and sign-ins. The shared-profile **Clear all local browsing data** action suppresses history recording in main before profile work begins, clears history after Chromium has flushed, and marks each mounted tab’s profile-reset reload as non-historical until a later navigation starts. It therefore clears history, site storage, cookies, cache, and HTTP authentication without racing cleared visits back into the index.

Legacy chat-scoped partitions are neither copied into the global profile nor deleted automatically. Users sign in once in the new profile; any cleanup of legacy partition directories must be a separate explicit destructive operation.

External history import is a user-initiated four-step wizard: **Sources → Range → Review → Done**. Nothing is scanned until **Scan** is selected. Detected profile paths stay in main; the renderer receives only expiring source tokens, browser/profile labels, an optional account email hint, support status, and lock/permission state. The restrained wizard uses bundled browser logos, app-owned checkboxes, and an app-owned calendar modal that renders outside the scrolling wizard body. A second review action is required before read-only imports. Cookies, passwords, bookmarks, downloads, autofill, and sign-ins are never read. Reimports are idempotent at Zyra’s normalized URL identity.

## Developer Suite

The active Browser page supports:

- full-panel and responsive freeform sizing plus Chrome DevTools' standard 17-device Phone and Tablet catalog;
- bounded editable dimensions, aspect locking, rotation, fit-to-panel presentation, pointer resize rails, and keyboard resize steps;
- per-tab page zoom and `prefers-color-scheme` emulation;
- reload, hard reload, detached guest DevTools, external opening, separate HTTP-cache and cookie/auth clearing, and full local-profile clearing;
- one finite in-page annotation session with Select, Region, Draw, Erase, Clear, Cancel, a change comment, Attach, and Escape;
- viewport screenshots shown at their natural aspect ratio from a bounded 640×440 high-density preview, with compact opaque copy image, open, reveal, copy path, annotation, and close buttons;
- thumbnail arrival, staggered action entry, right-drag dismissal, and animated click/timeout closure, all disabled when reduced motion is requested;
- one-at-a-time CDP screencast recording, renderer-side bounded video encoding, and reveal/copy-path actions.

The shell receives the main-owned page’s opaque `webContents.id` through the Browser-view state contract and pairs it with Zyra’s stable Browser tab ID. Main accepts a developer request only when `TrustedGuestRegistry.resolveOwned()` proves the requesting shell currently owns that page and it is bound to that exact tab. No API accepts an arbitrary Electron `webContents` ID by itself.

Screenshots and recordings are written only below the app-owned Browser artifact directory. The renderer receives an opaque artifact ID and, for screenshots, a bounded thumbnail—not the artifact filesystem path. Open, reveal, and clipboard APIs accept generated artifact IDs, validate owner-window identity and the unchanged file, and cannot operate on arbitrary paths. Recording saves additionally require a one-use, 60-second grant produced by a real stopped recording for the same window, guest, and tab; payloads are capped at 128 MB.

Annotation does not use CDP inspect mode. Main injects one self-contained script into a dedicated Chromium isolated world after owner/window/tab validation. The page can neither access that world nor keep its controls alive: Attach, Cancel, Escape, navigation, tab changes, Inspector closure, recording, DevTools, guest destruction, and capture completion all tear it down. The resulting marks are captured before teardown and returned with the bounded annotation payload. Attach then copies the owner-scoped artifact into Assistant attachment storage without exposing its path, adds the crop to the current composer, and appends a bounded `<preview_annotation>` context block when the message is sent.

Recording still uses allowlisted CDP operations against the trusted guest. Opening guest DevTools deliberately releases that guest’s CDP session, and the supervised Browser driver reattaches on its next operation. Color emulation is restored after DevTools closes. Annotation and recording cannot be active together.

## Security Defaults

Browser guests use:

- one exact `persist:zyra-browser-<opaque digest>` global local partition;
- `sandbox: true`;
- `contextIsolation: true`;
- `nodeIntegration: false` in the page, subframes, and workers;
- `webSecurity: true`;
- no guest preload;
- denied site and device permissions except HTTP(S)-scoped HTML fullscreen and `mediaKeySystem`, which are required for standard fullscreen and Widevine playback;
- downloads accepted only from registered Browser guests, assigned collision-safe paths by the main-owned download manager, and exposed to chrome through opaque IDs;
- a four-window bound for hardened HTTP(S) authentication popups, with opener/session continuity and no Node or preload access;
- HTTP(S)-only current-page navigation and redirects.

These values are supplied directly by `BrowserViewManager` when it constructs the page view; renderer attributes and renderer-selected partitions are not part of the security boundary.

## Visual Agent Control

Each trusted Browser guest registers as an on-demand `zyra-browser` control target. The Browser remains usable without an agent. A root or child principal still needs a bounded grant. Supervised and Edits-only root requests are approved in canonical chat. Auto review may issue routine bounded in-app Browser grants automatically but asks for paired Chrome or Windows control. Full access may issue routine bounded root grants across every control target. Child authority still requires an attenuated parent lease.

Fresh chats receive only the small `browser_use` loader. `browser_use({ action: "load" })` activates `browser_tabs`, `browser_access`, `browser_observe`, `browser_perform`, and `browser_session` for that Pi session; the legacy `browser_control` definition stays registered only as an inactive compatibility path. Unloading removes the full Browser schemas again while preserving the loader.

`browser_tabs.open` lets an agent create a blank sandboxed tab without navigation or input authority. Main sends a nonce-bound request only to the selected thread’s renderer and waits until that exact tab registers as a trusted guest. A root agent may reveal it in the Inspector. Child agents may create background tabs but cannot reveal or take over Zyra’s interface. The agent must then request a separately scoped grant through `browser_access` before it can navigate, observe, or interact. The selected permission mode changes the approval step, not the grant's target, scope, expiry, action budget, or revision checks.

Root agents can also operate on retained tabs without creating replacements:

- `reveal_tab` makes an already registered target the primary visible Browser tab;
- `set_tab_layout` selects one primary target or an explicit primary/secondary side-by-side pair;
- `resize_inspector` expands or contracts the visible Inspector within the same responsive layout bounds and reports the accepted width through workspace state;
- `refresh_tab` uses the target's bounded `navigate` grant; model-driven history traversal remains disabled until its destination origin can be proven before navigation;
- `close_tab` and `open_external` require a target-bound `tab.manage` grant with an explicit HTTP(S) origin;
- closing a tab immediately revokes its tab-management grant and descendants.

The renderer publishes a bounded Inspector/Browser workspace snapshot through trusted IPC. `list_targets` therefore reports whether Inspector is open, its accepted width, its active/open workspaces, all retained Browser tabs and sites, and the primary/secondary visible tab IDs. Renderer metadata cannot create a target or bind a target ID to a different tab; main reconciles by trusted tab identity and owner thread. Metadata without a matching registered guest is explicitly marked untrusted and carries no authoritative origin.

Every integrated Browser target is bound to the chat thread that owned its renderer workspace when the guest registered. Root and child discovery, workspace visibility, reveal/layout commands, and grant requests are filtered to that owner thread. A child cannot enumerate or request another thread's Browser tab.

Close, refresh, and external-browser commands use a two-phase surface request. Main may cancel before the renderer atomically claims the request; after a successful claim the command is committed and main waits for its exact request ID to complete. Concurrent commands for one tab cannot resolve each other's promises.

A principal may hold independent grants for several Browser targets in the same turn. Each target keeps its own action queue, monotonic observation revisions, viewport, cursor, audit trail, and remaining-action budget, allowing work on different tabs to proceed independently while preserving one owner per individual surface.

The staged visual loop is:

1. capture a bounded visual, structural, or combined observation;
2. bind it to one exact target, grant, monotonic revision, viewport, and stage intent;
3. reserve enough remaining grant budget for 1–64 bounded steps plus the checkpoint;
4. execute the target-local stage continuously for at most 12 seconds;
5. dispatch multi-point `stroke` input as one press, acknowledged point sequence, and guaranteed release;
6. publish cursor truth on a dedicated coalesced channel at up to roughly 30 FPS, with no CSS prediction;
7. stop at a clean action boundary if purposeful user divergence is detected on that exact target;
8. capture one higher-revision checkpoint for the model to inspect before the next stage.

Visual-only checkpoints avoid rebuilding the accessibility tree after every canvas stroke. Structure and combined modes remain available for semantic controls and safety checks. Supported in-app actions include move, click, double click, drag, multi-point stroke, scroll, bounded typing, keys, select, navigation, and waits. Revealing a Browser tab never focuses its guest or steals the user's keyboard. Target-local key input requires an agent-established click or observed-element focus, and that proof is cleared on navigation, grant replacement/revocation, or turn shutdown.

Native guest `input-event` records feed a rolling per-target interaction arbiter. Agent CDP dispatch is suppressed only for the exact dispatch call. One accidental input, passive pointer motion, or matching collaboration inside the stage’s declared activity/region causes a fresh checkpoint without pausing. Repeated target-local interaction outside that intent pauses at the next safe boundary. Activity in another Browser tab has a different target ID and cannot pause, cancel, or otherwise interrupt the agent’s tab. Audit records may include actor, category, target, bounded coordinates, stage, and time, but never raw typed content.

A paused result explains its target-local evidence and offers **Continue with your changes**, **Replan from here**, and **I’m taking over**. Resume captures a fresh observation, invalidates the old continuation, and requires a new stage; it never blindly replays uncertain remaining input.

Browser targets expose bounded trusted title, URL, origin, and opaque tab identity so an agent can resolve natural directions such as “the Word Grid tab.” They do not expose cookies, storage, request headers, credentials, or page source.

A desktop child agent with delegated Browser capability starts with `browser_use` but no authority. It can load the bounded tools, discover its owner thread’s in-app tabs, and create a pending request. User approval binds a grant to that child principal. Completion, cancellation, disconnection, rejection, and Emergency Stop remove active and pending authority.

Coordinate actions run against hidden retained guests and do not activate the Browser Inspector or move the system cursor. Opening Browser shows the live page and current agent cursor. Because native page views render above shell DOM, main mirrors the control boundary and cursor into an isolated world with a closed shadow surface; remote pages receive no Zyra API or authority, navigation reapplies the overlay, and reparenting retains its current state. The user can revoke the tab grant or stop all control from the Browser toolbar.

## Remaining Browser Work

- executable per-action approval for irreversible external side effects;
- richer visible Take Over/Resume controls beyond the structured chat choices;
- richer agent ownership labels and action history in the Browser toolbar;
- persisted Chromium back/forward history after a Browser guest is closed;
- per-site blocker controls, filter-list freshness UI, and breakage reporting beyond the current global default-off switch and compatibility exceptions;
- structural prompt-injection defenses and advisory local classification that preserve agent compatibility;
- automatic server discovery from terminal output or filesystem watchers;
- user-agent, device-pixel-ratio, and touch emulation beyond the current standard CSS viewport dimensions.

Chrome background visual use is specified separately in `docs/implementations/chrome-visual-browser-use.md`. Windows isolation is specified in `docs/implementations/windows-isolated-computer-use.md`.
