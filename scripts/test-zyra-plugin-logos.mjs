import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { validatePluginLogo } from './update-plugin-logos.mjs'

const root = new URL('../', import.meta.url)
const assets = new URL('desktop/src/renderer/src/assets/plugin-logos/', root)
const catalog = JSON.parse(await readFile(new URL('desktop/src/shared/plugins/openai-directory.json', root), 'utf8'))
const sources = JSON.parse(await readFile(new URL('sources.json', assets), 'utf8'))
const moduleText = await readFile(new URL('desktop/src/renderer/src/pages/plugins/bundled-plugin-logos.ts', root), 'utf8')
assert.equal(sources.catalogCommit, catalog.commit)
assert.equal(sources.logos.length, catalog.entries.length)
assert.equal(new Set(sources.logos.map(logo => logo.name)).size, sources.logos.length)
let total = 0
for (const entry of catalog.entries) {
  const logo = sources.logos.find(logo => logo.name === entry.name)
  assert.ok(logo, `${entry.name} must have a bundled official logo`)
  assert.match(logo.file, /^[a-z0-9-]+\.(png|svg|jpe?g)$/)
  assert.ok(logo.sourceUrl.startsWith('https://'))
  assert.ok(logo.sourcePage.startsWith('https://'))
  if (entry.iconUrl) assert.equal(logo.sourceUrl, entry.iconUrl, 'existing brand images must be preserved')
  const bytes = await readFile(new URL(logo.file, assets))
  validatePluginLogo(bytes, logo.file.slice(logo.file.lastIndexOf('.')))
  assert.equal(bytes.length, logo.bytes)
  assert.equal(createHash('sha256').update(bytes).digest('hex'), logo.sha256)
  assert.ok(moduleText.includes(`'${entry.name}': new URL('../../assets/plugin-logos/${logo.file}', import.meta.url).href`), 'Vite must receive literal bundled asset URLs')
  total += bytes.length
}
assert.ok(total < 16 * 1024 * 1024)
assert.ok(!moduleText.includes('https://'), 'rendering never hotlinks logo hosts')
assert.throws(() => validatePluginLogo(Buffer.from('<html>failure</html>'), '.png'))
assert.throws(() => validatePluginLogo(Buffer.alloc(0), '.png'))
assert.throws(() => validatePluginLogo(Buffer.alloc(2 * 1024 * 1024 + 1), '.png'))
assert.throws(() => validatePluginLogo(Buffer.from('<svg><script>alert(1)</script></svg>'), '.svg'))
assert.throws(() => validatePluginLogo(Buffer.from('<svg><image href="https://example.test/tracker"/></svg>'), '.svg'))
assert.throws(() => validatePluginLogo(Buffer.from('<!DOCTYPE svg><svg/>'), '.svg'))
assert.throws(() => validatePluginLogo(Buffer.from('<svg onload="alert(1)"></svg>'), '.svg'))
validatePluginLogo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path fill="red" d="M0 0h1v1z"/></svg>'), '.svg')
console.log(`Plugin logos: ${sources.logos.length} bundled official images, complete catalog coverage, validated bytes and source attribution: ok`)
