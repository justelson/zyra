import assert from 'node:assert/strict'
import {
    emptyAssistantContentParts,
    extractAssistantEventContentParts,
    extractAssistantEventMessagePhase
} from '../src/main/assistant/assistant-message-content'

const signedPhase = (phase: string) => ({ type: 'text', text: '', textSignature: JSON.stringify({ v: 1, id: 'provider-output', phase }) })
assert.equal(extractAssistantEventMessagePhase({ message: { role: 'assistant', content: [signedPhase('final_answer')] } }), 'final_answer')
assert.equal(extractAssistantEventMessagePhase({ message: { phase: 'commentary' }, assistantMessageEvent: { partial: { content: [signedPhase('commentary'), signedPhase('final_answer')] } } }), 'final_answer', 'the newest partial slot is authoritative at text_start')
assert.equal(extractAssistantEventMessagePhase({ message: { content: [{ type: 'text', text: '<final_answer>hello</final_answer>' }] } }), undefined, 'visible text cannot spoof metadata')
assert.equal(extractAssistantEventMessagePhase({ message: { content: [{ type: 'text', textSignature: '{broken' }] } }), undefined)
assert.equal(extractAssistantEventMessagePhase({ message: { content: [signedPhase('unknown')] } }), undefined)

const canonicalPrefix = 'Browser requests are bounded by a single'
const canonicalMidstreamText = `${canonicalPrefix} 12-second timer`
const staleLongerMessageText = `${canonicalPrefix}12-second timer even after a renderer round trip`
let current = emptyAssistantContentParts()

current = extractAssistantEventContentParts({
    message: { role: 'assistant', content: [{ type: 'text', text: canonicalPrefix }] },
    assistantMessageEvent: {
        type: 'text_delta',
        delta: canonicalPrefix,
        partial: { content: [{ type: 'text', text: canonicalPrefix }] }
    }
}, current, 'message_update')
assert.equal(current.text, canonicalPrefix)

current = extractAssistantEventContentParts({
    message: { role: 'assistant', content: [{ type: 'text', text: staleLongerMessageText }] },
    assistantMessageEvent: {
        type: 'text_delta',
        delta: ' 12-second timer',
        partial: { content: [{ type: 'text', text: canonicalMidstreamText }] }
    }
}, current, 'message_update')
assert.equal(
    current.text,
    canonicalMidstreamText,
    'a cumulative Pi partial outranks a longer stale message snapshot during streaming'
)

const canonicalProviderText = 'Browser requests are bounded by a single 12-second timer, and trusted registration completes the request.'
current = extractAssistantEventContentParts({
    message: { role: 'assistant', content: [{ type: 'text', text: `${canonicalProviderText} late.` }] },
    assistantMessageEvent: {
        type: 'text_delta',
        delta: `${canonicalProviderText} late.`,
        partial: { content: [{ type: 'text', text: `${canonicalProviderText} late.` }] }
    }
}, current, 'message_update')
assert.equal(current.text, `${canonicalProviderText} late.`)
current = extractAssistantEventContentParts({
    message: { role: 'assistant', content: [{ type: 'text', text: canonicalProviderText }] }
}, current, 'message_end')
assert.equal(
    current.text,
    canonicalProviderText,
    'the authoritative Pi message_end repairs a longer malformed partial'
)

const thought = '**Checking the stream**'
const narration = 'The response remains public and exact.'
let separated = extractAssistantEventContentParts({
    message: { role: 'assistant', content: [{ type: 'text', text: thought }] },
    assistantMessageEvent: {
        type: 'thinking_delta',
        delta: thought,
        partial: { content: [{ type: 'text', text: thought }] }
    }
}, emptyAssistantContentParts(), 'message_update')
separated = { ...separated, thinking: separated.text, text: '', hasThinkingBlock: true }
separated = extractAssistantEventContentParts({
    message: { role: 'assistant', content: [{ type: 'text', text: `${thought}${narration}` }] },
    assistantMessageEvent: {
        type: 'text_delta',
        delta: narration,
        partial: { content: [{ type: 'text', text: `${thought}${narration}` }] }
    }
}, separated, 'message_update')
assert.equal(separated.thinking, thought)
assert.equal(separated.text, narration, 'a cumulative text snapshot must not leak prior thinking into narration')

const deltaOnly = extractAssistantEventContentParts({
    assistantMessageEvent: { type: 'text_delta', delta: 'delta-only transport' }
}, emptyAssistantContentParts(), 'message_update')
assert.equal(deltaOnly.text, 'delta-only transport', 'delta-only providers retain their compatibility fallback')

console.log('Assistant canonical message content contracts passed.')
