import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { buildRuntimeManifest, validateRuntimeStage, RUNTIME_MANIFEST_FILE, RUNTIME_METADATA_FILES, RUNTIME_SOURCE_DIRECTORIES } from './release/runtime-contract.mjs'

const scoped = '@earendil-works/pi-coding-agent'
const deepFile = 'dist/core/tools/path-utils.js'
const required = [
    'analytics/events.v1.json', 'src/analytics/client.mjs', 'src/analytics/contracts.mjs',
    'src/analytics/cli.mjs', 'src/zyra-sdk.mjs', 'src/zyra-ui-bridge.mjs',
    'src/agent-server/main.mjs', 'bin/zyra.mjs', 'prompts/zyra_system_prompt.md',
    'prompts/inspect-project.md', 'agents/bug-analyzer.md', 'agents/code-reviewer.md',
    'workflows/review-changes.mjs'
]

async function put(root, name, content = '') {
    const file = path.join(root, name)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, content)
}

async function fixture(run, { installed = true } = {}) {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'zyra-runtime-imports-'))
    const root = path.join(temp, 'runtime')
    try {
        for (const dir of RUNTIME_SOURCE_DIRECTORIES) await mkdir(path.join(root, dir), { recursive: true })
        for (const file of [...RUNTIME_METADATA_FILES, ...required]) await put(root, file)
        const pkg = { name: 'runtime-fixture', version: '0.6.1', license: 'Apache-2.0', dependencies: { [scoped]: '1.0.0', plain: '1.0.0' } }
        await put(root, 'package.json', JSON.stringify(pkg))
        await put(root, 'package-lock.json', JSON.stringify({ name: pkg.name, version: pkg.version, lockfileVersion: 3, packages: { '': pkg } }))
        if (installed) {
            for (const name of Object.keys(pkg.dependencies)) {
                await put(root, `node_modules/${name}/package.json`, JSON.stringify({ name, version: '1.0.0' }))
                await put(root, `node_modules/${name}/${deepFile}`, 'export const fixture = true\n')
            }
        }
        const validate = async (specifier, options = {}) => {
            await put(root, 'src/permission-paths.mjs', `import '${specifier}'\n`)
            await put(root, RUNTIME_MANIFEST_FILE, JSON.stringify(await buildRuntimeManifest(root)))
            return validateRuntimeStage(root, { expectedVersion: '0.6.1', ...options })
        }
        await run({ root, temp, validate })
    } finally {
        await rm(temp, { recursive: true, force: true })
    }
}

const scopedImport = `../node_modules/${scoped}/${deepFile}`

test('declared scoped dependency static deep import survives manifest validation', () => fixture(async ({ validate }) => {
    await validate(scopedImport)
}))

test('declared unscoped dependency and ordinary source imports', () => fixture(async ({ validate }) => {
    await validate(`../node_modules/plain/${deepFile}`)
    await validate('./analytics/client.mjs')
    await validate('./agent-server/../analytics/client.mjs')
}))

test('exact dependency target must be an existing file', () => fixture(async ({ validate }) => {
    await assert.rejects(validate(`../node_modules/${scoped}/missing.js`), /dependency import is missing/)
    await assert.rejects(validate(`../node_modules/${scoped}/dist`), /dependency import is not a file/)
}))

test('undeclared relative and bare dependencies remain rejected in both modes', () => fixture(async ({ root, validate }) => {
    await put(root, `node_modules/undeclared/${deepFile}`)
    for (const requireDependencies of [true, false]) {
        for (const specifier of [`../node_modules/undeclared/${deepFile}`, 'undeclared', 'toString']) {
            await assert.rejects(validate(specifier, { requireDependencies }), /undeclared production dependency/)
        }
    }
}))

test('ordinary missing source remains rejected in both modes', () => fixture(async ({ validate }) => {
    for (const requireDependencies of [true, false]) {
        await assert.rejects(validate('./missing.mjs', { requireDependencies }), /runtime import is missing/)
    }
}))

test('source-only mode permits absent declared dependencies but retains path safety', () => fixture(async ({ validate }) => {
    await validate(scopedImport, { requireDependencies: false })
    await validate(`../node_modules/plain/${deepFile}`, { requireDependencies: false })
    await assert.rejects(validate(scopedImport), /dependency import is missing/)
}, { installed: false }))

test('source and package traversal rejected in both modes', () => fixture(async ({ temp, validate }) => {
    await put(temp, 'outside.mjs')
    for (const requireDependencies of [true, false]) {
        for (const specifier of [
            '../../outside.mjs', '../node_modules/plain/../../src/zyra-sdk.mjs',
            `../node_modules/${scoped}/../../../src/zyra-sdk.mjs`,
            `../node_modules/plain/../${scoped}/${deepFile}`,
            '../node_modules/plain/%2e%2e/elsewhere.js', '../node_modules/plain/..\\elsewhere.js'
        ]) {
            await assert.rejects(validate(specifier, { requireDependencies }), /Unsafe runtime import/)
        }
    }
}))

for (const escape of ['node_modules', `node_modules/${scoped}`, `node_modules/${scoped}/dist`]) {
    test(`symlink/junction escape rejected: ${escape}`, () => fixture(async ({ root, temp, validate }) => {
        const outside = path.join(temp, 'outside')
        await put(outside, deepFile)
        await put(outside, 'core/tools/path-utils.js')
        await put(outside, `${scoped}/${deepFile}`)
        await put(outside, 'package.json', '{}')
        await rm(path.join(root, escape), { recursive: true, force: true })
        await symlink(outside, path.join(root, escape), process.platform === 'win32' ? 'junction' : 'dir')
        for (const requireDependencies of [true, false]) {
            await assert.rejects(validate(scopedImport, { requireDependencies }), /Unsafe runtime import/)
        }
    }))
}

test('dependency symlink into another staged package is rejected', () => fixture(async ({ root, validate }) => {
    await rm(path.join(root, `node_modules/${scoped}/dist`), { recursive: true })
    await symlink(path.join(root, 'node_modules/plain/dist'), path.join(root, `node_modules/${scoped}/dist`), process.platform === 'win32' ? 'junction' : 'dir')
    for (const requireDependencies of [true, false]) {
        await assert.rejects(validate(scopedImport, { requireDependencies }), /Unsafe runtime import/)
    }
}))

test('source directory junction cannot escape the staged runtime', () => fixture(async ({ root, temp, validate }) => {
    const outside = path.join(temp, 'outside-prompts')
    await put(outside, 'zyra_system_prompt.md')
    await put(outside, 'inspect-project.md')
    await rm(path.join(root, 'prompts'), { recursive: true })
    await symlink(outside, path.join(root, 'prompts'), process.platform === 'win32' ? 'junction' : 'dir')
    for (const requireDependencies of [true, false]) {
        await assert.rejects(validate('../prompts/inspect-project.md', { requireDependencies }), /Unsafe runtime import/)
    }
}))

test('existing dependency package presence check is retained', () => fixture(async ({ root, validate }) => {
    await rm(path.join(root, 'node_modules/plain/package.json'))
    await assert.rejects(validate('./analytics/client.mjs'), /Staged runtime dependency is missing: plain/)
    await validate('./analytics/client.mjs', { requireDependencies: false })
}))
