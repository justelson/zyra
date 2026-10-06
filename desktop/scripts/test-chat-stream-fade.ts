import assert from 'node:assert/strict'
import { advanceStreamingText, type StreamingTextState } from '../src/renderer/src/components/ui/markdown/StreamingText'
let state: StreamingTextState = { value: 'Saved prefix', settled: 'Saved prefix', pieces: [] }
const append = (value: string) => {
    state = advanceStreamingText(state, value)
    assert.equal(state.settled + state.pieces.map(part => part.text).join(''), value, 'Fading never loses or repeats text')
    assert(state.pieces.length <= 64, 'Token nodes stay bounded throughout long responses')
}
append('Saved prefix grows')
assert.equal(state.settled, 'Saved prefix', 'Existing prefix is never animated again')
assert.equal(state.pieces.map(part => part.text).join(''), ' grows')
const keys = state.pieces.map(part => part.start)
append('Saved prefix grows again')
assert.deepEqual(state.pieces.slice(0, keys.length).map(part => part.start), keys, 'Existing token DOM keys stay stable')
for (let i = 0; i < 300; i++) append(state.value + ` delta${i}`)
append(state.value + 'x'.repeat(100000))
assert.equal(state.pieces.length, 64, 'A large single delta keeps only 64 token records')
append('Replacement text')
assert.equal(state.pieces.length, 0, 'Authoritative corrections snap, not replay')
state = { value: '', settled: '', pieces: [] }
append('👩'); append('👩‍'); append('👩‍🚀')
assert.deepEqual(state.pieces.map(part => part.text), ['👩‍🚀'], 'An emoji joined across deltas remains one grapheme')
state = { value: 'a', settled: 'a', pieces: [] }; append('á')
assert.deepEqual(state.pieces.map(part => part.text), ['á'], 'Combining accents are not split across spans')
console.log('Stream fade: new suffix only, stable keys, bounded token nodes, corrections and cross-delta graphemes passed')
