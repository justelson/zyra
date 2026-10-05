import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { previewVersion, previewBuilderConfig, preparePreview } from './release/build-preview.mjs'
assert.equal(previewVersion('0.7.0', 12), '0.7.0-alpha.12')
assert.equal(previewVersion('0.7.0-beta.3', 13), '0.7.0-alpha.13')
for (const input of ['latest', '0.7.0;echo nope', '0.7.0-alpha.nope']) assert.throws(() => previewVersion(input, 1))
for (const number of [0, -1, '1;echo nope', 65536]) assert.throws(() => previewVersion('0.7.0', number))
const base = { appId: 'app.zyra.desktop', productName: 'Zyra', beforePack: 'hook.cjs', nsis: { include: 'build/installer.nsh', differentialPackage: true }, fileAssociations: [{ ext: 'txt' }], publish: [{ provider: 'github' }], win: { icon: 'icon.ico' } }
const preview = previewBuilderConfig(base, 'preview-output')
assert.equal(base.appId, 'app.zyra.desktop')
assert.equal(base.nsis.include, 'build/installer.nsh')
assert.equal(base.fileAssociations.length, 1)
assert.equal(preview.appId, 'app.zyra.desktop.preview')
assert.equal(preview.productName, 'Zyra Preview')
assert.equal(preview.executableName, 'Zyra Preview')
assert.equal(preview.beforePack, 'hook.cjs')
assert.equal(preview.nsis.include, 'build/preview-installer.nsh')
assert.equal(preview.nsis.differentialPackage, false)
assert.deepEqual(preview.fileAssociations, [])
assert.deepEqual(preview.protocols, [])
assert.equal(preview.publish, null)
assert.equal(preview.win.icon, 'icon.ico')
const workflow = await readFile(new URL('../../.github/workflows/windows-preview.yml', import.meta.url), 'utf8')
assert.match(workflow, /workflow_dispatch:/)
assert.doesNotMatch(workflow, /^\s*(push|pull_request|issue_comment|schedule|workflow_run):/m)
assert.doesNotMatch(workflow, /secrets\./)
assert.match(workflow, /runs-on: windows-2025/)
assert.match(workflow, /retention-days: 1/)
assert.match(workflow, /persist-credentials: false/)
assert.doesNotMatch(workflow, /gh release|release:package|build-tui-release/)
const root = await mkdtemp(path.join(tmpdir(), 'zyra-preview-contract-'))
try {
    await mkdir(path.join(root, 'desktop'))
    for (const file of ['package.json', 'desktop/package.json']) await writeFile(path.join(root, file), JSON.stringify({ version: '0.7.0', build: base }))
    for (const file of ['package-lock.json', 'desktop/package-lock.json']) await writeFile(path.join(root, file), JSON.stringify({ version: '0.7.0', packages: { '': { version: '0.7.0' } } }))
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    git('init'); git('add', '.')
    git('-c', 'user.name=Preview fixture', '-c', 'user.email=preview@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture')
    const sha = git('rev-parse', 'HEAD')
    const env = { ZYRA_BUILD_SOURCE_SHA: sha, ZYRA_BUILD_SOURCE_REPOSITORY: 'example/source', GITHUB_RUN_ID: '123', GITHUB_RUN_NUMBER: '7' }
    await assert.rejects(preparePreview(root, { ...env, ZYRA_BUILD_SOURCE_SHA: 'a'.repeat(40) }), /does not match/)
    const result = await preparePreview(root, env)
    assert.equal(result.version, '0.7.0-alpha.7')
    for (const file of ['package.json', 'package-lock.json', 'desktop/package.json', 'desktop/package-lock.json']) {
        const pkg = JSON.parse(await readFile(path.join(root, file), 'utf8'))
        assert.equal(pkg.version, result.version)
        if (pkg.packages) assert.equal(pkg.packages[''].version, result.version)
    }
    assert.equal(git('rev-parse', 'HEAD'), sha, 'CI-only version derivation does not invent a source commit')
    await assert.rejects(preparePreview(root, env), /clean source/)
} finally { await rm(root, { recursive: true, force: true }) }
console.log('Preview packaging: isolated installer, four lockstep versions, exact source checkout and request-only Windows workflow passed')
