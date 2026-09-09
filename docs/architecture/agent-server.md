# Zyra Agent Server Architecture

## Goal

Zyra has one durable local agent service and multiple interchangeable clients. Desktop is primarily an application shell. TUI is a lightweight terminal client. Both surfaces list, open, and continue the same canonical chats.

Closing, reloading, or reconnecting a client must not terminate an active root turn, managed command, subagent, or workflow. An explicit Stop action still cancels work.

The proposed [voice-agent architecture](voice-agent/README.md) extends this ownership model with a deterministic task controller, realtime-session coordinator, selective narration, and continuity view. Optional Product Phase Two adds a relationship host, work-thread registry, attention queue, cross-conversation focus coordination, and Home controller activity receipts. That package is a draft specification; these modules are not claimed as current runtime behavior here.

## Sources Of Truth

Zyra uses one authority per concern:

1. **Pi session JSONL** is the canonical conversation and model-context history.
2. **Agent-server event journals** are the canonical ordered lifecycle/reconnect stream for active and recent work.
3. **Agent-server chat catalog** maps canonical Pi session IDs to project, path, display metadata, and known aliases.
4. **Desktop SQLite** is a rebuildable UI projection/cache. It is not allowed to create a second chat identity or own runtime lifetime.
5. **Renderer stores** remain presentation-only caches.
6. **Proposed Phase Two controller records** would own relationship, work-thread, focus-lease, attention, visit, consultation, retrieval-access, budget-reservation, and Home-activity-receipt orchestration while each message remains in its canonical Pi session.

A canonical chat ID is the Pi session header ID. Desktop `assistant-session:*` and `assistant-thread:*` IDs are aliases used by the shell until their projection is migrated.

## Process Model

```text
Desktop shell ─┐
               ├─ authenticated local named pipe ─ Zyra agent server
TUI client ────┘                                  ├─ chat catalog
                                                   ├─ event journals
                                                   ├─ bridge worker: chat A
                                                   ├─ bridge worker: chat B
                                                   └─ fleet/workflow recovery
```

The server runs as a detached local user process. The protocol version namespaces discovery and transport endpoints, while a channel-wide owner lock prevents incompatible generations from mutating the same chat state concurrently. The capability handshake also detects outdated services within the same protocol version. It binds only a per-user named pipe on Windows or a user-owned Unix socket elsewhere. A random descriptor token is stored in a mode-0600 local file and is required during the handshake. Desktop control additionally requires proof of a random secret retained through Electron `safeStorage`; the server keeps only its SHA-256 verifier. Declaring a Desktop surface or capability in the handshake is insufficient.

The existing `src/zyra-ui-bridge.mjs` remains the first worker implementation. Moving it behind the server gives Zyra durable process ownership without rewriting the Pi adapter and UI projection simultaneously. Packaged Desktop launches pass a writable `ZYRA_DATA_ROOT` (the user home) separately from the immutable staged runtime, so memory consolidation never writes into an app bundle or AppImage. Windows packages carry a pinned Node executable for the detached server; signed macOS/Linux packages use Electron's Node mode without depending on system `PATH`.

## Client Lifetime

- Connecting or selecting a chat attaches the client to a server-owned worker.
- Closing a UI socket detaches only that subscriber.
- In-flight requests and turns continue in the server.
- Events carry a monotonically increasing per-chat sequence.
- Reconnecting clients provide their last sequence and receive bounded replay followed by live events.
- Idle workers may stop only after they have no clients, no active turn, and a bounded idle timeout.
- `session.stop` is explicit and different from `session.detach`.

## Browser And Desktop Authority

Browser and Windows authority remains in the trusted desktop main process. When a server-owned worker emits a control request, the server routes it only to an attached client that explicitly advertised the matching authority. TUI clients do not gain desktop control by connecting.

A separate `desktop-workspace` authority handles user-typed TUI commands such as `/browser`, `/details-ui`, `/explore-files`, `/resources`, `/subagents-ui`, `/diff-ui`, and `/terminal-ui`. The authenticated server resolves the canonical chat, forwards a bounded presentation request only to a verified Desktop client, and matches the exact response ID. This route can open or arrange trusted UI; it cannot execute model tools, approve arbitrary control grants, mutate transcripts, or grant a TUI process general Desktop authority. `/browser --background` may arm one exact-tab, current-root grant intent because the command itself is a local user action; a normal bounded grant is issued only for a real root turn and remains subject to target, origin, duration, action-budget, turn-lifecycle, and Emergency Stop rules.

If no authorized desktop client is attached, the TUI can launch a registered installed Desktop in background-host mode and retry briefly. If Desktop is absent or cannot authenticate, the request fails closed while text chat remains alive.

## Service compatibility and updates

The authenticated handshake advertises the method list from `protocol.mjs`. Clients compare it with their required methods before sending application requests; a matching protocol number alone is insufficient. New methods must be registered in that list. Changes to the meaning of existing methods still require a protocol-version change.

When a same-protocol server lacks required methods, verified Desktop may request `server.retire`. The server refuses retirement during in-flight requests, background work, pending approvals/input, or workspace requests. An accepted retirement immediately blocks new requests, acknowledges the client, and shuts down through the normal lifecycle. The client waits for the old process to exit and attempts one replacement per required service contract during the client process lifetime. Concurrent callers share that attempt, and the attempt remains recorded across recreated connections so competing older clients cannot cause an upgrade loop.

Legacy services without capability advertisement or retirement support require a one-time controlled restart. They fail with `AGENT_SERVER_UPGRADE_REQUIRED`; active services return `AGENT_SERVER_UPGRADE_BUSY`. Permission failures are never ignored. Project changes check the permission contract before saving their new scope.

Run `npm run test:agent-server:compatibility` for the focused compatibility/replacement regression. It also runs in `test:agent-server`.

## Canonical Chat Catalog

The server records known project roots and scans each project’s `.zyra/sessions` directory using Pi `SessionManager.list()`. Catalog entries contain:

- canonical chat ID;
- session file path;
- project/CWD;
- title or first message;
- created/modified time;
- message count;
- aliases and last attached surfaces.

Both Desktop and TUI query the same catalog. Opening a catalog entry attaches to its canonical chat ID and session file regardless of which surface created it.

Catalog registration is additive and local. It never copies, rewrites, or deletes session JSONL files.

### Lazy historical tool bodies

Pi session JSONL remains complete and unchanged. The rebuildable chat-index sidecar stores entry offsets, byte lengths, hashes, and lightweight envelopes; it never copies tool-output bodies. Incremental scans advance only through complete newline-delimited records, retain a partial tail for the next pass, and fully rescan a same-size rewrite. Clients may request `catalog.history` with `toolResultBodies: "lazy-v1"`. The server keeps the latest 15 tool results eager and replaces older results with a validated `historyBodyRef` containing the canonical chat ID, entry index/ID, SHA-256, tool identity, byte count, and content metadata.

An expanded historical tool card resolves that reference through `catalog.entry.body`. The server checks the indexed chat, exact entry offset, entry ID, hash, tool call ID, and tool name before returning the canonical entry. Desktop keeps a byte-bounded LRU cache; SQLite stores the lightweight reference, while the renderer merges hydrated payloads for expanded cards and Review persists authoritative file-change metadata when requested. Deferred bodies remain distinguishable from genuinely empty outputs. Worker attach snapshots also omit historical tool-result messages so the same bodies are not serialized once during connection and again during catalog paging. TUI catalog pages remain eager until the terminal surface has a real interactive expansion path.

This policy applies only to UI/catalog projection and transport. It does not truncate Pi `SessionManager` state, model context, compaction input, branching, exports, search, Review, or canonical JSONL. Explicit Review search scans deferred tool-result lines through the offset index and merges matching tool calls back into persisted turn results without hydrating every output. A future Pi runtime optimization requires an upstream-supported lazy session reader or a separately proven compatibility layer.

## Implemented Migration

### Server foundation

- authenticated local named-pipe/Unix-socket protocol with a mode-0600 descriptor token;
- detached server startup with stale-lock recovery;
- server-owned bridge workers and separate utility work for model lists/title generation;
- canonical project/session catalog and alias tracking;
- explicit attach, detach, interrupt, and stop semantics;
- bounded in-memory replay plus bounded, compacted per-chat JSONL event journals;
- active root requests, managed commands, agents, and workflows prevent idle worker disposal;
- exact-session Desktop control routing that fails closed when no Desktop authority is attached.

### Desktop client

- `ZyraPiRuntime` uses `DesktopAgentServerConnection` for canonical sessions;
- Electron shutdown and session disconnect detach the client without disposing the server worker;
- reconnect uses the last sequence and replays missed provider events with durable turn IDs;
- externally initiated TUI turns are projected through the existing Desktop runtime-event path;
- Browser control remains in trusted Electron main and is never granted merely by server attachment;
- global catalog changes import TUI-created chats and Pi message history into Desktop SQLite;
- SQLite remains a rebuildable shell projection and retains local Desktop IDs as aliases.

### TUI client

- normal CLI/TUI startup uses `createZyraTuiClientRuntime` and the same server protocol;
- prompts, interrupt, steer, follow-up, compaction, fleet, and workflow calls execute in the server-owned session;
- `/chat` opens the global canonical catalog across known projects;
- TUI exit detaches and closes its socket without stopping active server work;
- `ZYRA_EMBEDDED_RUNTIME=1` remains a temporary compatibility fallback for focused debugging.

### Verification

- `npm run test:agent-server` covers protocol authentication boundaries, canonical aliases, Desktop/TUI worker sharing, detach during an active prompt, durable replay, control routing, explicit stop, the real Pi bridge, and the Desktop adapter;
- Desktop TypeScript verifies the shell integration and shared contracts;
- focused syntax and whitespace checks cover the server, bridge, and TUI entrypoint.

## Remaining Follow-Up

- Add an explicit user-facing agent-server status/restart command before release packaging.
- Add richer Pi tool/activity reconstruction when importing a chat that Desktop has never projected; message history is imported now, while future live and replayed activity remains rich.
- Exercise a live provider turn across an actual Desktop-close/TUI-open cycle after the next normal Electron restart.
- Remove `ZYRA_EMBEDDED_RUNTIME` after one compatibility cycle.

## Proposed Phase Two server extension

After Product Phase One ships, the same server ownership model can expose one relationship-level subscription over several canonical chats. It must coordinate one relationship-wide focus lease with explicit multi-client takeover, prepare an immutable target provider binding and conversation hydration, transact paired route/focus changes, recover visits/budgets, and project Inbox/active-work state. It does not merge workers or JSONL histories, and a client disconnect still detaches rather than cancelling work. See [Phase Two — relationship-first interaction](voice-agent/relationship-first-interaction.md).

## Non-Goals

- No cloud sync or LAN listener.
- No renderer-owned agent process.
- No destructive migration of existing Pi sessions or desktop SQLite.
- No broad Browser/Windows authority for TUI clients.
- No attempt to merge Desktop and TUI presentation layers.
