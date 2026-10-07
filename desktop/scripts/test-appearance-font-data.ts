import assert from 'node:assert/strict'
import { appearanceFontBytes, serializeAppearanceFont } from '../src/renderer/src/lib/appearance-font-data'

const data = Uint8Array.from({ length: 20000 }, (_, index) => index % 256)
const face = { data, weight: '100 1000', style: 'normal' as const, format: 'woff2' as const, unicodeRange: 'U+0000-00FF, U+0131' }
const resource = serializeAppearanceFont('Zyra Managed example', [face])
assert(Object.isFrozen(resource), 'loaded resources are immutable and can be compared by reference')
const encoded = resource.css.match(/base64,([a-z\d+/=]+)"/i)?.[1]
assert(encoded)
assert.deepEqual(new Uint8Array(Buffer.from(encoded, 'base64')), data, 'chunked serialization preserves every byte')
assert(resource.css.includes('font-weight:100 1000') && resource.css.includes('unicode-range:U+0000-00FF, U+0131'))
assert.deepEqual(appearanceFontBytes({ type: 'Buffer', data: [0, 127, 255] }), new Uint8Array([0, 127, 255]), 'legacy JSON bytes remain supported')
assert.throws(() => appearanceFontBytes({ data: [0, 256] }))
assert.throws(() => appearanceFontBytes({ data: [0, '12'] }))
for (const invalid of [
    { weight: '400;src:url(https://invalid)' }, { unicodeRange: 'U+00FF;}body{}' },
    { style: 'normal;src:url(https://invalid)' }, { format: 'unknown' }
]) assert.throws(() => serializeAppearanceFont('Example', [{ ...face, ...invalid } as typeof face]), 'untrusted descriptor syntax cannot become CSS')
const escaped = serializeAppearanceFont('Example"</style><script>', [face])
assert(!escaped.css.includes('</style>') && !escaped.css.includes('<script>'), 'font family names cannot close the trusted style element')
console.log('Appearance font data: immutable resources, complete byte serialization, legacy bytes and descriptor injection rejection passed')
