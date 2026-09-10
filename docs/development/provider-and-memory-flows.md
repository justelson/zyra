# Provider, memory and speaking-style flows

## Provider connections

Desktop setup recommends ChatGPT. Other providers are available from the sign-in page and Settings > Account: OpenCode Zen with an API key, Claude through the Anthropic API, and custom Chat Completions, Responses or Anthropic Messages endpoints.

A connection verifies model access with a small synthetic request before saving it. Credentials use the existing Pi auth store. Endpoint and model metadata live in `<data-root>/.zyra/providers.json`; they contain no API keys. The data root follows `ZYRA_DATA_ROOT`, otherwise the user home directory, matching the agent server. Normal runtime startup loads saved metadata without contacting providers. Runtime model refresh and model changes pick up saved connections.

`src/provider-connections.mjs` owns validation, verification, persistence and removal. The existing auth worker transports these operations off Electron's main process. Preload exposes narrow typed connection methods. Onboarding retains its existing step IDs and accepts a verified connection from any supported provider; optional provider identity fields survive review and restart. Disconnecting a provider removes its credential and metadata without deleting chats.

ChatGPT subscription features and Voice still require ChatGPT sign-in. Connecting another provider does not supply those capabilities. Memory workers use the active model. Fleet routing accepts explicit provider/model IDs and inheritance; the existing named OpenAI aliases remain explicit choices. Background titles choose an authenticated model when their preferred model is unavailable.

OpenCode's public free endpoint rejected a synthetic request identifying the client as Zyra with `MissingSessionID` and a restriction to OpenCode. Zyra therefore does not advertise no-key free access or impersonate the OpenCode client. See the [Zen documentation](https://opencode.ai/docs/zen/) and [provider implementation](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/plugin/provider/opencode.ts). Supporting a separately installed OpenCode runtime would be a distinct integration.

## Memory ownership

The agent-server bridge owns a cancellable idle scheduler for persistent desktop sessions. It schedules after 60 seconds of idle time, limits subsequent runs to one per 15 minutes, and cancels pending or active work when a foreground turn starts or the bridge is disposed. A job is limited to two minutes. Empty chats do not generate a current-chat extraction. Existing claim leases, retry limits and per-thread enabled/disabled/polluted modes still apply. `ZYRA_MEMORY_BACKGROUND=0` disables automatic work.

The existing consolidation pipeline retains responsibility for extracting and promoting useful evidence. There is no promise to record every turn: sessions can produce no durable memory, fail a provider request, or be excluded. Closed applications do not run this scheduler. Settings reads the same data root as the server and shows the memory summary before other local files. Existing project-local memory is preserved in place.

## Speaking styles

Five packaged wording preferences replace built-in builder/learner personas: concise, friendly, direct, thoughtful and playful. Concise incorporates the requested unslop guidance. Styles affect expression, not tools, task ownership or permission rules. Settings and per-chat configuration use the existing persisted profile field to avoid breaking saved sessions. Legacy `default`, `builder` and `learner` values resolve to concise. Local private overlays remain supported.

`/profile` selects a style without generating a model confirmation. The generic `/start` catalog item and implementation have been removed. User-created commands are preserved.

## Focused checks

- `npm run test:provider-connections`: isolated verification, persisted real-runtime registration, removal and invalid-request isolation.
- `npm run test:memory-idle`: idle scheduling, cancellation and cooldown.
- `node scripts/test-zyra-memory.mjs`: existing extraction, privacy modes, claims and consolidation contracts.
- `bun desktop/scripts/test-memory-overview-root.ts`: settings/server data-root consistency.
- `bun desktop/scripts/test-onboarding-state.ts`: setup state, provider identity and persistence.
- `node scripts/test-zyra-ui-render.mjs`: style switching and legacy/runtime preference behavior.
- `node scripts/test-zyra-subagents.mjs`: provider inheritance and existing fleet boundaries.
- `npm --prefix desktop run test:assistant-streaming`: true deltas, corrections, main batching and canonical replay.
