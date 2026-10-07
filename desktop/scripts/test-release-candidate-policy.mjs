import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parse } from 'yaml'
import { readPreviewRun, resolveReleaseCandidate, validatePreviewManifest, validatePreviewRun } from './release/candidate-policy.mjs'
import { expectedReleaseAssetNames } from './release/release-contract.mjs'

const sourceSha = 'a'.repeat(40)
const laterMaster = 'b'.repeat(40)
const workflowSha = 'c'.repeat(40)
const version = '0.8.0'
const sourceRepository = 'source/zyra'
const buildRepository = 'helper/zyra'
const candidate = { mode: 'tag', version, head: sourceSha, master: sourceSha, onMaster: true, approvedSourceSha: sourceSha }
const manifest = {
    schemaVersion: 1, distribution: 'preview', version: '0.8.0-alpha.9',
    source: { repository: sourceRepository, sha: sourceSha, version },
    build: { repository: buildRepository, workflowSha, runId: '123', runAttempt: '2' },
    installer: { name: 'Zyra-Preview-0.8.0-alpha.9-Windows-x64.exe', size: 100, sha256: 'd'.repeat(64) }
}
const manifestArgs = { manifest, candidateSha: sourceSha, version, sourceRepository, buildRepository }
const identity = validatePreviewManifest(manifestArgs)
assert.equal(validatePreviewManifest({ ...manifestArgs, manifest: { ...manifest, channel: 'dev', version: '0.8.0-dev.10' } }).sourceSha, sourceSha)
const run = {
    id: 123, run_attempt: 2, repository: { full_name: buildRepository }, head_repository: { full_name: buildRepository },
    event: 'workflow_dispatch', path: '.github/workflows/windows-preview.yml',
    head_sha: workflowSha, display_title: `Preview ${sourceSha}`, status: 'completed', conclusion: 'success'
}

// Approval survives master advancing; substituting the new tip is forbidden.
assert.deepEqual(resolveReleaseCandidate({ ...candidate, master: laterMaster }), { head: sourceSha, approved: true })
assert.throws(() => resolveReleaseCandidate({ ...candidate, head: laterMaster, master: laterMaster }), /differs from approved source/)
assert.throws(() => resolveReleaseCandidate({ ...candidate, approvedSourceSha: '' }), /Stable publication requires/)
assert.throws(() => resolveReleaseCandidate({ ...candidate, approvedSourceSha: 'master' }), /40-character/)
assert.throws(() => resolveReleaseCandidate({ ...candidate, onMaster: false }), /contained in origin\/master/)

// Existing unsigned rehearsals and signed prerelease gates retain their policy.
assert.equal(resolveReleaseCandidate({ ...candidate, mode: 'rehearsal', approvedSourceSha: '' }).approved, false)
assert.throws(() => resolveReleaseCandidate({ ...candidate, mode: 'rehearsal', approvedSourceSha: '', master: laterMaster }), /exactly match/)
assert.equal(resolveReleaseCandidate({ ...candidate, version: `${version}-beta.1`, approvedSourceSha: '' }).approved, false)

// Source and control workflow SHAs intentionally differ. Final bytes/version
// are rebuilt; approval does not require alpha installer bytes to equal stable.
assert.equal(identity.sourceSha, sourceSha)
assert.notEqual(identity.workflowSha, identity.sourceSha)
assert.equal(validatePreviewRun(identity, run), `https://github.com/${buildRepository}/actions/runs/123/attempts/2`)
const retryIdentity = validatePreviewManifest({ ...manifestArgs, manifest: { ...manifest, build: { ...manifest.build, requestId: 'delivery:abc-123' } } })
const retryRun = { ...run, display_title: `Preview ${sourceSha} request:delivery:abc-123` }
assert.equal(validatePreviewRun(retryIdentity, retryRun), validatePreviewRun(identity, run))
assert.throws(() => validatePreviewRun(retryIdentity, run), /explicit request identity/)
assert.throws(() => validatePreviewRun(identity, retryRun), /explicit request identity/)
assert.throws(() => validatePreviewRun(retryIdentity, { ...retryRun, display_title: `Preview ${sourceSha} request:another-delivery` }), /explicit request identity/)
const nullRequestIdentity = validatePreviewManifest({ ...manifestArgs, manifest: { ...manifest, build: { ...manifest.build, requestId: null } } })
assert.equal(validatePreviewRun(nullRequestIdentity, run), validatePreviewRun(identity, run))
for (const requestId of ['', 123, 'bad request', '/path', 'x'.repeat(129)]) {
    assert.throws(() => validatePreviewManifest({ ...manifestArgs, manifest: { ...manifest, build: { ...manifest.build, requestId } } }), /requestId/)
}
for (const [patch, error] of [
    [{ schemaVersion: 2 }, /schema-1/],
    [{ distribution: 'stable' }, /schema-1/],
    [{ source: { ...manifest.source, sha: laterMaster } }, /source SHA/],
    [{ source: { ...manifest.source, repository: 'other/zyra' } }, /source repository/],
    [{ source: { ...manifest.source, version: '0.7.0' } }, /source version/],
    [{ version }, /preview build/],
    [{ build: { ...manifest.build, repository: 'untrusted/zyra' } }, /trusted builder/],
    [{ build: { ...manifest.build, workflowSha: 'master' } }, /40-character/],
    [{ build: { ...manifest.build, runAttempt: '0' } }, /positive decimal/],
    [{ installer: { ...manifest.installer, sha256: '' } }, /installer provenance/]
]) assert.throws(() => validatePreviewManifest({ ...manifestArgs, manifest: { ...manifest, ...patch } }), error)

// An earlier successful attempt cannot bless a failed rerun, or vice versa.
for (const [patch, error] of [
    [{ id: 124 }, /different preview run/],
    [{ run_attempt: 1 }, /different preview run/],
    [{ repository: { full_name: 'other/zyra' } }, /different build repository/],
    [{ head_repository: { full_name: 'other/zyra' } }, /different build repository/],
    [{ path: '.github/workflows/helper-ci.yml' }, /Windows preview workflow/],
    [{ event: 'pull_request' }, /Windows preview workflow/],
    [{ head_sha: sourceSha }, /control workflow SHA/],
    [{ display_title: `Preview ${laterMaster}` }, /approved source SHA/],
    [{ status: 'in_progress' }, /completed and successful/],
    [{ conclusion: 'failure' }, /completed and successful/],
    [{ conclusion: 'cancelled' }, /completed and successful/]
]) assert.throws(() => validatePreviewRun(identity, { ...run, ...patch }), error)

let requested = false
const fetched = await readPreviewRun(identity, { fetchImpl: async (url, options) => {
    requested = true
    assert.equal(url, `https://api.github.com/repos/${buildRepository}/actions/runs/123/attempts/2`)
    assert.equal(options.redirect, 'error')
    assert(options.signal instanceof AbortSignal)
    assert.equal(options.headers.Authorization, undefined)
    return { ok: true, json: async () => run }
} })
assert(requested)
assert.equal(validatePreviewRun(identity, fetched), validatePreviewRun(identity, run))
await assert.rejects(() => readPreviewRun(identity, { fetchImpl: async () => ({ ok: false, status: 403 }) }), /HTTP 403/)
await assert.rejects(() => readPreviewRun(identity, { fetchImpl: async () => { throw new Error('offline') } }), /offline/)

// Wiring is part of the contract: tag checkout cannot silently move to approval
// while builds, assembly and draft publication must consume preflight's SHA.
const workflow = parse(readFileSync(path.join(import.meta.dirname, '..', '..', '.github', 'workflows', 'desktop-release.yml'), 'utf8'))
const preflight = workflow.jobs.preflight
const checkoutRef = preflight.steps.find(step => step.uses?.startsWith('actions/checkout@')).with.ref
assert(checkoutRef.includes("github.event_name == 'workflow_dispatch' && inputs.approved_source_sha"))
assert(checkoutRef.includes('|| github.sha'))
const gate = preflight.steps.find(step => step.id === 'release_contract')
assert(gate.env.ZYRA_APPROVED_SOURCE_SHA.includes('vars.ZYRA_APPROVED_SOURCE_SHA'))
assert(gate.env.ZYRA_APPROVED_PREVIEW_MANIFEST.includes('vars.ZYRA_APPROVED_PREVIEW_MANIFEST'))
assert(gate.env.ZYRA_PREVIEW_BUILD_REPOSITORY.includes('vars.ZYRA_PREVIEW_BUILD_REPOSITORY'))
assert(gate.env.GH_TOKEN.includes('github.token'))
assert.equal(preflight.permissions.actions, 'read')
assert.equal(preflight.outputs.head, '${{ steps.release_contract.outputs.head }}')
for (const jobName of ['build', 'assemble', 'release']) {
    const checkout = workflow.jobs[jobName].steps.find(step => step.uses?.startsWith('actions/checkout@'))
    assert.equal(checkout.with.ref, '${{ needs.preflight.outputs.head }}', `${jobName} must use the frozen candidate`)
}
assert.equal(workflow.jobs.release.env.RELEASE_SHA, '${{ needs.preflight.outputs.head }}')
const draft = workflow.jobs.release.steps.find(step => step.id === 'draft')
assert(draft.run.includes('gh release edit "${RELEASE_TAG}" --repo "${GITHUB_REPOSITORY}" --target "${RELEASE_SHA}"'))
const draftValidation = workflow.jobs.release.steps.find(step => step.run?.includes('validate-github-draft.mjs'))
assert(draftValidation.run.includes('--sha="${RELEASE_SHA}" --branch=""'))
const publication = workflow.jobs.release.steps.find(step => step.name === 'Publish only the signed and notarized tagged candidate')
assert(publication.run.includes('if [[ "${tag_sha}" != "${RELEASE_SHA}" ]]'))
assert(publication.run.indexOf('if [[ "${tag_sha}" != "${RELEASE_SHA}" ]]') < publication.run.indexOf('--draft=false'))
assert(preflight.steps.some(step => step.run === 'node desktop/scripts/test-release-candidate-policy.mjs'))

// Exercise the real draft validator using the workflow's strict target policy.
const fixtureDirectory = await mkdtemp(path.join(os.tmpdir(), 'zyra-candidate-policy-'))
const fixtureFile = path.join(fixtureDirectory, 'draft.json')
try {
    const draftFixture = {
        tagName: `v${version}`, isDraft: true, targetCommitish: 'master',
        assets: expectedReleaseAssetNames(version, { includeChecksums: true }).map(name => ({ name, size: 1 }))
    }
    const validateDraft = () => spawnSync(process.execPath, [
        path.join(import.meta.dirname, 'release', 'validate-github-draft.mjs'),
        `--file=${fixtureFile}`, `--version=${version}`, `--sha=${sourceSha}`, '--branch='
    ], { encoding: 'utf8' })
    await writeFile(fixtureFile, JSON.stringify(draftFixture))
    const movingTarget = validateDraft()
    assert.notEqual(movingTarget.status, 0)
    assert.match(movingTarget.stderr, /Draft target master is neither release SHA/)
    await writeFile(fixtureFile, JSON.stringify({ ...draftFixture, targetCommitish: sourceSha }))
    const frozenTarget = validateDraft()
    assert.equal(frozenTarget.status, 0, frozenTarget.stderr)
} finally {
    await unlink(fixtureFile)
    await rmdir(fixtureDirectory)
}
console.log('Frozen release candidate and preview evidence policy: ok')
