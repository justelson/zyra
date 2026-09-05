// Maintainer-only asset refresh. Uses the checked-in catalog; no Plugin installation or execution.
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, copyFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MAX_LOGO_BYTES = 2 * 1024 * 1024
const MAX_TOTAL_BYTES = 16 * 1024 * 1024
const origins = new Set(['https://raw.githubusercontent.com', 'https://docs.lovable.dev', 'https://consensus.app', 'https://higgsfield.ai'])

export function validatePluginLogo(bytes, extension) {
  if (!bytes.length || bytes.length > MAX_LOGO_BYTES) throw new Error('Logo size is invalid.')
  if (extension === '.png') {
    if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) || bytes.toString('ascii', 12, 16) !== 'IHDR') throw new Error('Invalid PNG logo.')
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20)
    if (!width || !height || width > 4096 || height > 4096) throw new Error('PNG logo dimensions exceed limits.')
  } else if (extension === '.jpg' || extension === '.jpeg') {
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) throw new Error('Invalid JPEG logo.')
  } else if (extension === '.svg') {
    const svg = bytes.toString('utf8')
    // These bundled files render only as images, never inline DOM or executable markup.
    if (!/<svg(?:\s|>)/i.test(svg) || /<!DOCTYPE|<!ENTITY|<(?:[\w-]+:)?(?:script|foreignObject|iframe|object|embed)\b|\son[\w-]+\s*=|(?:href|src)\s*=\s*["'](?!#)|url\(\s*["']?(?!#)|javascript:/i.test(svg)) throw new Error('SVG logo contains unsupported content.')
  } else throw new Error('Unsupported logo format.')
}

async function downloadLogo(sourceUrl) {
  const url = new URL(sourceUrl)
  if (!origins.has(url.origin) || url.username || url.password || url.hash) throw new Error('Unapproved logo origin.')
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20_000), headers: { 'User-Agent': 'Zyra-Plugin-Logos', 'Accept-Encoding': 'identity' } })
  if (!response.ok) throw new Error(`Logo request failed: ${response.status} ${url.pathname}`)
  const chunks = []
  let total = 0
  for await (const chunk of response.body) {
    total += chunk.byteLength
    if (total > MAX_LOGO_BYTES) throw new Error('Logo exceeds its byte limit.')
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

export async function updatePluginLogos() {
  const catalog = JSON.parse(await readFile(join(root, 'desktop/src/shared/plugins/openai-directory.json'), 'utf8'))
  const overrides = JSON.parse(await readFile(join(root, 'desktop/src/shared/plugins/plugin-logo-overrides.json'), 'utf8'))
  if (!/^[a-f0-9]{40}$/.test(catalog.commit) || !Array.isArray(catalog.entries) || catalog.entries.length > 128) throw new Error('Invalid logo catalog.')
  const staging = await mkdtemp(join(tmpdir(), 'zyra-plugin-logos-'))
  const sources = []
  let totalBytes = 0
  try {
    for (let index = 0; index < catalog.entries.length; index += 4) {
      const outcomes = await Promise.allSettled(catalog.entries.slice(index, index + 4).map(async entry => {
        if (!/^[a-z0-9-]+$/.test(entry.name)) throw new Error('Invalid logo name.')
        const override = overrides[entry.name]
        const sourceUrl = entry.iconUrl || override?.sourceUrl
        if (!sourceUrl) throw new Error(`No official logo recorded for ${entry.name}.`)
        if (entry.iconUrl && !sourceUrl.startsWith(`https://raw.githubusercontent.com/openai/plugins/${catalog.commit}/plugins/${entry.name}/`)) throw new Error('Catalog logo is not commit-pinned.')
        const extension = extname(new URL(sourceUrl).pathname).toLowerCase()
        const bytes = await downloadLogo(sourceUrl)
        validatePluginLogo(bytes, extension)
        totalBytes += bytes.length
        if (totalBytes > MAX_TOTAL_BYTES) throw new Error('Logo bundle exceeds its byte limit.')
        const file = `${entry.name}${extension}`
        await writeFile(join(staging, file), bytes, { flag: 'wx' })
        return { name: entry.name, file, sourcePage: entry.iconUrl ? entry.sourceUrl : override.sourcePage, sourceUrl, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
      }))
      const failure = outcomes.find(result => result.status === 'rejected')
      if (failure) throw failure.reason
      sources.push(...outcomes.map(result => result.value))
    }
    const assets = join(root, 'desktop/src/renderer/src/assets/plugin-logos')
    await mkdir(assets, { recursive: true })
    for (const source of sources) await copyFile(join(staging, source.file), join(assets, source.file))
    await writeFile(join(assets, 'sources.json'), `${JSON.stringify({ catalogCommit: catalog.commit, logos: sources }, null, 2)}\n`)
    const urls = sources.map(source => `    '${source.name}': new URL('../../assets/plugin-logos/${source.file}', import.meta.url).href,`).join('\n')
    await writeFile(join(root, 'desktop/src/renderer/src/pages/plugins/bundled-plugin-logos.ts'), `// Generated by scripts/update-plugin-logos.mjs. Source attribution is beside the assets.\nconst logos: Readonly<Record<string, string>> = {\n${urls}\n}\n\nexport function bundledPluginLogo(name: string): string | null {\n    return Object.hasOwn(logos, name) ? logos[name] : null\n}\n`)
    console.log(`Bundled ${sources.length} official Plugin logos (${totalBytes} bytes); no Plugins installed or executed.`)
  } finally {
    await rm(staging, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await updatePluginLogos()
