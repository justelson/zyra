import { spawn } from 'node:child_process'
import { access, lstat, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { FuseV1Options, getCurrentFuseWire } from '@electron/fuses'
import { normalizeReleasePlatform } from './release-contract.mjs'
import { validateRuntimeStage } from './runtime-contract.mjs'

function arg(name, fallback = null) {
    const inline = process.argv.slice(2).find((value) => value.startsWith(`--${name}=`))
    if (inline) return inline.slice(name.length + 3)
    const index = process.argv.indexOf(`--${name}`)
    return index >= 0 ? process.argv[index + 1] : fallback
}

async function exists(target) {
    try {
        await access(target)
        return true
    } catch {
        return false
    }
}

async function findResourcesDirectory(root, depth = 0) {
    if (depth > 5) return null
    if (await exists(path.join(root, 'app.asar'))) return root
    const entries = await readdir(root, { withFileTypes: true })
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        if (!entry.isDirectory()) continue
        const found = await findResourcesDirectory(path.join(root, entry.name), depth + 1)
        if (found) return found
    }
    return null
}

async function requireNonempty(file, label) {
    const stats = await lstat(file).catch(() => null)
    if (!stats?.isFile() || stats.size <= 0) throw new Error(`${label} is missing or empty: ${file}`)
}

async function requireOne(files, label) {
    for (const file of files) {
        const stats = await lstat(file).catch(() => null)
        if (stats?.isFile() && stats.size > 0) return
    }
    throw new Error(`${label} is missing; checked ${files.join(', ')}`)
}

async function findPackagedExecutable(resources, platform) {
    const applicationRoot = path.dirname(resources)
    const candidates = platform === 'windows'
        ? [path.join(applicationRoot, `${arg('executable-name', 'Zyra')}.exe`)]
        : platform === 'macos'
            ? [path.join(applicationRoot, 'MacOS', 'Zyra')]
            : [
                path.join(applicationRoot, 'zyra-desktop'),
                path.join(applicationRoot, 'zyra'),
                path.join(applicationRoot, 'Zyra')
            ]
    for (const candidate of candidates) {
        const stats = await lstat(candidate).catch(() => null)
        if (stats?.isFile() && stats.size > 0) return candidate
    }
    throw new Error(`Packaged ${platform} executable is missing; checked ${candidates.join(', ')}`)
}

async function validatePackagedFuses(resources, platform) {
    const executable = await findPackagedExecutable(resources, platform)
    const fuses = await getCurrentFuseWire(executable)
    const enabled = 49
    const disabled = 48
    const expected = new Map([
        [FuseV1Options.RunAsNode, enabled],
        [FuseV1Options.EnableCookieEncryption, enabled],
        [FuseV1Options.EnableNodeOptionsEnvironmentVariable, disabled],
        [FuseV1Options.EnableNodeCliInspectArguments, disabled],
        [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, enabled],
        [FuseV1Options.OnlyLoadAppFromAsar, enabled]
    ])
    for (const [fuse, state] of expected) {
        if (fuses[fuse] !== state) {
            throw new Error(`Packaged Electron fuse ${FuseV1Options[fuse]} is ${fuses[fuse]}; expected ${state}.`)
        }
    }
}

async function runPackagedLaunchSmoke(resources, platform, version) {
    const executable = await findPackagedExecutable(resources, platform)
    const launchTimeoutMs = platform === 'windows' ? 180_000 : 90_000
    const smokeDirectory = await mkdtemp(path.join(tmpdir(), 'zyra-packaged-launch-'))
    const marker = path.join(smokeDirectory, 'launch.json')
    let output = ''
    try {
        const applicationArgs = ['--headless', '--disable-gpu', '--no-sandbox']
        const useVirtualDisplay = platform === 'linux' && Boolean(process.env.CI) && !process.env.DISPLAY
        const child = spawn(useVirtualDisplay ? 'xvfb-run' : executable, useVirtualDisplay
            ? ['--auto-servernum', executable, ...applicationArgs]
            : applicationArgs, {
            env: {
                ...process.env,
                ZYRA_PACKAGED_SMOKE: '1',
                ZYRA_PACKAGED_SMOKE_MARKER: marker,
                ZYRA_DISABLE_AUTO_UPDATE: '1'
            },
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true
        })
        child.stdout?.on('data', (chunk) => { if (output.length < 64 * 1024) output += chunk })
        child.stderr?.on('data', (chunk) => { if (output.length < 64 * 1024) output += chunk })
        const exit = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                child.kill('SIGKILL')
                reject(new Error(`Packaged ${platform} launch smoke timed out.\n${output}`))
            }, launchTimeoutMs)
            child.once('error', (error) => {
                clearTimeout(timeout)
                reject(error)
            })
            child.once('exit', (code, signal) => {
                clearTimeout(timeout)
                resolve({ code, signal })
            })
        })
        if (exit.code !== 0) {
            const status = exit.code === null ? `signal ${exit.signal || 'unknown'}` : `code ${exit.code}`
            throw new Error(`Packaged ${platform} launch exited with ${status}.\n${output}`)
        }
        const result = JSON.parse(await readFile(marker, 'utf8'))
        if (result.version !== version || result.platform !== (platform === 'windows' ? 'win32' : platform === 'macos' ? 'darwin' : 'linux')) {
            throw new Error(`Packaged launch identity is invalid: ${JSON.stringify(result)}`)
        }
        if (arg('expected-distribution') === 'preview') {
            if (result.distribution !== 'preview' || result.sourceSha !== arg('expected-source-sha')
                || result.appName !== 'Zyra Preview' || path.basename(result.userDataPath) !== 'Zyra Preview'
                || !result.namespaceId) throw new Error('Packaged preview identity or provenance is invalid')
        }
        if (path.resolve(result.resourcesPath) !== path.resolve(resources)
            || path.resolve(result.runtimeRoot) !== path.resolve(resources, 'zyra-runtime')) {
            throw new Error(`Packaged launch resolved the wrong runtime: ${JSON.stringify(result)}`)
        }
    } finally {
        await rm(smokeDirectory, { recursive: true, force: true })
    }
}

const rawDirectory = path.resolve(arg('raw-dir', '.'))
const platform = normalizeReleasePlatform(arg('platform', process.platform))
const version = arg('version')
if (!version) throw new Error('validate-packaged-app requires --version')
const resources = await findResourcesDirectory(rawDirectory)
if (!resources) throw new Error(`Could not find a packaged app resources directory under ${rawDirectory}`)
const expectedProductionVmp = arg('expected-production-vmp', 'false') === 'true'
const productionVmpMarkerPath = path.join(resources, 'zyra-widevine-vmp.json')
if (expectedProductionVmp) {
    await requireNonempty(productionVmpMarkerPath, 'Production Widevine VMP marker')
    const marker = JSON.parse(await readFile(productionVmpMarkerPath, 'utf8'))
    const expectedPlatform = platform === 'windows' ? 'win32' : platform === 'macos' ? 'darwin' : 'linux'
    if (marker.schemaVersion !== 1 || marker.productionVmp !== true || marker.platform !== expectedPlatform) {
        throw new Error('Production Widevine VMP marker is invalid for this package')
    }
} else if (await exists(productionVmpMarkerPath)) {
    throw new Error('Unsigned or unpacked packages must not claim production Widevine VMP status')
}

await requireNonempty(path.join(resources, 'LICENSE'), 'Packaged Apache-2.0 license')
await requireNonempty(path.join(resources, 'NOTICE'), 'Packaged Zyra notice')
await requireNonempty(path.join(resources, 'THIRD_PARTY_NOTICES.md'), 'Packaged third-party notices')
await requireNonempty(path.join(resources, 'THIRD_PARTY_LICENSES.txt'), 'Packaged third-party licenses')
const applicationRoot = path.dirname(resources)
if (platform === 'macos') {
    await requireNonempty(path.join(resources, 'ELECTRON-LICENSE.txt'), 'Packaged Electron license')
    await requireNonempty(path.join(resources, 'CHROMIUM-THIRD-PARTY-LICENSES.html'), 'Packaged Chromium licenses')
} else {
    await requireOne([
        path.join(applicationRoot, 'LICENSE.electron.txt'),
        path.join(applicationRoot, 'LICENSE')
    ], 'Packaged Electron license')
    await requireNonempty(path.join(applicationRoot, 'LICENSES.chromium.html'), 'Packaged Chromium licenses')
}
const runtimeRoot = path.join(resources, 'zyra-runtime')
await validateRuntimeStage(runtimeRoot, { expectedVersion: version, requireDependencies: true })
await requireNonempty(path.join(resources, 'zyra-browser-control-extension', 'manifest.json'), 'Packaged browser extension')

const sidecar = path.join(resources, 'zyra-computer-use')
if (platform === 'windows') {
    for (const fileName of [
        'Zyra.ComputerUse.exe',
        'coreclr.dll',
        'hostfxr.dll',
        'DOTNET-LICENSE.txt',
        'DOTNET-THIRD-PARTY-NOTICES.txt'
    ]) {
        await requireNonempty(path.join(sidecar, fileName), 'Self-contained packaged Windows sidecar')
    }
} else if (await exists(sidecar)) {
    throw new Error(`Windows computer-use sidecar leaked into the ${platform} package`)
}

const packagedNodePty = path.join(resources, 'app.asar.unpacked', 'node_modules', 'node-pty')
const nodePtyPackage = JSON.parse(await readFile(path.join(packagedNodePty, 'package.json'), 'utf8'))
if (nodePtyPackage.version !== '1.1.0') throw new Error(`Packaged node-pty version is ${nodePtyPackage.version}`)
if (platform === 'windows') {
    await requireNonempty(path.join(packagedNodePty, 'prebuilds', 'win32-x64', 'pty.node'), 'Packaged Windows node-pty binding')
} else if (platform === 'macos') {
    await requireNonempty(path.join(packagedNodePty, 'prebuilds', 'darwin-x64', 'pty.node'), 'Packaged macOS x64 node-pty binding')
    await requireNonempty(path.join(packagedNodePty, 'prebuilds', 'darwin-arm64', 'pty.node'), 'Packaged macOS arm64 node-pty binding')
} else {
    await requireOne([
        path.join(packagedNodePty, 'build', 'Release', 'pty.node'),
        path.join(packagedNodePty, 'prebuilds', 'linux-x64', 'pty.node')
    ], 'Packaged Linux node-pty binding')
}

await validatePackagedFuses(resources, platform)
await runPackagedLaunchSmoke(resources, platform, version)

console.log(`Validated packaged ${platform} app resources at ${resources}`)
