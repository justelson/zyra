import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { downloadCatalogPlugin, PluginDownloadCache } from '../src/plugins/plugin-download.mjs'

const commit = 'a'.repeat(40), plugins = 'b'.repeat(40), packageSha = 'c'.repeat(40)
const entry = { name: 'test-plugin', hasSkills: true, installation: 'AVAILABLE', sourceUrl: `https://github.com/openai/plugins/tree/${commit}/plugins/test-plugin` }
const source = new Map([
  ['.codex-plugin/plugin.json', Buffer.from('{"name":"test-plugin","version":"1.0.0"}')],
  ['skills/test/SKILL.md', Buffer.from('---\nname: test\ndescription: Test Skill.\n---\nNever execute this fixture.')],
  ['must-not-run.js', Buffer.from('throw new Error("Package code must never run")')],
])
const dirs = ['.codex-plugin', 'skills', 'skills/test'].map(p => ({ path: p, type: 'tree', mode: '040000', sha: 'd'.repeat(40) }))
const files = [...source].map(([p, bytes]) => ({ path: p, type: 'blob', mode: '100644', size: bytes.length, sha: createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') }))
const root = await mkdtemp(path.join(tmpdir(), 'zyra-plugin-download-'))
const calls = []
function fetcher({ entries = [...dirs, ...files], truncated = false, mutateBytes = false, status = 200, redirected = false, controller } = {}) {
  return async (url, options) => {
    calls.push(url)
    assert.equal(options.redirect, 'error')
    assert.equal(options.credentials, 'omit')
    assert.equal(options.headers['Accept-Encoding'], 'identity', 'wire bytes must match the Git file size')
    assert.ok(options.signal)
    if (url.startsWith('https://api.github.com/repos/openai/plugins/git/trees/')) {
      const ref = url.split('/').at(-1).split('?')[0]
      const tree = ref === commit ? [{ path: 'plugins', mode: '040000', type: 'tree', sha: plugins }] : ref === plugins ? [{ path: entry.name, mode: '040000', type: 'tree', sha: packageSha }] : entries
      return new Response(JSON.stringify({ tree, truncated: ref === packageSha ? truncated : false }))
    }
    assert.ok(url.startsWith(`https://raw.githubusercontent.com/openai/plugins/${commit}/plugins/test-plugin/`))
    if (controller) { controller.abort(); throw new DOMException('Cancelled', 'AbortError') }
    const relative = url.split('/plugins/test-plugin/')[1].split('/').map(decodeURIComponent).join('/')
    const response = new Response(mutateBytes ? Buffer.from('corrupt') : source.get(relative), { status })
    if (redirected) Object.defineProperty(response, 'redirected', { value: true })
    return response
  }
}
const run = options => downloadCatalogPlugin({ stagingRoot: root, entry, commit, fetchImpl: fetcher(options), signal: options?.controller?.signal })
async function rejects(options, pattern) {
  await assert.rejects(() => run(options), pattern)
  assert.deepEqual(await readdir(root), [], 'failed downloads leave no package directory')
}
try {
  const result = await run()
  assert.equal(result.sourceLocator, entry.sourceUrl)
  assert.ok(path.dirname(result.packageRoot) === root)
  for (const [p, bytes] of source) assert.deepEqual(await readFile(path.join(result.packageRoot, p)), bytes)
  assert.equal(calls.length, 6)
  await rm(result.packageRoot, { recursive: true })
  const cache = new PluginDownloadCache()
  const progress = []
  const cachedRun = (options = {}) => downloadCatalogPlugin({ stagingRoot: root, entry, commit, cache, fetchImpl: fetcher(), onProgress: value => progress.push(value), ...options })
  let checkpoint = calls.length
  const cold = await cachedRun()
  assert.equal(calls.length - checkpoint, 6, 'cold download fetches three trees and three files')
  assert.equal(progress[0].phase, 'metadata')
  assert.equal(progress[0].completedFiles, 0, 'progress snapshots cannot be mutated later')
  assert.equal(progress.at(-1).completedFiles, files.length)
  assert.equal(progress.at(-1).completedBytes, files.reduce((sum, file) => sum + file.size, 0))
  await rm(cold.packageRoot, { recursive: true })
  checkpoint = calls.length
  const warm = await cachedRun()
  assert.equal(calls.length - checkpoint, 3, 'warm downloads refresh tree metadata but fetch no file bodies')
  assert.ok(calls.slice(checkpoint).every(url => url.startsWith('https://api.github.com/')), 'only hash-verifiable blobs are reused')
  assert.equal(progress.at(-1).cacheHits, files.length)
  for (const [p, bytes] of source) assert.deepEqual(await readFile(path.join(warm.packageRoot, p)), bytes)
  await rm(warm.packageRoot, { recursive: true })
  const key = `blob:${files[0].sha}`
  const copy = cache.get(key)
  copy.fill(0)
  assert.notDeepEqual(cache.get(key), copy, 'callers cannot mutate cached bytes through get')
  cache.set(key, Buffer.from('corrupt'))
  checkpoint = calls.length
  const repaired = await cachedRun()
  assert.equal(calls.length - checkpoint, 4, 'metadata stays fresh and a corrupt blob is re-fetched against its pinned identity')
  assert.deepEqual(await readFile(path.join(repaired.packageRoot, files[0].path)), source.get(files[0].path))
  await rm(repaired.packageRoot, { recursive: true })
  cache.clear()
  const partialAbort = new AbortController()
  await assert.rejects(() => cachedRun({ signal: partialAbort.signal, onProgress: value => { if (value.completedFiles === 1) partialAbort.abort() } }), /abort/i)
  assert.deepEqual(await readdir(root), [], 'cancelled staging is removed even though verified cache entries survive')
  checkpoint = calls.length
  const retried = await cachedRun()
  assert.ok(calls.length - checkpoint < 3 + files.length, 'retry reuses complete verified files while fetching fresh metadata')
  assert.ok(progress.at(-1).cacheHits > 0)
  await rm(retried.packageRoot, { recursive: true })
  cache.clear()
  assert.equal(cache.bytes, 0)
  let clock = 0
  const tiny = new PluginDownloadCache({ maxBytes: 4, maxEntries: 2, ttlMs: 10, now: () => clock })
  const firstKey = `blob:${'1'.repeat(40)}`, secondKey = `blob:${'2'.repeat(40)}`, thirdKey = `blob:${'3'.repeat(40)}`
  const input = Buffer.from('aa')
  tiny.set(firstKey, input); input.fill(0)
  assert.equal(tiny.get(firstKey).toString(), 'aa', 'set also copies the input')
  tiny.set(secondKey, Buffer.from('bb')); tiny.get(firstKey); tiny.set(thirdKey, Buffer.from('cc'))
  assert.equal(tiny.get(secondKey), null, 'least recently used entries are evicted within both bounds')
  assert.equal(tiny.bytes, 4)
  assert.equal(tiny.set(secondKey, Buffer.alloc(5)), false)
  assert.equal(tiny.set('untrusted-key', Buffer.alloc(1)), false)
  assert.equal(tiny.set(`tree:${'1'.repeat(40)}:1`, Buffer.alloc(1)), false, 'unverifiable tree metadata cannot enter the cache')
  clock = 11
  assert.equal(tiny.get(firstKey), null)
  assert.equal(tiny.get(thirdKey), null)
  assert.equal(tiny.bytes, 0)
  console.log('Plugin cache: file downloads 3 -> 0, metadata requests remain 3; bounded TTL/LRU, copied bytes, corrupt-hit revalidation and cancelled-download reuse: ok')
  await rejects({ truncated: true }, /incomplete/)
  await rejects({ mutateBytes: true }, /match|size|abort/i)
  await rejects({ status: 503 }, /failed|abort/i)
  await rejects({ redirected: true }, /failed|abort/i)
  await rejects({ controller: new AbortController() }, /Cancelled|abort/i)
  const stalledAbort = new AbortController()
  const normalFetch = fetcher()
  const stalled = downloadCatalogPlugin({ stagingRoot: root, entry, commit, signal: stalledAbort.signal, fetchImpl: async (url, options) => {
    if (url.startsWith('https://api.github.com/')) return normalFetch(url, options)
    setTimeout(() => stalledAbort.abort(), 10)
    return new Response(new ReadableStream({ start() {}, cancel() { return new Promise(() => {}) } }))
  } })
  await assert.rejects(() => stalled, /abort/i)
  assert.deepEqual(await readdir(root), [], 'a stuck response cancellation cannot block owned-directory cleanup')
  for (const bad of ['../outside', '/absolute', 'C:/drive', 'skills\\outside', 'skills/file:stream', 'skills/CON.txt', 'skills/trailing.']) {
    await rejects({ entries: [...dirs, ...files, { ...files[0], path: bad }] }, /path|unsupported/)
  }
  for (const mode of ['120000', '160000', '020000']) await rejects({ entries: [...dirs, ...files, { ...files[0], path: 'link', mode }] }, /links|special/)
  await rejects({ entries: [...dirs, ...files, { ...files[0], path: 'SKILLS/test/extra.md' }] }, /collide|incomplete/)
  await rejects({ entries: [...dirs, ...files, { ...files[0], path: '.codex-plugin/PLUGIN.JSON' }] }, /collide/)
  await rejects({ entries: [...dirs, ...files, { ...files[0], path: 'huge', size: 16 * 1024 * 1024 + 1 }] }, /size/)
  await rejects({ entries: [{ ...dirs[0] }, { ...files[0], path: '.codex-plugin' }] }, /collide/)
  await assert.rejects(() => downloadCatalogPlugin({ stagingRoot: root, entry: { ...entry, sourceUrl: 'https://example.com/package' }, commit, fetchImpl: () => { throw Error('Network must not run') } }), /provenance/)
  await assert.rejects(() => downloadCatalogPlugin({ stagingRoot: root, entry: { ...entry, installation: 'BLOCKED' }, commit }), /cannot/)
  assert.deepEqual(await readdir(root), [])
  console.log('Pinned Plugin downloader: bounded paths, modes, bytes, provenance, cancellation, no execution, and cleanup: ok')
} finally { await rm(root, { recursive: true, force: true }) }
