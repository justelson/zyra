# Model Support

Zyra keeps model registration separate from provider transport support. A model can be known to the picker before every provider path can run it safely.

## GPT-5.6 Luna

- `openai/gpt-5.6-luna` uses the OpenAI API path and is available when the configured API account has access.
- `openai-codex/gpt-5.6-luna` is registered and visible in Zyra, but locally injected registrations are marked `Pi support pending`.
- Selecting a pending Luna entry stops with a specific compatibility message instead of sending a request that will fail as `Model not found`.
- Zyra does not identify itself as the first-party `codex_exec` client. The current Codex subscription backend treats Pi and official Codex client identities differently for Luna.

When Pi adds Luna to its own model registry, `registerZyraRuntimeModels()` finds the official entry and leaves it untouched. The pending compatibility marker only belongs to Zyra's temporary injected entry, so removing the bridge later should be a small merge rather than a transport rewrite.

## Subagent Fleet Routing

Subagents and workflows use a Codex-only routing catalog. Fleet candidates must use `openai-codex/*`; `openai/*` API models and third-party providers are excluded even if the root chat can use them.

Selectors are semantic tiers:

- `sol`: orchestration, difficult synthesis, architecture, and high-risk review
- `terra`: implementation, debugging, review, and verification
- `luna`: fast search/extraction when Pi transport support and live account availability both pass
- `inherit`: the current root model only when it is an eligible Codex model

The router evaluates authentication, Pi compatibility, cached/live availability, context window, reasoning/tool requirements, and policy allow/deny lists. Every rejected candidate and fallback reason is persisted with the run. Previous-generation fallbacks are GPT-5.5, GPT-5.4, GPT-5.4 mini, and GPT-5.3 Codex Spark.

Luna's fleet alias does not bypass its support-pending state. When the locally registered Luna entry remains blocked, a Luna-preferring task records that rejection and chooses its first live compatible fallback. Bounded escalation to Terra or Sol requires a concrete recorded reason; a child cannot promote itself.

See [subagents-workflows.md](subagents-workflows.md) for definition formats, controls, safety boundaries, and workflow behavior.

## Authentication Methods

Desktop supports [multiple ChatGPT accounts and usage rules](chatgpt-accounts.md) in **Settings > Providers > Limits**.

Zyra treats the active model provider as the active authentication method:

- `openai-codex/*` uses the ChatGPT/Codex subscription connection.
- `openai/*` uses the separately billed OpenAI API connection.

Run `zyra login subscription` or `zyra login api` outside chat. Inside chat, `/auth` shows both methods and `/auth subscription` or `/auth api` switches the current session and persists the corresponding model for future sessions.

API keys are entered through a masked terminal prompt and verified against OpenAI before storage. `OPENAI_API_KEY` can supply the API connection without writing a key to Pi's auth file. Keys must never be placed in slash commands, CLI arguments, prompts, transcripts, or logs.

## Deferred: Ultra Effort

`ultra` is intentionally deferred.

Codex 0.144 model metadata observed on 2026-07-10 exposed `ultra` for GPT-5.6 Sol and Terra on the current account, while Luna stopped at `max`. Zyra currently exposes the stable shared range from `low` through `max`.

Before adding `ultra`, verify all of these against official Pi support:

- Pi's public thinking-level type and persistence format can represent `ultra` without aliasing it to `xhigh` or `max`.
- Model-specific capabilities keep Luna capped at `max` while allowing Sol and Terra to advertise `ultra` only where the active account supports it.
- Provider payload mapping, session restore, model switching, `/thinking`, status rendering, and desktop metadata preserve the exact selected value.
- Upstream Pi support replaces Zyra's compatibility code cleanly, with regression coverage for older saved sessions.
