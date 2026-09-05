import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readFileSync } from 'node:fs'
import { AssistantPluginRegistry } from '../src/main/assistant/assistant-plugin-registry'
import type { AssistantPluginDownload } from '../src/shared/assistant/contracts'

const root = await mkdtemp(join(tmpdir(), 'zyra-managed-plugin-test-'))
let version = '1.0.0'
let shouldFail = false
let hold = false
let downloadedRoot = ''
async function packageFiles(dir: string, name: string) {
    await mkdir(join(dir, '.codex-plugin'), { recursive: true })
    await mkdir(join(dir, 'skills/test'), { recursive: true })
    await writeFile(join(dir, '.codex-plugin/plugin.json'), JSON.stringify({ name, version, description: 'Fixture package.', skills: './skills' }))
    await writeFile(join(dir, 'skills/test/SKILL.md'), `---\nname: fixture-test\ndescription: Test fixture Skill.\n---\nRelease ${version}.`)
    await writeFile(join(dir, 'must-not-run.js'), 'throw new Error("Never execute installed packages")')
}
const registry = new AssistantPluginRegistry({ rootPath: join(root, 'registry'), download: async ({ stagingRoot, entry, commit, signal }) => {
    if (shouldFail) throw Error('Fixture network failure')
    if (hold) await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true }))
    signal.throwIfAborted()
    downloadedRoot = await mkdtemp(join(stagingRoot, 'package-'))
    await packageFiles(downloadedRoot, entry.name)
    return { packageRoot: downloadedRoot, sourceLocator: `https://github.com/openai/plugins/tree/${commit}/plugins/${entry.name}` }
} })
async function finished(id: string): Promise<AssistantPluginDownload> {
    for (let attempt = 0; attempt < 200; attempt++) {
        const state = registry.acquisitions.get(id, 42)
        if (state.status !== 'downloading') return state
        await new Promise(resolve => setTimeout(resolve, 5))
    }
    throw Error('Fixture acquisition did not finish')
}
async function install() {
    const download = await registry.acquisitions.start('vercel', 42)
    const ready = await finished(download.id)
    assert.equal(ready.status, 'ready')
    assert.ok(ready.inspection)
    assert.ok(!JSON.stringify(ready).includes(root), 'model-independent renderer review has no private storage paths')
    assert.throws(() => registry.acquisitions.get(download.id, 43), /missing|expired/)
    await assert.rejects(() => registry.acquisitions.cancel(download.id, 43), /missing|expired/)
    await assert.rejects(() => registry.installInspectedPlugin({ reviewId: ready.inspection!.reviewId, confirmed: true }, 43), /another Desktop/)
    const result = await registry.installInspectedPlugin({ reviewId: ready.inspection!.reviewId, confirmed: true }, 42)
    await assert.rejects(() => registry.installInspectedPlugin({ reviewId: ready.inspection!.reviewId, confirmed: true }, 42), /missing|expired/)
    assert.deepEqual(await readdir(join(root, 'registry/acquisitions')), [])
    return result.catalog
}
try {
    await registry.initialize()
    await registry.createChatScope('existing-chat', null, false)
    let catalog = await install()
    const plugin = catalog.plugins[0], release = catalog.releases[0]
    assert.equal(plugin.name, 'vercel')
    assert.match(catalog.sources[0].locator, /^https:\/\/github.com\/openai\/plugins\/tree\/[a-f0-9]{40}\/plugins\/vercel$/)
    assert.ok(release.packagePath.startsWith(join(root, 'registry/releases')))
    assert.equal(release.containsExecutableFiles, true)
    assert.equal((await registry.getChatScope('existing-chat'))?.plugins.length, 0)
    const selection = { pluginId: plugin.id, releaseId: release.id, contentDigest: release.contentDigest }
    const localRoot = join(root, 'other-package')
    await packageFiles(localRoot, 'other-plugin')
    const local = await registry.inspectLocalPlugin({ packagePath: localRoot }, 42)
    catalog = (await registry.installInspectedPlugin({ reviewId: local.reviewId, confirmed: true }, 42)).catalog
    const other = catalog.plugins.find(p => p.name === 'other-plugin')!
    await registry.setPluginSet({ pluginIds: [other.id], expectedRevision: 1 })
    const setsBefore = (await registry.getCatalog()).pluginSets
    const scoped = await registry.createChatScope('plugin-chat', null, true, selection)
    assert.deepEqual(scoped.plugins.map(p => p.pluginId), [plugin.id], 'Use in Chat selects only the requested release')
    assert.equal(scoped.plugins[0].contentDigest, selection.contentDigest)
    assert.deepEqual((await registry.getCatalog()).pluginSets, setsBefore, 'Use in Chat never changes global or Project defaults')
    assert.deepEqual((await registry.createChatScope('normal-chat')).plugins.map(p => p.pluginId), [other.id])
    await assert.rejects(() => registry.createChatScope('existing-chat', null, true, selection), /new Chat/)
    await assert.rejects(() => registry.createChatScope('stale-chat', null, true, { ...selection, contentDigest: '0'.repeat(64) }), /changed|unavailable/)
    const skillPath = join(release.packagePath, 'skills/test/SKILL.md')
    const bytes = await readFile(skillPath)
    await writeFile(skillPath, 'tampered')
    await assert.rejects(() => registry.createChatScope('tampered-chat', null, true, selection))
    assert.equal(await registry.getChatScope('tampered-chat'), null)
    await writeFile(skillPath, bytes)
    await registry.setPluginState(plugin.id, 'disabled')
    await assert.rejects(() => registry.createChatScope('disabled-chat', null, true, selection), /changed|unavailable/)
    version = '2.0.0'
    catalog = await install()
    assert.equal(catalog.plugins.find(p => p.id === plugin.id)?.state, 'disabled', 'reinstallation never silently reactivates')
    assert.equal((await registry.getChatScope('plugin-chat'))?.plugins[0].releaseId, release.id, 'updates retain the new Chat\'s pinned release')
    await registry.setPluginState(plugin.id, 'active')
    await assert.rejects(() => registry.createChatScope('outdated-selection', null, true, selection), /changed|unavailable/)

    const cancelReady = await registry.acquisitions.start('vercel', 42)
    const ready = await finished(cancelReady.id)
    await registry.acquisitions.cancel(cancelReady.id, 42)
    await assert.rejects(() => registry.installInspectedPlugin({ reviewId: ready.inspection!.reviewId, confirmed: true }, 42), /missing|expired/)
    assert.deepEqual(await readdir(join(root, 'registry/acquisitions')), [])
    shouldFail = true
    const failed = await registry.acquisitions.start('vercel', 42)
    assert.equal((await finished(failed.id)).status, 'failed')
    await registry.acquisitions.cancel(failed.id, 42)
    shouldFail = false; hold = true
    const pending = await registry.acquisitions.start('vercel', 42)
    await registry.acquisitions.cancelOwner(42)
    assert.throws(() => registry.acquisitions.get(pending.id, 42), /missing|expired/)
    assert.deepEqual(await readdir(join(root, 'registry/acquisitions')), [])

    const browserContract = readFileSync(join(import.meta.dir, '../src/shared/browser-assistant-bridge.ts'), 'utf8')
    for (const method of ['startPluginDownload', 'getPluginDownload', 'cancelPluginDownload', 'createPluginChat']) assert.ok(!browserContract.includes(`'${method}'`), `${method} is Desktop-only`)
    const reopened = new AssistantPluginRegistry({ rootPath: join(root, 'registry') })
    assert.equal((await reopened.getChatScope('plugin-chat'))?.plugins[0].contentDigest, release.contentDigest)
    await reopened.dispose()
    console.log('Managed Plugin downloads, owner-bound review, internal storage, cancellation, and isolated new Chat scopes: ok')
} finally { await registry.dispose(); await rm(root, { recursive: true, force: true }) }
