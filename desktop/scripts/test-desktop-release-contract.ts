import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expectedReleaseAssetNames, platformReleaseContract } from './release/release-contract.mjs'
import { resolvePlatformReleaseContract } from '../src/main/update/github-release-feed'

const desktopRoot = path.resolve(import.meta.dirname, '..')
const repositoryRoot = path.resolve(desktopRoot, '..')
const readJson = (file: string) => JSON.parse(readFileSync(file, 'utf8'))
const rootPackage = readJson(path.join(repositoryRoot, 'package.json'))
const rootLock = readJson(path.join(repositoryRoot, 'package-lock.json'))
const desktopPackage = readJson(path.join(desktopRoot, 'package.json'))
const desktopLock = readJson(path.join(desktopRoot, 'package-lock.json'))
const build = desktopPackage.build
const localTuiReleaseSource = readFileSync(path.join(repositoryRoot, 'scripts', 'build-release.mjs'), 'utf8')
const standaloneTuiBuilderSource = readFileSync(path.join(repositoryRoot, 'scripts', 'build-tui-release.mjs'), 'utf8')
const standaloneTuiSignerSource = readFileSync(path.join(repositoryRoot, 'scripts', 'sign-standalone-tui.mjs'), 'utf8')
const standaloneTuiSmokeSource = readFileSync(path.join(repositoryRoot, 'scripts', 'test-standalone-tui-binary.mjs'), 'utf8')
const standaloneTuiEntitlements = readFileSync(path.join(desktopRoot, 'build', 'entitlements.tui.plist'), 'utf8')

assert.equal(rootPackage.version, '0.6.1')
assert.equal(rootPackage.scripts['release:tui'], 'node scripts/build-release.mjs', 'the local standalone TUI build shortcut stays stable')
assert.match(localTuiReleaseSource, /build-tui-release\.mjs/, 'the local release shortcut delegates to the canonical standalone TUI builder')
assert.doesNotMatch(localTuiReleaseSource, /git["', ]+archive|checksums\.txt/, 'the local shortcut cannot archive source or emit the obsolete checksum format')
assert.match(standaloneTuiBuilderSource, /TUI_RELEASE_TARGETS/, 'the canonical TUI builder uses the shared platform contract')
assert.match(standaloneTuiBuilderSource, /BUN_RUNTIME_VERSION[\s\S]*assertBunVersion/, 'standalone TUI builds pin the licensed Bun runtime version')
assert.match(standaloneTuiBuilderSource, /"--compile"/, 'the canonical TUI builder emits native standalone executables')
assert.match(standaloneTuiBuilderSource, /collectResources/, 'the canonical TUI builder embeds runtime resources')
assert.match(standaloneTuiBuilderSource, /path\.join\(root,\s*["']desktop["'],\s*["']resources["'],\s*["']icon\.ico["']\)/, 'the Windows TUI reuses the Desktop release icon')
assert.match(standaloneTuiBuilderSource, /--windows-icon=/, 'the shared Zyra icon is embedded in the Windows TUI executable')
assert.match(standaloneTuiBuilderSource, /--windows-title=Zyra/, 'the Windows TUI exposes Zyra product metadata')
assert.match(standaloneTuiBuilderSource, /--windows-copyright=Copyright 2026 justelson/, 'the Windows TUI carries the copyright holder')
assert.match(standaloneTuiSignerSource, /signtool[\s\S]*Get-AuthenticodeSignature/, 'the Windows standalone TUI is signed and verified')
assert.match(standaloneTuiSignerSource, /codesign[\s\S]*notarytool[\s\S]*spctl/, 'both macOS standalone TUI binaries are signed, notarized, and assessed by Gatekeeper')
assert.match(standaloneTuiSmokeSource, /process\.platform === "darwin" \? "\/tmp"[\s\S]*"zys-"/, 'the macOS standalone smoke must keep its Unix socket below the platform path limit')
assert.match(standaloneTuiSmokeSource, /stdio: \["ignore", "pipe", "pipe"\][\s\S]*server\.signalCode[\s\S]*serverOutput/, 'standalone server smoke failures must retain process diagnostics')
assert.match(standaloneTuiEntitlements, /allow-jit[\s\S]*allow-unsigned-executable-memory[\s\S]*disable-library-validation/, 'Bun standalone binaries retain reviewed JavaScript runtime entitlements')
assert(rootPackage.files.includes('analytics'), 'the npm/TUI package allowlist includes the versioned analytics catalog')
assert.equal(rootPackage.author, 'justelson')
assert.equal(desktopPackage.version, rootPackage.version, 'root and Desktop versions must be lockstep')
assert(JSON.stringify(build.extraResources || []).includes('.release/zyra-node'), 'desktop packages the pinned Node runtime')
assert.equal(rootLock.version, rootPackage.version)
assert.equal(rootLock.packages[''].version, rootPackage.version)
assert.equal(desktopLock.version, desktopPackage.version)
assert.equal(desktopLock.packages[''].version, desktopPackage.version)
assert.equal(desktopPackage.name, 'zyra-desktop')
assert.equal(desktopPackage.private, true)
assert.equal(desktopLock.name, 'zyra-desktop')
assert.equal(desktopLock.packages[''].name, 'zyra-desktop')
assert.equal(rootPackage.license, 'Apache-2.0')
assert.equal(desktopPackage.license, 'Apache-2.0')
assert.equal(desktopPackage.author, 'justelson')
assert.equal(build.copyright, 'Copyright © 2026 justelson')

assert.equal(build.appId, 'app.zyra.desktop')
assert.equal(build.productName, 'Zyra')
assert.equal(build.asar, true, 'packaged application code must remain inside app.asar')
assert.deepEqual(build.electronFuses, {
    runAsNode: true,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true
})
assert.match(desktopPackage.devDependencies.electron, /castlabs\/electron-releases[\s\S]*v43\.2\.0%2Bwvcus/, 'Widevine-capable Electron must remain deliberately pinned')
assert.equal(desktopLock.packages['node_modules/electron'].version, '43.2.0+wvcus')
assert.equal(build.electronDownload?.mirror, 'https://github.com/castlabs/electron-releases/releases/download/', 'packaging must let electron-builder add the CastLabs v-prefixed release tag exactly once')
assert.equal(build.afterPack, 'scripts/release/widevine-vmp-after-pack.cjs', 'macOS VMP signing must run before code signing')
assert.equal(build.afterSign, 'scripts/release/widevine-vmp-after-sign.cjs', 'Windows VMP signing must run after code signing')
assert.equal(desktopPackage.devDependencies['electron-builder'], '26.15.3')
assert.equal(desktopLock.packages['node_modules/electron-builder'].version, '26.15.3')
assert.equal(desktopPackage.dependencies['node-pty'], '1.1.0', 'node-pty ABI input must be pinned')
assert.equal(build.npmRebuild, false, 'Node-API node-pty binaries must not be forced through Electron ABI rebuilds')
assert(build.asarUnpack.includes('node_modules/node-pty/**'))
assert(desktopPackage.scripts.postinstall.includes('ensure-electron.mjs'))
assert(desktopPackage.scripts.postinstall.includes('verify-node-pty-install.mjs'))
assert(desktopPackage.scripts['native:prepare'].includes('verify-node-pty-install.mjs'))
assert(desktopPackage.scripts['test:native-abi'].includes('test-node-pty-electron.mjs'))
const runtimeContractSource = readFileSync(path.join(desktopRoot, 'scripts', 'release', 'runtime-contract.mjs'), 'utf8')
assert.match(runtimeContractSource, /RUNTIME_SOURCE_DIRECTORIES[^\n]*\['src', 'analytics'/, 'Desktop runtime staging includes the shared analytics catalog directory')
assert.match(runtimeContractSource, /'analytics\/events\.v1\.json'[\s\S]*'src\/analytics\/client\.mjs'/, 'Desktop runtime validation requires analytics catalog and client entrypoints')
const packageScript = readFileSync(path.join(desktopRoot, 'scripts', 'release', 'package-desktop.mjs'), 'utf8')
const installerSource = readFileSync(path.join(desktopRoot, 'build', 'installer.nsh'), 'utf8')
const nodePtyInstallVerifier = readFileSync(path.join(desktopRoot, 'scripts', 'release', 'verify-node-pty-install.mjs'), 'utf8')
const packagedValidator = readFileSync(path.join(desktopRoot, 'scripts', 'release', 'validate-packaged-app.mjs'), 'utf8')
const signatureVerifier = readFileSync(path.join(desktopRoot, 'scripts', 'release', 'verify-platform-signature.mjs'), 'utf8')
const signatureMarkerValidator = readFileSync(path.join(desktopRoot, 'scripts', 'release', 'validate-signature-markers.mjs'), 'utf8')
const preflightSource = readFileSync(path.join(desktopRoot, 'scripts', 'release', 'preflight.mjs'), 'utf8')
const vmpSignerSource = readFileSync(path.join(desktopRoot, 'scripts', 'release', 'widevine-vmp-sign.cjs'), 'utf8')
const vmpAfterPackSource = readFileSync(path.join(desktopRoot, 'scripts', 'release', 'widevine-vmp-after-pack.cjs'), 'utf8')
const releaseWorkflowSource = readFileSync(path.join(repositoryRoot, '.github', 'workflows', 'desktop-release.yml'), 'utf8')
const mainSource = readFileSync(path.join(desktopRoot, 'src', 'main', 'index.ts'), 'utf8')
const persistenceSource = readFileSync(path.join(desktopRoot, 'src', 'main', 'assistant', 'persistence.ts'), 'utf8')
const nativeSqliteSource = readFileSync(path.join(desktopRoot, 'src', 'main', 'assistant', 'native-sqlite-adapter.ts'), 'utf8')
assert(packageScript.includes('validate-packaged-app.mjs'), 'every native package must validate its installed resource layout')
assert.match(packageScript, /if \(!expectedSigned\)[\s\S]*delete builderEnvironment\[name\][\s\S]*CSC_IDENTITY_AUTO_DISCOVERY = 'false'/, 'unsigned rehearsals must omit empty signing credentials before electron-builder resolves certificate paths')
assert.match(installerSource, /!ifndef BUILD_UNINSTALLER\s+\$\{StrStr\}\s+!endif/, 'the installer-only PATH helper must not trigger a fatal unused-function warning during NSIS uninstaller compilation')
assert.match(nodePtyInstallVerifier, /process\.platform === 'darwin'[\s\S]*chmod\(helper, 0o755\)[\s\S]*helperMode & 0o111/, 'macOS installs must restore and verify node-pty spawn-helper execute permissions')
assert(packageScript.includes('`--version=${version}`'), 'signature verification must receive the exact release version')
assert(signatureVerifier.includes('platformReleaseContract(version, platform)'), 'signature verification must use the canonical artifact name')
assert(signatureVerifier.includes("'widevine-vmp'") && signatureVerifier.includes("'verify-pkg'"), 'final packaged applications must verify Widevine VMP signing')
assert(signatureMarkerValidator.includes("check.name === 'widevine-vmp'") && signatureMarkerValidator.includes("'widevine-vmp', 'codesign'"), 'release assembly requires Widevine VMP evidence on Windows and macOS')
assert(signatureMarkerValidator.includes("['windows-x64']") && signatureMarkerValidator.includes("['macos-arm64', 'macos-x64']"), 'release assembly requires every standalone TUI signing target')
assert.match(signatureMarkerValidator, /assetsDirectory[\s\S]*details\.size !== artifact\.size[\s\S]*sha256File\(target\)/, 'release assembly binds TUI signature evidence to the final bytes')
assert(packagedValidator.includes('runPackagedLaunchSmoke'), 'every native package must execute its installed main process')
assert(packagedValidator.includes("path.join(applicationRoot, 'zyra-desktop')"), 'Linux package validation must use electron-builder\u2019s executable name for the internal Desktop package')
assert(packagedValidator.includes('getCurrentFuseWire'), 'every native package must verify the fuses on its actual executable')
assert(packagedValidator.includes("platform === 'windows' ? 180_000 : 90_000"), 'cold unsigned package scans need a bounded native-platform launch allowance')
assert(packagedValidator.includes("ZYRA_PACKAGED_SMOKE: '1'"), 'packaged launch smoke must use the bounded release probe')
assert.match(packagedValidator, /platform === 'linux'[\s\S]*process\.env\.CI[\s\S]*!process\.env\.DISPLAY[\s\S]*'xvfb-run'[\s\S]*'--auto-servernum'/, 'packaged Linux launch validation must provide Electron with a virtual display on headless CI')
assert.match(packagedValidator, /child\.once\('exit', \(code, signal\)[\s\S]*signal \$\{exit\.signal/, 'packaged launch failures must preserve signal diagnostics')
assert.match(mainSource, /if \(process\.env\.ZYRA_PACKAGED_SMOKE === '1'\)[\s\S]*await runPackagedLaunchSmoke\(\)[\s\S]*app\.exit\(0\)[\s\S]*return[\s\S]*void initializeProtectedMedia\(\)/, 'the packaged release probe must exit deterministically before normal runtime services start')
assert(preflightSource.includes("const taggedPublication = mode === 'tag'"), 'every public tag must enter the signing gate')
assert(preflightSource.includes("require_signing=${taggedPublication ? 'true' : 'false'}"), 'alpha, beta, and stable tags must all require native signing')
assert(preflightSource.includes("'EVS_ACCOUNT_NAME'") && preflightSource.includes("'EVS_PASSWD'"), 'tagged releases require Widevine VMP credentials')
assert(preflightSource.includes("'ZYRA_WINDOWS_CERTIFICATE_THUMBPRINT'") && preflightSource.includes("'ZYRA_MACOS_TEAM_ID'"), 'tagged releases pin standalone TUI publisher identities')
assert(preflightSource.includes("ZYRA_ACCEPT_ECS_SECURITY_DELTA === 'true'"), 'tagged releases require explicit acceptance of the current ECS patch-level delta')
assert(vmpSignerSource.includes("'before-code-sign'") && vmpSignerSource.includes("platform !== 'darwin'"), 'macOS VMP signing runs before Apple code signing')
assert(vmpAfterPackSource.includes('Electron Framework.sig') && vmpAfterPackSource.includes('arm64') && vmpAfterPackSource.includes('x64'), 'macOS universal staging removes incompatible per-architecture VMP signatures before merging')
assert.match(releaseWorkflowSource, /- name: Build native package and updater metadata[\s\S]*EVS_ACCOUNT_NAME:[\s\S]*EVS_PASSWD:/, 'EVS credentials are scoped to the native packaging step')
assert.match(releaseWorkflowSource, /- name: Build native package and updater metadata[\s\S]*NODE_OPTIONS: --max-old-space-size=4096/, 'native release packaging must have enough heap for the renderer production graph')
assert.doesNotMatch(releaseWorkflowSource, /GITHUB_ENV/, 'signing credentials cannot leak into later smoke or upload steps')
assert.match(releaseWorkflowSource, /EVS_ACCOUNT_NAME: \$\{\{ github\.event_name == 'push' && secrets\.EVS_ACCOUNT_NAME \|\| '' \}\}/, 'manual rehearsals do not receive EVS credentials during preflight')
assert.match(releaseWorkflowSource, /EVS_ACCOUNT_NAME: \$\{\{ needs\.preflight\.outputs\.publish == 'true' && matrix\.platform != 'linux'/, 'unsigned native rehearsals do not receive EVS credentials during packaging')
assert.match(releaseWorkflowSource, /- name: Smoke Widevine protected media[\s\S]*npm --prefix desktop run smoke:protected-media/, 'native release runners probe Widevine before packaging')
assert.match(releaseWorkflowSource, /- name: Sign and verify standalone TUI binaries[\s\S]*sign-standalone-tui\.mjs/, 'tagged publication signs standalone TUI binaries before upload')
assert.match(releaseWorkflowSource, /macos-arm64[\s\S]*test-standalone-tui-binary\.mjs[\s\S]*macos-x64/, 'both macOS standalone TUI architectures are smoked')
assert(vmpSignerSource.includes("'after-code-sign'") && vmpSignerSource.includes("platform !== 'win32'"), 'Windows VMP signing runs after Authenticode')
assert(!preflightSource.includes('stablePublication'), 'prerelease tags must not bypass signing/notarization')
assert.match(persistenceSource, /Boolean\(process\.versions\.electron\)[\s\S]*openNativeAssistantDatabase/, 'Electron production persistence must use disk-backed native SQLite')
assert.match(nativeSqliteSource, /node:sqlite[\s\S]*journal_mode = WAL/, 'native Assistant persistence must use Electron’s bundled SQLite with WAL durability')
assert(desktopPackage.scripts['test:native-sqlite'].includes('test-native-sqlite-adapter.mjs'))

const globalResources = build.extraResources
assert(globalResources.some((entry: { from: string; to: string }) => entry.from === '../LICENSE' && entry.to === 'LICENSE'))
assert(globalResources.some((entry: { from: string; to: string }) => entry.from === '../NOTICE' && entry.to === 'NOTICE'))
assert(globalResources.some((entry: { from: string; to: string }) => entry.from === '../THIRD_PARTY_NOTICES.md' && entry.to === 'THIRD_PARTY_NOTICES.md'))
assert(globalResources.some((entry: { from: string; to: string }) => entry.from === '../THIRD_PARTY_LICENSES.txt' && entry.to === 'THIRD_PARTY_LICENSES.txt'))
const thirdPartyNotices = readFileSync(path.join(repositoryRoot, 'THIRD_PARTY_NOTICES.md'), 'utf8')
assert.match(thirdPartyNotices, /Product logos from SVGL[\s\S]*MIT License/)
assert.match(thirdPartyNotices, /Developer-tool logos from Simple Icons[\s\S]*CC0 1\.0 Universal/)
assert.match(thirdPartyNotices, /Material Icon Theme file icons[\s\S]*MIT license/)
assert.match(thirdPartyNotices, /Kenney UI Audio voice cues[\s\S]*CC0 1\.0 Universal/)
assert(globalResources.some((entry: { from: string; to: string }) => entry.from === '.release/zyra-runtime' && entry.to === 'zyra-runtime'))
assert(
    globalResources.some((entry: { from: string; to: string }) =>
        entry.from === '.release/zyra-runtime/node_modules' && entry.to === 'zyra-runtime/node_modules'),
    'staged dependencies need their own resource mapping because electron-builder excludes a matcher-root node_modules directory'
)
assert(globalResources.some((entry: { to: string }) => entry.to === 'zyra-browser-control-extension'))
assert(!globalResources.some((entry: { to: string }) => entry.to === 'zyra-computer-use'), 'Windows sidecar cannot be a global resource')
assert(build.win.extraResources.some((entry: { to: string }) => entry.to === 'zyra-computer-use'))

assert.deepEqual(build.win.target, [{ target: 'nsis', arch: ['x64'] }])
assert.equal(build.win.artifactName, 'Zyra-Desktop-${version}-Windows-${arch}.${ext}')
assert.equal(build.nsis.oneClick, false)
assert.equal(build.nsis.allowToChangeInstallationDirectory, true)
assert.equal(build.nsis.include, 'build/installer.nsh')
assert.deepEqual(build.mac.target, [
    { target: 'dmg', arch: ['universal'] },
    { target: 'zip', arch: ['universal'] }
])
assert(build.mac.extraResources.some((entry: { to: string }) => entry.to === 'ELECTRON-LICENSE.txt'))
assert(build.mac.extraResources.some((entry: { to: string }) => entry.to === 'CHROMIUM-THIRD-PARTY-LICENSES.html'))
assert.equal(build.mac.artifactName, 'Zyra-Desktop-${version}-macOS-${arch}.${ext}')
assert.equal(
    build.mac.x64ArchFiles,
    'Contents/Resources/{zyra-runtime/node_modules/**,app.asar.unpacked/node_modules/node-pty/prebuilds}/*darwin-{arm64,x64}*/**/*',
    'universal merging must preserve explicitly architecture-qualified runtime and node-pty prebuilds without trying to lipo identical copies'
)
assert.equal(build.mac.hardenedRuntime, true)
assert.equal(build.mac.category, 'public.app-category.developer-tools')
assert.match(build.mac.extendInfo.NSMicrophoneUsageDescription, /microphone/i)
assert.equal(build.mac.entitlements, 'build/entitlements.mac.plist')
assert.equal(build.mac.entitlementsInherit, 'build/entitlements.mac.inherit.plist')
assert.deepEqual(build.linux.target, [
    { target: 'AppImage', arch: ['x64'] },
    { target: 'deb', arch: ['x64'] }
])
assert.equal(build.linux.artifactName, 'Zyra-Desktop-${version}-Linux-x64.${ext}', 'the x64-only Linux producer must match the public updater and install contract instead of target-specific x86_64/amd64 aliases')
assert.equal(build.linux.icon, 'resources/icons')
assert.equal(build.fileAssociations[0].icon, 'resources/icon')
assert.equal(build.generateUpdatesFilesForAllChannels, true)

for (const platform of ['windows', 'macos', 'linux'] as const) {
    const contract = platformReleaseContract(rootPackage.version, platform)
    assert(contract.assets.every((name) => name.includes(rootPackage.version) || name.startsWith('latest')))
    const updaterContract = resolvePlatformReleaseContract(
        rootPackage.version,
        platform === 'windows' ? 'win32' : platform === 'macos' ? 'darwin' : 'linux',
        platform === 'macos' ? 'arm64' : 'x64'
    )
    assert.deepEqual(updaterContract?.requiredAssetNames, contract.assets, `${platform} build and updater asset contracts must match`)
}
assert.equal(expectedReleaseAssetNames(rootPackage.version).length, 14)
assert(
    expectedReleaseAssetNames(rootPackage.version).includes(`Zyra-Desktop-${rootPackage.version}-Windows-x64.exe`),
    'Desktop artifacts must retain the user-facing product name'
)
for (const target of ['windows-x64', 'macos-arm64', 'macos-x64', 'linux-x64']) {
    const suffix = target === 'windows-x64' ? '.exe' : ''
    assert(expectedReleaseAssetNames(rootPackage.version).includes(`Zyra-TUI-${rootPackage.version}-${target}${suffix}`), `unified release must include ${target} TUI`)
}

const electronConfig = readFileSync(path.join(desktopRoot, 'electron.vite.config.ts'), 'utf8')
const browserConfig = readFileSync(path.join(desktopRoot, 'vite.browser.config.ts'), 'utf8')
const browserRuntimeTsconfig = readFileSync(path.join(desktopRoot, 'tsconfig.browser-runtime.json'), 'utf8')
const monacoRuntime = readFileSync(path.join(desktopRoot, 'src', 'renderer', 'src', 'lib', 'monaco', 'runtime.ts'), 'utf8')
const updatesSource = readFileSync(path.join(desktopRoot, 'src', 'renderer', 'src', 'lib', 'app-updates.tsx'), 'utf8')
const browserAdapterSource = readFileSync(path.join(desktopRoot, 'src', 'renderer', 'src', 'lib', 'browser-devscope-adapter.ts'), 'utf8')
const buildMetadataSource = readFileSync(path.join(desktopRoot, 'src', 'renderer', 'src', 'lib', 'release-build-metadata.ts'), 'utf8')
const aboutSource = readFileSync(path.join(desktopRoot, 'src', 'renderer', 'src', 'pages', 'settings', 'AboutSettings.tsx'), 'utf8')
assert(electronConfig.includes('__ZYRA_DESKTOP_VERSION__: JSON.stringify(desktopVersion)'))
assert.doesNotMatch(electronConfig, /['"]monaco-vs['"]\s*:/, 'Monaco worker resolution cannot depend on a Vite alias that a running dev server may have loaded before HMR')
for (const monacoAsset of [
    'editor/editor.worker.js?worker',
    'language/json/json.worker.js?worker',
    'language/css/css.worker.js?worker',
    'language/html/html.worker.js?worker',
    'language/typescript/ts.worker.js?worker',
    'base/browser/ui/codicons/codicon/codicon.ttf?url',
    'base/browser/ui/codicons/codicon/codicon.css'
]) {
    assert(
        monacoRuntime.includes(`../../../../../node_modules/monaco-editor/esm/vs/${monacoAsset}`),
        `Monaco 0.56 asset ${monacoAsset} must use a config-independent filesystem path`
    )
}
assert.doesNotMatch(browserRuntimeTsconfig, /monaco-workers\.d\.ts/, 'Browser-runtime typechecking cannot retain the removed alias declaration file')
assert(browserConfig.includes('__ZYRA_DESKTOP_VERSION__: JSON.stringify(desktopVersion)'))
assert(updatesSource.includes('reportHostDesktopVersion'), 'Desktop and Browser update surfaces must report the host package version')
assert(browserAdapterSource.includes('currentVersion: __ZYRA_DESKTOP_VERSION__'))
assert(!browserAdapterSource.includes("currentVersion: '0.1.0'"))
assert(buildMetadataSource.includes('__ZYRA_DESKTOP_VERSION__'))
assert(aboutSource.includes('useWindowChrome()'))
assert(aboutSource.includes('Apache-2.0'))
assert(!aboutSource.includes("'v0.5.0'") && !aboutSource.includes('>Windows<') && !aboutSource.includes('>MIT<'))

const ciWorkflow = readFileSync(path.join(repositoryRoot, '.github', 'workflows', 'desktop-ci.yml'), 'utf8')
const releaseWorkflow = readFileSync(path.join(repositoryRoot, '.github', 'workflows', 'desktop-release.yml'), 'utf8')
assert(ciWorkflow.includes('windows-2025') && ciWorkflow.includes('macos-15') && ciWorkflow.includes('ubuntu-24.04'))
assert.match(ciWorkflow, /Verify canonical generated branding[\s\S]*if: matrix\.platform == 'linux'[\s\S]*git diff --exit-code -- desktop\/resources/, 'byte-level branding drift must use one canonical Pillow host while every platform keeps structural validation')
assert(releaseWorkflow.includes('workflow_dispatch:') && releaseWorkflow.includes('tags:'))
assert(releaseWorkflow.includes(`default: "${rootPackage.version}"`), 'manual rehearsal defaults must match the current lockstep release')
assert(releaseWorkflow.includes('Create or verify the private draft'))
assert(releaseWorkflow.includes('validate-github-draft.mjs'))
assert(releaseWorkflow.includes('--sha="${RELEASE_SHA}" --branch=master'))
assert(releaseWorkflow.includes('RELEASE_SHA: ${{ needs.preflight.outputs.head }}'))
assert(releaseWorkflow.includes("format('rehearsal-{0}-{1}', needs.preflight.outputs.tag, github.run_id)"), 'unsigned rehearsals must not create the production tag')
assert(releaseWorkflow.indexOf('Create or verify the private draft') < releaseWorkflow.indexOf('Publish only the signed and notarized tagged candidate'))
assert(releaseWorkflow.includes('Keep unsigned workflow-dispatch builds unpublished'))
assert(releaseWorkflow.includes('EXPECTED_VERSION: ${{ inputs.version }}'))
assert(releaseWorkflow.includes('--expected-version="${EXPECTED_VERSION}"'))
assert(!releaseWorkflow.includes('--expected-version="${{ inputs.version }}"'), 'workflow inputs must not be interpolated into a secret-bearing shell script')
assert(releaseWorkflow.includes("needs.preflight.outputs.publish != 'true'"))
assert(releaseWorkflow.includes("needs.preflight.outputs.publish == 'true'"))
assert(releaseWorkflow.includes('gh release upload "${RELEASE_TAG}" release-assets/* --repo "${GITHUB_REPOSITORY}" --clobber'))
assert(!releaseWorkflow.includes('origin/main') && !releaseWorkflow.includes('refs/remotes/origin/main'))
for (const secret of [
    'ZYRA_WINDOWS_CERTIFICATE',
    'ZYRA_WINDOWS_CERTIFICATE_PASSWORD',
    'ZYRA_WINDOWS_CERTIFICATE_THUMBPRINT',
    'ZYRA_MACOS_CERTIFICATE',
    'ZYRA_MACOS_CERTIFICATE_PASSWORD',
    'ZYRA_MACOS_TEAM_ID',
    'ZYRA_MACOS_NOTARIZATION_API_KEY',
    'ZYRA_MACOS_NOTARIZATION_KEY_ID',
    'ZYRA_MACOS_NOTARIZATION_ISSUER_ID',
    'EVS_ACCOUNT_NAME',
    'EVS_PASSWD',
    'ZYRA_ACCEPT_ECS_SECURITY_DELTA'
]) {
    assert(releaseWorkflow.includes(secret), `release workflow must gate ${secret}`)
}

console.log(`Zyra Desktop v${rootPackage.version} release infrastructure contract: ok`)
