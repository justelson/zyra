# Desktop response timing diagnostics

Settings → Privacy & support → Diagnostics shows locally submitted chat turns.
Local recording is always active, including when product analytics is off.
There is no collection toggle for the local recorder. Existing hang incident
files and bounded CPU profiles remain available in the profile's diagnostics
directory.

The response recorder retains up to 200 turns, prioritizing active turns, in a
2 MiB `diagnostics/response-timings.json` file. Each turn retains at most 32
provider calls and aggregate counters for the full turn. Private atomic writes
checkpoint ordinary progress at most once per ten seconds; submission, first
text, display and completion use a short debounce. Disk errors never fail a
chat. Atomic replacement may briefly require another bounded temporary file.
The app can refresh and copy the retained records without reading transcripts.

Stages distinguish renderer submission, main-process receipt, runtime dispatch,
canonical server acceptance, first provider event, first provider text, Desktop
text receipt and a visible text paint opportunity. Provider request timestamps
are captured in the common agent loop, including reasoning-only events, so they
work across model providers. Older runtimes leave unavailable fields absent;
Desktop receipt is never substituted for a provider timestamp.

The display observation runs after the actual text reveal policy. It requires
a visible document, viewport intersection including overflow clipping, visible
CSS and committed text across two animation frames. It measures a paint
opportunity, not physical monitor pixels. Background, collapsed and offscreen
text is not acknowledged until it becomes visible. Streaming updates do not
create per-token disk or analytics events. First-display times can therefore
include time spent away from the chat.

Provider activity gaps reset between provider calls and exclude tool execution.
Runtime recovery/ping attempts and compaction durations are recorded separately.
Existing proven stall incidents annotate active turns; high-CPU alerts alone do
not count as a stall. Main and renderer stall reports may overlap and must not
be added together as elapsed wall time. An unfinished turn from a previous
Desktop process is labelled `unfinished`, without claiming its background work
was interrupted.

One `zyra_v1_response_timing` summary is offered to the existing consent-gated
PostHog client after settlement, allowing a short window for a queued display
acknowledgement. Local recording does not enable analytics or alter consent.
The catalog permits only finite bounded durations, counters, outcomes, known
model names and reasoning efforts. Custom model names become `other`. No turn
IDs, request IDs, timestamps, prompts, responses, credentials, raw errors or
paths are sent in this event. Late display acknowledgements remain available
locally without sending another summary.

Run `npm --prefix desktop run test:response-timing` for source provider timing,
local persistence/privacy/retention, real submission/queue integration and
hidden Electron display/settings checks. `node scripts/test-product-analytics.mjs`
verifies catalog ownership, sanitization and consent behavior. After building
the owned runtime, `node scripts/test-model-request-timing.mjs --compiled`
verifies the packaged provider control. These checks use synthetic data; live
provider latency and installed-app diagnosis require collecting new turns with
the corresponding Desktop and background runtime activated.
