import assert from 'node:assert/strict'
import { readPerformanceSamples, recordPerformanceSample, recordStreamQueue, startEditorMeasurement } from '../src/shared/performance-samples'
import { providerFeatures, providerForAppFeature, RECOMMENDED_PROVIDER } from '../src/shared/assistant/provider-features'
import { publishRuntimeActivation, readRuntimeActivation, subscribeRuntimeActivation } from '../src/main/assistant/runtime-activation'
let now = 100
const editor = startEditorMeasurement(() => now)
now = 112; editor.readable(); now = 220; editor.interactive(); editor.interactive()
assert.deepEqual(readPerformanceSamples().slice(-2).map(s => [s.stage,s.elapsedMs]), [['readable',12],['interactive',120]])
recordStreamQueue([{occurredAt:new Date(900).toISOString()},{occurredAt:new Date(950).toISOString()}],1000)
assert.equal(readPerformanceSamples().at(-1)?.elapsedMs,100)
assert.equal(readPerformanceSamples().at(-1)?.count,2)
for(let i=0;i<500;i++) recordPerformanceSample({area:'stream',stage:'queue-flush',elapsedMs:i})
assert.equal(readPerformanceSamples().length,120)
for(const provider of ['opencode','anthropic','custom-example']) { assert.equal(providerFeatures(provider).voice,null);assert.equal(providerFeatures(provider).subscriptionUsage,false) }
assert.equal(providerForAppFeature('voice'),'openai-codex');assert.equal(providerForAppFeature('subscriptionUsage'),'openai-codex');assert.equal(RECOMMENDED_PROVIDER,'openai-codex')
const phases:string[]=[];const unsubscribe=subscribeRuntimeActivation(s=>phases.push(s.phase))
for(const phase of ['checking','waiting','restarting','ready'] as const)publishRuntimeActivation({phase})
unsubscribe();publishRuntimeActivation({phase:'idle'})
assert.deepEqual(phases,['checking','waiting','restarting','ready']);assert.equal(readRuntimeActivation().phase,'idle')
console.log('Bounded content-free timings, provider features and runtime status lifecycle passed')
