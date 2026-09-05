import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { downloadCatalogPlugin } from '../src/plugins/plugin-download.mjs'

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
