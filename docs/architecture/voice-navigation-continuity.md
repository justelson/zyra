# Voice and dictation across navigation

Voice belongs to its originating conversation, not the currently selected page. This contract covers Desktop call controls, dictation, task results and context handoff.

## Live calls

Desktop runs the single WebRTC owner in an independent, trusted Voice widget window. Chat panes observe its versioned state and send commands. The widget has no parent, frame or taskbar entry, remains above other applications, and does not throttle audio when the main window is minimized. Only the exact trusted widget WebContents receives audio-only microphone permission. Transparent space outside the orb and rounded controls passes pointer input through.

Selecting or creating another Chat does not close or transfer the call. The owning Chat is shown below the widget. Starting Voice elsewhere offers **Cancel**, **Return to call**, or **End call and start here**. A handoff names the exact previous call ID, waits for its acknowledged cleanup, and rejects stale decisions. The microphone and speaker stop locally before awaiting network cleanup. Late transcript/state events cannot affect the replacement call.

The browser fallback keeps its media owner at application lifetime. A browser tab closing still ends its own physical media session. The standalone Voice Lab retains its separate compatibility path and the service-wide single-call guard.

An idle widget releases its hidden renderer after command acknowledgement. A transport crash closes its route without cancelling independently accepted work. Full application exit remains a different lifecycle boundary.

## Agent work

Accepted requests capture their original Chat, execution configuration, working directory and filesystem scope. Ending audio neither aborts an active request nor drops accepted queued requests. Results update the original task even if no narrator is connected. A result may be narrated only into an active call for that same conversation.

A profile-local private journal retains bounded task requests, terminal status and completed text evidence. Worker replacement restores that evidence under the current permissions and configuration. An unfinished record after runtime replacement is interrupted, not completed. Bounded request/outcome/status summaries enter the next typed turn as hidden application context. They are never prewritten as user-facing assistant prose.

Explicitly handed-off managed background commands retain their private worker owner. Process controls namespace their job IDs and enforce owning-Chat boundaries. They survive task/call completion, not full Desktop termination. Foreground commands are not silently reclassified as background work.

## Dictation

Recording captures an immutable destination and dispatch configuration. Leaving a Chat finalizes its recording into that Chat's draft. A pending transcription continues without changing selection or focus. Only an explicit Transcribe and send action submits it; ordinary completion and navigation remain draft-only.

Completion merges against the owner's latest draft. Browser recognition replaces only its own unchanged segment. Newer edits and attachments are not overwritten or cleared by a delayed send. Explicit Send snapshots text before transcription awaits, so typing afterward is not silently submitted.

Explicit discard cancels that exact request. Losing a renderer/client, or reaching the transcription concurrency admission limit, retains captured audio in transcription history for recovery. History uses stable newest-first, 20-entry pages; deletion clamps the current page and preserves playback/copy controls.

## Model context

A canonical Voice append must complete both durable persistence and live SDK-context synchronization before publishing success. Replays repair live context without duplicating durable entries or starting model turns. Projection uses `buildSessionContext()`, preserving branch and compaction boundaries. Busy streaming/compaction rejects the append before modifying history. A retry after a flush failure must still establish durability.

Chat-to-Voice context is **bounded**, not the full transcript. A fresh connection or reconnection materializes recent messages, pending decisions and task outcomes. UTF-8 packet limits apply. Omitted history and truncated long messages are explicitly identified; the Voice model must not claim complete recall. Delegated work receives the source conversation ID for scoped earlier-history retrieval.

Startup hydrates deltas that arrive while provider connection is in progress. The route activates only after reaching a stable barrier. If new history exceeds the bounded packet, preparation fails rather than acknowledging incomplete catch-up.

## Verification boundaries

`test:voice-core`, Desktop `test:voice-continuity`, `test:assistant-voice-transcription`, and `test:voice-history-pagination` cover real SDK history, synthetic providers, service methods, native SQLite and hidden renderer/media interactions. They do not establish installed-app activation, real microphone/provider acceptance, or Windows cross-application pointer/minimize behavior. Those require an explicitly authorized deployment and live acceptance pass.
