import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { createPackage } from '@electron/asar'
import { BUNDLED_RENDERER_PACKAGES, assertNoExternalRendererImports, validateRendererPayload } from './release/renderer-payload-contract.mjs'

for (const name of BUNDLED_RENDERER_PACKAGES) {
    for (const text of [`import x from '${name}'`, `export * from '${name}/subpath'`,
        `const x = require('${name}')`, `const x = import('${name}')`])
        assert.throws(() => assertNoExternalRendererImports(text, 'main.ts'), /Renderer-only dependency/)
    assert.doesNotThrow(() => assertNoExternalRendererImports(`import type { X } from '${name}'`, 'main.ts'))
}
assert.doesNotThrow(() => assertNoExternalRendererImports("import React from 'react'; const p = require('node-pty')", 'main.ts'))

const desktop = path.resolve(import.meta.dirname, '..')
async function validateSource(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name)
        if (entry.isDirectory()) await validateSource(file)
        else if (/\.(?:ts|tsx|mjs|cjs|js)$/.test(file) && !/\.d\.(?:ts|mts|cts)$/.test(file))
            assertNoExternalRendererImports(await readFile(file, 'utf8'), file)
    }
}
for (const directory of ['main', 'preload', 'shared']) await validateSource(path.join(desktop, 'src', directory))

const fixture = await mkdtemp(path.join(tmpdir(), 'zyra-renderer-payload-'))
try {
    const source = path.join(fixture, 'app')
    const archive = path.join(fixture, 'app.asar')
    const put = async (file, text) => {
        const target = path.join(source, file)
        await mkdir(path.dirname(target), { recursive: true })
        await writeFile(target, text)
    }
    await put('out/renderer/index.html', '<script src="assets/app.js"></script>')
    await put('out/renderer/assets/app.js', 'export const bundledFeatures = true')
    await put('out/main/index.js', "import log from 'electron-log'")
    await put('out/preload/index.cjs', "require('electron')")
    await createPackage(source, archive)
    assert.doesNotThrow(() => validateRendererPayload(archive))
    // Each fixture archive has a distinct name; ASAR caches headers by path.
    await put('out/main/index.js', "await import('mermaid')")
    const badMain = path.join(fixture, 'bad-main.asar')
    await createPackage(source, badMain)
    assert.throws(() => validateRendererPayload(badMain), /Renderer-only dependency/)
    await put('out/main/index.js', "import log from 'electron-log'")
    await put('node_modules/monaco-editor/index.js', 'raw duplicate')
    const duplicate = path.join(fixture, 'duplicate.asar')
    await createPackage(source, duplicate)
    assert.throws(() => validateRendererPayload(duplicate), /Duplicate renderer dependency/)
} finally {
    assert.equal(path.dirname(path.resolve(fixture)), path.resolve(tmpdir()))
    assert.ok(path.basename(fixture).startsWith('zyra-renderer-payload-'))
    await rm(fixture, { recursive: true, force: true })
}
console.log('PASS renderer-only dependency source ownership, actual ASAR bundle presence, external main/preload rejection and duplicate-package rejection')
