import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const directory = await mkdtemp(join(tmpdir(), 'zyra-extension-startup-'))
const sourcePath = new URL('../src/main/browser-extension-manager.ts', import.meta.url)
const snapshotIndex = process.argv.indexOf('--source-snapshot')
const modules = {
    electron: 'export const app={getPath:()=>globalThis.__extensionFixture.directory}; export const dialog={};',
    'electron-log': 'export default {warn:()=>{}}',
    './ipc/handlers/browser-preview-handlers': 'export function getGlobalBrowserSession(){const f=globalThis.__extensionFixture;f.acquisitions++;return f.session}',
    './browser-extension-crx': 'export function downloadChromeWebStoreCrx(){throw Error("Unexpected network")};export function extractCrxToDirectory(){throw Error("Unexpected extraction")}'
}
try {
    const source = await readFile(snapshotIndex < 0 ? sourcePath : process.argv[snapshotIndex + 1], 'utf8')
    const bundle = await build({ stdin: { contents: source, loader: 'ts', resolveDir: dirname(fileURLToPath(sourcePath)) },
        bundle: true, write: false, platform: 'node', format: 'esm',
        plugins: [{ name: 'extension-runtime-boundaries', setup(api) {
            api.onResolve({ filter: /.*/ }, input => input.path in modules ? { path: input.path, namespace: 'fixture' } : undefined)
            api.onLoad({ filter: /.*/, namespace: 'fixture' }, input => ({ contents: modules[input.path], loader: 'js' }))
        } }]
    })
    const { BrowserExtensionManager } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)
    const loaded = [], removed = []
    const session = { extensions: {
        loadExtension: async (path, options) => { assert.equal(options.allowFileAccess, false); loaded.push(path); return { id: basename(path) } },
        removeExtension: id => removed.push(id)
    } }
    const fixture = { directory, acquisitions: 0, session }
    globalThis.__extensionFixture = fixture
    const config = join(directory, 'browser-extensions.json')
    const save = entries => writeFile(config, JSON.stringify(entries))
    const record = (id, enabled) => ({ id, path: join(directory, id), name: id, version: '1', enabled })
    for (const entries of [[], [record('disabled', false)], [record('missing', true)]]) {
        await save(entries)
        const manager = new BrowserExtensionManager()
        await Promise.all([manager.loadEnabled(), manager.loadEnabled()])
        assert.equal((await manager.list()).length, entries.length)
        if (entries[0]?.id === 'disabled') { await manager.setEnabled('disabled', false); await manager.reload('disabled') }
        assert.equal(fixture.acquisitions, 0, 'Empty, disabled and missing extensions must not initialize the browser/filter engine')
    }
    for (const id of ['enabled', 'another']) {
        await mkdir(join(directory, id))
        await writeFile(join(directory, id, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: id, version: '1' }))
    }
    const icon = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/xZkAAAAASUVORK5CYII=', 'base64')
    await writeFile(join(directory, 'enabled', 'icon.png'), icon)
    await writeFile(join(directory, 'enabled', 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'enabled', version: '1', icons: { 32: 'icon.png' } }))
    await save([record('enabled', true), record('another', true)])
    const manager = new BrowserExtensionManager()
    assert.equal((await manager.list()).find(item => item.id === 'enabled').iconDataUrl, `data:image/png;base64,${icon.toString('base64')}`)
    await Promise.all([manager.loadEnabled(), manager.loadEnabled()])
    assert.equal(fixture.acquisitions, 1, 'One shared protected browser session is acquired when needed')
    assert.deepEqual(loaded.map(path => basename(path)), ['enabled', 'another'], 'Enabled extensions load once in persisted order')
    await manager.setEnabled('enabled', false)
    await manager.setEnabled('enabled', true)
    await manager.reload('another')
    assert.deepEqual(removed, ['enabled', 'another'])
    assert.deepEqual(loaded.map(path => basename(path)), ['enabled', 'another', 'enabled', 'another'])
    assert.equal(fixture.acquisitions, 1, 'Enable and reload reuse the same browser session')
    const injected = new BrowserExtensionManager(session)
    await injected.loadEnabled()
    assert.equal(fixture.acquisitions, 1, 'An explicitly injected session remains supported')
    console.log('Browser extension startup passed: no unused session; enabled startup loading, concurrency, toggling, reload and injection preserved.')
} finally {
    delete globalThis.__extensionFixture
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('zyra-extension-startup-')) throw Error('Invalid extension test cleanup path')
    await rm(directory, { recursive: true, force: true })
}
