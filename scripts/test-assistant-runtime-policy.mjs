import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  applyAssistantReasoningSummary,
  DEFAULT_ASSISTANT_CONTEXT_COMPACTION_THRESHOLD_TOKENS,
  DEFAULT_ASSISTANT_REASONING_SUMMARY,
  resolveAssistantContextCompactionThreshold,
  shouldCompactAssistantContext,
} from '../src/assistant-runtime-policy.mjs'

assert.equal(DEFAULT_ASSISTANT_REASONING_SUMMARY, 'detailed')
assert.equal(DEFAULT_ASSISTANT_CONTEXT_COMPACTION_THRESHOLD_TOKENS, 256_000)

const detailedPayload = applyAssistantReasoningSummary({
  model: 'gpt-5.6-sol',
  include: ['reasoning.encrypted_content'],
  service_tier: 'priority',
  reasoning: { effort: 'xhigh', summary: 'auto' },
}, 'detailed')
assert.deepEqual(detailedPayload?.reasoning, { effort: 'xhigh', summary: 'detailed' })
assert.equal(detailedPayload?.service_tier, 'priority', 'summary selection preserves speed and reasoning effort')
assert.equal(applyAssistantReasoningSummary({ reasoning: null }, 'detailed'), undefined)

assert.equal(resolveAssistantContextCompactionThreshold(400_000, 256_000), 256_000)
assert.equal(resolveAssistantContextCompactionThreshold(128_000, 256_000), 112_000, 'smaller models retain a 16k output reserve')
assert.equal(shouldCompactAssistantContext({
  contextTokens: 253_705,
  contextWindow: 400_000,
  configuredThreshold: 256_000,
  promptTokens: 120,
}), true, 'the observed 253k chat compacts before another prompt crosses the selected boundary')
assert.equal(shouldCompactAssistantContext({
  contextTokens: 244_434,
  contextWindow: 400_000,
  configuredThreshold: 256_000,
  promptTokens: 120,
}), true, 'the 16k turn headroom would have compacted before the observed outlier began')
assert.equal(shouldCompactAssistantContext({
  contextTokens: 230_000,
  contextWindow: 400_000,
  configuredThreshold: 256_000,
  promptTokens: 120,
}), false)
assert.equal(shouldCompactAssistantContext({
  contextTokens: 230_000,
  contextWindow: 400_000,
  configuredThreshold: 256_000,
  promptTokens: 120,
  additionalContextTokens: 12_000,
}), true, 'query-selected memory participates in the projected context before compaction')
assert.equal(shouldCompactAssistantContext({
  contextTokens: 0,
  contextWindow: 32_000,
  configuredThreshold: 256_000,
  promptTokens: 500,
}), false, 'a small fresh model window cannot compact an empty conversation')

const { calculateSessionUsage, compactZyraContextBeforePrompt, setZyraReasoningSummary } = await import('../src/zyra-sdk.mjs')
const completeSessionUsage = calculateSessionUsage({
  getEntries: () => [
    { type: 'message', message: { role: 'assistant', usage: { input: 1_000, output: 200, cacheRead: 9_000, reasoning: 80, cost: { total: 0.02 } } } },
    { type: 'message', message: { role: 'assistant', usage: { input: 2_000, output: 300, cacheRead: 18_000, reasoning: 120, cost: { total: 0.03 } } } },
  ],
})
assert.equal(completeSessionUsage.input, 3_000)
assert.equal(completeSessionUsage.cacheRead, 27_000)
assert.equal(completeSessionUsage.reasoning, 200)
assert.equal(completeSessionUsage.cost, 0.05, 'the runtime reports complete model cost across every provider response in the thread')
assert.equal(completeSessionUsage.costComplete, true)
const partialSessionUsage = calculateSessionUsage({
  getEntries: () => [
    { type: 'message', message: { role: 'assistant', usage: { input: 1_000, output: 200, cacheRead: 9_000, cost: { total: 0.02 } } } },
    { type: 'message', message: { role: 'assistant', usage: { input: 2_000, output: 300, cacheRead: 18_000 } } },
  ],
})
assert.equal(partialSessionUsage.cost, 0.02)
assert.equal(partialSessionUsage.costComplete, false, 'one unpriced provider response makes the cumulative cost unavailable to Thread Details')
let compactionCalls = 0
const runtime = {
  session: {
    isStreaming: false,
    isCompacting: false,
    model: { id: 'synthetic', provider: 'test', contextWindow: 400_000, auto_compact_token_limit: 256_000 },
    getContextUsage: () => ({ tokens: 260_000, contextWindow: 400_000, percent: 65 }),
    compact: async () => { compactionCalls += 1 },
  },
  contextCompactionThresholdTokens: 256_000,
  reasoningSummaryState: { value: 'auto' },
}
const compacted = await compactZyraContextBeforePrompt(runtime, 'Apply the requested UI correction.')
assert.equal(compacted.compacted, true)
assert.equal(compactionCalls, 1, 'the SDK compaction path invokes Pi before a projected 256k crossing')
assert.equal(runtime.reasoningSummaryState.value, 'auto', 'internal compaction restores the user-facing summary preference before the real turn')
assert.equal(setZyraReasoningSummary(runtime, 'detailed'), 'detailed')
assert.equal(runtime.reasoningSummaryState.value, 'detailed')
const failingRuntime = {
  session: {
    isStreaming: false,
    isCompacting: false,
    model: { id: 'synthetic', provider: 'test', contextWindow: 400_000, auto_compact_token_limit: 256_000 },
    getContextUsage: () => ({ tokens: 260_000, contextWindow: 400_000, percent: 65 }),
    compact: async () => { throw new Error('summary provider failed') },
  },
  contextCompactionThresholdTokens: 256_000,
  reasoningSummaryState: { value: 'detailed' },
}
await assert.rejects(() => compactZyraContextBeforePrompt(failingRuntime, 'Retry safely.'), /summary provider failed/)
assert.equal(failingRuntime.reasoningSummaryState.value, 'detailed', 'compaction failure cannot leak its internal concise mode into later turns')
let repeatedCompactionCalls = 0
const alreadyCompactedRuntime = {
  session: {
    isStreaming: false,
    isCompacting: false,
    model: { id: 'synthetic', provider: 'test', contextWindow: 400_000, auto_compact_token_limit: 256_000 },
    getContextUsage: () => ({ tokens: 260_000, contextWindow: 400_000, percent: 65 }),
    sessionManager: { getBranch: () => [{ type: 'compaction', id: 'latest-summary' }] },
    compact: async () => { repeatedCompactionCalls += 1 },
  },
  contextCompactionThresholdTokens: 256_000,
  reasoningSummaryState: { value: 'detailed' },
}
assert.equal((await compactZyraContextBeforePrompt(alreadyCompactedRuntime, 'Continue.')).compacted, false)
assert.equal(repeatedCompactionCalls, 0, 'an already-compacted branch cannot enter a failed compaction loop')
const ineligibleRuntime = {
  session: {
    isStreaming: false,
    isCompacting: false,
    model: { id: 'synthetic', provider: 'test', contextWindow: 400_000, auto_compact_token_limit: 256_000 },
    getContextUsage: () => ({ tokens: 260_000, contextWindow: 400_000, percent: 65 }),
    compact: async () => { throw new Error('Nothing to compact (session too small)') },
  },
  contextCompactionThresholdTokens: 256_000,
  reasoningSummaryState: { value: 'detailed' },
}
assert.equal((await compactZyraContextBeforePrompt(ineligibleRuntime, 'Continue.')).compacted, false)
assert.equal(ineligibleRuntime.reasoningSummaryState.value, 'detailed')

const root = fileURLToPath(new URL('..', import.meta.url))
const sdkSource = readFileSync(`${root}/src/zyra-sdk.mjs`, 'utf8')
const bridgeSource = readFileSync(`${root}/src/zyra-ui-bridge.mjs`, 'utf8')
const runtimeSource = readFileSync(`${root}/desktop/src/main/assistant/zyra-runtime.ts`, 'utf8')
const serviceSource = readFileSync(`${root}/desktop/src/main/assistant/service.ts`, 'utf8')
const sessionActionsSource = readFileSync(`${root}/desktop/src/main/assistant/service-session-actions.ts`, 'utf8')
const mainSource = readFileSync(`${root}/desktop/src/main/index.ts`, 'utf8')
const contextIndicatorSource = readFileSync(`${root}/desktop/src/renderer/src/pages/assistant/AssistantComposerContextIndicator.tsx`, 'utf8')
const composerViewSource = readFileSync(`${root}/desktop/src/renderer/src/pages/assistant/AssistantComposerView.tsx`, 'utf8')
const sharedPolicySource = readFileSync(`${root}/desktop/src/shared/assistant/runtime-policy.ts`, 'utf8')
const agentServerSource = readFileSync(`${root}/src/agent-server/server.mjs`, 'utf8')

assert.match(sdkSource, /createReasoningSummaryExtension\(options\.reasoningSummaryState\)/, 'every primary runtime installs the summary policy before provider requests')
assert.match(sdkSource, /await compactZyraContextBeforePrompt\(runtime, expanded\.text/, 'compaction runs before the user prompt enters the model context')
assert.ok(
  sdkSource.indexOf('const contextMessages = prepareZyraTurnContext') >= 0 &&
  sdkSource.indexOf('const contextMessages = prepareZyraTurnContext') < sdkSource.indexOf('await compactZyraContextBeforePrompt(runtime, expanded.text'),
  'query-dependent layered memory must be projected before automatic compaction'
)
assert.match(bridgeSource, /sdk\.setZyraReasoningSummary\(runtime, payload\.reasoningSummary\)/, 'the bridge applies the latest main-owned summary preference on every prompt')
assert.match(bridgeSource, /contextCompactionThresholdTokens: payload\.contextCompactionThresholdTokens/, 'the bridge passes the selected context limit into real prompt execution')
assert.match(bridgeSource, /async function handleAbort\(\) \{\s*const currentRuntime = runtime;[\s\S]{0,650}currentRuntime\?\.session\?\.abortCompaction\?\.\(\)/, 'Stop captures the requesting runtime and cancels its automatic compaction instead of waiting for its provider request')
assert.match(runtimeSource, /reasoningSummary: options\?\.reasoningSummary/, 'Desktop sends summary mode through the canonical agent server')
assert.match(runtimeSource, /modelCompactionOverrides: options\?\.modelCompactionOverrides/, 'Desktop sends per-model overrides through the canonical agent server')
assert.doesNotMatch(runtimeSource, /\bspawnSync\b/, 'assistant runtime availability checks must never block the Electron main loop')
assert.match(serviceSource, /const refreshDue = forceRefresh \|\| isAssistantModelCatalogRefreshDue\(this\.modelCatalogLastAttemptAt, Date\.now\(\), this\.modelCatalogLastRefreshFailed\)/, 'model discovery respects the catalog refresh interval and explicit refresh requests')
assert.match(serviceSource, /if \(!refreshDue\)[\s\S]{0,180}structuredClone\(knownModels\)/, 'model-list reads use the persisted catalog while a refresh is not due')
assert.match(runtimeSource, /serviceTier: input\.serviceTier,[\s\S]{0,80}reasoningSummary: 'auto'/, 'private Voice tasks retain their explicit non-UI summary policy')
assert.match(sessionActionsSource, /getRuntimePolicy\?\.\(\)/, 'prompt dispatch reads the authoritative runtime policy at send time')
assert.match(mainSource, /getRuntimePolicy: \(\) => setupServices\.preferences\.getAssistantRuntimePolicy\(\)/, 'runtime policy comes from main-owned device preferences')
assert.match(contextIndicatorSource, /resolveModelCompactionPolicy/, 'the composer meter uses the same provider/per-model policy as the runtime')
assert.match(contextIndicatorSource, /className="inline-flex size-\[32px\]/, 'the progress ring itself is the complete compact composer control')
assert.doesNotMatch(contextIndicatorSource, /h-\[30px\].*bg-white\/\[0\.025\]/, 'the context number has no larger decorative outer circle')
assert.match(composerViewSource, /<AssistantComposerContextIndicator/, 'the effective context limit must be mounted in the real composer')
assert.match(contextIndicatorSource, /auto-compacts at \$\{formatCompactMetric\(compactionLimitTokens\)\}/, 'the composer states the same effective boundary enforced by the runtime')
assert.match(agentServerSource, /outcome: interrupted \? "interrupted" : "failed"/, 'cancelling provider-backed compaction leaves the canonical turn interrupted instead of failed')
assert.match(sharedPolicySource, /DEFAULT_ASSISTANT_REASONING_SUMMARY[^=]*= 'detailed'/, 'renderer and runtime reasoning-summary defaults remain aligned')
assert.match(sharedPolicySource, /DEFAULT_ASSISTANT_CONTEXT_COMPACTION_THRESHOLD_TOKENS = 256_000/, 'legacy renderer and runtime saved values remain compatible without applying a global cap')

console.log('Assistant runtime policy contract: ok')
