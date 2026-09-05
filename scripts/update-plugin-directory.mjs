// Maintainer-only metadata refresh. Downloads JSON, never Plugin code or assets.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseZyraPluginManifestText, parseZyraPluginMarketplaceText } from '../src/plugins/plugin-contract.mjs'

const output = resolve(dirname(fileURLToPath(import.meta.url)), '../desktop/src/shared/plugins/openai-directory.json')
const descriptionOverrides = JSON.parse(await readFile(new URL('../desktop/src/shared/plugins/plugin-description-overrides.json', import.meta.url), 'utf8'))
for (const [name, value] of Object.entries(descriptionOverrides)) {
  if (!/^[a-z0-9-]+$/.test(name) || typeof value?.longDescription !== 'string' || !value.longDescription.trim() || value.longDescription.length > 3000) {
    throw new Error('Invalid Plugin description override.')
  }
}
function applyDescription(entry) {
  const override = descriptionOverrides[entry.name]
  return { ...entry, longDescription: override?.longDescription || entry.longDescription, longDescriptionSource: override ? 'zyra' : entry.longDescriptionSource || 'publisher' }
}
if (process.argv.includes('--apply-descriptions')) {
  const catalog = JSON.parse(await readFile(output, 'utf8'))
  if (!Array.isArray(catalog.entries)) throw new Error('Invalid saved Plugin directory.')
  await writeFile(output, `${JSON.stringify({ ...catalog, entries: catalog.entries.map(applyDescription) }, null, 2)}\n`)
  console.log('Plugin descriptions updated; upstream snapshot and package pins unchanged.')
  process.exit(0)
}

async function boundedText(url, maxBytes) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000), redirect: 'error', headers: { 'User-Agent': 'Zyra-Plugin-Directory' } })
  if (!response.ok) throw new Error(`Directory metadata request failed: ${response.status}`)
  const chunks = []
  let total = 0
  for await (const chunk of response.body) {
    total += chunk.byteLength
    if (total > maxBytes) throw new Error('Directory metadata exceeds its byte limit.')
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

const commit = JSON.parse(await boundedText('https://api.github.com/repos/openai/plugins/commits/main', 2 * 1024 * 1024)).sha
if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid catalog commit.')
const rawRoot = `https://raw.githubusercontent.com/openai/plugins/${commit}`
const published = JSON.parse(await boundedText(`${rawRoot}/.agents/plugins/marketplace.json`, 2 * 1024 * 1024))
if (!Array.isArray(published.plugins) || published.plugins.length > 512) throw new Error('Invalid marketplace entries.')
// External package hosts are outside this metadata source. Keep the omission explicit.
const localEntries = published.plugins.filter((entry) => entry.source?.source === 'local')
const externalEntryCount = published.plugins.length - localEntries.length
const marketplace = parseZyraPluginMarketplaceText(JSON.stringify({ ...published, plugins: localEntries }))
const entries = []
for (let index = 0; index < marketplace.plugins.length; index += 4) {
  const batch = await Promise.all(marketplace.plugins.slice(index, index + 4).map(async (entry) => {
    const path = entry.source.path.replace(/^\.\//, '')
    if (!/^plugins\/[a-z0-9-]+$/.test(path)) throw new Error('Unexpected catalog package path.')
    const manifest = parseZyraPluginManifestText(await boundedText(`${rawRoot}/${path}/.codex-plugin/plugin.json`, 64 * 1024))
    if (manifest.name !== entry.name) throw new Error('Catalog name does not match its manifest.')
    const iconPath = manifest.interface.logo || manifest.interface.composerIcon || manifest.interface.logoDark
    const iconUrl = iconPath ? `${rawRoot}/${path}/${iconPath.replace(/^\.\//, '')}` : null
    return applyDescription({
      name: manifest.name,
      displayName: manifest.interface.displayName || manifest.name,
      version: manifest.version,
      longDescription: manifest.interface.longDescription || manifest.description,
      websiteUrl: manifest.interface.websiteUrl || manifest.homepageUrl,
      privacyPolicyUrl: manifest.interface.privacyPolicyUrl,
      termsOfServiceUrl: manifest.interface.termsOfServiceUrl,
      description: manifest.interface.shortDescription || manifest.description,
      category: entry.category || manifest.interface.category || 'Other',
      publisher: manifest.interface.developerName || manifest.author?.name || 'Not provided',
      license: manifest.license,
      iconUrl,
      hasSkills: Boolean(manifest.contributions.skills),
      hasMcp: Boolean(manifest.contributions.mcp),
      hasApps: Boolean(manifest.contributions.apps),
      installation: entry.policy.installation,
      sourceUrl: `https://github.com/openai/plugins/tree/${commit}/${path}`
    })
  }))
  entries.push(...batch)
}
await mkdir(dirname(output), { recursive: true })
await writeFile(output, `${JSON.stringify({ version: 1, source: 'https://github.com/openai/plugins', commit, checkedAt: new Date().toISOString(), externalEntryCount, entries }, null, 2)}\n`)
console.log(`Plugin directory metadata: ${entries.length} entries at ${commit}; no packages downloaded.`)
