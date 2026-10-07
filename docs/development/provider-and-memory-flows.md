# Provider, memory and speaking-style flows

## Provider connections

First Send resolves the explicit prompt model, then the retained chat model, then the saved new-chat preference before runtime attachment and dispatch. Cold drafts therefore use the saved preference even when preparation has not finished. Canonical drafts named New chat remain eligible for title generation from the first prompt; title utility work starts independently of connection and uses its own configured model.

Desktop setup recommends ChatGPT. Other providers are available from the sign-in page and Settings > Account: OpenCode Zen with an API key, Claude through the Anthropic API, and custom Chat Completions, Responses or Anthropic Messages endpoints.

An API-key connection verifies model access with a small synthetic request before saving it. Credentials are stored in Zyra's `<state-root>/credentials/auth.json`; legacy Pi credentials are imported only with explicit confirmation. ChatGPT subscription sign-in uses Zyra's own browser or device-code OAuth flow and credential refresh, with no Codex installation, Codex credential import, or Zyra-specific OAuth client ID setting. The browser callback uses OpenAI's registered local port 1455; device-code sign-in is available when that port cannot be used. Endpoint and model metadata live in `<data-root>/.zyra/providers.json`; they contain no API keys. The data root follows `ZYRA_DATA_ROOT`, otherwise the user home directory, matching the agent server. Normal runtime startup loads saved metadata without contacting providers. Runtime model refresh and model changes pick up saved connections.

The current ChatGPT subscription connection has one credential slot. A future multi-account phase should store separate account profiles, let the user select a default account for new chats, bind existing chats to their chosen account, and show usage and reconnect state per account. Migrate the current credential into the first profile without replacing existing credentials or chats. Do not import another harness's tokens without explicit user approval.

Desktop refreshes the model catalog on its first model-list request after launch, then no more than once every four hours unless the user requests a refresh. Refresh re-reads saved API-provider `/models` endpoints and the OpenCode harness catalog, skips availability probes and model-generation requests, and keeps cached models when a provider request fails. OpenCode harness refresh reads its live catalog only when its local service is already running. These refreshes update the saved provider catalog so later sessions receive the same model list.

`src/provider-connections.mjs` owns validation, verification, persistence and removal. The existing auth worker transports these operations off Electron's main process. Preload exposes narrow typed connection methods. Onboarding retains its existing step IDs and accepts a verified connection from any supported provider; optional provider identity fields survive review and restart. Disconnecting a provider removes its credential and metadata without deleting chats.

ChatGPT subscription features and Voice still require ChatGPT sign-in. Connecting another provider does not supply those capabilities. Memory workers use a shared `auto`/pinned model preference: auto selects the provider-specific memory default when it is available, keeps effort at Luna `medium` and Sonnet 5 `low`, and otherwise stays on the active chat provider; pinned selections never fall back across providers. OpenCode prefers its connected ChatGPT Luna model and otherwise Big Pickle. Fleet routing accepts explicit provider/model IDs and inheritance; the existing named OpenAI aliases remain explicit choices. Background titles choose an authenticated model when their preferred model is unavailable.

OpenCode's public free endpoint rejected a synthetic request identifying the client as Zyra with `MissingSessionID` and a restriction to OpenCode. Zyra therefore does not advertise no-key free access or impersonate the OpenCode client. See the [Zen documentation](https://opencode.ai/docs/zen/) and [provider implementation](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/plugin/provider/opencode.ts). The separately installed OpenCode runtime is now a supported provider kind (`opencode-harness`, see `src/opencode-harness.mjs`): a Zyra-owned loopback `serve` instance pipes text-only turns through the session API under the user's own OpenCode login. Track the remaining onboarding, fleet-routing, install-offer, and delegation work in [DESIGN-002](../roadmap.md).

## Memory ownership

The agent-server bridge owns a cancellable idle scheduler for persistent desktop sessions. It schedules after 60 seconds of idle time, limits subsequent runs to one per 15 minutes, and cancels pending or active work when a foreground turn starts or the bridge is disposed. A job is limited to two minutes. Empty chats do not generate a current-chat extraction. Existing claim leases, retry limits and per-thread enabled/disabled/polluted modes still apply. `ZYRA_MEMORY_BACKGROUND=0` disables automatic work.

The existing consolidation pipeline retains responsibility for extracting and promoting useful evidence. There is no promise to record every turn: sessions can produce no durable memory, fail a provider request, or be excluded. Closed applications do not run this scheduler. Settings reads the same data root as the server and shows the memory summary before other local files. Existing project-local memory is preserved in place.

## Speaking styles

Five packaged wording preferences replace built-in builder/learner personas: concise, friendly, direct, thoughtful and playful. Concise incorporates the requested unslop guidance. Styles affect expression, not tools, task ownership or permission rules. Settings and per-chat configuration use the existing persisted profile field to avoid breaking saved sessions. Legacy `default`, `builder` and `learner` values resolve to concise. Local private overlays remain supported.

`/profile` selects a style without generating a model confirmation. The generic `/start` catalog item and implementation have been removed. User-created commands are preserved.

## Focused checks

- `npm run test:provider-connections`: isolated verification, persisted real-runtime registration, removal and invalid-request isolation.
- `npm run test:zyra-auth-store`: Zyra credential storage, legacy import, runtime integration, redacted listing and API-key operations.
- `npm run test:zyra-shell-operations` and `node scripts/test-zyra-managed-bash.mjs`: Zyra-owned shell execution and managed-job lifecycle.
- `npm run test:memory-idle`: idle scheduling, cancellation and cooldown.
- `node scripts/test-zyra-memory.mjs`: existing extraction, privacy modes, claims and consolidation contracts.
- `bun desktop/scripts/test-memory-overview-root.ts`: settings/server data-root consistency.
- `bun desktop/scripts/test-onboarding-state.ts`: setup state, provider identity and persistence.
- `node scripts/test-zyra-ui-render.mjs`: style switching and legacy/runtime preference behavior.
- `node scripts/test-zyra-subagents.mjs`: provider inheritance and existing fleet boundaries.
- `npm --prefix desktop run test:assistant-streaming`: true deltas, corrections, main batching and canonical replay.
