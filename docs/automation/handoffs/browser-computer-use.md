# Browser and Computer Use Handoff

## Status

Implementation commit: `4471c4d` (`feat: add secure browser and Windows computer control`)

This branch delivers the shared agent-control protocol, main-process authority broker, integrated Browser driver, paired Chrome extension, Windows sidecar, Pi tools, Control Inspector UI, lifecycle revocation, packaging hooks, security documentation, and deterministic/live verification.

## Delivered

### Shared authority and protocol

- Versioned JS/TypeScript contracts with a canonical wire fixture and equivalence test.
- Explicit capabilities, short-lived grants, action limits, origin/application scopes, strict child-principal attenuation, current observation revisions, per-target action queues, bounded payloads, and structured errors.
- Main-owned trusted target registry. Renderer-supplied Electron IDs are association hints only and cannot mint authority.
- Bounded redacted audit persistence; grants, raw observation payloads, typed text, and pairing credentials are not copied into broker persistence. Bounded redacted observations remain in the calling Chat's tool transcript as the next-action feedback.
- Side-effect heuristics fail closed, unknown side-effect labels are rejected, and model control cannot type into password fields.

### Integrated Zyra Browser

- Trusted webviews register through the main process.
- Driver uses a strict CDP allowlist for accessibility observations, bounded selected-tab screenshots, semantic action dispatch, navigation, and revision invalidation.
- Existing Browser partition isolation, denied permission prompts, webview sandboxing, popup/navigation policy, and download gates remain intact.
- Browser toolbar and global title bar expose control state and emergency stop.

### Paired Chrome

- MV3 extension has no persistent host access and no `debugger` permission.
- Pairing is loopback-only with extension-origin validation, one-time challenge proof, rotating bearer tokens, replay rejection, bounded messages, and session-only credential storage.
- The extension requests only optional `http://127.0.0.1/*` access during the explicit pairing gesture.
- A second popup gesture grants one ordinary HTTP(S) tab/document; every main-document navigation revokes that exact-document grant.
- Structure, semantic actions, active-tab screenshots, sensitive-value redaction, and disconnect/revoke events use the broker's common contract.
- Deterministic unpacked and ZIP packaging is wired into Windows release packaging.

### Windows computer use

- Dependency-free `.NET 8` sidecar communicates over an authenticated current-user named pipe with bounded, correlated RPC.
- `computer_open_app` resolves one registered Windows Start app by display name. It rejects ambiguous or sensitive matches and accepts no paths, arguments, files, URLs, or model-supplied protocols.
- Window selection returns opaque tokens; every operation revalidates handle, process start identity, executable identity, process integrity, and blocked-application policy. If the short-lived helper exits during provider reasoning, selection privately rebuilds its registry and continues only if the same HMAC-bound token still identifies the exact window.
- UI Automation provides bounded semantic observations and actions. Read-only value patterns are never advertised as type targets. Deferred tools include exact-window move, coordinate click, and drag. Pointer points are translated from target-relative coordinates and must remain both inside and topmost within the selected window; obscured pixels and privilege crossings fail closed.
- Capture is limited to the selected window and returns opaque bounded artifacts.
- During an active exact-window grant, a recordable synthetic Zyra cursor shows moving, pressing, dragging, typing, and scrolling phases. A separate click-through, capture-protected accent glow fills the selected app's display, keeps the center clear, and identifies the controlled app with its local icon when available, plus its stop key. The glow follows Zyra's accent and density preferences. Neither overlay enters model observations or accepts input.
- Sidecar startup is lazy. The process remains only for an active pending/approved feedback loop, exits on task release or turn completion, and uses a short idle timeout for abandoned enumeration. Crash/disconnect revokes authority, and Emergency Stop clears observations, queues, grants, and screenshot artifacts.

### Product and runtime wiring

- Browser control and deferred verb-named Windows tools are registered through the existing Pi runtime and use correlated duplex desktop bridge RPC. Releasing one grant keeps those named tools available for another requested app in the same turn; turn completion unloads them.
- Root sessions default to one lightweight `tool_search`; explicit computer-control prompts preload the turn-scoped named tools before the first provider call, while ambiguous tasks still use search. `computer_use_app` combines registered-app reuse/launch, exact single-candidate selection, grant request, and observation. It may execute already-known routine semantic steps from its private initial observation before returning the final state; ambiguous matches fall back to explicit selection. `computer_sequence` runs up to 16 already-clear routine clicks, exact-field typing steps, bounded editing/navigation keys, and short waits with a fresh internal observation and revision check after every step. Successful access to the next requested Windows app replaces the prior Windows grant for that root turn. Turn completion revokes remaining grants, so the model skips release-only provider calls during handoff and at the end. These changes remove serial provider turns without weakening the grant or critical-action path. Client-side deferred loading remains necessary because the current Pi custom-tool adapter does not expose OpenAI's native `defer_loading` field.
- Non-desktop/TUI use fails closed with `CONTROL_CAPABILITY_UNAVAILABLE`; it never hangs waiting for a bridge that does not exist.
- Inspector → Control includes pending grant approval, active targets/grants, revocation, Chrome pairing, Windows target selection, audit summaries, driver health, and emergency stop.
- Plain `Escape` is scoped to the lifetime of an active Windows grant; `Ctrl+Alt+Escape` remains the permanent global fallback. Overlay teardown shares release, expiry, interruption, target-loss, shutdown, and Emergency Stop lifecycle.

## Verification

Passed on Windows in this worktree:

- `npm run check`
- `npm run privacy-check`
- `bun run --cwd desktop typecheck`
- `bun run --cwd desktop build`
- `npm run test:agent-control`
  - contract equivalence
  - capability policy and child attenuation
  - stale revision and emergency-stop behavior
  - bounded bridge correlation
  - audit retention and redaction
  - loopback pairing origin/proof/token rotation/replay/exact-tab event flow
  - extension security tests
  - `.NET` build and six deterministic sidecar checks
- `npm run --prefix desktop test:agent-surface`
- `npm --prefix extensions/zyra-browser-control run package` (deterministic package generation)
- `dotnet build native/zyra-computer-use/src/Zyra.ComputerUse/Zyra.ComputerUse.csproj -c Release`
- `dotnet run --project native/zyra-computer-use/tests/Zyra.ComputerUse.Tests/Zyra.ComputerUse.Tests.csproj -c Release`
- `node native/zyra-computer-use/scripts/smoke-sidecar.mjs`
  - live owned WinForms target
- `bun run --cwd desktop smoke:windows-control-overlay`
  - recordable cursor, capture-protected full-display accent glow, scoped Escape registration, and grant teardown
  - 10 UI Automation elements
  - selected-window capture
  - semantic typing

Generated extension output, Electron build output, and `.NET` `bin/obj` directories were removed after verification and remain ignored.

## Merge and release notes

- Chrome's actual **Load unpacked → Pair → Grant this tab** click-through still requires a human-controlled Chrome session. The loopback server and exact-tab event path are exercised end to end by executable tests, but the external Chrome UI gesture was not automated in this run.
- The selected-window capture provider currently uses the Win32 `PrintWindow` path behind the opaque capture interface. It never captures the desktop or an unselected window. Replacing that provider with a Windows Graphics Capture frame source remains the documented release follow-up when the approved WinRT projection dependency is available.
- Windows binary code signing, Chrome Web Store publication, and automatic extension installation remain release/distribution gates; this branch intentionally implements developer loading and package hooks only.

READY_FOR_MERGE
