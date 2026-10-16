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

Prompt-scoped hidden context uses `PromptOptions.contextMessages`. The engine
accepts it with its original user message only after prompt preflight; failed
authentication, compaction or input handling must not leave an orphan custom
entry. Streaming delivery queues the user and context as one message batch,
including in one-at-a-time mode. Agent steering/follow-up APIs still accept a
single message, or an array that must be consumed together. Ordinary `sendCustomMessage` retains its existing semantics.

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
