# Zyra Browser and Computer Use Implementation Plan

**Status:** Implemented

**Revision:** 2

**Scope:** In-app Browser control, explicitly paired Chrome tabs, Windows computer use, shared permission broker, agent tools, audit, recovery, UI, packaging, and testing

**Execution mode:** Implemented from this plan; unchecked task boxes below are retained as historical planning detail.

---

## 1. Goal

Give Zyra secure, observable, revocable control over three target classes:

1. The retained in-app Zyra Browser.
2. Explicitly paired tabs in the user's Chrome browser.
3. Exact Windows application windows selected through a root Chat's bounded grant request.

The implementation must let a root Codex agent observe a target, act on the latest observation, verify the result, and stop safely. The same broker must later accept attenuated leases from Zyra subagents without giving them control by default.

A complete result includes:

- Typed contracts.
- Main-process broker and policy.
- In-app Browser driver.
- Chrome MV3 extension and pairing transport.
- Windows sidecar using UI Automation and Windows capture APIs.
- Root-agent tools and bridge RPC.
- Desktop controls, grants, audit, emergency stop, and status.
- Persistence and recovery behavior.
- Deterministic, integration, security, performance, and manual tests.
- Packaging hooks and operator documentation.

---

## 2. Non-goals and prohibitions

The implementation must not:

- Expose raw Chrome DevTools Protocol access to a model, renderer, workflow, or subagent.
- Expose cookies, authentication headers, local storage, IndexedDB, browser profile files, or password values.
- Attach to arbitrary Electron `webContents` selected by renderer input.
- Give an extension permanent broad control of every Chrome tab.
- Use `<all_urls>` as the default Chrome permission.
- Control `chrome://`, extension, browser-settings, payment, password-manager, or browser-internal pages.
- Automatically elevate a Windows process.
- Interact with UAC or the Windows secure desktop.
- Inject input into a higher-integrity process.
- Read the clipboard globally.
- Type a secret supplied through a model prompt.
- Approve purchases, messages, publishing, deletion, account changes, or other external side effects silently.
- Persist active grants across an app restart by default.
- Give Browser, Chrome, or Windows control to a subagent without an explicit attenuated lease.
- Weaken the existing global Browser profile, main-owned page sandbox, permission denial, download denial, or HTTP(S)-only navigation policy.

---

## 3. Existing foundation

The implementation builds on the current Browser rather than creating a second embedded browser.

Existing authority:

- `desktop/src/main/browser-view-manager.ts`
  - creates and retains one sandboxed, context-isolated, Node-free `WebContentsView` per Browser tab;
  - owns page navigation, popup policy, shell attachment, and lossless owner-window transfer.
- `desktop/src/main/index.ts`
  - disables renderer webview tags and composes the Browser view, popup, and utility-window owners.
- `desktop/src/main/ipc/handlers/browser-preview-handlers.ts`
  - owns the one exact persistent Browser partition;
  - owns the global local Browser session;
  - denies permissions and downloads;
  - owns safe external navigation and data clearing.
- `desktop/src/renderer/src/pages/assistant/AssistantBrowserWebview.tsx`
  - reports an inert page slot and consumes typed main-owned page events.
- `desktop/src/renderer/src/pages/assistant/AssistantBrowserWorkspace.tsx`
  - owns Browser tabs, toolbar, retained mounting, and global profile UI.
- `desktop/src/renderer/src/pages/assistant/assistant-browser-workspace-state.ts`
  - owns bounded per-chat tab metadata.
- `desktop/src/shared/contracts/devscope-api.ts`
  - owns typed renderer/preload/main contracts.
- `src/zyra-ui-bridge.mjs` and `desktop/src/main/assistant/zyra-pi-runtime.ts`
  - form the process boundary between the Pi agent and Electron main.

Preserve the current global Browser profile:

```text
zyra-global-browser-profile:v1
  -> SHA-256 digest
  -> exact persistent Chromium partition
  -> retained sandboxed webviews
```

Browser credentials remain local under Electron `userData` and never enter prompts, Resources, link previews, logs, or control observations.

---

## 4. Platform basis

### Electron

Electron exposes Chrome DevTools Protocol through `webContents.debugger` in the main process. The API supports attach, detach, event messages, and bounded `sendCommand` calls. Invoking DevTools can detach the debugger, so detach and recovery are normal lifecycle states.

Official reference: <https://www.electronjs.org/docs/latest/api/debugger>

### Chrome extensions

Chrome MV3 provides:

- `activeTab` for temporary access after an explicit user gesture.
- `chrome.scripting` for bounded DOM observation and actions.
- `chrome.debugger` for optional CDP access with an explicit extension permission and visible browser warning.
- Native messaging when a packaged native host is required.

Initial Zyra pairing uses a loopback transport with rotating credentials and exact-tab grants. Native messaging remains an optional packaged transport, not a reason to request broad page permissions.

Official references:

- <https://developer.chrome.com/docs/extensions/develop/concepts/activeTab>
- <https://developer.chrome.com/docs/extensions/reference/api/scripting>
- <https://developer.chrome.com/docs/extensions/reference/api/debugger>
- <https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging>

### Windows

Windows UI Automation exposes an accessibility tree, common properties, control patterns, events, and actions across supported desktop frameworks. It is the primary Windows observation and action path.

Windows Graphics Capture provides user-consented capture of a selected application window or display and visibly marks active capture.

`SendInput` can synthesize keyboard and mouse input, but Windows User Interface Privilege Isolation limits injection to equal or lower integrity processes. Zyra must treat this as a security boundary rather than trying to bypass it.

Official references:

- <https://learn.microsoft.com/en-us/dotnet/framework/ui-automation/ui-automation-overview>
- <https://learn.microsoft.com/en-us/windows/apps/develop/media-authoring-processing/screen-capture>
- <https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput>

---

## 5. Architecture

```text
Codex root or leased subagent
          |
          | bounded tool request
          v
Bridge duplex RPC
          |
          v
AgentControlBroker (Electron main)
  |             |                 |
  v             v                 v
ZyraBrowser   ChromeExtension   WindowsDesktop
Driver        Driver            Driver
  |             |                 |
  v             v                 v
retained      paired exact      selected HWND
webContents   Chrome tab        + UIA sidecar
```

### 5.1 Authority

`AgentControlBroker` is authoritative for:

- Principals.
- Targets.
- Grants and leases.
- Observation revisions.
- Allowed actions.
- Domain and application scope.
- Action count and expiry.
- Auditing.
- Cancellation.
- Emergency stop.

Drivers translate normalized broker operations into platform-specific calls. They do not make independent permission decisions.

### 5.2 No renderer authority

The renderer may request a grant, select a visible target, display state, and trigger emergency stop. It cannot:

- Mint a grant.
- Select an arbitrary process or `webContents` by numeric ID.
- Widen capabilities.
- Extend expiry.
- Forge observation revisions.
- Mark an action approved.

Every renderer request is rebound to its sender window and validated in main.

---

## 6. Shared contracts

Create:

```text
desktop/src/shared/agent-control/
  contracts.ts
  protocol.ts
  policy.ts
  validation.ts

src/agent-control/
  contracts.mjs
  tool-contracts.mjs
  bridge-client.mjs
```

JavaScript and TypeScript contract fixtures must prove equivalent wire behavior.

### 6.1 Principal

```typescript
type ControlPrincipal =
  | { type: "root"; threadId: string; turnId: string }
  | { type: "agent"; fleetId: string; agentRunId: string; parentThreadId: string };
```

### 6.2 Target

```typescript
type ControlTarget =
  | {
      kind: "zyra-browser";
      targetId: string;
      tabId: string;
      guestIdentity: string;
      origin: string | null;
    }
  | {
      kind: "chrome-tab";
      targetId: string;
      pairId: string;
      tabToken: string;
      origin: string | null;
    }
  | {
      kind: "windows-window";
      targetId: string;
      sidecarSessionId: string;
      processId: number;
      windowToken: string;
      executableIdentity: string;
    };
```

Numeric `webContents`, Chrome tab, process, and HWND values remain inside drivers. Public contracts use opaque identities.

### 6.3 Capabilities

```typescript
type ControlCapability =
  | "observe.structure"
  | "observe.screenshot"
  | "navigate"
  | "pointer.click"
  | "pointer.move"
  | "keyboard.type"
  | "keyboard.key"
  | "scroll"
  | "form.select"
  | "window.focus";
```

No generic `evaluate`, `executeScript`, `cdp`, `shell`, `clipboard.read`, `cookie.read`, or `credential.read` capability exists.

### 6.4 Grant and lease

```typescript
interface ControlGrant {
  version: 1;
  grantId: string;
  principal: ControlPrincipal;
  targetId: string;
  capabilities: ControlCapability[];
  allowedOrigins?: string[];
  allowedExecutableIdentities?: string[];
  issuedAt: string;
  expiresAt: string;
  maxActions: number;
  actionCount: number;
  state: "active" | "expired" | "revoked" | "consumed";
  issuedBy: "user" | "delegated-parent";
  parentGrantId?: string;
}
```

An agent lease must be a strict subset of its parent grant:

- Same target or narrower target.
- Subset of capabilities.
- Same or earlier expiry.
- Same or fewer remaining actions.
- Same or narrower origins/application identity.

### 6.5 Observation

```typescript
interface ControlObservation {
  version: 1;
  observationId: string;
  revision: number;
  targetId: string;
  capturedAt: string;
  targetState: "ready" | "navigating" | "detached" | "closed" | "blocked";
  url?: string;
  title?: string;
  origin?: string;
  viewport?: { width: number; height: number; scale: number };
  elements: ControlElement[];
  screenshotRef?: string;
  focusedElementRef?: string;
  truncation?: { totalElements: number; returnedElements: number };
  redactions: string[];
}
```

Element references are valid only for one target revision.

### 6.6 Action

```typescript
interface ControlActionRequest {
  version: 1;
  requestId: string;
  grantId: string;
  targetId: string;
  observationRevision: number;
  action:
    | { type: "click"; elementRef: string }
    | { type: "type"; elementRef: string; text: string; replace?: boolean }
    | { type: "key"; key: string; modifiers?: string[] }
    | { type: "scroll"; elementRef?: string; deltaX: number; deltaY: number }
    | { type: "select"; elementRef: string; values: string[] }
    | { type: "navigate"; url: string }
    | { type: "focus" }
    | { type: "wait"; condition: ControlWaitCondition; timeoutMs: number };
}
```

Every action requires the latest observation revision. Stale actions return a typed stale-observation error and a fresh observation hint.

---

## 7. Permission policy

### 7.1 User-visible grant flow

The canonical chat owns permission decisions.

- Supervised root requests render one bounded grant card in chat.
- Auto review issues routine bounded in-app Browser grants automatically and renders paired Chrome or Windows requests in chat.
- Edits only renders every control-grant request in chat.
- Full access issues routine bounded root grants across Browser, paired Chrome, and selected Windows windows without another prompt.
- Child agents still require an attenuated parent lease.
- Browser chrome and Thread Details show pending or active status without approval buttons.
- Chrome pairing, browser-owned optional permission requests, and exact-tab activation remain explicit setup gestures.
- A root Chat may select one bounded Windows candidate as part of its grant request; modes other than Full access require approval of that exact target in Chat before use.

A grant remains bound to the requesting principal, exact target, allowed origin or executable, capabilities, expiry, action count, and screenshot policy. The selected chat mode changes only whether a routine root grant needs a separate approval.

### 7.2 Side effects

The following remain per-action approval boundaries in the first release:

- Sending or publishing content.
- Purchases and financial transactions.
- Account, security, permission, or password changes.
- Destructive deletion.
- Uploading local files.
- Submitting sensitive personal or regulated data.
- Installing software or extensions.
- Accepting legal terms.

The broker cannot perfectly infer semantics from UI structure. The agent must mark intended side-effect class, and the broker adds DOM/UI heuristics. Either signal may require approval.

### 7.3 Secrets

- Password fields are represented as redacted and non-readable.
- Existing field values are never returned for password or sensitive fields.
- A model cannot receive or type a secret from Browser profile storage.
- The user may manually focus and type a secret while a lease is paused.
- Control resumes only after a new observation.
- Clipboard read is absent.

### 7.4 Emergency stop

One global emergency stop must:

- Revoke every active grant.
- Abort every queued and running action.
- Detach Electron and Chrome debugger sessions.
- Stop Windows input injection and capture.
- Close pairing transports.
- Invalidate every observation revision.
- Record a redacted audit event.

Expose it in:

- Browser toolbar while controlled.
- Control Center Inspector workspace.
- Desktop title/status area while any target is controlled.
- A global keyboard shortcut that does not conflict with normal editing.

---

## 8. AgentControlBroker

Create:

```text
desktop/src/main/agent-control/
  agent-control-broker.ts
  capability-policy.ts
  grant-store.ts
  target-registry.ts
  observation-store.ts
  action-queue.ts
  audit-store.ts
  redaction.ts
  emergency-stop.ts
  control-errors.ts
  drivers/
    driver.ts
    zyra-browser-driver.ts
    chrome-extension-driver.ts
    windows-desktop-driver.ts
```

Responsibilities:

- Bind targets to trusted main-process identities.
- Validate every grant and action.
- Serialize actions per target.
- Permit bounded parallel observation across different targets.
- Maintain monotonic target revisions.
- Enforce expiry and action counts before dispatch.
- Reject stale actions.
- Redact observations and audit records.
- Cancel on target destruction, navigation, principal cancellation, app shutdown, lease expiry, or emergency stop.
- Expose bounded query state to the renderer.

### 8.1 Persistence

Persist:

- Redacted audit summaries.
- Pairing metadata without reusable secrets.
- Trusted extension identity.
- Driver health and last disconnect reason.
- User policy preferences.

Do not persist active grants, raw screenshots, page trees, field contents, or pairing bearer credentials across restarts by default.

---

## 9. In-app Zyra Browser driver

### 9.1 Trusted guest registry

Register each page when `BrowserViewManager` constructs its `WebContentsView`.

Main must:

- Supply the exact global Browser session directly.
- Verify the authoritative owner BrowserWindow.
- Construct the page with the existing sandbox and navigation policy and no preload.
- Mint an opaque guest control identity.
- Track lifecycle by trusted `webContents` reference while allowing its shell owner to change atomically during reparenting.
- Remove the target immediately when the page is explicitly closed or its final owner disappears.

The renderer may associate its stable local tab ID with the main-owned page identity exposed through the typed state contract. Main verifies sender ownership and guest identity. A raw renderer-provided `webContents` ID is insufficient authority.

### 9.2 CDP ownership

Only `ZyraBrowserDriver` uses `guestContents.debugger`.

Attach on demand and handle:

- Already attached state.
- DevTools-caused detach.
- Guest destruction.
- Main-frame navigation.
- Renderer reload.
- Driver timeout.
- Emergency stop.

Use a strict command allowlist. Initial allowed CDP domains/commands may include bounded subsets of:

- Accessibility tree retrieval.
- DOM snapshot capture.
- Page screenshot capture.
- Input dispatch.
- Page lifecycle and navigation.

Do not enable Network inspection, Storage, Cookies, raw Runtime evaluation, arbitrary script injection, Target discovery beyond the bound guest, or download control.

### 9.3 Observation strategy

Prefer:

1. Accessibility tree.
2. Bounded DOM snapshot for missing semantics.
3. Screenshot only when requested or needed for visual verification.

Normalize into `ControlElement` values containing only useful fields:

- Opaque element reference.
- Role.
- Accessible name.
- Bounded text.
- State.
- Bounds.
- Action affordances.

Bound observations by node count, depth, text length, image dimensions, and total bytes.

### 9.4 Actions

- Resolve an element reference against the current revision.
- Prefer semantic DOM/accessibility actions.
- Use input dispatch when semantic action is unavailable.
- Wait for a meaningful lifecycle, DOM, focus, or URL change.
- Capture the next revision.
- Return action result plus a bounded observation diff.

Navigation must pass the existing HTTP(S)-only URL policy and grant origin policy.

---

## 10. Root-agent tool and duplex bridge RPC

The Pi agent runs in `src/zyra-ui-bridge.mjs`, while control authority lives in Electron main. Add correlated duplex RPC.

### 10.1 Bridge flow

```text
Pi tool handler
  -> bridge emits control.request(requestId, operation)
  -> ZyraPiRuntime receives trusted bridge request
  -> AgentControlBroker validates and runs operation
  -> main sends control.response(requestId, result) to bridge
  -> tool resolves with bounded result
```

Requirements:

- Correlated request IDs.
- Timeout and abort propagation.
- Principal bound from the current thread and turn, not model input.
- Bounded request and response sizes.
- Unknown-operation rejection.
- Worker exit rejects pending control calls.
- Main disposal aborts all pending calls.

### 10.2 Model-facing tools

Expose narrow tools:

#### `browser_control`

```text
list_targets
request_grant
observe
navigate
click
type
key
scroll
select
wait
release
```

#### Deferred Windows computer tools

`tool_search` is the default deferred entry point. An explicit natural-language computer-control request preloads the same bounded tool set before the first provider call; ambiguous requests still activate it through a relevant search. The tools unload at turn completion:

```text
computer_use_app
computer_open_app
computer_list_windows
computer_request_access
computer_observe
computer_focus
computer_move
computer_click
computer_drag
computer_sequence
computer_type
computer_key
computer_scroll
computer_wait
computer_release
```

`computer_use_app` is the common path. It reuses one exact running app or launches its registered Start app, selects that single match, requests the bounded Chat grant, and returns a structure observation in one provider round trip. When exact routine labels are already known, the call may also execute a bounded semantic sequence from its private initial observation and return only the final state. If a newly launched app restores non-empty, dirty, or unreadable text, embedded typing stops before its first input and revokes the grant; the agent must inspect that restored state instead of assuming a fresh document. A role hint may be omitted when an exact name resolves to one unique non-sensitive control that supports the requested action. Multiple matching windows fail closed and fall back to `computer_open_app`, `computer_list_windows`, and exact candidate selection. No path, command argument, file, URL, ambient title list, or unrelated app is accepted. Requesting visual verification or coordinate work should include screenshot access in that first grant. A successful `computer_use_app` call replaces any older Windows grant held by the same root turn after the new exact grant exists, so multi-app handoffs do not need a release-only provider turn. Explicit release still ends control immediately. Final standalone release calls are unnecessary because turn completion revokes every remaining grant and unloads the tools.

`computer_sequence` accepts up to 16 already-clear routine steps from that observation: exact role/name clicks, exact-field typing, a narrow editing/navigation key allowlist, and short waits. The broker resolves semantic targets uniquely, executes one step, captures and commits the next revision, then resolves the following step from that fresh observation. It stops before any missing, ambiguous, stale, sensitive, critical-looking, unauthorized, expired, or interrupted step. Only the initial and final compact observations enter model context; every internal action still passes capability, grant, revision, element, audit, action-count, and Emergency Stop checks. Critical actions remain on the individual canonical approval path.

The Windows helper starts on the first computer operation, remains available for the active pending/approved feedback loop, exits immediately when the task releases its grant, and exits after a short idle timeout when enumeration is abandoned. It does not run continuously waiting for work.

Tool output contains normalized observations and references, never raw CDP, raw UIA objects, cookies, handles, or reusable pairing credentials.

TUI-only sessions return a specific capability-unavailable result until a standalone broker transport is implemented. They must not silently emulate desktop control with shell tools.

---

## 11. Chrome MV3 extension

Create a standalone package:

```text
extensions/zyra-browser-control/
  manifest.json
  package.json
  tsconfig.json
  src/
    service-worker.ts
    popup.ts
    popup.html
    content-observer.ts
    protocol.ts
    pairing.ts
    tab-grants.ts
    action-runner.ts
    redaction.ts
  scripts/
    build.mjs
    package.mjs
  tests/
```

### 11.1 Permissions

Default manifest permissions:

- `activeTab`.
- `scripting`.
- `storage` for bounded local pairing metadata.
- `tabs` only if exact required behavior cannot be implemented without it.

`debugger` is optional and requested only for features that cannot be delivered safely through `activeTab` plus `scripting`.

Do not request broad persistent host access by default.

### 11.2 Pairing

User flow:

1. Open Zyra Control Center.
2. Choose **Pair Chrome**.
3. Zyra starts a loopback-only server on a random port.
4. Zyra shows a short-lived pairing code.
5. User opens the extension popup and enters/confirms the code.
6. Challenge-response establishes a session with a rotating high-entropy credential.
7. User activates an exact tab through the extension popup.
8. Extension grants only that tab to Zyra.

Transport rules:

- Bind only to `127.0.0.1` and `::1` when supported safely.
- Reject non-loopback peers.
- Validate extension origin and protocol version.
- Use a challenge nonce and rotating session key.
- Never place bearer credentials in query strings, logs, prompts, or command lines.
- Cap message size, rate, and pending requests.
- Expire pairing and tab tokens.
- Revoke on extension disable, tab close, browser restart, app restart, or emergency stop.

### 11.3 Observation and action

Prefer injected, predefined content functions through `chrome.scripting`:

- Build a bounded accessible DOM representation.
- Redact secret fields.
- Mint revision-scoped element references.
- Perform predefined click, focus, type, select, and scroll actions.
- Observe resulting DOM, focus, URL, and title changes.

Optional `chrome.debugger` use must:

- Be separately consented.
- Be exact-tab scoped.
- Use a command allowlist.
- Handle Chrome's visible debugging indicator.
- Detach on lease release or emergency stop.

No arbitrary script text comes from the model or broker.

---

## 12. Windows computer-use sidecar

Create a separate Windows project:

```text
native/zyra-computer-use/
  Zyra.ComputerUse.sln
  src/Zyra.ComputerUse/
    Program.cs
    Protocol/
    Security/
    UiAutomation/
    Capture/
    Input/
    Windows/
    Redaction/
    Audit/
  tests/Zyra.ComputerUse.Tests/
```

A separate sidecar is preferred over an Electron ABI-bound native addon.

### 12.1 Process and transport

- Electron main launches the sidecar on demand.
- Use an ACL-restricted named pipe for the current Windows user.
- Pass the initial authentication secret through an inherited handle or protected stdin, not command-line arguments.
- Validate protocol version and peer process.
- Use bounded JSON-RPC messages.
- Enforce per-call deadlines and cancellation.
- Kill the child process tree on broker disposal or emergency stop.
- Preserve the short abandoned-enumeration timeout. If the helper exits while the provider is deciding, `selectWindow` privately refreshes the native registry once and retries only when the same HMAC-bound token is present. A closed, replaced, blocked, or identity-changed window still fails closed.
- Sidecar never listens on a network socket.

### 12.2 Window selection

The user selects an exact visible top-level application window.

Store opaque target identity bound to:

- Process identity.
- Executable path/signature hash where available.
- Process start time.
- Window identity.
- Current user session.

Reject stale PID reuse and changed process identity.

### 12.3 UI Automation first

Observation:

- Control/content tree.
- Name, automation ID, class, control type, enabled/focused state.
- Supported control patterns.
- Bounds.
- Bounded text where safe.

Actions prefer UIA patterns:

- Invoke.
- Selection.
- Value.
- Toggle.
- Expand/collapse.
- Scroll.
- Focus.

Physical input is fallback-only for equal-or-lower integrity targets and requires a current revision. Keyboard fallback requires exact-target focus verification. Coordinate move, click, and drag are translated from selected-window to screen coordinates, checked against current window bounds, and allowed only when `WindowFromPoint` still resolves to the exact selected top-level window; obscured or mispositioned input fails before mouse-down.

### 12.4 Capture

Use Windows Graphics Capture for selected-window screenshots.

- Require user consent through system selection where required.
- Preserve the system's visible capture indicator.
- Capture only the granted window.
- Bound size and frequency.
- Redact configured regions and sensitive controls when coordinates are reliable.

### 12.5 Visible Windows control presence

An active exact-window grant drives two main-process-owned, click-through Electron overlays:

- A recordable synthetic Zyra cursor. The Windows driver derives its screen-space position from the latest revisioned UI Automation element bounds and publishes moving, pressing, typing, scrolling, and idle phases through the existing control cursor contract. Browser and Windows render that state with the same unfilled 24px Lucide `MousePointer2` outline, bounded eased movement, and a restrained accent glow; there is no surrounding ring, cursor trail, or attached phase label.
- A capture-protected, full-display accent glow on the display containing the exact selected window. Its borderless three-layer falloff reaches inward without drawing hard accent lines, keeps the center transparent, and shows `Zyra is using {application}` beside the active Emergency Stop key without entering model screenshots or control observations. On entry, the light blooms in first and the status treatment follows with a short eased drop; reduced-motion mode shows both immediately. The spacious status treatment avoids decorative pulse, app-icon, divider, and accent-strip elements; its surface, text, font, accent, density, and reduced-motion behavior come from Zyra's live appearance preferences.

The main process revalidates exact-window availability and its containing display through the authenticated sidecar every 750 ms. It updates the overlay DOM only when the app label, stop key, appearance, display, or visibility changes. Plain `Escape` is registered globally only while a Windows grant is active; the permanent `Ctrl+Alt+Escape` shortcut remains the fallback. Overlay windows are non-focusable, ignore mouse input, are excluded from trusted Assistant renderer IPC, and are hidden before Emergency Stop revokes grants. Release, expiry, target closure, turn interruption, sidecar failure, and shutdown all remove the visual state and unregister plain Escape.
- Store screenshots as short-lived local artifacts.
- Return only opaque references through tools.

### 12.5 Blocked targets

Deny or require hardened policy for:

- UAC and secure desktop.
- Higher-integrity/admin processes.
- Password managers.
- Credential, authentication, security, and system-policy applications.
- Lock screen and logon UI.
- Antivirus/security configuration.
- Payment and wallet applications.
- Hidden/background windows not selected by the user.

No automatic elevation path exists.

---

## 13. Control Center and Browser UI

Create:

```text
desktop/src/renderer/src/pages/assistant/
  AssistantControlWorkspace.tsx
  AssistantControlTargets.tsx
  AssistantControlGrantDialog.tsx
  AssistantControlAudit.tsx
  AssistantChromePairing.tsx
  AssistantWindowsTargetPicker.tsx
  AssistantControlEmergencyStop.tsx
```

### 13.1 Inspector Control workspace

Modes:

```text
Targets | Grants | Audit | Pairing
```

Show:

- In-app Browser tabs available for control.
- Paired Chrome tabs.
- Selected Windows windows.
- Principal using each target.
- Capabilities, origin/app scope, expiry, and remaining actions.
- Current driver health.
- Last redacted action.
- Revoke and emergency-stop controls.

### 13.2 Browser toolbar

When the active Browser tab is controlled:

- Show a visible control indicator.
- Show principal and remaining lease time.
- Offer revoke and emergency stop for active control.
- Show pending requests as “Waiting in chat” without approve or deny buttons.
- Keep normal Browser navigation and profile controls unchanged.

### 13.3 Approval cards

Use typed approval cards in canonical chat for grant and side-effect requests. Main owns each pending record, and trusted renderer actions resolve it. Do not add a second approval surface in Browser chrome, Thread Details, settings, or a modal.

### 13.4 Responsive and motion behavior

- Reuse existing Inspector tab and retained-workspace patterns.
- Preserve Inspector resizing and entrance motion.
- Avoid remounting Browser webviews when Control is selected.
- Respect reduced motion.
- Use status text and iconography, not color alone.

---

## 14. Subagent integration contract

This builder implements the broker side of delegation without assuming the fleet implementation's internal files.

```typescript
interface DelegatedControlLeaseRequest {
  parentGrantId: string;
  parentPrincipal: ControlPrincipal;
  childPrincipal: Extract<ControlPrincipal, { type: "agent" }>;
  targetId: string;
  capabilities: ControlCapability[];
  expiresAt: string;
  maxActions: number;
}
```

Rules:

- A subagent has no control grant by default.
- Only the parent/root may request delegation.
- Broker proves strict attenuation.
- Child actions are audited under child and parent identities.
- Parent cancellation revokes descendants.
- Workflow completion revokes unused leases.
- A child cannot delegate again at initial depth policy.

The integration agent later connects this contract to `AgentFleetController` cancellation and capability policy.

---

## 15. Audit, redaction, and retention

Audit events include:

- Principal.
- Target kind and opaque ID.
- Grant lifecycle.
- Action type.
- Origin or executable identity.
- Observation revision.
- Outcome and bounded error.
- Timestamp and elapsed time.
- Redaction flags.

Audit events exclude:

- Typed text values by default.
- Password values.
- Cookies and tokens.
- Raw page trees.
- Raw screenshots.
- Full URLs containing sensitive query or fragment values.
- Pairing secrets.

Use bounded retention under Electron `userData`. Add an explicit clear-audit action separate from clearing Browser profile data.

---

## 16. Recovery and lifecycle

On app restart:

- Active grants become revoked.
- Observation revisions are invalid.
- CDP sessions are detached.
- Loopback pairing bearer credentials are gone.
- Chrome and Windows targets appear disconnected until explicitly repaired/reselected.
- Redacted audit history remains according to retention policy.

On renderer reload:

- Main-owned grants remain active only if the trusted target and principal remain alive.
- UI rehydrates summaries through typed IPC.
- Renderer cannot recreate missing grants.

On target navigation:

- Increment revision.
- Re-evaluate origin scope.
- Pause or revoke if the new origin is outside grant policy.

On root/subagent cancellation:

- Abort pending action.
- Revoke descendant leases.
- Release driver resources.

---

## 17. Packaging

### Chrome extension

- Produce deterministic unpacked and ZIP artifacts.
- Exclude private pairing state.
- Document developer loading.
- Keep Chrome Web Store publication manual and explicitly approved.
- Do not auto-install the extension.

### Windows sidecar

- Build a self-contained or framework-dependent package according to measured installer size.
- Include the sidecar in Electron `extraResources` or the existing package pipeline.
- Resolve the binary from packaged and dev paths.
- Verify hashes before launch where practical.
- Add code-signing as a release gate; do not require a signing credential for local deterministic tests.
- Uninstaller removes bundled binaries and registered native-host entries if native messaging is later enabled.

No agent may publish, sign with a user identity, or alter system-wide registry state during ordinary tests.

---

## 18. Implementation phases

### Phase 0 — Threat model and contracts

- [ ] Add data-flow and threat-model documentation.
- [ ] Define principals, targets, grants, observations, actions, results, and audit events.
- [ ] Add runtime validation and cross-language fixtures.
- [ ] Define error taxonomy and stale-revision behavior.

**Gate:** Untrusted renderer/model input cannot mint target authority or raw platform handles.

### Phase 1 — Broker core

- [ ] Implement target registry, grants, action queue, revisions, audit, and emergency stop.
- [ ] Add expiry and action-count enforcement.
- [ ] Add strict lease attenuation.
- [ ] Add deterministic fake driver.

**Gate:** Broker policy tests cover grant widening, stale revisions, cancellation, expiry, and emergency stop.

### Phase 2 — In-app Browser observation

- [ ] Register trusted retained guests in main.
- [ ] Add on-demand debugger lifecycle.
- [ ] Implement bounded accessibility/DOM observation.
- [ ] Implement screenshot artifact references.
- [ ] Add redaction and navigation revision changes.

**Gate:** A local fixture page can be observed without exposing raw CDP, cookies, storage, or password values.

### Phase 3 — In-app Browser actions

- [ ] Add click, type, key, select, scroll, navigate, wait, and focus.
- [ ] Require latest revision.
- [ ] Verify resulting state.
- [ ] Add origin-scope transitions.
- [ ] Add grant and emergency-stop UI.

**Gate:** An agent completes a local form fixture, while stale and out-of-origin actions fail safely.

### Phase 4 — Agent bridge and tools

- [ ] Add duplex correlated bridge RPC.
- [ ] Bind principal from runtime context.
- [ ] Add narrow Browser and computer tools.
- [ ] Add abort and timeout propagation.
- [ ] Add specialized activity presentation.

**Gate:** A root Codex turn can request a grant, observe, act, and verify through bounded tool contracts.

### Phase 5 — Chrome extension and pairing

- [ ] Build standalone MV3 package.
- [ ] Add loopback pairing and rotating credentials.
- [ ] Add exact-tab activation.
- [ ] Add bounded observation/actions through scripting.
- [ ] Add optional debugger mode only if required.
- [ ] Add disconnect, revoke, and browser-restart behavior.

**Gate:** One explicitly paired Chrome tab is controllable; another unpaired tab remains inaccessible.

### Phase 6 — Windows sidecar protocol

- [ ] Build named-pipe JSON-RPC host.
- [ ] Add same-user and peer validation.
- [ ] Add process/window identity and stale-PID protection.
- [ ] Add cancellation and process-tree disposal.
- [ ] Add fake UIA/capture providers for tests.

**Gate:** Malformed, oversized, unauthenticated, and stale-target requests are rejected deterministically.

### Phase 7 — Windows observation and actions

- [ ] Add UIA tree and control patterns.
- [ ] Add selected-window capture.
- [ ] Add semantic actions and bounded `SendInput` fallback.
- [ ] Add integrity/UAC/secure-desktop denial.
- [ ] Add Control Center target selection.

**Gate:** Zyra controls a selected ordinary test window and cannot control an elevated or secure-desktop target.

### Phase 8 — Persistence, audit, and recovery

- [ ] Persist redacted audit and non-secret pairing metadata.
- [ ] Revoke active grants at restart.
- [ ] Handle renderer reload and target destruction.
- [ ] Add retention and clear-audit controls.

**Gate:** Restart leaves no active control path or reusable credential while preserving bounded audit evidence.

### Phase 9 — Subagent lease seam

- [ ] Implement delegated lease acceptance and strict attenuation.
- [ ] Add parent/child audit identity.
- [ ] Add cancellation hooks independent of fleet internals.
- [ ] Add integration fixtures for the merge agent.

**Gate:** Root grants do not automatically reach children; a valid subset lease works and revokes with its parent.

### Phase 10 — Packaging and end-to-end hardening

- [ ] Package extension artifacts.
- [ ] Package sidecar in dev and production layouts.
- [ ] Run security, performance, failure, and build checks.
- [ ] Run isolated live Electron, Chrome, and Windows smoke tests where locally available.
- [ ] Update architecture and user documentation.

**Gate:** All acceptance criteria pass, with exact external/manual limitations documented.

---

## 19. File map

```text
src/agent-control/
  contracts.mjs
  tool-contracts.mjs
  bridge-client.mjs
  browser-control-tool.mjs
  computer-control-tool.mjs

desktop/src/shared/agent-control/
  contracts.ts
  protocol.ts
  policy.ts
  validation.ts

desktop/src/main/agent-control/
  agent-control-broker.ts
  capability-policy.ts
  grant-store.ts
  target-registry.ts
  observation-store.ts
  action-queue.ts
  audit-store.ts
  redaction.ts
  emergency-stop.ts
  control-errors.ts
  bridge-control-rpc.ts
  drivers/driver.ts
  drivers/zyra-browser-driver.ts
  drivers/chrome-extension-driver.ts
  drivers/windows-desktop-driver.ts

desktop/src/main/ipc/handlers/
  agent-control-handlers.ts

desktop/src/preload/adapters/
  agent-control-adapter.ts

desktop/src/renderer/src/pages/assistant/
  AssistantControlWorkspace.tsx
  AssistantControlTargets.tsx
  AssistantControlGrantDialog.tsx
  AssistantControlAudit.tsx
  AssistantChromePairing.tsx
  AssistantWindowsTargetPicker.tsx
  AssistantControlEmergencyStop.tsx

extensions/zyra-browser-control/
  manifest.json
  package.json
  src/
  scripts/
  tests/

native/zyra-computer-use/
  Zyra.ComputerUse.sln
  src/
  tests/
```

Keep Browser profile ownership in the existing Browser preview handler. The driver may call it through a narrow internal interface; it must not duplicate partition derivation or storage clearing.

---

## 20. Testing

### 20.1 Contract and broker tests

Add:

```text
desktop/scripts/test-agent-control-contract.ts
desktop/scripts/test-agent-control-policy.ts
desktop/scripts/test-agent-control-revisions.ts
desktop/scripts/test-agent-control-bridge.ts
desktop/scripts/test-agent-control-audit.ts
```

Cover:

- Schema bounds.
- Unknown capability.
- Renderer-forged target.
- Grant widening.
- Expired grant.
- Consumed grant.
- Stale observation.
- Origin transition.
- Parent cancellation.
- Emergency stop.
- Duplicate and late driver results.
- Secret and URL redaction.

### 20.2 In-app Browser tests

Use a local deterministic HTTP fixture with:

- Buttons.
- Inputs.
- Password field.
- Select.
- Scroll container.
- Same-origin navigation.
- Cross-origin navigation.
- Delayed DOM updates.
- iframe.
- Popup attempt.
- Download attempt.

Prove:

- Browser profile behavior remains unchanged.
- Main owns guest identity.
- Accessibility tree is bounded.
- Password value is absent.
- Stale actions fail.
- New navigation increments revision.
- Existing download, permission, protocol, popup, and partition gates remain effective.

### 20.3 Extension tests

Cover:

- Manifest permissions.
- Pairing expiry and replay.
- Origin validation.
- Exact-tab scope.
- Message size/rate bounds.
- Secret-field redaction.
- Tab close and browser restart.
- Optional debugger detach.
- Unpaired-tab denial.

### 20.4 Windows sidecar tests

Cover:

- Named-pipe authentication.
- Protocol bounds.
- Stale PID/window identity.
- UIA normalization.
- Semantic action preference.
- Equal-integrity `SendInput` fallback.
- Higher-integrity denial.
- Capture consent and selected-window scope.
- Sidecar crash and restart.
- Emergency stop during input.

Use an owned deterministic test application for automated integration. Use Notepad only as a manual smoke target when available.

### 20.5 Performance bounds

Initial targets:

```text
Observation nodes returned: <= 1,500
Observation payload: <= 512 KiB without screenshot
Screenshot artifact: <= configured 2 MiB after scaling/compression
Pending actions per target: <= 32
Concurrent actions per target: 1
Audit in-memory page: <= 500 entries
Pairing pending requests: <= 32
Default action timeout: <= 15 seconds
```

### 20.6 Required checks

- Focused Node syntax and contract tests.
- Desktop TypeScript.
- Existing Browser architecture and Inspector contracts.
- Extension build and tests.
- Sidecar unit and integration tests.
- Scoped `git diff --check`.
- Privacy check.
- Desktop production build after full integration.
- No installer publication.

If an external Chrome or Windows UI test cannot run in the isolated environment, deterministic protocol and fake-driver coverage must still pass, and the exact manual check remains listed in the handoff. The builder continues all other work.

### 20.7 Measured Windows path

Live Windows development benchmarks use the authenticated Assistant service and delete their temporary Chat, trace, event journal, and replay data afterward. In-app Browser benchmarks require an explicitly named Chat that is already selected in the development renderer; service-level session selection does not substitute for visible renderer selection. Those runs retain evidence in the dedicated test Chat and close their temporary tabs afterward.

| Scenario | Total | Provider | Tools | Computer calls | Observation text |
|---|---:|---:|---:|---:|---:|
| Historical broad baseline | 368.2 s | 347.3 s | 14.8 s | 21 | 204,711 chars |
| One-call deterministic type/click/readback | 18.4 s | 15.7 s | 2.7 s | 1 | 1,759 chars |
| One-call Calculator after final-state projection | 30.0 s | 22.5 s | 7.5 s | 1 | 1,894 chars |
| Two-app Calculator-to-editor handoff | 89.9 s | 80.8 s | 9.1 s | 2 | 9,213 chars |

Provider deliberation remains variable and is the largest latency source. The implementation therefore optimizes provider round trips: routine known steps can execute inside `computer_use_app`, completed sequences return changed/readback elements rather than every unchanged control, and a successful next-app grant replaces the prior Windows grant without a release-only call.

### 20.8 Measured in-app Browser path

A live development run against `https://example.com` verifies the register-first, command-navigation path. The explicit in-app Browser prompt preloaded the bounded tools, `browser_tabs` created and navigated one incognito tab, and the `observe.structure` grant returned its initial observation. No loader, tab-list, explicit-observe, screenshot, fallback, or Windows-control call was needed.

| Scenario | Total | Provider | Tools | Browser calls | Observation text | Result |
|---|---:|---:|---:|---:|---:|---|
| Final open/read common path | 41.0 s | 24.3 s | 16.7 s | 2 | 1,484 chars | Title `Example Domain`; heading `Example Domain` |

The final path had zero failed tool results. The 16.5-second tab operation includes trusted target registration and requested navigation; the grant plus initial structure took 0.2 seconds. A later already-mounted-workspace run exposed and fixed a storage-mode ordering race: selected-tab state had created an agent-requested tab as `normal` before the `incognito` surface request ran, so trusted registration correctly refused the mismatch. The corrected run registered the requested incognito target and verified both title and heading. The temporary tab was subsequently closed through an exact one-action `tab.manage` grant; close completion also tolerates the renderer synchronously removing the target and revoking that grant.

The follow-on Browser → Calculator → editor acceptance run verified Browser title/heading and Calculator's visible `10,063` result. The editor stage discovered that modern Notepad can restore prior unsaved documents even when no Notepad window or process was open. Its test input was immediately undone and UI readback verified restoration; the new launched-app typing guard now rejects that state before input. Because the machine contains pre-existing unsaved Notepad work, the clean-document transcription case remains intentionally unverified rather than risking that work.

---

## 21. Acceptance criteria

- [ ] The in-app Browser remains sandboxed, context-isolated, Node-isolated, permission-denied, download-denied, and HTTP(S)-only.
- [ ] The existing global Browser profile remains the only integrated Browser credential profile.
- [ ] Root tools can list, observe, and act only through `AgentControlBroker`.
- [ ] Raw CDP, raw UIA, cookies, storage, and platform handles never reach model or renderer contracts.
- [ ] Every action requires an active grant and current observation revision.
- [ ] Stale actions fail without best-effort clicking.
- [ ] Origin and executable transitions pause or revoke out-of-scope control.
- [ ] Password and sensitive field values are redacted.
- [ ] Emergency stop revokes every target and aborts active work.
- [ ] Chrome pairing requires an explicit user gesture and exact-tab selection.
- [ ] Unpaired Chrome tabs are inaccessible.
- [x] Windows control requires one exact ordinary application window selected through a root Chat grant request.
- [ ] Zyra never elevates or controls UAC/secure desktop.
- [ ] `SendInput` is fallback-only and respects Windows integrity boundaries.
- [ ] Active grants and bearer credentials do not survive restart.
- [ ] Subagents have no control by default.
- [ ] Delegated subagent leases are strict subsets and revoke with the parent.
- [ ] Audit is bounded and redacted.
- [ ] TUI-only sessions report control unavailable rather than bypassing the broker.
- [ ] Extension, sidecar, desktop, bridge, security, and build checks pass.

---

## 22. Autonomous builder mandate

The assigned builder owns this complete plan. It must not stop after contracts, a protocol skeleton, the in-app Browser driver, or a renderer prototype.

The builder must:

- Read this plan, `AGENTS.md`, `docs/architecture/assistant-browser.md`, and the parallel execution runbook completely.
- Inspect real files before editing.
- Implement every phase end to end.
- Preserve the existing Browser profile and security constraints.
- Use a separate dev/test Electron process and isolated test profile.
- Leave any user-owned Electron process untouched.
- Make routine architecture, naming, dependency, and test decisions independently.
- Diagnose failures and continue.
- Commit coherent checkpoints.
- Finish with a clean feature worktree.
- Write `docs/automation/handoffs/browser-computer-use.md` containing commits, exact tests/results, package or installer changes, manual checks, collision notes, and limitations.

The builder asks only when continuing requires:

- Destructive user-data or Git-history changes.
- Stopping a user-owned process with no isolated substitute.
- A missing production secret, signing identity, paid account, or store identity.
- Deployment, publication, purchase, force push, or protected-branch merge.
- An irreversible security/compatibility choice that cannot be resolved from repository and platform evidence.

Routine decisions do not justify a question. A blocked optional live check does not stop deterministic implementation and tests.

The handoff must end with:

```text
READY_FOR_MERGE
```

or one exact reason:

```text
BLOCKED_FOR_MERGE: <reason>
```

`READY_FOR_MERGE` means the full implementation is committed. TODO-only Chrome, sidecar, packaging, bridge, or UI placeholders are not completion.
