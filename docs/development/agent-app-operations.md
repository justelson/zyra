# Agent settings and app operations

The SDK exposes four small discovery tools: `settings`, `settings_action`, `app`, and `usage`. They call registered owners, not arbitrary Desktop IPC, JavaScript, shell commands or configuration-file writes.

## Identity and authorization

The canonical server supplies the originating Chat, namespace, current turn and permission mode. `current` never means the Chat selected in the Desktop window. Default Chat scope is the originating Project, or only that Chat when projectless. A user-directed cross-Project request uses `input.appScope: "installation"`; the server obtains real consent for that exact operation, including expanded reads. The resulting scope is not reusable authorization. Supporting agents cannot expand app scope or mutate app state, and their Chat discovery is limited to the parent conversation. Browser/computer grants and filesystem access remain separate.

The Desktop app owner authenticates with its namespace authority. Responses and live-operation validation are bound to that exact connection. Missing or disconnected owners fail visibly rather than selecting another device. Before a queued main-process mutation starts, the owner rechecks that its server request and originating turn remain valid. Stop does not roll back an administrative operation already accepted by its owning service.

Read-only modes cannot mutate. Explicit area/verb allowlists prevent reads or previews from falling through to moves or other actions. Protected settings, named side effects, title changes, forks, Stop and queue Resume require real user approval even in full-access mode. Arguments such as `confirmed: true` do not grant approval. Credentials, consent and device trust use secure owning UI, never plaintext values in tools.

## Settings

Start with `settings list`, then get an area or exact keys. Descriptors identify the owner, scope, constraints, default/saved/effective values, source, effect timing, write eligibility and Settings destination. List omits saved/effective values. Computed/OS state is read-only; startup behavior uses its actual OS owner. Compatibility mirrors are not writable substitutes for remembered choices.

Preference preview is side-effect-free. Apply/reset use revision checks and existing validation without silent coercion. Reset removes saved ownership. Undo restores saved/unset ownership only if no newer preference changes intervene. Historical Memory defaults are explained by the actual owner; an ordinary first preference write cannot implicitly enable Memory.

Remembered new-Chat choices, Desktop Chat composer staging, Voice Lab, provider/account routing, delegation, memory processing, Plugins/Skills and runtime operations retain distinct owners. Desktop next-turn staging does not change a running turn, old Chat choices or TUI configuration. Remembering requires explicit intent. Named actions expose their parameter schema and effect; their owning services revalidate live inventory, revisions and prerequisites. Authentication, installation, export/cleanup and consent flows may deliberately hand off to secure UI.

## Usage and app objects

`usage` reports available account windows, used/remaining percentages, durations, reset timestamps/countdowns, readiness, routing, reset-credit counts and freshness. Placeholder windows are omitted; absent values remain unknown. Chat token/cost consumption and runtime-reported context estimates are distinct. Cumulative token consumption is never treated as current context size. Recent-turn results are bounded.

`app list` discovers actual area actions and related existing tools. Chat listing/search/reading, explicit manual title changes, settlement/archive, no-navigation creation, current work, profile-local queues, Resources, Projects and fleet metadata reuse owning services. Files, Git, processes, browser/computer and workflow execution keep their existing scoped tools. An advertised related tool is not a new permission grant.

Final committed sidebar groups drive numbered shortcuts and cycling. Agent movement and UI drag/menu movement use the same persisted writer and Undo. Hidden and unauthorized slots are preserved. Mutations need the exact live owner/revision. Cold navigation does not invent a different order. Queue editing uses the live queue owner; recovery remains held and Resume needs explicit approval.

## Citations and forks

Selecting a completed assistant passage exposes Cite. The composer citation preserves the exact quote, source/message identity, rendered-text offsets/context and optional comment. The ordinary draft is untouched. Structured attribution survives drafts, queues and serialized sent history; provider input contains a readable quote and comment. Source navigation uses existing message hydration, then highlights an exact or uniquely reanchored passage. Unavailable/changed sources do not destroy the saved quote or silently select an ambiguous passage.

A history fork uses an exact persisted message boundary and complete tool-call/result groups. The source stays immutable, configuration uses real persisted profile/chat-config entries, and no provider is attached or prompted. Shared mode uses current working files. Optional isolation invokes the Project/worktree owner and creates a Git worktree at creation-time HEAD, without copying uncommitted changes. Neither mode restores files to the selected message's date.

A new Desktop fork cannot attach until its scope is confirmed. Partial import leaves an explicit pending fork rather than granting broader access or duplicating work. Provenance survives the canonical catalog and Desktop cache and links back to the source.

## Durability and verification

Mutation identity claims are fsynced before side effects and retained independently from the last 500 detailed receipts. Expired details never permit automatic re-execution. Conflicting IDs, uncertain completion and failed receipt persistence fail closed. Receipts omit raw arguments, credentials and raw provider error bodies; redaction makes affected Undo ineligible rather than restoring redacted values.

Run `npm --prefix desktop run test:agent-app`, `test:assistant-context-actions`, `test:shortcut-hints` and `test:keybindings`. Follow cross-boundary changes with `test:chat-interactions`, title/server/gateway regressions and serial shared/renderer/main/preload typechecks. The selection checks use actual Monaco and native pointer events in disposable hidden Electron windows. Hint checks mount the actual portal with synthetic modifier/foreground events, effective remapping and recording/IME/modal suppression. Citation navigation checks include exact highlighting after rendered text nodes are replaced. Tests use synthetic data and isolated profiles; they do not prove installed-app, live-provider or cross-device acceptance.
