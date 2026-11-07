# Chat latency runner

`npm run benchmark:chat-latency` runs the selected installed or checkout runtime's actual canonical server, bridge worker, Zyra SDK, chat prompt, tool schemas, account routing and streaming provider adapter. It starts no Electron window, web server or watcher and installs no dependencies. The client connects over an isolated local IPC namespace.

This is a diagnostic runner for working with an agent, including from a phone. It does not expose the PC or its account to a new remote service.

## Use

Identify the runtime actually used by the intended Preview installation. Pass its `resources/zyra-runtime` directory and the matching Preview profile explicitly. Use a fresh ignored output directory for each run.

```powershell
npm run benchmark:chat-latency -- --runtime-root "<verified runtime directory>" --profile "<Preview profile directory>" --output docs.local/reviews/chat-latency/run-01
```

Without `--live`, this only prints a plan. Add `--live` after model-credit use is authorized. Live calls are never part of CI or ordinary validation. Prefer the same Node executable as the installed background agent when comparing an installed runtime.

The model is explicitly `openai-codex/gpt-6.1-sol`. Reasoning effort, summary mode, product profile, permission mode, web tools, memory and fast mode come from Preview's device preferences. This isolated runner requires memory off. It uses the existing Preview credential owner, including normal account routing and token refresh, without exporting or duplicating credentials.

- `--samples 3` sends a fresh-chat turn and two follow-ups. Maximum 10 calls per run.
- The synthetic project defaults to a fresh system-temp directory outside the checkout and user home on Windows. `--project PATH` selects a new or empty scratch directory. Instruction-bearing lexical or resolved ancestors are rejected before runtime loading or any model call, without reading their contents.
- The runner and its workers use a newly created home under the output directory, excluding personal skills, custom skill-source settings and commands. Built-in resources remain available. An existing synthetic home is rejected. The selected Preview credential directory stays explicit and separate; no credentials are copied into the synthetic home.
- `--scenario echo` requests exactly `OK`.
- `--scenario code-review` asks for a short review of a synthetic concurrency bug.
- `--idle-ms 90000` waits between full-chat turns to test idle connection reuse. Maximum 10 minutes.
- `--timeout-ms 180000` bounds each turn. Timed-out full-chat turns are aborted through the normal protocol.
- `--direct-provider` is an explicitly labeled comparison using the same installed provider runtime/account routing, model, effort and summary setting. It omits the Chat system prompt, tools, server and bridge. Do not describe this comparison as full-harness performance.

## Measurements and limits

`report.json` separates runtime imports, server startup, client connection, Chat attachment, canonical acceptance, provider request start, first provider event, first provider answer text, first answer text received by the client, and completion. First reasoning-summary delivery is a separate optional observation. The adapter's existing request diagnostics supply transport, attempts, request bytes, token/cache counters and provider timing. The observer reads those diagnostics without changing requests or provider streams.

The JSON summary includes no prompts, replies, credentials, account identifiers, raw errors or user-chat identifiers. Provider observations retain only allowed measurements and known enums. The production server keeps its synthetic event journal in the isolated output directory; the fixture's canonical transcript stays in its separate scratch project. Keep output private and ignored. The runner closes its own server/workers at the end. It never attaches, changes selection in, or restarts the user's existing chats or services.

An isolated test project has no personal skills, personal project instructions, attached Plugin scopes or historical user conversation. The production harness code and built-in prompt/tool construction are reused. These samples cannot establish the performance of a particular long-running conversation. Client receipt also does not prove Desktop or physical phone paint time. Use the app's local Response timings recorder to correlate a real slow user turn through display.

Cold-start timing begins before runtime module imports and includes setup. Submit-to-text timing begins after Chat attachment. Do not combine these into one provider latency or compare a fresh process with an attached warm chat without labeling the difference. Small sample sets report count/min/median/max; they do not support a p95 guarantee. RAM fields are observed process samples, not a guaranteed total peak.

Normal Chat setup defers the default package/resource discovery implementation and HTML exporter. Explicit SDK discovery, extension-enabled sessions, supporting agents and HTML export load their owning implementation when needed. Unbound worker preparation overlaps runtime fingerprint reads only after install admission succeeds; startup failure releases that spare. `npm run test:startup-performance` and `npm run test:child-session-runtime` verify these boundaries without model calls.

## Offline checks

```powershell
npm run test:chat-latency
```

These checks distinguish hidden reasoning from answer text, preserve first receipt and timeout evidence through abort cleanup, handle missing measurements and final/retry outcomes, and verify that the observer leaves split production protocol output unchanged while excluding private fields. The CLI gate also proves that dry runs do not load the runtime or create state and rejects oversized sample counts and profile-owned output. Actual skill discovery/formatting in both runner and inherited worker environments excludes synthetic personal-skill fixtures, retains built-in skills and keeps the selected credential owner separate. No model calls occur.
