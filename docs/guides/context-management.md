# Context management and cache reuse

## Defaults and model overrides

Settings → Assistant → Context & memory uses model-specific policies. There is no single effective global compaction cap.

- A provider's recommended threshold is used when supplied, bounded by its supported input capacity.
- Codex metadata keeps `context_window`, `max_context_window`, `auto_compact_token_limit` and `effective_context_window_percent` distinct. Its 90% automatic boundary is derived from the resolved window, not applied a second time to its usable-context percentage.
- Providers without a recommendation use a labelled safe-headroom fallback when capacity is known. An unknown capacity stays unknown.
- The maximum or extended context window is informational. Increasing a compaction threshold cannot enable an unsupported model configuration.

Choose **Customize models** to open the model picker. Each selected model has a threshold dropdown and a Remove action. The dropdown's provider-default option and Remove both restore automatic policy for that model. Unavailable models retain their saved overrides without claiming that those overrides are currently usable.

Presets are Zyra choices within supported bounds, not a claimed list of provider service tiers. Pricing labels are derived from verified short/long rates and identify input, cached input and output multipliers separately. They are API-equivalent estimates, not promises about ChatGPT subscription quota. A higher threshold itself is not a purchase; actual request length determines the applicable rate.

`assistantModelCompactionOverrides` is a device preference keyed by exact provider/model selector. The old global preference remains saved for compatibility but is not applied to every model. It is read-only in agent settings. Model and effort preferences are unchanged.

## Agents can manage their own context

The `context` tool accepts only:

- `action: inspect`: own context occupancy, effective policy, headroom, pending-input count, compaction status and host-supplied diagnostics.
- `action: compact`: optionally provide summary focus in `instructions`. The tool returns pending immediately.

There is no target Chat, agent or session parameter. Supporting agents receive the same own-session capability through normal capability attenuation. An explicit disallowed-tool policy remains effective.

Requested compaction runs at a safe boundary after the complete tool batch is persisted and before the next model inference. It does not abort and restart the task. Inspect afterward to see completion or failure and before/after estimates. One request is permitted per user task, including failures; repeated requests in the same pending batch coalesce. Automatic compaction remains available as a safety net.

Compaction preserves the previous checkpoint when a long turn is summarized again. Empty, truncated, tool-calling and otherwise incomplete summary responses are rejected before committing a replacement checkpoint. Cancellation preserves original history. Trailing oversized tool-result groups retain their assistant call and complete results rather than making the cut-point selection fall back to the beginning.

Single oversized prompts and hidden attachments are rejected before they can enter a queue or create orphan context. A dispatch-boundary guard also checks combined queued context and tool output before provider inference. It can run one automatic checkpoint when enabled; if the input still cannot fit, it reports a budget error rather than silently truncating history or making an over-budget inference. Token-size estimates are conservative local estimates, not an exact provider tokenizer.

## Cache stability and diagnostics

Turn-specific memory, skill instructions, title state and worktree choices are appended atomically with the submitted user message. They do not rewrite a shared system-prompt block on every request. Application instruction blocks survive tool-guidance rebuilds.

Loaded Browser and Windows tool definitions stay available across normal turns in SDK sessions. Explicit unload/disable remains effective. Retaining a definition does not retain, renew or extend any tab/window grant. Every operation still checks its exact grant, expiry, revocation and critical-action policy. Model discovery preserves same-model verified transport capabilities and documented deferred-tool support; it never borrows capabilities from a neighboring unknown model.

Own-context diagnostics expose bounded request observations for Codex: transport, full/delta payload bytes, retries, elapsed timing, first-event/text timing, anonymized account affinity, model/effort/tier, provider-reported token counts and local change reasons. Local fingerprints do not establish the provider's internal reason for a cache miss. They contain no raw prompts, credentials, response IDs or account IDs. Observations are in-memory, bounded and expire when idle.

A temporary WebSocket failure opens an account/endpoint-scoped circuit breaker. Requests use SSE during cooldown; one controlled probe can restore WebSocket use. A partially emitted response is never replayed through fallback. Healthy eligible accounts are preferred for continuing conversations, with actual-limit or availability failover. This does not bypass account selection or model restrictions.

## Usage scopes

Whole-chat cache reuse is weighted by input tokens, not copied from the latest response. Chat details distinguish whole-chat, latest-turn and latest-request reuse. Context occupancy is separate from cumulative processing. Cache writes and maintenance usage are included in session totals, and reasoning remains a subset of output.

Supporting-agent failures and resumes retain metered lifetime usage instead of resetting to zero. Current-task diagnostics subtract the submission baseline, show primary and supporting totals separately and combine them without re-counting inherited history. Active requests and unreported provider work remain unknown. API-equivalent costs are not subscription invoices.

## Delayed retention check

Prompt caching works independently from persistent server-side response storage; Codex requests retain `store:false`. This implementation does not assert that indefinite retention is guaranteed for every third-party client and sends no speculative retention parameter.

Record a private baseline after a metered response:

```sh
node scripts/cache-retention-check.mjs start --session-file <own-session.jsonl> --checkpoint <private-check.json>
```

Leave that conversation idle for 12–24 hours. Resume using the same account/model, then inspect the first new request:

```sh
node scripts/cache-retention-check.mjs check --session-file <own-session.jsonl> --checkpoint <private-check.json> --minimum-hours 12
```

The script makes no model or authentication request. It saves a digest and metadata, not conversation text, and never overwrites an existing checkpoint. A cold first request cannot be hidden by selecting a later warm one. Changed history, model, compaction or insufficient delay makes the result inconclusive. Session logs alone cannot establish account/tool-schema/system-prefix identity. A delayed hit demonstrates reuse over the observed interval, not "forever" retention.

## Validation

`npm run test:context-cache` runs the focused source/contract tests and disposable hidden Settings component fixture. Compile maintained runtime TypeScript with `npm run runtime:build`; verify generated files with `npm run runtime:check`. No live provider traffic, real account changes, app activation or installer is required for these synthetic checks. Installed-app and delayed-retention acceptance remain separate.
