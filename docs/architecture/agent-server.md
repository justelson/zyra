# Zyra Agent Server Architecture

## Goal

Each Zyra installation namespace has one durable local agent service and multiple clients. Desktop is primarily an application shell. TUI is a lightweight terminal client. Clients connected to the same namespace list, open, and continue the same canonical chats. Development profiles, installed Desktop and an independent TUI can use separate namespaces; shared project history does not imply shared live ownership.

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

### Completion receipts and attention notifications

`session.view` reports an explicitly visible chat, independently of worker attachment or global chat selection. Desktop combines the mounted chat route and document visibility with main-process native window focus, visibility and minimized state. Browser tabs report their own document focus; Android uses its foreground chat route; TUI renews from terminal focus reports. Each view has its own identifier, renews every 10 seconds and expires after 35 seconds. Disconnects remove that client's views.

The chat catalog persists `lastSeenCompletedTurnId` and its completion timestamp. A completed or interrupted turn that is viewed is acknowledged there; `catalog.changed` distributes the receipt to Desktop/browser projections and phone lists. Read acknowledgments do not change chat history or recency. A stale catalog response cannot replace a locally read latest turn with an older receipt. Merely selecting a chat in a background window does not acknowledge it.

Live completion, input and approval edges produce a deduplicated `chat.attention` notice to one connected Desktop client with verified workspace authority, unless any current view is showing that chat. Hydrating history does not produce notifications; retry boundaries and user interruptions do not produce completion alerts. Desktop rechecks canonical visibility, read state and pending attention before showing an Electron OS notification. Viewing the chat or resolving the request closes the active notification; clicking it restores the Desktop window at that exact chat. OS notification settings still govern delivery. Views and receipts synchronize within one installation namespace, not between independent installations.

The updated server advertises `session.view` in its capability contract. Deploying renderer changes alone cannot enable canonical visibility or native notices on an older running agent server; activate the corresponding server update for installed acceptance.

Android's shared `MobileSession` owns one `ChatAlertMonitor`, its persisted edge receipts and native alert publisher. Opening the app or enabling chat notifications while it is visible does not start a foreground service or post an announcement. The service owns only the background connection lease: it starts when an opted-in Activity leaves, stops on return, and keeps Android's required background status notification silent. Configuration changes do not start it. This handoff preserves completion/input deduplication and exact-chat intents without stopping real foreground alerts.

Browser and Windows authority remains in the trusted desktop main process. When a server-owned worker emits a control request, the server routes it only to an attached client that explicitly advertised the matching authority. TUI clients do not gain desktop control by connecting.

A separate `desktop-workspace` authority handles user-typed TUI commands such as `/browser`, `/details-ui`, `/explore-files`, `/resources`, `/subagents-ui`, `/diff-ui`, and `/terminal-ui`. The authenticated server resolves the canonical chat, forwards a bounded presentation request only to a verified Desktop client, and matches the exact response ID. This route can open or arrange trusted UI; it cannot execute model tools, approve arbitrary control grants, mutate transcripts, or grant a TUI process general Desktop authority. `/browser --background` may arm one exact-tab, current-root grant intent because the command itself is a local user action; a normal bounded grant is issued only for a real root turn and remains subject to target, origin, duration, action-budget, turn-lifecycle, and Emergency Stop rules.

If no authorized desktop client is attached, the TUI can launch a registered installed Desktop in background-host mode and retry briefly. If Desktop is absent or cannot authenticate, the request fails closed while text chat remains alive.

## Service compatibility and updates

The authenticated handshake advertises the method list from `protocol.mjs`. Clients compare it with their required methods before sending application requests; a matching protocol number alone is insufficient. New methods must be registered in that list. Changes to the meaning of existing methods still require a protocol-version change.

When a same-protocol server lacks required methods, verified Desktop may request `server.retire`. The server refuses retirement during in-flight requests, background work, pending approvals/input, or workspace requests. An accepted retirement immediately blocks new requests, acknowledges the client, and shuts down through the normal lifecycle. The client waits for the old process to exit and attempts one replacement per required service contract during the client process lifetime. Concurrent callers share that attempt, and the attempt remains recorded across recreated connections so competing older clients cannot cause an upgrade loop.

Missing required capabilities still fail with `AGENT_SERVER_UPGRADE_REQUIRED`, or `AGENT_SERVER_UPGRADE_BUSY` when an incompatible busy service cannot retire. A content fingerprint difference alone is not incompatibility. A method-compatible service that is busy, lacks retirement support or refuses this client's retirement authority stays connected with `updatePending`; no retirement permission is bypassed. Project changes still check the permission contract before saving their new scope.

### Explicit activation and recovery controls

The existing client owns one replacement path for initial compatibility checks and explicit Desktop activation. Explicit socket close emits the same detachment notification as transport loss so Desktop invalidates old worker bindings; compatible wrong-revision replacements remain observable, while incompatible replacements are actually disconnected. `refreshRuntimeStatus` observes the authenticated instance and exposes the expected installed runtime fingerprint separately from the active fingerprint. `activateRuntimeUpdate` shares concurrent requests, pins the observed instance, and asks the existing verified `server.retire` gate. It does not kill processes or cancel turns. The server derives sanitized activity counts and retirement eligibility from the same calculation, including worker cleanup requests after a foreground answer completes and active memory consolidation. Accepted retirement freezes queued maintenance before shutdown.

Desktop's About page has one Background agent section for connection, installed-versus-active code, blockers, refresh/reconnect and safe activation. The app menu links there. Code agreement is unknown without a fresh observation. A successful activation confirms the expected fingerprint on a replacement instance; it does not certify a particular bug fix. Older compatible busy servers stay connected. Unsupported lifecycle controls fail rather than gaining new authority. Browser status relay remains read-only.

Chat actions expose **Stop active turn** independently of saved running state or diagnostics visibility. An untargeted recovery Stop resolves and pins the canonical active turn. An explicitly targeted Stop never substitutes a newer turn. Missing/failed observation does not establish an interruption. Pending local submissions retain their separate cancellation path. Cancellation is checked again immediately before writing a prompt after attachment/setup waits. Once written, Stop waits for that exact canonical admission before aborting, rather than interpreting momentary idle as proof no work can start. A missing admission confirmation produces an error, not a false terminal outcome. Managed background processes retain their existing explicit controls.

### Instance identity and live observations

[ADR 0018](../adr/0018-separate-runtime-identity-compatibility-and-liveness.md) defines the status contract. The service advertises a stable `namespaceId` and a per-start `instanceId`, channel, protocol version, runtime revision and start time. Clients reject an advertised namespace mismatch and retain a bounded, sanitized public projection without tokens, paths or authority proofs.

Connection health is separate from turn state. A 15-second service heartbeat has a five-second deadline; consumers mark observations stale after 45 seconds. Desktop and its browser renderer show the installation label and real connection state. Mobile uses its own upstream client confirmation, with clock-adjusted observation age. TUI shows its namespace and connection health. Browser sharing reports broker connectivity separately from agent activity, and pins a known installation rather than silently moving when a loopback port is reused.

Terminals opened inside Desktop inherit that installation's state directory and channel, without Desktop authority secrets. Desktop-managed launchers default to the owning installation while respecting an inherited namespace. Independently installed TUI commands retain their own default namespace. Development mobile hosts allocate and persist their own port instead of contending for the installed host's fixed default.

Persisted history is not a liveness signal. This implementation does not enumerate active work across separate installations or add cross-namespace takeover. A stopped or missing worker in Dev says nothing about a production worker reading the same project history.

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

Desktop and TUI query the same catalog when they select the same namespace. Opening a catalog entry attaches to its canonical chat ID and session file regardless of which surface created it.

Catalog registration is additive and local. It never copies, rewrites, or deletes session JSONL files.

### Lazy historical tool bodies

Pi session JSONL remains complete and unchanged. The rebuildable chat-index sidecar stores entry offsets, byte lengths, hashes, and lightweight envelopes; it never copies tool-output bodies. Incremental scans advance only through complete newline-delimited records, retain a partial tail for the next pass, and fully rescan a same-size rewrite. Clients may request `catalog.history` with `toolResultBodies: "lazy-v1"`. The server keeps the latest 15 tool results eager and replaces older results with a validated `historyBodyRef` containing the canonical chat ID, entry index/ID, SHA-256, tool identity, byte count, and content metadata.

An expanded historical tool card resolves that reference through `catalog.entry.body`. The server checks the indexed chat, exact entry offset, entry ID, hash, tool call ID, and tool name before returning the canonical entry. Desktop keeps a byte-bounded LRU cache; SQLite stores the lightweight reference, while the renderer merges hydrated payloads for expanded cards and Review persists authoritative file-change metadata when requested. Deferred bodies remain distinguishable from genuinely empty outputs. Worker attach snapshots also omit historical tool-result messages so the same bodies are not serialized once during connection and again during catalog paging. TUI catalog pages remain eager until the terminal surface has a real interactive expansion path.

This policy applies only to UI/catalog projection and transport. It does not truncate Pi `SessionManager` state, model context, compaction input, branching, exports, search, Review, or canonical JSONL. Explicit Review search scans deferred tool-result lines through the offset index and merges matching tool calls back into persisted turn results without hydrating every output. A future Pi runtime optimization requires an upstream-supported lazy session reader or a separately proven compatibility layer.

## Chat title ownership

For tool-enabled Chat turns, the foreground model sets the initial title with `set_chat_title` before its visible response. The bridge publishes a metadata event; the catalog persists `initial`, `provisional`, `model`, `manual`, or `refresh` ownership independently of the transcript. A greeting title remains provisional until a concrete task arrives. An omitted title action leaves initial ownership eligible on the next turn, without starting a competing utility model.

The server supplies eligibility from canonical state, never from model arguments. A proposed title carries the expected prior title; the catalog rechecks both ownership and title after asynchronous reads. Manual names, including names chosen before first attachment, cannot be overwritten by a stale initial proposal. Unknown legacy names are conservatively locked rather than guessed automatic. Title tool evidence stays in canonical model history, but Desktop/TUI presentation and catalog action counts hide it.

Explicit and periodic refreshes still use the separately configured title model and recent completed turns. Periodic refresh skips manual names and canonical writes recheck that protection. An explicit refresh remains a deliberate user override. Startup, navigation and ordinary completion no longer launch initial-title utility repairs. Realtime voice's existing non-tool title path is unchanged.

## Implemented Migration

### Server foundation

- authenticated local named-pipe/Unix-socket protocol with a mode-0600 descriptor token;
- detached server startup with stale-lock recovery;
- server-owned bridge workers and separate utility work for model lists and title refreshes;
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

### Questions, steering and Stop

`request_user_input` defaults to `mode: "blocking"`: hand off questions and end the tool turn. `mode: "async"` returns a durable request without ending independent work. Canonical request metadata owns this mode; an answering client cannot upgrade a blocking question. Pending async requests survive turn completion and journal replay, but do not advertise blocking input presence. Explicit idle settlement dismisses unanswered async requests without sending answers.

Message-capable answers include the original questions. A running answer uses exact-turn steering; idle continuation starts a normal prompt. Steer must name the current `targetTurnId` and never abort or change that turn's execution configuration. Durable response claims/completions prevent same-surface retries, competing surfaces or recovery from dispatching an answer twice. Stop increments a journaled continuation epoch; older async answers become held receipts instead of restarting work. An uncertain in-flight response is not automatically replayed after process loss.

Desktop owns a separate profile-local composer queue. It saves the full message/configuration/attachments before acceptance, restores queues held, and holds synchronously before Stop. Async Desktop answers enter that queue before resolving the request with `deferContinuation: true`; the server must not dispatch a duplicate continuation. This queue and manual sidebar ordering are not cross-device server-owned state. The distinction is explicit rather than claiming T3's shared-queue behavior.

### Verification

- `npm run test:agent-server` covers protocol authentication boundaries, canonical aliases, Desktop/TUI worker sharing, detach during an active prompt, durable replay, control routing, explicit stop, the real Pi bridge, and the Desktop adapter;
- Desktop TypeScript verifies the shell integration and shared contracts;
- focused syntax and whitespace checks cover the server, bridge, and TUI entrypoint.

## Remaining Follow-Up

- Verify the local Background agent controls and read-only `runtime:inspect` command in the requested installed release. Source/isolated tests do not establish installed activation.
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
