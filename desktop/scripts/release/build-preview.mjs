import { spawn, execFileSync } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, writeFile, readdir, stat, copyFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export function previewVersion(version, runNumber) {
    const core = String(version).match(/^(\d+\.\d+\.\d+)(?:-(?:alpha|beta)\.\d+)?$/)?.[1]
    if (!core || !/^[1-9]\d*$/.test(String(runNumber)) || Number(runNumber) > 65535) throw new Error('Invalid preview version/run number')
    return `${core}-alpha.${runNumber}`
}

export function previewBuilderConfig(build, output) {
    return {
        ...build,
        appId: 'app.zyra.desktop.preview',
        productName: 'Zyra Preview',
        executableName: 'Zyra Preview',
        fileAssociations: [],
        protocols: [],
        publish: null,
        directories: { ...build.directories, output },
        win: { ...build.win, artifactName: 'Zyra-Preview-${version}-Windows-${arch}.${ext}' },
        nsis: { ...build.nsis, include: 'build/preview-installer.nsh', differentialPackage: false, oneClick: true, perMachine: false, allowToChangeInstallationDirectory: false }
    }
}

export async function preparePreview(root, env) {
    if (!/^[a-f0-9]{40}$/.test(env.ZYRA_BUILD_SOURCE_SHA || '')) throw new Error('Preview requires an exact source SHA')
    if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}\/[a-zA-Z0-9_.-]+$/.test(env.ZYRA_BUILD_SOURCE_REPOSITORY || '')) throw new Error('Invalid source repository')
    if (!/^\d+$/.test(env.GITHUB_RUN_ID || '')) throw new Error('Missing workflow run identity')
    const actual = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
    if (actual !== env.ZYRA_BUILD_SOURCE_SHA) throw new Error('Checked-out source does not match requested SHA')
    if (execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8' }).trim()) throw new Error('Preview preparation requires a clean source checkout')
    const files = ['package.json', 'package-lock.json', 'desktop/package.json', 'desktop/package-lock.json']
    const packages = await Promise.all(files.map(async file => JSON.parse(await readFile(path.join(root, file), 'utf8'))))
    const sourceVersion = packages[0].version
    if (packages.some(pkg => pkg.version !== sourceVersion) || packages[1].packages[''].version !== sourceVersion || packages[3].packages[''].version !== sourceVersion) throw new Error('Preview source versions are not lockstep')
    const version = previewVersion(sourceVersion, env.GITHUB_RUN_NUMBER)
    for (const pkg of packages) { pkg.version = version; if (pkg.packages) pkg.packages[''].version = version }
    await Promise.all(files.map((file, index) => writeFile(path.join(root, file), `${JSON.stringify(packages[index], null, 4)}\n`)))
    const output = path.join(root, 'desktop', 'dist', 'previews', env.GITHUB_RUN_ID)
    await mkdir(path.join(root, '.release'), { recursive: true })
    const config = previewBuilderConfig(packages[2].build, path.join(output, 'raw'))
    await writeFile(path.join(root, '.release', 'preview-builder.json'), `${JSON.stringify(config, null, 2)}\n`)
    await writeFile(path.join(root, '.release', 'preview-request.json'), JSON.stringify({ sourceSha: actual, sourceRepository: env.ZYRA_BUILD_SOURCE_REPOSITORY, sourceVersion, version }))
    return { version, sourceVersion, output }
}

function run(command, args, cwd, env) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd, env, stdio: 'inherit', shell: process.platform === 'win32' && /\.cmd$/.test(command) })
        child.once('error', reject)
        child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)))
    })
}

async function build(root, env) {
    if (process.platform !== 'win32' || env.GITHUB_ACTIONS !== 'true') throw new Error('Personal previews are built only on hosted Windows CI')
    const desktop = path.join(root, 'desktop')
    const version = JSON.parse(await readFile(path.join(desktop, 'package.json'), 'utf8')).version
    const request = JSON.parse(await readFile(path.join(root, '.release', 'preview-request.json'), 'utf8'))
    if (!version.includes('-alpha.') || version !== request.version || request.sourceSha !== env.ZYRA_BUILD_SOURCE_SHA || request.sourceRepository !== env.ZYRA_BUILD_SOURCE_REPOSITORY) throw new Error('Preview request/version identity changed after preparation')
    if (execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() !== request.sourceSha) throw new Error('Preview source checkout changed after preparation')
    const output = path.join(desktop, 'dist', 'previews', env.GITHUB_RUN_ID)
    const raw = path.join(output, 'raw')
    const upload = path.join(output, 'upload')
    const buildEnv = { ...env, ZYRA_BUILD_DISTRIBUTION: 'preview', CSC_IDENTITY_AUTO_DISCOVERY: 'false', ZYRA_EXPECT_SIGNED: '0' }
    for (const key of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_API_KEY', 'APPLE_API_KEY_CONTENT', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER', 'EVS_ACCOUNT_NAME', 'EVS_PASSWD']) delete buildEnv[key]
    await run('npx.cmd', ['--no-install', 'electron-vite', 'build'], desktop, buildEnv)
    await run(process.execPath, ['scripts/release/prepare-release-resources.mjs', '--platform=windows'], desktop, buildEnv)
    await run('npx.cmd', ['--no-install', 'electron-builder', '--win', '--x64', '--publish', 'never', '--config', '../.release/preview-builder.json'], desktop, buildEnv)
    await run(process.execPath, ['scripts/release/validate-packaged-app.mjs', '--platform=windows', `--version=${version}`, `--raw-dir=${raw}`, '--executable-name=Zyra Preview', '--expected-distribution=preview', `--expected-source-sha=${env.ZYRA_BUILD_SOURCE_SHA}`], desktop, buildEnv)
    await run(process.execPath, ['scripts/release/verify-platform-signature.mjs', '--platform=windows', `--version=${version}`, `--raw-dir=${raw}`, `--marker=${output}/signature.json`, '--expected-signed=false'], desktop, buildEnv)
    const installers = (await readdir(raw)).filter(name => /^Zyra-Preview-.*-Windows-x64\.exe$/.test(name))
    if (installers.length !== 1) throw new Error('Preview build did not produce exactly one installer')
    const installer = installers[0]
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(path.join(raw, installer))) hash.update(chunk)
    const sha256 = hash.digest('hex')
    const manifest = {
        schemaVersion: 1, distribution: 'preview', signed: false, version,
        source: { repository: env.ZYRA_BUILD_SOURCE_REPOSITORY, sha: env.ZYRA_BUILD_SOURCE_SHA, version: request.sourceVersion },
        build: { repository: env.GITHUB_REPOSITORY, workflowSha: env.GITHUB_SHA, runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT },
        installer: { name: installer, size: (await stat(path.join(raw, installer))).size, sha256 },
        profile: 'Zyra Preview', automaticUpdates: false
    }
    await mkdir(upload, { recursive: true })
    // Only the installer and provenance enter Actions storage, not unpacked resources.
    await copyFile(path.join(raw, installer), path.join(upload, installer))
    const manifestBytes = `${JSON.stringify(manifest, null, 2)}\n`
    await writeFile(path.join(upload, 'preview.json'), manifestBytes)
    await writeFile(path.join(upload, 'SHA256SUMS'), `${sha256}  ${installer}\n${createHash('sha256').update(manifestBytes).digest('hex')}  preview.json\n`)
    console.log(`Preview validated: ${version} from ${env.ZYRA_BUILD_SOURCE_SHA}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    const phase = process.argv[2]
    const root = path.resolve(process.argv[3] || '.')
    if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Use the explicitly requested hosted preview workflow, not local packaging')
    if (phase === 'prepare') {
        const result = await preparePreview(root, process.env)
        console.log(`Prepared ${result.version} from ${process.env.ZYRA_BUILD_SOURCE_SHA}`)
    } else if (phase === 'build') await build(root, process.env)
    else throw new Error('Expected prepare or build phase')
}
