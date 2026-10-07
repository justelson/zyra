import { execFileSync } from 'node:child_process'
import { appendFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPreviewRun, resolveReleaseCandidate, validatePreviewManifest, validatePreviewRun } from './candidate-policy.mjs'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const desktopRoot = path.resolve(scriptDirectory, '..', '..')
const repositoryRoot = path.resolve(desktopRoot, '..')

function arg(name, fallback = null) {
    const inline = process.argv.slice(2).find((value) => value.startsWith(`--${name}=`))
    if (inline) return inline.slice(name.length + 3)
    const index = process.argv.indexOf(`--${name}`)
    return index >= 0 ? process.argv[index + 1] : fallback
}

function git(args) {
    return execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' }).trim()
}

function assert(condition, message) {
    if (!condition) throw new Error(message)
}

function hasSecret(name) {
    return Boolean(String(process.env[name] || '').trim())
}

const mode = arg('mode', 'contract')
assert(['contract', 'rehearsal', 'tag'].includes(mode), `Unknown preflight mode: ${mode}`)
const rootPackage = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'))
const rootLock = JSON.parse(await readFile(path.join(repositoryRoot, 'package-lock.json'), 'utf8'))
const desktopPackage = JSON.parse(await readFile(path.join(desktopRoot, 'package.json'), 'utf8'))
const desktopLock = JSON.parse(await readFile(path.join(desktopRoot, 'package-lock.json'), 'utf8'))
const version = rootPackage.version
const tag = `v${version}`

assert(/^\d+\.\d+\.\d+(?:-(?:alpha|beta)\.\d+)?$/.test(version), `Unsupported Zyra release version: ${version}`)
assert(version === desktopPackage.version, `Root/Desktop versions differ: ${version} != ${desktopPackage.version}`)
assert(version === rootLock.version && version === rootLock.packages?.['']?.version, 'Root package-lock version is not lockstep')
assert(version === desktopLock.version && version === desktopLock.packages?.['']?.version, 'Desktop package-lock version is not lockstep')
assert(desktopPackage.name === 'zyra-desktop', `Unexpected Desktop package name: ${desktopPackage.name}`)
assert(rootPackage.private === true && desktopPackage.private === true, 'Root and Desktop packages must remain private')
assert(desktopLock.name === desktopPackage.name && desktopLock.packages?.['']?.name === desktopPackage.name, 'Desktop package-lock identity is stale')
assert(rootPackage.license === 'Apache-2.0' && desktopPackage.license === 'Apache-2.0', 'Root and Desktop release metadata must declare the repository Apache-2.0 license')
execFileSync(process.execPath, [path.join(repositoryRoot, 'scripts', 'test-legal-release-contract.mjs')], {
    cwd: repositoryRoot,
    stdio: 'inherit'
})

const requestedVersion = arg('expected-version')
if (requestedVersion) assert(requestedVersion === version, `Requested version ${requestedVersion} does not match package version ${version}`)

const approvedSourceSha = arg('approved-source-sha', process.env.ZYRA_APPROVED_SOURCE_SHA || '')
const previewManifestFile = arg('preview-manifest')
const previewManifestJson = process.env.ZYRA_APPROVED_PREVIEW_MANIFEST || ''
assert(!(previewManifestFile && previewManifestJson), 'Provide preview-manifest or ZYRA_APPROVED_PREVIEW_MANIFEST, not both')
const hasPreviewEvidence = Boolean(previewManifestFile || previewManifestJson)
assert(Boolean(approvedSourceSha) === hasPreviewEvidence, 'Approved source SHA and reviewed preview manifest must be supplied together')
assert(mode !== 'contract' || !approvedSourceSha, 'Candidate approval requires tag or rehearsal mode, not contract-only validation')

let head = null
let previewRunUrl = ''
if (mode !== 'contract') {
    head = git(['rev-parse', 'HEAD'])
    const master = git(['rev-parse', 'refs/remotes/origin/master'])
    const candidate = resolveReleaseCandidate({
        mode, version, head, master, approvedSourceSha,
        onMaster: Boolean(approvedSourceSha) && git(['merge-base', head, master]) === head
    })

    if (mode === 'tag') {
        const requestedTag = arg('tag', process.env.GITHUB_REF_NAME || '')
        assert(requestedTag === tag, `Release tag ${requestedTag || 'missing'} must equal ${tag}`)
        const tagCommit = git(['rev-list', '-n', '1', requestedTag])
        assert(tagCommit === head, `Tag ${requestedTag} (${tagCommit}) must point at HEAD (${head})`)
    } else {
        const refName = arg('ref-name', process.env.GITHUB_REF_NAME || 'master')
        assert(refName === 'master', `Workflow rehearsal must run from master, not ${refName}`)
    }

    if (candidate.approved) {
        const manifest = JSON.parse(previewManifestFile
            ? await readFile(path.resolve(previewManifestFile), 'utf8')
            : previewManifestJson)
        const sourceRepository = arg('source-repository', process.env.GITHUB_REPOSITORY || '')
        const identity = validatePreviewManifest({
            manifest, candidateSha: head, version, sourceRepository,
            buildRepository: arg('preview-build-repository', process.env.ZYRA_PREVIEW_BUILD_REPOSITORY || sourceRepository)
        })
        previewRunUrl = validatePreviewRun(identity, await readPreviewRun(identity, {
            token: process.env.GH_TOKEN || process.env.GITHUB_TOKEN
        }))
    }
}

const taggedPublication = mode === 'tag'
if (taggedPublication) {
    const requiredSecrets = [
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
    ]
    const missing = requiredSecrets.filter((name) => !hasSecret(name))
    assert(missing.length === 0, `Tagged publication is blocked; missing signing/notarization secrets: ${missing.join(', ')}`)
    assert(process.env.ZYRA_ACCEPT_ECS_SECURITY_DELTA === 'true', 'Tagged publication is blocked until the CastLabs Electron 43.2 versus stock Electron 43.4 security delta is explicitly accepted or removed by an upgrade.')
}

const output = process.env.GITHUB_OUTPUT
if (output) {
    await appendFile(output, [
        `version=${version}`,
        `tag=${tag}`,
        `head=${head || ''}`,
        `approved_source_sha=${approvedSourceSha}`,
        `preview_run_url=${previewRunUrl}`,
        `publish=${mode === 'tag' ? 'true' : 'false'}`,
        `require_signing=${taggedPublication ? 'true' : 'false'}`
    ].join('\n') + '\n')
}

console.log(`Zyra Desktop release preflight: ${mode} ${tag}${head ? ` @ ${head}` : ''}`)
if (previewRunUrl) console.log(`Approved source preview evidence: ${previewRunUrl}`)
