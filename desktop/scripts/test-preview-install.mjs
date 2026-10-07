import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { UUID } from 'builder-util-runtime'
import { AppInfo } from 'app-builder-lib/out/appInfo.js'
import { getWindowsInstallationDirName } from 'app-builder-lib/out/targets/targetUtil.js'
import { previewInstallPolicy, installedValidatorArgs, assertHostedWindows, assertHostedInstallLocation } from './release/validate-preview-install.mjs'

const sourceSha = 'a'.repeat(40)
function fixture() {
    return {
        platform: 'win32', desktopRoot: 'D:\\a\\zyra\\zyra\\source\\desktop', sourceSha, version: '0.7.0-dev.7',
        env: { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', RUNNER_OS: 'Windows', ZYRA_BUILD_DISTRIBUTION: 'preview',
            GITHUB_RUN_ID: '123', GITHUB_RUN_NUMBER: '7', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: 'b'.repeat(40),
            ZYRA_BUILD_SOURCE_SHA: sourceSha, ZYRA_BUILD_SOURCE_REPOSITORY: 'example/source', GITHUB_REPOSITORY: 'example/helper',
            GITHUB_WORKSPACE: 'D:\\a\\zyra\\zyra', SystemRoot: 'C:\\Windows', LOCALAPPDATA: 'C:\\Users\\developer\\AppData\\Local', APPDATA: 'C:\\Users\\developer\\AppData\\Roaming' },
        packageMetadata: { name: 'zyra-desktop', version: '0.7.0-dev.7' },
        config: { appId: 'app.zyra.desktop.preview', productName: 'Zyra Preview', executableName: 'Zyra Preview', publish: null,
            directories: { output: 'D:\\a\\zyra\\zyra\\source\\desktop\\dist\\previews\\123\\raw' },
            nsis: { oneClick: true, perMachine: false, allowToChangeInstallationDirectory: false, include: 'build/preview-installer.nsh', differentialPackage: false } },
        request: { sourceVersion: '0.7.0', version: '0.7.0-dev.7', sourceSha, sourceRepository: 'example/source', runId: '123', runAttempt: '1', workflowSha: 'b'.repeat(40), channel: 'dev', target: 'windows-x64' },
        installer: 'D:\\a\\zyra\\zyra\\source\\desktop\\dist\\previews\\123\\raw\\Zyra-Preview-0.7.0-dev.7-Windows-x64.exe'
    }
}

const policy = previewInstallPolicy(fixture())
const explicitNullIdentity = fixture()
explicitNullIdentity.request.sourcePr = null
explicitNullIdentity.request.requestId = null
assert.deepEqual(previewInstallPolicy(explicitNullIdentity), policy, 'Missing legacy PR/request fields and explicit null identities are equivalent')
assert.equal(policy.installRoot, 'C:\\Users\\developer\\AppData\\Local\\Programs\\zyra-desktop')
assert.equal(policy.profileRoot, 'C:\\Users\\developer\\AppData\\Roaming\\Zyra Preview')
assert.equal(policy.registryKeys.length, 4)
// Check the real installed builder's namespace and derivation, rather than a second copy of our GUID.
const require = createRequire(import.meta.url)
const builder = readFileSync(require.resolve('app-builder-lib/out/targets/nsis/NsisTarget.js'), 'utf8')
const namespace = builder.match(/ELECTRON_BUILDER_NS_UUID\s*=\s*builder_util_runtime_1\.UUID\.parse\("([a-f0-9-]+)"\)/)?.[1]
assert.ok(namespace, 'The installed builder UUID namespace contract changed')
assert.match(builder, /options\.guid\s*\|\|\s*builder_util_runtime_1\.UUID\.v5\(appInfo\.id, ELECTRON_BUILDER_NS_UUID\)/)
const derivedGuid = UUID.v5(fixture().config.appId, UUID.parse(namespace))
assert.ok(policy.registryKeys.every(key => key.toLowerCase().endsWith(derivedGuid.toLowerCase())), 'Preview registry guard must match the installed builder')
const input = fixture()
const appInfo = new AppInfo({ config: input.config, metadata: input.packageMetadata })
assert.match(builder, /APP_FILENAME:\s*\(0, targetUtil_1\.getWindowsInstallationDirName\)\(appInfo, !oneClick \|\| isPerMachine\)/)
assert.equal(getWindowsInstallationDirName(appInfo, !input.config.nsis.oneClick || input.config.nsis.perMachine),
    path.win32.basename(policy.installRoot), 'Default one-click/per-user directory must match the actual builder')
const installSection = readFileSync(require.resolve('app-builder-lib/templates/nsis/installSection.nsh'), 'utf8')
const oneClickLaunch = installSection.slice(installSection.lastIndexOf('!ifdef ONE_CLICK'))
assert.match(oneClickLaunch, /!ifdef RUN_AFTER_FINISH\s*\$\{ifNot\} \$\{Silent\}\s*\$\{orIf\} \$\{isForceRun\}\s*!insertmacro doStartApp/,
    'The actual one-click template must suppress automatic launch for /S without --force-run')
assert.match(oneClickLaunch, /!else\s*\$\{if\} \$\{isForceRun\}\s*!insertmacro doStartApp/,
    'Disabling runAfterFinish must still require explicit force-run')
const multiUser = readFileSync(require.resolve('app-builder-lib/templates/nsis/multiUser.nsh'), 'utf8')
const knownFolderGuid = multiUser.match(/!define FOLDERID_UserProgramFiles ([^\r\n]+)/)?.[1]
assert.ok(knownFolderGuid, 'The installed builder UserProgramFiles contract changed')
let nativeScript
const fakeQuery = (command, args, options) => {
    assert.equal(command, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    assert.deepEqual(args.slice(0, 4), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command'])
    assert.equal(options.timeout, 30_000)
    assert.equal(options.windowsHide, true)
    nativeScript = args[4]
    return 'c:\\users\\developer\\appdata\\local\\programs\\\r\n'
}
assertHostedInstallLocation(input.platform, input.env, fakeQuery)
assert.ok(nativeScript.includes(knownFolderGuid.replace(/[{}]/g, '')), 'Native query must use the actual builder known-folder GUID')
assert.match(nativeScript, /SHGetKnownFolderPath\(ref folder, 0x00004000, IntPtr.Zero, out result\)/,
    'Query the configured folder without creating it')
assert.match(nativeScript, /finally[\s\S]*Marshal\.FreeCoTaskMem\(result\)/, 'Native result must be freed on success or failure')
assert.throws(() => assertHostedInstallLocation(input.platform, input.env, () => 'D:\\RedirectedPrograms'), /differs from LOCALAPPDATA/)
assert.throws(() => assertHostedInstallLocation(input.platform, input.env, () => ''), /absolute local-drive path/)
assert.throws(() => assertHostedInstallLocation(input.platform, input.env, () => { throw new Error('Native lookup failed') }), /Native lookup failed/)
for (const env of [{}, { ...input.env, RUNNER_ENVIRONMENT: 'self-hosted' }]) {
    assert.throws(() => assertHostedInstallLocation('win32', env, () => assert.fail('Local execution must not query native paths')))
}
const helper = readFileSync(new URL('./release/validate-preview-install.mjs', import.meta.url), 'utf8')
const preflightOffset = helper.indexOf('assertHostedInstallLocation(process.platform, process.env)')
assert.ok(preflightOffset >= 0 && preflightOffset < helper.indexOf('await mkdir(policy.profileRoot')
    && preflightOffset < helper.indexOf('await run(policy.installer'),
    'Known-folder preflight must run before profile creation or installer execution')
assert.deepEqual(installedValidatorArgs(policy), ['--platform=windows', `--raw-dir=${policy.installRoot}`, '--version=0.7.0-dev.7',
    '--executable-name=Zyra Preview', '--expected-distribution=preview', `--expected-source-sha=${sourceSha}`])
for (const [name, mutate] of [
    ['non-Windows execution', f => { f.platform = 'linux' }],
    ['local execution', f => { f.env.GITHUB_ACTIONS = undefined }],
    ['self-hosted execution', f => { f.env.RUNNER_ENVIRONMENT = 'self-hosted' }],
    ['mismatched prepared source', f => { f.request.sourceSha = 'c'.repeat(40) }],
    ['mismatched base version', f => { f.request.sourceVersion = '0.8.0' }],
    ['mismatched prepared run', f => { f.request.runId = '124' }],
    ['mismatched explicit request', f => { f.request.requestId = 'another-request' }],
    ['installation in source account', f => { f.env.GITHUB_REPOSITORY = 'example/source' }],
    ['stable installer identity', f => { f.config.appId = 'app.zyra.desktop' }],
    ['changed default path identity', f => { f.packageMetadata.name = 'Zyra' }],
    ['custom silent-install behavior', f => { f.config.nsis.script = 'custom-installer.nsi' }],
    ['different registry identity', f => { f.config.nsis.guid = '00000000-0000-0000-0000-000000000000' }],
    ['checkout outside CI workspace', f => { f.desktopRoot = 'C:\\Users\\developer\\projects\\zyra\\desktop' }],
    ['installer outside build output', f => { f.installer = 'C:\\Users\\developer\\Downloads\\Zyra-Preview-0.7.0-dev.7-Windows-x64.exe' }],
    ['installer from another run', f => { f.installer = f.installer.replace('123', '124') }],
    ['relative installation base', f => { f.env.LOCALAPPDATA = 'relative' }]
]) {
    const input = fixture()
    mutate(input)
    assert.throws(() => previewInstallPolicy(input), undefined, name)
}
assert.throws(() => assertHostedWindows('win32', {}))
// Exercise the real top-level-await CLI entry, not an imported builder whose
// CLI branch is skipped. Reject before filesystem reads or native queries.
const rejectedBuild = spawnSync(process.execPath, [fileURLToPath(new URL('./release/build-preview.mjs', import.meta.url)),
    'build', path.resolve('preview-preflight-must-not-be-read')], {
    env: { ...process.env, GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'self-hosted', RUNNER_OS: 'Windows',
        LOCALAPPDATA: 'relative-install-forbidden', APPDATA: 'relative-profile-forbidden' },
    encoding: 'utf8', timeout: 5_000, maxBuffer: 32_768, windowsHide: true
})
assert.equal(rejectedBuild.error, undefined, 'The actual build CLI must exit within the bounded timeout')
assert.notEqual(rejectedBuild.status, 0, 'The invalid runner cannot build')
assert.match(rejectedBuild.stderr, process.platform === 'win32'
    ? /Preview installation requires a hosted runner/ : /Preview installation requires Windows/,
    'The real CLI must reach the environment preflight instead of an ESM evaluation cycle or filesystem reads')
console.log('Preview install policy: hosted-only known-folder preflight, actual builder directory/GUID/silent-launch contracts, exact identity and installed validator arguments passed (no installer or native query executed)')
