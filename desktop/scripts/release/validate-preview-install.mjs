import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { previewRequestIdentity, previewVersion } from './build-preview.mjs'
import { absoluteWindowsPath, assertHostedWindows, assertHostedInstallLocation } from './preview-install-environment.mjs'
export { assertHostedWindows, assertHostedInstallLocation } from './preview-install-environment.mjs'

const previewGuid = 'f40d1c64-09fc-5a67-8c47-1ed366ac53d7' // electron-builder UUIDv5 for app.zyra.desktop.preview.
const windows = path.win32

export function previewInstallPolicy({ platform, env, desktopRoot, packageMetadata, config, request, installer, version, sourceSha }) {
    assertHostedWindows(platform, env)
    assert.equal(env.ZYRA_BUILD_DISTRIBUTION, 'preview', 'Only Preview installation is allowed')
    const identity = previewRequestIdentity(env)
    for (const [key, expected] of Object.entries(identity)) {
        const actual = key === 'sourcePr' || key === 'requestId' ? request[key] ?? null : request[key]
        assert.equal(actual, expected, `The prepared ${key} differs`)
    }
    assert.match(sourceSha || '', /^[a-f0-9]{40}$/, 'An exact source SHA is required')
    assert.equal(sourceSha, env.ZYRA_BUILD_SOURCE_SHA, 'Source SHA differs from the workflow request')
    assert.equal(version, previewVersion(request.sourceVersion, env.GITHUB_RUN_NUMBER), 'Dev version differs from the prepared source/workflow run')
    assert.equal(packageMetadata.name, 'zyra-desktop', 'The default installation directory contract changed')
    assert.equal(packageMetadata.version, version, 'The source package version differs')
    assert.equal(request.version, version, 'The prepared preview version differs')
    assert.equal(request.sourceSha, sourceSha, 'The prepared preview source differs')
    assert.match(env.ZYRA_BUILD_SOURCE_REPOSITORY || '', /^[\w.-]+\/[\w.-]+$/, 'A source repository is required')
    assert.equal(request.sourceRepository, env.ZYRA_BUILD_SOURCE_REPOSITORY, 'The prepared repository differs')
    assert.match(env.GITHUB_REPOSITORY || '', /^[\w.-]+\/[\w.-]+$/, 'A helper repository is required')
    assert.notEqual(env.GITHUB_REPOSITORY.toLowerCase(), request.sourceRepository.toLowerCase(), 'Install validation must run in the helper repository')
    assert.equal(config.appId, 'app.zyra.desktop.preview', 'The installer must have the Preview app ID')
    assert.equal(config.productName, 'Zyra Preview', 'The installer must have the Preview product name')
    assert.equal(config.executableName, 'Zyra Preview', 'The installer must have the Preview executable name')
    assert.equal(config.publish, null, 'Preview publication must remain disabled')
    assert.equal(config.nsis?.oneClick, true, 'Silent launch behavior requires one-click NSIS')
    assert.equal(config.nsis?.perMachine, false, 'Only per-user installation is allowed')
    assert.equal(config.nsis?.allowToChangeInstallationDirectory, false, 'The default directory contract changed')
    assert.equal(config.nsis?.include, 'build/preview-installer.nsh', 'Only the isolated Preview hooks are allowed')
    assert.ok(!config.nsis?.script, 'A custom NSIS script cannot provide the validated silent-install contract')
    assert.equal(config.nsis?.differentialPackage, false, 'The manual Preview packaging contract changed')
    assert.ok(!config.nsis.guid || config.nsis.guid.toLowerCase() === previewGuid, 'The Preview registry identity changed')
    const desktop = absoluteWindowsPath(desktopRoot, 'Desktop root')
    const workspace = absoluteWindowsPath(env.GITHUB_WORKSPACE, 'Workflow workspace')
    const relative = windows.relative(workspace, desktop)
    assert.ok(relative && !relative.startsWith('..') && !windows.isAbsolute(relative), 'Desktop root must be inside the workflow workspace')
    const raw = windows.join(desktop, 'dist', 'previews', env.GITHUB_RUN_ID, 'raw')
    assert.equal(absoluteWindowsPath(config.directories?.output, 'Preview output').toLowerCase(), raw.toLowerCase(), 'The prepared output directory differs')
    const installerPath = absoluteWindowsPath(installer, 'Installer')
    assert.equal(installerPath.toLowerCase(), windows.join(raw, `Zyra-Preview-${version}-Windows-x64.exe`).toLowerCase(), 'Only this run\'s exact installer is allowed')
    return {
        installer: installerPath,
        installRoot: windows.join(absoluteWindowsPath(env.LOCALAPPDATA, 'Local app data'), 'Programs', 'zyra-desktop'),
        profileRoot: windows.join(absoluteWindowsPath(env.APPDATA, 'Roaming app data'), 'Zyra Preview'),
        registryKeys: ['HKEY_CURRENT_USER', 'HKEY_LOCAL_MACHINE'].flatMap(hive => [
            `${hive}\\Software\\${previewGuid}`,
            `${hive}\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${previewGuid}`
        ]),
        version, sourceSha
    }
}

export function installedValidatorArgs(policy) {
    return ['--platform=windows', `--raw-dir=${policy.installRoot}`, `--version=${policy.version}`,
        '--executable-name=Zyra Preview', '--expected-distribution=preview', `--expected-source-sha=${policy.sourceSha}`]
}

async function safeAncestors(target) {
    for (let current = path.resolve(target); ; current = path.dirname(current)) {
        const entry = await lstat(current).catch(error => { if (error.code === 'ENOENT') return null; throw error })
        assert.ok(!entry?.isSymbolicLink(), `Refusing a symlink or junction: ${current}`)
        if (path.dirname(current) === current) break
    }
}

function run(command, args, env, timeoutMs = 600_000) {
    return new Promise((resolve, reject) => {
        const started = performance.now()
        const child = spawn(command, args, { env, stdio: ['ignore', 'inherit', 'inherit'], shell: false, windowsHide: true })
        const timer = setTimeout(() => {
            child.kill()
            reject(new Error(`${path.basename(command)} timed out`))
        }, timeoutMs)
        child.once('error', error => { clearTimeout(timer); reject(error) })
        child.once('exit', (code, signal) => {
            clearTimeout(timer)
            if (code !== 0) reject(new Error(`${path.basename(command)} exited ${code ?? signal}`))
            else resolve(Math.round(performance.now() - started))
        })
    })
}

async function main() {
    assertHostedWindows(process.platform, process.env) // Before reading paths or performing any mutation.
    const values = Object.fromEntries(process.argv.slice(2).map(argument => {
        const match = argument.match(/^--(installer|version|source-sha)=(.+)$/)
        assert.ok(match, 'Use --installer=<absolute EXE> --version=<Dev version> --source-sha=<SHA>')
        return [match[1], match[2]]
    }))
    const desktopRoot = fileURLToPath(new URL('../../', import.meta.url))
    const releaseRoot = path.resolve(desktopRoot, '..', '.release')
    const [packageMetadata, config, request] = await Promise.all([
        path.join(desktopRoot, 'package.json'), path.join(releaseRoot, 'preview-builder.json'), path.join(releaseRoot, 'preview-request.json')
    ].map(async file => JSON.parse(await readFile(file, 'utf8'))))
    const policy = previewInstallPolicy({ platform: process.platform, env: process.env, desktopRoot,
        packageMetadata, config, request, installer: values.installer, version: values.version, sourceSha: values['source-sha'] })
    assertHostedInstallLocation(process.platform, process.env)
    await Promise.all([policy.installRoot, policy.profileRoot, policy.installer].map(safeAncestors))
    const priorInstall = await lstat(policy.installRoot).catch(error => { if (error.code === 'ENOENT') return null; throw error })
    assert.equal(priorInstall, null, 'Refusing to touch an existing installation before the fresh-install test')
    assert.ok((await lstat(policy.installer)).isFile(), 'The installer is not a regular file')
    const powershell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    // Fail if NSIS could discover an older Preview in a different registered location.
    await run(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
        `$ErrorActionPreference='Stop'; foreach ($key in @(${policy.registryKeys.map(key => `'Registry::${key}'`).join(',')})) { if (Test-Path -LiteralPath $key) { throw 'A Preview installation is already registered' } }`], process.env, 30_000)
    const sentinel = path.join(policy.profileRoot, `install-smoke-${randomUUID()}.txt`)
    const contents = `Preview profile preservation: ${randomUUID()}\n`
    const staleFile = path.join(policy.installRoot, `install-smoke-stale-${randomUUID()}.txt`)
    const validateInstalled = async stage => {
        await safeAncestors(policy.installRoot)
        const installRoot = await realpath(policy.installRoot)
        await run(process.execPath, [path.join(desktopRoot, 'scripts', 'release', 'validate-packaged-app.mjs'),
            ...installedValidatorArgs({ ...policy, installRoot })], process.env)
        assert.equal(await readFile(sentinel, 'utf8'), contents, `${stage} changed the Preview profile sentinel`)
    }
    let ownsSentinel = false
    try {
        await mkdir(policy.profileRoot, { recursive: true })
        await safeAncestors(policy.profileRoot)
        await writeFile(sentinel, contents, { flag: 'wx' })
        ownsSentinel = true
        const freshMs = await run(policy.installer, ['/S'], process.env)
        console.log(`Preview fresh silent install: ${freshMs} ms`)
        await validateInstalled('Fresh installation')
        await writeFile(staleFile, 'Must be removed by the old-version uninstaller\n', { flag: 'wx' })
        const reinstallMs = await run(policy.installer, ['/S', '--updated'], process.env)
        console.log(`Preview same-version repeat silent install: ${reinstallMs} ms`)
        await validateInstalled('Repeat installation')
        const remainingStaleFile = await lstat(staleFile).catch(error => { if (error.code === 'ENOENT') return null; throw error })
        assert.equal(remainingStaleFile, null, 'Repeat installation did not remove the old installed files')
        console.log('Preview actual installer: fresh/repeat installed resource and launch checks, profile preservation passed')
    } finally {
        if (ownsSentinel) {
            await safeAncestors(sentinel)
            await unlink(sentinel).catch(error => { if (error.code !== 'ENOENT') throw error })
        }
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main()
