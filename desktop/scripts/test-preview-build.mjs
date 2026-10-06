import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { previewVersion, previewBuilderConfig, preparePreview, previewRequestIdentity } from './release/build-preview.mjs'
import { getMainFileMatchers, getNodeModuleFileMatcher } from 'app-builder-lib/out/fileMatcher.js'
import { computeFileSets, computeNodeModuleFileSets, getDestinationPath } from 'app-builder-lib/out/util/appFileCopier.js'
import { PM } from 'app-builder-lib/out/node-module-collector/index.js'
import { Platform } from 'app-builder-lib/out/core.js'
assert.equal(previewVersion('0.7.0', 12), '0.7.0-dev.12')
assert.equal(previewVersion('0.7.0-beta.3', 13), '0.7.0-dev.13')
assert.equal(previewVersion('0.7.0-alpha.3', 14), '0.7.0-dev.14')
assert.equal(previewVersion('0.7.0-dev.3', 15), '0.7.0-dev.15')
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
assert.equal(preview.nsis.oneClick, true, 'Preserve the existing Preview installation directory calculation')
assert.equal(preview.nsis.perMachine, false)
assert.equal(preview.nsis.allowToChangeInstallationDirectory, false)
assert.deepEqual(preview.fileAssociations, [])
assert.deepEqual(preview.protocols, [])
assert.equal(preview.publish, null)
assert.equal(preview.icon, 'resources/icon-dev.png')
assert.equal(preview.win.icon, 'resources/icon-dev.ico')
assert.equal(preview.nsis.installerIcon, 'resources/icon-dev.ico')
assert.equal(preview.nsis.uninstallerIcon, 'resources/icon-dev.ico')
assert.equal(base.win.icon, 'icon.ico', 'Stable icon remains untouched')
const desktopBuild = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).build
const desktopBuildSnapshot = structuredClone(desktopBuild)
const actualPreviewBuild = previewBuilderConfig(desktopBuild, 'preview-output')
for (const key of ['asar', 'asarUnpack', 'extraResources']) {
    assert.deepEqual(actualPreviewBuild[key], desktopBuild[key], `Preserve actual Desktop ${key}`)
}
assert.deepEqual(actualPreviewBuild.win.extraResources, desktopBuild.win.extraResources,
    'Preserve actual platform extra resources')
assert.deepEqual(desktopBuild, desktopBuildSnapshot, 'Actual stable build configuration remains unchanged')

async function testPreviewFileCollection() {
    const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'zyra-preview-files-'))
    try {
        const appDir = path.join(fixtureRoot, 'app')
        const destination = path.join(fixtureRoot, 'package')
        const stable = {
            files: ['!dist/**', '!.release/**', '!resources/branding/icons/*-source.png'],
            asar: true,
            asarUnpack: ['node_modules/node-pty/**'],
            extraResources: [{ from: '.release/zyra-runtime', to: 'zyra-runtime', filter: ['**/*'] }],
            win: {}, directories: { output: 'dist' }
        }
        const stableSnapshot = structuredClone(stable)
        const config = previewBuilderConfig(stable, path.join(fixtureRoot, 'dist'))
        const metadata = { name: 'preview-file-fixture', version: '1.0.0', main: 'out/main/index.js',
            dependencies: { 'fixture-prod': '1.0.0' }, devDependencies: { 'fixture-dev': '1.0.0' } }
        const fixtureFiles = {
            'package.json': JSON.stringify(metadata),
            'out/main/index.js': "import 'fixture-prod'",
            'out/main/chunks/shared.mjs': 'export const shared = true',
            'out/preload/index.cjs': 'module.exports = {}',
            'out/renderer/index.html': '<script src="assets/app.js"></script>',
            'out/renderer/assets/app.js': 'export {}',
            'out/renderer/assets/style.css': 'body {}',
            'out/renderer/assets/editor.worker.js': 'self.onmessage = () => {}',
            'resources/icon-dev.ico': 'icon fixture',
            'resources/branding/icons/logo.png': 'logo fixture',
            'resources/branding/icons/logo-source.png': 'source artwork',
            'resources/routes.map': 'application data, not a source map',
            'src/main/index.ts': 'raw desktop source',
            'scripts/release/build.mjs': 'build script',
            'electron.vite.config.ts': 'build configuration',
            'dist/old-installer.exe': 'old output',
            '.release/zyra-runtime/src/zyra-sdk.mjs': 'separate runtime staging',
            'node_modules/fixture-prod/package.json': JSON.stringify({ name: 'fixture-prod', version: '1.0.0',
                main: 'index.js', dependencies: { 'fixture-transitive': '1.0.0' } }),
            'node_modules/fixture-prod/index.js': 'module.exports = {}',
            'node_modules/fixture-prod/build/Release/addon.node': 'native fixture; collection only',
            'node_modules/fixture-prod/dist/sql-wasm.js': 'module.exports = {}',
            'node_modules/fixture-prod/dist/sql-wasm.wasm': 'wasm fixture; collection only',
            'node_modules/fixture-prod/dist/routes.map': 'runtime data',
            'node_modules/fixture-prod/LICENSE': 'license fixture',
            'node_modules/fixture-transitive/package.json': JSON.stringify({ name: 'fixture-transitive', version: '1.0.0', main: 'index.js' }),
            'node_modules/fixture-transitive/index.js': 'module.exports = {}',
            'node_modules/fixture-transitive/NOTICE': 'legal notice fixture',
            'node_modules/fixture-dev/package.json': JSON.stringify({ name: 'fixture-dev', version: '1.0.0', main: 'index.js' }),
            'node_modules/fixture-dev/index.js': 'development-only dependency'
        }
        const maps = []
        for (const ext of ['js', 'cjs', 'mjs', 'css']) {
            for (const prefix of ['out/renderer/assets', 'node_modules/fixture-prod/dist']) {
                const file = `${prefix}/compiled.${ext}.map`
                fixtureFiles[file] = '{"version":3,"sources":[]}'
                maps.push(file)
            }
        }
        for (const [file, content] of Object.entries(fixtureFiles)) {
            const target = path.join(appDir, file)
            await mkdir(path.dirname(target), { recursive: true })
            await writeFile(target, content)
        }
        // Exercise the same two collection passes as PlatformPackager.copyAppFiles;
        // no Electron download, archive creation, or native execution is needed.
        const info = { appDir, projectDir: appDir, buildResourcesDir: 'build', config, appInfo: { type: 'commonjs' },
            nodePackageName: metadata.name, debugLogger: { isEnabled: false },
            getWorkspaceRoot: async () => appDir, getPackageManager: async () => PM.TRAVERSAL,
            isPrepackedAppAsar: false, areNodeModulesHandledExternally: false }
        const platformPackager = { info, config, platform: Platform.WINDOWS }
        const macroExpander = value => value
        const matchers = getMainFileMatchers(appDir, destination, macroExpander, config.win,
            platformPackager, config.directories.output, false)
        const appSets = await computeFileSets(matchers, null, platformPackager, false)
        const dependencyMatcher = getNodeModuleFileMatcher(appDir, destination, macroExpander, config.win, info)
        const dependencySets = await computeNodeModuleFileSets(platformPackager, dependencyMatcher)
        const names = sets => new Set(sets.flatMap(set => set.files.map(file =>
            path.relative(destination, getDestinationPath(file, set)).split(path.sep).join('/'))))
        const appFiles = names(appSets)
        const dependencyFiles = names(dependencySets)
        const collected = new Set([...appFiles, ...dependencyFiles])
        const baselinePackager = { ...platformPackager, config: stable, info: { ...info, config: stable } }
        const baselineMatchers = getMainFileMatchers(appDir, destination, macroExpander, stable.win,
            baselinePackager, path.join(fixtureRoot, 'stable-dist'), false)
        const baselineFiles = names(await computeFileSets(baselineMatchers, null, baselinePackager, false))
        for (const file of ['src/main/index.ts', 'scripts/release/build.mjs',
            'out/renderer/assets/compiled.js.map']) {
            assert.ok(baselineFiles.has(file), `Fixture must reproduce the existing packaging waste: ${file}`)
        }
        for (const file of ['package.json', 'out/main/index.js', 'out/main/chunks/shared.mjs',
            'out/preload/index.cjs', 'out/renderer/index.html', 'out/renderer/assets/app.js',
            'out/renderer/assets/style.css', 'out/renderer/assets/editor.worker.js',
            'resources/icon-dev.ico', 'resources/branding/icons/logo.png', 'resources/routes.map']) {
            assert.ok(appFiles.has(file), `Compiled app/resource missing from real collection: ${file}`)
        }
        for (const file of ['node_modules/fixture-prod/package.json', 'node_modules/fixture-prod/index.js',
            'node_modules/fixture-prod/build/Release/addon.node', 'node_modules/fixture-prod/dist/sql-wasm.js',
            'node_modules/fixture-prod/dist/sql-wasm.wasm', 'node_modules/fixture-prod/dist/routes.map',
            'node_modules/fixture-prod/LICENSE', 'node_modules/fixture-transitive/index.js',
            'node_modules/fixture-transitive/NOTICE']) {
            assert.ok(dependencyFiles.has(file), `Automatic production dependency missing: ${file}`)
            assert.ok(!appFiles.has(file), `Dependencies must come from the separate production pass: ${file}`)
        }
        for (const file of ['src/main/index.ts', 'scripts/release/build.mjs', 'electron.vite.config.ts',
            'dist/old-installer.exe', '.release/zyra-runtime/src/zyra-sdk.mjs',
            'resources/branding/icons/logo-source.png', ...maps]) {
            assert.ok(!collected.has(file), `Development artifact leaked into preview: ${file}`)
        }
        assert.ok(![...collected].some(file => file.startsWith('node_modules/fixture-dev/')),
            'Real dependency discovery must omit devDependencies')
        assert.deepEqual(stable, stableSnapshot, 'Preview configuration must not mutate stable packaging')
        assert.deepEqual(config.asar, stable.asar)
        assert.deepEqual(config.asarUnpack, stable.asarUnpack)
        assert.deepEqual(config.extraResources, stable.extraResources,
            'Runtime/extension extra resources keep their independent filters')
    } finally {
        const resolved = path.resolve(fixtureRoot)
        assert.equal(path.dirname(resolved), path.resolve(tmpdir()), 'Cleanup stays within the temporary fixture root')
        assert.ok(path.basename(resolved).startsWith('zyra-preview-files-'))
        await rm(resolved, { recursive: true, force: true })
    }
}
await testPreviewFileCollection()
const installer = await readFile(new URL('../build/preview-installer.nsh', import.meta.url), 'utf8')
assert.match(installer, /customInit[\s\S]*MB_OKCANCEL[\s\S]*Dev channel \$\{VERSION\}/)
assert.match(installer, /Existing Zyra Preview settings and history are preserved/)
assert.match(installer, /Dev updates are installed manually/)
assert.doesNotMatch(installer, /WriteReg|FileWrite|DeleteReg|ZyraInstallFileIcons|StrCpy \$INSTDIR/)
const workflow = await readFile(new URL('../../.github/workflows/windows-preview.yml', import.meta.url), 'utf8')
assert.ok(workflow.includes("run-name: Preview ${{ inputs.source_sha }}${{ inputs.request_id && format(' request:{0}', inputs.request_id) || '' }}"), 'Token-bearing previews match the relay and candidate policy; legacy direct requests retain their plain SHA title')
assert.match(workflow, /workflow_dispatch:/)
assert.doesNotMatch(workflow, /^\s*(push|pull_request|issue_comment|schedule|workflow_run):/m)
assert.doesNotMatch(workflow, /secrets\./)
assert.match(workflow, /runs-on: windows-2025/)
assert.equal(workflow.match(/retention-days: 7/g)?.length, 2)
assert.match(workflow, /group: windows-preview-.*inputs.source_repository.*inputs.source_pr.*inputs.source_sha.*inputs.target/)
assert.match(workflow, /cancel-in-progress: true/)
assert.match(workflow, /default: windows-x64/)
assert.match(workflow, /brand:release-assets -- --preview/)
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
    const env = { ZYRA_BUILD_SOURCE_SHA: sha, ZYRA_BUILD_SOURCE_REPOSITORY: 'example/source', ZYRA_BUILD_SOURCE_PR: '24', ZYRA_BUILD_REQUEST_ID: 'delivery:abc-123', GITHUB_RUN_ID: '123', GITHUB_RUN_NUMBER: '7', GITHUB_RUN_ATTEMPT: '2', GITHUB_SHA: 'b'.repeat(40) }
    assert.equal(previewRequestIdentity({ ...env, ZYRA_BUILD_SOURCE_PR: '' }).sourcePr, null)
    assert.equal(previewRequestIdentity({ ...env, ZYRA_BUILD_REQUEST_ID: '' }).requestId, null)
    for (const id of ['request with spaces', 'request;echo nope', 'a'.repeat(129), '../file']) assert.throws(() => previewRequestIdentity({ ...env, ZYRA_BUILD_REQUEST_ID: id }), /Invalid explicit request/)
    for (const target of ['macos', 'windows-arm64', 'linux']) assert.throws(() => previewRequestIdentity({ ...env, ZYRA_BUILD_TARGET: target }), /Unsupported/)
    for (const pr of ['0', '-1', '24;echo nope', '024']) assert.throws(() => previewRequestIdentity({ ...env, ZYRA_BUILD_SOURCE_PR: pr }), /Invalid source PR/)
    assert.throws(() => previewRequestIdentity({ ...env, GITHUB_SHA: 'main' }), /workflow SHA/)
    await assert.rejects(preparePreview(root, { ...env, ZYRA_BUILD_SOURCE_SHA: 'a'.repeat(40) }), /does not match/)
    const result = await preparePreview(root, env)
    assert.equal(result.version, '0.7.0-dev.7')
    assert.equal(result.sourceVersion, '0.7.0')
    const request = JSON.parse(await readFile(path.join(root, '.release', 'preview-request.json'), 'utf8'))
    assert.deepEqual(request, { channel: 'dev', target: 'windows-x64', sourcePr: '24', requestId: 'delivery:abc-123', runId: '123', runAttempt: '2', workflowSha: 'b'.repeat(40), sourceSha: sha, sourceRepository: 'example/source', sourceVersion: '0.7.0', version: '0.7.0-dev.7' })
    for (const file of ['package.json', 'package-lock.json', 'desktop/package.json', 'desktop/package-lock.json']) {
        const pkg = JSON.parse(await readFile(path.join(root, file), 'utf8'))
        assert.equal(pkg.version, result.version)
        if (pkg.packages) assert.equal(pkg.packages[''].version, result.version)
    }
    assert.equal(git('rev-parse', 'HEAD'), sha, 'CI-only version derivation does not invent a source commit')
    await assert.rejects(preparePreview(root, env), /clean source/)
} finally { await rm(root, { recursive: true, force: true }) }
console.log('Preview packaging: real app/production file collection, isolated installer, four lockstep versions, exact source checkout and request-only Windows workflow passed')
