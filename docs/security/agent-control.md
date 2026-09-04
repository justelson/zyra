# Agent Control Security and Operations

Zyra control is a revocable desktop capability, not a general script or remote-desktop channel.

Under the draft [voice-agent architecture](../architecture/voice-agent/README.md), spoken conversation never grants control authority. The realtime foreground has no direct control capability; a primary agent still needs the existing principal, target, approval, lease, observation-revision, and emergency-stop path. Speech may discuss or navigate to an approval, but it does not authorize one in the proposed reference profile.

Optional Phase Two relationship membership, work-thread launch, Inbox selection, focus-visit acceptance, context retrieval, and profile switching do not transfer or mint a control grant. A task keeps its exact principal/attempt/lease through Home ↔ thread focus changes, and stale focus-lease, route, and provider-binding generations cannot route control results into another conversation.

## Authority flow

```text
root turn or attenuated child principal
  -> bounded Browser tool or deferred verb-named Windows computer tool
  -> correlated desktop bridge RPC
  -> AgentControlBroker
  -> active grant + current observation revision + scope checks
  -> one target driver
  -> verified next observation
  -> redacted bounded audit
```

The Electron main process owns targets, grants, observations, action serialization, audit, pairing, and emergency stop. Renderer values cannot mint target authority. Numeric Electron, Chrome, HWND, and UI Automation identities stay inside trusted drivers.

## Permission presentation

Zyra has four user-facing permission modes shared by local tools and control surfaces. Supervised asks before root control grants. Auto review issues routine bounded in-app Browser grants automatically but asks before paired Chrome or Windows grants. Edits only asks before every control grant. Full access issues routine bounded root grants automatically across Browser, paired Chrome, and explicitly selected Windows windows.

No mode widens a grant or removes broker checks. Purchases, external sending or publishing, production deployment, account or security changes, destructive deletion, history rewrites, file uploads, sensitive-data submission, software installation, legal acceptance, and secret handling always require attention. Browser and computer actions in those classes create an exact pending action record in main. The action resumes only after approval from a trusted Zyra renderer in canonical chat.

Browser chrome and Thread Details show pending or active status only. Chrome pairing, browser-owned optional permission requests, and exact-tab activation remain explicit setup gestures because their platform owners require them. For Windows, a root Chat may search ordinary applications by the app name supplied in the user's request and include one opaque matching candidate in its exact grant request. Supervised, Auto review, and Edits only show that exact window in Chat before access begins; Full access pre-authorizes routine exact-window grants. Child agents cannot select Windows targets.

## Threat model

| Threat | Boundary |
| --- | --- |
| Renderer forges an Electron guest | Main registers each attached guest first, verifies its owning `BrowserWindow`, then accepts the numeric ID only as an association hint. |
| Model requests raw platform access | Tool operations are allowlisted. There is no evaluate, execute-script, CDP, UIA, cookie, storage, credential, clipboard, or shell capability. |
| Stale element click | Every action carries the latest target revision. Element references are revision-scoped and rejected after navigation, action, restart, or emergency stop. |
| Grant widening | User approval may narrow a pending request only. Delegated child leases prove target, capability, expiry, action count, origin, and application attenuation. |
| Secret exposure | Password/sensitive values are removed from observations, and model control cannot type into password fields. Typed text is excluded from audit. Pair tokens are session-only and never enter URLs, logs, prompts, or argv. |
| Chrome ambient authority | MV3 has no persistent host or debugger access. It requests `activeTab`, `scripting`, session storage, and an optional `http://127.0.0.1/*` permission only when the user pairs. Pairing requires the Control Center code and extension popup gesture; a second gesture grants exactly one tab/document. |
| Windows privilege crossing | The sidecar uses a current-user named pipe, authenticates every bounded request, validates process start identity, blocks sensitive applications, and rejects higher-integrity targets. It never elevates or handles secure desktop/UAC. |
| Runaway control | Grants expire and have action limits. Per-target actions serialize. Global emergency stop revokes grants, aborts queues, invalidates observations, closes pairing, and disposes drivers. |

## Persistence

Persisted under Electron `userData`:

- bounded redacted audit summaries;
- non-secret driver health/policy metadata when added.

Never persisted in broker state or audit:

- active grants;
- observation trees;
- element references;
- typed values;
- Chrome bearer credentials.

A bounded redacted observation is returned in the calling Chat's tool transcript because it is the agent's feedback for the next action. Model-facing Windows enumeration requires a non-empty application query; unfiltered legacy requests are rejected. Pre-grant search results omit ambient window titles, and raw candidate arrays are not copied into persisted tool details. The common `computer_use_app` path may combine registered-app reuse or launch, exact single-match selection, grant request, and observation in one tool call. Optional routine steps still pass the same sequence validator, capability checks, revisions, action counts, and per-step audits before the call returns its final observation. A missing role hint is accepted only when one non-sensitive control with the exact name supports the requested action; zero or multiple matches fail closed. For a multi-app root turn, the broker revokes an older Windows grant only after the next app's exact grant succeeds. Multiple matches still require explicit candidate selection. A Windows grant returns its initial observation. Routine semantic action sequences revalidate exact role/name matches and commit a fresh observation after every internal click, exact-field type, safe editing/navigation key, or short wait. They cannot carry critical side effects, target sensitive elements, use system shortcuts, or bypass grant expiry, action limits, capabilities, revision checks, audit, interruption, or Emergency Stop.

Screenshots are written only as bounded opaque artifacts under `userData/agent-control/artifacts`; paths never reach model or renderer contracts. Rolling retention, emergency stop, orderly shutdown, and the next broker startup delete them, including files left by a prior crash.

Chrome uses `chrome.storage.session`, so pairing and exact-tab grants disappear on browser restart. Windows helper authentication exists only for the current Electron control session and is passed through protected stdin. The helper process launches on demand, remains only for an active computer feedback loop, exits when the grant is released or the turn ends, and has a short idle timeout for abandoned enumeration. If that timeout elapses while the provider is deciding, target selection performs one private re-enumeration and proceeds only when the same HMAC-bound window token is still present; process start identity, executable identity, handle, policy, and exact-target checks remain unchanged.

Target-relative pointer move, coordinate click, and drag are available only with their explicit capabilities and the latest observation revision. Electron translates coordinates to screen space; the sidecar then verifies each point is inside the selected window and that `WindowFromPoint` still resolves to that exact top-level target. Obscured, replaced, out-of-window, higher-integrity, or mispositioned pointer input fails before mouse-down. Drag side effects use the same canonical approval rules as clicks, typing, keys, and selection.

While an exact Windows grant is active, Electron presents two click-through overlays derived only from that granted target. A capture-visible synthetic Zyra cursor receives screen-space positions from already-observed UI Automation bounds. A separate capture-protected, full-display edge glow appears on the display containing the selected app and identifies the application with its local executable icon when available, plus the stop key. Its transparent center does not tint the controlled app, and its colors follow Zyra's current accent preference. The exact grant remains window-bound even though the safety treatment fills the display. Neither overlay accepts input, grants authority, changes revisions, appears in selected-window screenshots, or exposes another window. Both disappear on release, expiry, target loss, turn interruption, sidecar failure, shutdown, or Emergency Stop. A broker-owned expiry sweep revokes idle authority and releases retained targets even when no UI read or action occurs; expired pending approvals are settled the same way.

## Chrome developer loading

1. Run `npm --prefix extensions/zyra-browser-control run package`.
2. Open `chrome://extensions`, enable Developer mode, and choose **Load unpacked**.
3. Select `extensions/zyra-browser-control/dist/unpacked`.
4. Open Zyra **Inspector → Control → Pairing**, choose **Pair Chrome**, and enter the displayed loopback port and code in the extension popup.
5. With the intended ordinary HTTP(S) tab active, choose **Grant this tab** in the popup.

Store publication and automatic installation are intentionally absent.

## Windows sidecar

Development build:

```powershell
dotnet build native/zyra-computer-use/Zyra.ComputerUse.slnx
dotnet run --project native/zyra-computer-use/tests/Zyra.ComputerUse.Tests/Zyra.ComputerUse.Tests.csproj --no-build
```

The desktop launches the sidecar only when a registered app is opened or Windows targets are listed. Release packaging publishes a framework-dependent `win-x64` sidecar into Electron `extraResources`. Code signing remains a release gate; local development does not sign or alter the registry.

Explicit natural-language computer-control prompts preload the deferred named tools for that turn; ambiguous prompts retain `tool_search` as the entry point. `computer_open_app` resolves the requested name inside `shell:AppsFolder`, the current Windows registered-app catalog. The native helper invokes that catalog item. It never accepts an executable path, command arguments, a file, a URL, or a protocol supplied by the model. Exact names win; partial names must resolve to one app. The sensitive-application policy runs before launch. Opening an app grants no control; observation and input still require an opaque candidate and exact-target grant.

The capture provider is target-scoped and uses `PrintWindow` in this branch. This avoids desktop-wide pixels and preserves the opaque screenshot contract. A Windows Graphics Capture frame source can replace it behind the same provider boundary when the Windows App SDK/WinRT capture dependency is approved for release.

## Windows manual smoke test

1. Build the development sidecar with `dotnet build native/zyra-computer-use/src/Zyra.ComputerUse/Zyra.ComputerUse.csproj`.
2. Restart the development desktop so its main process loads the current control code.
3. Open an empty, unsaved test application window.
4. Create a new Chat in **Supervised** mode and ask: `Use computer control in the test application. Type "Zyra computer-use smoke test", then release access. Do not save, close, or use another window.`
5. Approve the exact target and bounded capabilities in Chat. Confirm that the text appears only in that application.
6. Repeat with a ten-second wait and press plain `Escape` during the wait. Confirm that the protected frame and cursor disappear, the later action is cancelled, and the control status returns to idle. Repeat with `Ctrl+Alt+Escape` to verify the permanent fallback.

The root agent sees bounded application identities and opaque candidate tokens. Ambient window titles stay private until access to one exact target is granted. Merely listing windows grants no authority.

## Emergency stop

- UI: title bar, Browser controlled-tab indicator, and Thread Details.
- Keyboard: plain `Escape` while an exact Windows grant is active, plus the permanent `Ctrl+Alt+Escape` fallback (`Command+Alt+Escape` on macOS, though Windows control is Windows-only). Plain Escape is unregistered immediately when Windows control ends.

Emergency stop is safe to invoke repeatedly.
