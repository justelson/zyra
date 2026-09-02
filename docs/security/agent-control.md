# Agent Control Security and Operations

Zyra control is a revocable desktop capability, not a general script or remote-desktop channel.

Under the draft [voice-agent architecture](../architecture/voice-agent/README.md), spoken conversation never grants control authority. The realtime foreground has no direct control capability; a primary agent still needs the existing principal, target, approval, lease, observation-revision, and emergency-stop path. Speech may discuss or navigate to an approval, but it does not authorize one in the proposed reference profile.

Optional Phase Two relationship membership, work-thread launch, Inbox selection, focus-visit acceptance, context retrieval, and profile switching do not transfer or mint a control grant. A task keeps its exact principal/attempt/lease through Home ↔ thread focus changes, and stale focus-lease, route, and provider-binding generations cannot route control results into another conversation.

## Authority flow

```text
root turn or attenuated child principal
  -> bounded browser_control/computer_control tool
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

Browser chrome and Thread Details show pending or active status only. Chrome pairing, browser-owned optional permission requests, exact-tab activation, and Windows window selection remain explicit setup gestures because their platform owners require them.

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

Never persisted by the broker:

- active grants;
- observation trees;
- element references;
- typed values;
- Chrome bearer credentials.

Screenshots are written only as bounded opaque artifacts under `userData/agent-control/artifacts`; paths never reach model or renderer contracts. Rolling retention, emergency stop, orderly shutdown, and the next broker startup delete them, including files left by a prior crash.

Chrome uses `chrome.storage.session`, so pairing and exact-tab grants disappear on browser restart. Windows sidecar authentication is generated per launch and passed through stdin.

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

The desktop launches the sidecar only when Windows targets are listed. Release packaging publishes a framework-dependent `win-x64` sidecar into Electron `extraResources`. Code signing remains a release gate; local development does not sign or alter the registry.

The capture provider is target-scoped and uses `PrintWindow` in this branch. This avoids desktop-wide pixels and preserves the opaque screenshot contract. A Windows Graphics Capture frame source can replace it behind the same provider boundary when the Windows App SDK/WinRT capture dependency is approved for release.

## Emergency stop

- UI: title bar, Browser controlled-tab indicator, and Control Center.
- Keyboard: `Ctrl+Alt+Escape` (`Command+Alt+Escape` on macOS, though Windows control is Windows-only).

Emergency stop is safe to invoke repeatedly.
