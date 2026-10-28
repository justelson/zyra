# Zyra runtime

Zyra owns and ships the source here. No Pi package is installed, resolved, or
required to build or run the CLI, desktop worker, or standalone executable.

| Module | Responsibility |
| --- | --- |
| `engine` | Agent sessions, resources, extensions, tools, model registry, compaction |
| `agent` | Streaming turn loop, tool execution, steering, cancellation, context |
| `providers` | Provider transports, credentials contracts, model data, OAuth |
| `terminal` | Terminal rendering, input, Markdown, native keyboard helpers |
| `protocol` | Local wire contracts |
| `client` | Local runtime client |
| `telemetry` | Instrumentation contracts and no-op contexts |

Each module has editable TypeScript in `source/`, executable JavaScript and
declarations in `src/`, and a license notice. The executable files are checked
in so packaged production installations do not need a compiler.

Run `npm run runtime:build` after editing the TypeScript. It checks all modules
with strict TypeScript and emits declarations, executable modules, and assets.
`npm run runtime:check` checks that the compiled files match. `npm run test:runtime-ownership`
rejects external Pi dependencies and imports, and exercises the local exports.
Terminal native source and platform prebuilds live in `terminal/native/`.

OpenAI discovery is owned by `../openai-model-catalog.mjs`: account-visible
endpoint results replace the provider catalog, including removed models. Other
providers retain local baseline metadata and their direct transport discovery.
An optional catalog overlay requires an explicitly configured
`ZYRA_MODEL_CATALOG_URL`; no upstream Pi catalog service is contacted.

Google Gemini and Groq additionally refresh their account-visible chat model lists
through `../direct-api-model-catalog.mjs` at normal session/model-list refresh,
not during cold bridge attachment. Google listing is paginated. Successful lists
replace removed models, including empty accounts; failures use a same-key cache
or the checked-in baseline. Cache entries expire after 15 minutes and are scoped
by provider plus a SHA-256 key fingerprint; API keys are never serialized. Offline
startup only reads that cache. Unknown models retain unknown pricing/context and
conservative capabilities rather than borrowing a different model's metadata.
`npm run test:direct-api-model-catalog` exercises discovery, account rotation,
offline restore and the compiled Gemini transport without live inference.

The Google/Groq baseline was reviewed against official model and deprecation
documentation on 2026-10-22. Gemini 3.8 Flash and 4 Argon use LOW/MEDIUM/HIGH,
not MINIMAL; 3.7 Flash now routes to 3.8. Argon's $2/$10 input/output prices are
introductory through 2026-11-30 and require a later baseline refresh. Groq public
Qwen 3.6 has retired; Qwen 3.8 accepts none/low/medium/high reasoning efforts.
Enterprise-only Llama availability is discovered rather than advertised as a
public baseline. Model lists do not supply live prices or prove tool compatibility.
Sources: [Google models](https://ai.google.dev/gemini-api/docs/models?hl=en),
[Google deprecations](https://ai.google.dev/gemini-api/docs/deprecations?hl=en),
[Argon migration](https://ai.google.dev/gemini-api/docs/latest-model?hl=en),
[Groq models](https://console.groq.com/docs/models),
[Groq deprecations](https://console.groq.com/docs/deprecations), and
[Qwen 3.8](https://console.groq.com/docs/model/qwen/qwen3.8-27b).

`PromptOptions.contextMessages` accepts hidden turn context atomically with its
original user message after preflight. Streaming queues preserve these batches
in one-at-a-time mode. Session-bound `inspectContext` and
`requestContextCompaction` expose own-context state and defer requested
maintenance until all tool results are persisted. Failed authentication,
compaction or input handling must not leave an orphan custom entry. Agent
steering/follow-up APIs accept a single message or an atomic message array;
ordinary `sendCustomMessage` retains its existing semantics. Empty/incomplete
checkpoints are never committed. Host model policy and dispatch-budget checks
apply to queued inputs as well as foreground prompts; original history remains durable.

Extensions can import `@zyra/engine`, `@zyra/agent`, `@zyra/providers`, and
`@zyra/terminal` through the local extension loader. Historical Pi import names
are virtual aliases to these same local implementations for existing extensions.
Legacy session files and manifests stay readable. Credentials are not copied
from another application's storage automatically.

The default engine resource directory is `~/.zyra/agent`. `ZYRA_AGENT_DIR` and
`ZYRA_CODING_AGENT_DIR` override it. Runtime version checks and installer APIs
require explicit Zyra configuration; install reporting to Pi is removed.
Clipboard access uses local Windows, macOS, Wayland, or X11 commands.

This implementation began as a maintained fork of MIT-licensed Pi. See
`provenance.json` and each module's `LICENSE` for upstream versions and attribution.
Zyra changes are maintained in this repository; updates do not require a Pi release.
