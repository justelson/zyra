# Local Browser Client

Status: **Current for V1 same-device access.** LAN, Tailscale, and public HTTPS access remain later phases.

## Product Boundary

Zyra Desktop remains the local execution host. Chrome is a presentation and control client for the same persisted projects, chats, agents, files, Git operations, terminals, approvals, and settings APIs.

The production V1 browser URL is:

```text
http://127.0.0.1:47821/
```

Source development uses `http://127.0.0.1:47822/` so an installed production Desktop and the dev Desktop never contend for the same browser-client host.

The same link is available in **Settings → Connections**, with Open and Copy link actions.

The browser client binds only to loopback. Closing a browser tab does not stop active agent work. Stopping Zyra Desktop stops the local browser host.

## Runtime Topology

```text
Chrome
  -> BrowserClientHost (stable loopback origin, static renderer)
  -> BrowserAssistantBridge (dynamic private loopback port + process capability)
  -> AssistantService for canonical chat operations
  -> BrowserDevscopeRelay for typed Desktop actions and events
  -> existing main-process IPC handlers and execution services
```

Production serves the existing built renderer from `out/renderer`. Development uses its isolated stable client origin and proxies renderer assets to the Electron Vite server. The renderer installs the browser adapters only when Electron's preload API is absent.

The private bridge capability is generated for each Desktop process and is never included in browser JavaScript. The stable host injects it while proxying same-origin requests. The existing descriptor remains available to the development Vite proxy.

## Supported Browser Surfaces

- canonical Assistant sessions, threads, history, streaming, approvals, guided input, interruption, and account data;
- stable chat/thread hash routes with reload and Back/Forward recovery;
- projects, filesystem reads/writes, Git operations, IDE/Explorer/terminal launches, and native same-machine folder selection;
- integrated terminal request/response operations plus live terminal output;
- Git clone progress and Python preview events;
- Agent Control state, cursor updates, approvals, revocation, Emergency Stop, Chrome pairing, and window selection;
- local image, audio, and video rendering through the protected file endpoint, including byte ranges for media;
- browser-native uploads staged into Desktop-owned Assistant attachment storage;
- realtime conversation Voice, with Chrome owning microphone capture, WebRTC media, and playback while Desktop retains provider signaling, canonical route ownership, transcript commits, delegation, and persistence.

## Intentional Desktop-Only Surfaces

- Electron window controls and app update actions (the Browser may report the host Desktop package version, but cannot check, download, or install updates);
- the Electron `<webview>`-based integrated website preview and its guest developer tools;
- guest-bound Browser surface requests and integrated Browser recording frames.

Desktop-only controls must be hidden, disabled, or represented by an explicit unavailable state in Chrome. They must not invoke arbitrary guest IDs through the generic relay.

## Event Transport

Assistant domain events use the canonical bounded AssistantService replay stream. Realtime Voice uses a dedicated bounded SSE stream because WebRTC control events have different ownership and lifecycle requirements: each tab has an ephemeral session-scoped client ID, only the owning tab receives Voice events, event sequences are deduplicated after reconnect, provider-ingest requests stay ordered, and a short disconnect grace allows transparent SSE recovery before Desktop stops an orphaned Voice session.

The subscription-backed WebRTC call contract is checked into `src/chatgpt-realtime-contract.mjs`. Runtime code never downloads an endpoint or model override because the allowlisted endpoint receives ChatGPT OAuth credentials. Maintainers can detect upstream Codex changes with `npm run voice:check-codex-contract` and explicitly regenerate the reviewed allowlisted contract with `npm run voice:sync-codex-contract`; deterministic parser and allowlist tests run in the normal core lanes without network access.

Non-Assistant Desktop events use a separate supervised event stream with an allowlisted envelope:

- `agentControlCursor`
- `agentControlState`
- `gitCloneProgress`
- `previewTerminal`
- `pythonPreview`

The preload relay subscribes to the existing typed Electron adapters. Main accepts events only from the current trusted Desktop renderer, then broadcasts them to browser subscribers. Event streams reconnect after interruption and stop when their final browser subscriber unmounts.

## Local File Transport

Browser renderers cannot load the Electron-only `zyra://` protocol. Browser file URLs are projected to the protected same-origin file endpoint. The bridge:

- accepts only authenticated local bridge requests;
- resolves the same `zyra://` paths as Desktop;
- serves files with explicit MIME types and `nosniff`;
- supports one bounded HTTP byte range for media seeking;
- applies a sandbox CSP and no-store caching.

The endpoint preserves existing local-app file authority. LAN/public phases must replace path-bearing URLs with environment-scoped opaque file capabilities before exposing the server beyond loopback.

## Security Boundary

- listeners bind to `127.0.0.1` only;
- requests require an exact local Host and reject cross-site browser requests;
- state-changing requests require the Zyra browser client header;
- the internal bridge also requires its current process capability and an allowlisted origin;
- generic DevScope paths reject prototype traversal and event-method invocation;
- preload invocation requires owned adapter properties;
- Electron guest and raw IPC authority are never exposed to Chrome;
- browser Voice requires an active owner-scoped event stream, rejects cross-tab control, permits microphone access only for the local host origin, and leaves camera access disabled.

Loopback protects against network access, not hostile software running as the same operating-system user. Pairing, revocation, TLS/private-network policy, and environment-scoped credentials belong to the LAN and HTTPS phases.

## Focused Verification

```bash
bun run --cwd desktop typecheck:browser-runtime
bun desktop/scripts/test-browser-client-host.ts
bun desktop/scripts/test-browser-assistant-bridge.ts
bun desktop/scripts/test-browser-surface-parity.ts
bun desktop/scripts/test-browser-devscope-live-adapter.ts
bun desktop/scripts/test-assistant-realtime-voice.ts
bun desktop/scripts/test-assistant-chat-routing.ts
bun desktop/scripts/test-assistant-client-local-selection.ts
bun desktop/scripts/test-assistant-new-chat-surface.ts
```
