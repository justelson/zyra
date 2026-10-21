# Separate runtime identity, compatibility and liveness

Status: Accepted for the local implementation. Release and device validation remain pending.

## Context

A source change can alter the runtime fingerprint without changing its protocol. Previously, a new client tried to retire the older service and disconnected when that service was busy. The active work continued, but the client lost its live observation. Persisted chat state could then look idle or current without a working connection.

Desktop development profiles, installed Desktop and an independent TUI can coexist. A hostname, executable version, open listener or cached browser pairing does not identify a live connection to the intended service.

## Decision

Preserve the existing separation between installed Desktop, development profiles and independently launched TUI namespaces. Separate four facts:

- The installation label identifies development, installed or standalone usage. It describes the app instance, not the entire computer.
- `namespaceId` identifies the existing state-directory/channel namespace without publishing its path. It remains stable across service restarts and protocol generations.
- `instanceId` identifies one service start. It is different after restarting in the same namespace.
- Connection health records the last authenticated confirmation. It is independent of a chat's running, waiting or terminal state.

Desktop also offers explicit safe activation through the existing client retirement path. The status projection carries installed expected and active runtime fingerprints separately, plus sanitized blockers. Concurrent activation requests share one replacement; the server checks current work and the requested instance before retirement. No automatic idle-update schedule or forced cancellation is implied. Reconnect and lifecycle controls are Desktop-owned; browser status relay stays read-only.

The authenticated handshake, service status and attachment response carry public instance identity. A descriptor and handshake advertising different namespaces are rejected. Browser automatic reconnection pins both the selected origin and the known namespace; a process reusing that port is not silently accepted as the old installation.

Protocol/method compatibility and code freshness are distinct. Missing required methods still fail closed. If a same-protocol, method-compatible service cannot retire because work is active, retirement is unavailable, or the client lacks retirement authority, the client keeps its connection and reports `updatePending`. It does not cancel work. An idle, authorized replacement still uses the existing retirement handshake and bounded replacement policy. A deferred update can be activated on a later connection; the UI does not promise that an open connection hot-swaps its worker code automatically.

A connected client checks service status every 15 seconds, with a five-second deadline. An old heartbeat cannot close a replacement socket. Missing observations become visibly stale after 45 seconds. Mobile adjusts observation age with the host's advertised clock rather than requiring the phone clock to match the PC.

Desktop publishes sanitized identity and health to its own windows and browser renderer. Mobile forwards its own canonical-client health with the owning Desktop's installation label. Browser sharing has separate broker health; stored pairing credentials alone do not mean connected. A terminal launched inside Desktop inherits that Desktop namespace, but never its authority secret. Desktop-managed launchers select their installation by default and retain an explicitly inherited namespace. An independently installed TUI retains its independent default. Development Settings cannot replace or remove the installed global terminal command.

## Consequences and limits

A lost UI connection is not a stopped turn. Last observed activity remains history until refreshed; it must not be presented as current merely because it is stored. An update-pending connection can still observe compatible active work.

A development client does not merge production authority, catalogs or control grants. Shared project history can appear in multiple catalogs; its presence is not evidence that work is running in the currently connected namespace. This decision does not add a cross-installation live-work directory, automatic takeover, shared writer lock or an instance-switching UI.

Listener health and runtime health remain separate. Development mobile listeners choose an available port on first use and persist it, avoiding a fixed-port collision with the installed host. Existing paired listeners retain their saved port.

## Verification

- `scripts/test-agent-server-connection-status.mjs`: compatible busy/passive/unauthorized observers, missing-method rejection, namespace mismatch, heartbeat loss and public metadata.
- `scripts/test-runtime-activation.mjs`: fingerprint changes and authenticated idle replacement without terminating busy work.
- `desktop/scripts/test-runtime-connection-status.ts`: freshness, presentation, browser relay policy, terminal namespace isolation and mobile port policy.
- `desktop/scripts/test-agent-server-worker.ts`: accepted-turn projection, shared subscribers, replay and retained server-owned work.
- Mobile gateway runtime-status tests and Android `RuntimeStatusTest` cover projection and freshness. Browser extension connection tests cover cached-pairing honesty and installation pinning.

Tests that have not been executed on a platform remain pending. No live service is restarted solely to validate this change.
