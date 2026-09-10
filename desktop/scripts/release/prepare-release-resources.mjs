import { execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { access, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeReleasePlatform } from './release-contract.mjs'
import { NODE_RELEASE_RUNTIME_VERSION } from './runtime-contract.mjs'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const desktopRoot = path.resolve(scriptDirectory, '..', '..')
const repositoryRoot = path.resolve(desktopRoot, '..')

function arg(name, fallback = null) {
    const inline = process.argv.slice(2).find((value) => value.startsWith(`--${name}=`))
    if (inline) return inline.slice(name.length + 3)
    const index = process.argv.indexOf(`--${name}`)
    return index >= 0 ? process.argv[index + 1] : fallback
}

function run(executable, args, cwd) {
    return new Promise((resolve, reject) => {
        const useShell = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(executable)
        const child = spawn(executable, args, { cwd, stdio: 'inherit', shell: useShell })
        child.on('error', reject)
        child.on('exit', (code) => {
            if (code === 0) resolve()
            else reject(new Error(`${executable} ${args.join(' ')} exited with code ${code ?? 'unknown'}`))
        })
    })
}

async function requireFile(file, label) {
    await access(file).catch(() => {
        throw new Error(`${label} is missing: ${file}`)
    })
}

function resolveDotnetRoot() {
    const candidates = [process.env.DOTNET_ROOT]
    try {
        const locator = process.platform === 'win32' ? 'where.exe' : 'which'
        const executable = execFileSync(locator, ['dotnet'], { encoding: 'utf8' }).split(/\r?\n/).find(Boolean)
        if (executable) candidates.push(path.dirname(executable.trim()))
    } catch {
        // The explicit and standard installation paths below still apply.
    }
    if (process.platform === 'win32' && process.env.ProgramFiles) {
        candidates.push(path.join(process.env.ProgramFiles, 'dotnet'))
    }
    for (const candidate of candidates.filter(Boolean)) {
        if (existsSync(path.join(candidate, 'LICENSE.txt'))
            && existsSync(path.join(candidate, 'ThirdPartyNotices.txt'))) return candidate
    }
    throw new Error('The .NET SDK license files are missing. Install the pinned .NET 8 SDK before packaging Windows.')
}

const platform = normalizeReleasePlatform(arg('platform', process.platform))
const hostPlatform = normalizeReleasePlatform(process.platform)
if (platform !== hostPlatform) {
    throw new Error(`Release resources for ${platform} must be prepared on a native ${platform} host (current: ${hostPlatform}).`)
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const extensionRoot = path.join(repositoryRoot, 'extensions', 'zyra-browser-control')
await run(npm, ['--prefix', extensionRoot, 'ci', '--no-audit', '--no-fund'], repositoryRoot)
await run(npm, ['--prefix', extensionRoot, 'run', 'package'], repositoryRoot)
await requireFile(path.join(extensionRoot, 'dist', 'unpacked', 'manifest.json'), 'Packaged browser extension')
await requireFile(path.join(extensionRoot, 'dist', 'zyra-browser-control.zip'), 'Browser extension ZIP')

await run(process.execPath, [path.join(scriptDirectory, 'stage-zyra-runtime.mjs')], desktopRoot)

const nodeRuntimeDirectory = path.join(desktopRoot, '.release', 'zyra-node')
await rm(nodeRuntimeDirectory, { recursive: true, force: true })
await mkdir(nodeRuntimeDirectory, { recursive: true })
if (process.platform === 'win32') {
    if (process.versions.node !== NODE_RELEASE_RUNTIME_VERSION) {
        throw new Error(`Windows releases must package Node.js ${NODE_RELEASE_RUNTIME_VERSION}; got ${process.versions.node}.`)
    }
    const nodeRuntimePath = path.join(nodeRuntimeDirectory, 'node.exe')
    await copyFile(process.execPath, nodeRuntimePath)
    await requireFile(nodeRuntimePath, 'Pinned Windows Node runtime')
} else {
    await writeFile(path.join(nodeRuntimeDirectory, 'electron-run-as-node.txt'), 'Unix packages use the signed Electron executable with ELECTRON_RUN_AS_NODE=1.\n', 'utf8')
}

const sidecarOutput = path.join(desktopRoot, '.release', 'zyra-computer-use', 'win-x64')
await rm(path.join(desktopRoot, '.release', 'zyra-computer-use'), { recursive: true, force: true })
if (platform === 'windows') {
    const sidecarProject = path.join(
        repositoryRoot,
        'native',
        'zyra-computer-use',
        'src',
        'Zyra.ComputerUse',
        'Zyra.ComputerUse.csproj'
    )
    await run('dotnet', [
        'publish',
        sidecarProject,
        '-c', 'Release',
        '-r', 'win-x64',
        '--self-contained', 'true',
        '-p:PublishSingleFile=false',
        '-p:DebugType=None',
        '-p:DebugSymbols=false',
        '-o', sidecarOutput
    ], repositoryRoot)
    const dotnetRoot = resolveDotnetRoot()
    await copyFile(path.join(dotnetRoot, 'LICENSE.txt'), path.join(sidecarOutput, 'DOTNET-LICENSE.txt'))
    await copyFile(
        path.join(dotnetRoot, 'ThirdPartyNotices.txt'),
        path.join(sidecarOutput, 'DOTNET-THIRD-PARTY-NOTICES.txt')
    )
    for (const fileName of [
        'Zyra.ComputerUse.exe',
        'Zyra.ComputerUse.runtimeconfig.json',
        'coreclr.dll',
        'hostfxr.dll',
        'DOTNET-LICENSE.txt',
        'DOTNET-THIRD-PARTY-NOTICES.txt'
    ]) {
        await requireFile(path.join(sidecarOutput, fileName), 'Self-contained Windows computer-use sidecar')
    }
}

const rootPackage = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'))
console.log(`Prepared Zyra ${rootPackage.version} release resources for ${platform}.`)
