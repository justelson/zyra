import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ZYRA_PLUGIN_LIMITS as limits, ZyraPluginValidationError } from './plugin-contract.mjs'

const SHA = /^[a-f0-9]{40}$/
const METADATA_BYTES = 2 * 1024 * 1024
const API = 'https://api.github.com/repos/openai/plugins/git/trees/'
const fail = (code, message) => { throw new ZyraPluginValidationError(code, message) }

async function ordinaryDirectories(directory) {
  for (let current = path.resolve(directory); ; current = path.dirname(current)) {
    try {
      const info = await lstat(current)
      if (info.isSymbolicLink() || !info.isDirectory()) fail('PLUGIN_DOWNLOAD_STORAGE', 'Plugin storage must use ordinary directories.')
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    if (path.dirname(current) === current) break
  }
}

function safePath(value) {
  if (typeof value !== 'string' || !value || value.length > limits.maxPathCharacters || value.includes('\\')) fail('PLUGIN_DOWNLOAD_PATH', 'Invalid Plugin file path.')
  const parts = value.split('/')
  if (parts.length > limits.maxDepth || parts.some(part => !part || part === '.' || part === '..' || /[\x00-\x1f\x7f<>:"|?*]/.test(part) || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(part))) {
    fail('PLUGIN_DOWNLOAD_PATH', 'Plugin contains an unsupported or escaping file path.')
  }
  return parts
}

async function boundedRequest(url, maxBytes, signal, fetchImpl) {
  const request = new AbortController()
  const timeout = setTimeout(() => request.abort(), 20_000)
  const combined = AbortSignal.any([signal, request.signal])
  let rejectAbort
  const aborted = new Promise((_, reject) => { rejectAbort = reject })
  const onAbort = () => rejectAbort(combined.reason || new DOMException('Plugin download aborted.', 'AbortError'))
  combined.addEventListener('abort', onAbort, { once: true })
  let reader
  try {
    combined.throwIfAborted()
    const pending = fetchImpl(url, { signal: combined, redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', headers: { 'User-Agent': 'Zyra-Plugin-Installer', 'Accept-Encoding': 'identity' } })
    pending.then(response => { if (combined.aborted) void response.body?.cancel().catch(() => undefined) }, () => undefined)
    const response = await Promise.race([pending, aborted])
    if (!response.ok || response.redirected || !response.body) fail('PLUGIN_DOWNLOAD_HTTP', `Plugin download failed (${response.status}). Try again.`)
    const encoding = response.headers.get('content-encoding')
    if (encoding && encoding !== 'identity') fail('PLUGIN_DOWNLOAD_ENCODING', 'Plugin server did not supply the requested uncompressed bytes.')
    const declared = response.headers.get('content-length')
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) fail('PLUGIN_DOWNLOAD_SIZE', 'Plugin download exceeds its size limit.')
    reader = response.body.getReader()
    const chunks = []
    let total = 0
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), aborted])
      if (done) break
      total += value.byteLength
      if (total > maxBytes) fail('PLUGIN_DOWNLOAD_SIZE', 'Plugin download exceeds its size limit.')
      chunks.push(Buffer.from(value))
    }
    combined.throwIfAborted()
    return Buffer.concat(chunks, total)
  } finally {
    combined.removeEventListener('abort', onAbort)
    clearTimeout(timeout)
    request.abort()
    if (reader) { void reader.cancel().catch(() => undefined); reader.releaseLock() }
  }
}

async function tree(ref, recursive, signal, fetchImpl) {
  if (!SHA.test(ref)) fail('PLUGIN_DOWNLOAD_TREE', 'Invalid catalog tree identity.')
  const bytes = await boundedRequest(`${API}${ref}${recursive ? '?recursive=1' : ''}`, METADATA_BYTES, signal, fetchImpl)
  let result
  try { result = JSON.parse(bytes.toString('utf8')) } catch { fail('PLUGIN_DOWNLOAD_TREE', 'Invalid catalog tree response.') }
  if (!result || result.truncated !== false || !Array.isArray(result.tree) || result.tree.length > limits.maxPackageFiles * (limits.maxDepth + 1)) fail('PLUGIN_DOWNLOAD_TREE', 'Catalog tree is incomplete or exceeds its limit.')
  return result.tree
}

function directorySha(entries, name) {
  const matches = entries.filter(entry => entry.path === name)
  if (matches.length !== 1 || matches[0].type !== 'tree' || matches[0].mode !== '040000' || !SHA.test(matches[0].sha)) fail('PLUGIN_DOWNLOAD_TREE', 'Catalog package directory is unavailable.')
  return matches[0].sha
}

function packageFiles(entries) {
  const paths = new Map()
  const files = []
  let total = 0
  for (const entry of entries) {
    const parts = safePath(entry.path)
    const key = entry.path.normalize('NFKC').toLowerCase()
    if (paths.has(key)) fail('PLUGIN_DOWNLOAD_PATH', 'Plugin file names collide on this device.')
    if (!SHA.test(entry.sha)) fail('PLUGIN_DOWNLOAD_TREE', 'Invalid Plugin file identity.')
    if (entry.type === 'tree' && entry.mode === '040000') {
      paths.set(key, { path: entry.path, directory: true })
    } else if (entry.type === 'blob' && ['100644', '100755'].includes(entry.mode)) {
      if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > limits.maxFileBytes) fail('PLUGIN_DOWNLOAD_SIZE', 'Plugin file exceeds its size limit.')
      total += entry.size
      files.push({ ...entry, parts })
      paths.set(key, { path: entry.path, directory: false })
    } else fail('PLUGIN_DOWNLOAD_KIND', 'Plugin links, submodules, and special files are not supported.')
  }
  if (!files.length || files.length > limits.maxPackageFiles || total > limits.maxPackageBytes) fail('PLUGIN_DOWNLOAD_SIZE', 'Plugin package exceeds its size limit.')
  for (const entry of entries) {
    const parts = entry.path.split('/')
    for (let index = 1; index < parts.length; index++) {
      const parent = parts.slice(0, index).join('/')
      const node = paths.get(parent.normalize('NFKC').toLowerCase())
      if (!node?.directory || node.path !== parent) fail('PLUGIN_DOWNLOAD_PATH', 'Plugin directory paths collide or are incomplete.')
    }
  }
  if (!files.some(file => file.path === '.codex-plugin/plugin.json')) fail('PLUGIN_DOWNLOAD_TREE', 'Plugin manifest is missing.')
  return files
}

export async function downloadCatalogPlugin({ stagingRoot, entry, commit, signal = new AbortController().signal, fetchImpl = fetch }) {
  if (!SHA.test(commit) || !entry || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.name) || !entry.hasSkills || entry.installation === 'BLOCKED') fail('PLUGIN_DOWNLOAD_SOURCE', 'This Plugin cannot be downloaded from the catalog.')
  const sourceLocator = `https://github.com/openai/plugins/tree/${commit}/plugins/${entry.name}`
  if (entry.sourceUrl !== sourceLocator) fail('PLUGIN_DOWNLOAD_SOURCE', 'Plugin catalog provenance does not match its release.')
  const operation = new AbortController()
  const combined = AbortSignal.any([signal, operation.signal])
  const timeout = setTimeout(() => operation.abort(), 120_000)
  let packageRoot = null
  try {
    combined.throwIfAborted()
    await ordinaryDirectories(stagingRoot)
    await mkdir(stagingRoot, { recursive: true, mode: 0o700 })
    const root = await tree(commit, false, combined, fetchImpl)
    const plugins = await tree(directorySha(root, 'plugins'), false, combined, fetchImpl)
    const entries = await tree(directorySha(plugins, entry.name), true, combined, fetchImpl)
    const files = packageFiles(entries)
    combined.throwIfAborted()
    packageRoot = path.join(path.resolve(stagingRoot), `package-${randomUUID()}`)
    await ordinaryDirectories(stagingRoot)
    await mkdir(packageRoot, { mode: 0o700 })
    let next = 0
    const worker = async () => {
      for (;;) {
        combined.throwIfAborted()
        const file = files[next++]
        if (!file) return
        const url = `https://raw.githubusercontent.com/openai/plugins/${commit}/plugins/${entry.name}/${file.parts.map(encodeURIComponent).join('/')}`
        const bytes = await boundedRequest(url, file.size, combined, fetchImpl)
        const digest = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
        if (bytes.length !== file.size || digest !== file.sha) fail('PLUGIN_DOWNLOAD_DIGEST', 'Downloaded Plugin bytes do not match the pinned catalog release.')
        const destination = path.join(packageRoot, ...file.parts)
        await ordinaryDirectories(path.dirname(destination))
        await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 })
        combined.throwIfAborted()
        await writeFile(destination, bytes, { flag: 'wx', mode: 0o600 })
      }
    }
    // A failing worker aborts its sibling. Both settle before cleanup begins.
    let failure
    await Promise.allSettled([worker(), worker()].map(work => work.catch(error => { failure ??= error; operation.abort(); throw error })))
    if (failure) throw failure
    combined.throwIfAborted()
    return { packageRoot, sourceLocator }
  } catch (error) {
    operation.abort()
    if (packageRoot) await rm(packageRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    throw error
  } finally { clearTimeout(timeout); operation.abort() }
}
