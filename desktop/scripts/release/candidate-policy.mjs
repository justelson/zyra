// Approval is a maintainer-supplied SHA and the preview.json they reviewed.
// The live Actions attempt corroborates that provenance; it is not approval.
function assert(condition, message) {
    if (!condition) throw new Error(message)
}

function sha(value, label) {
    assert(typeof value === 'string' && /^[a-f0-9]{40}$/.test(value), `${label} must be a full lowercase 40-character commit SHA`)
    return value
}

function repository(value, label) {
    assert(typeof value === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value), `${label} must be owner/repository`)
    return value
}

export function resolveReleaseCandidate({ mode, version, head, master, onMaster, approvedSourceSha }) {
    assert(mode === 'tag' || mode === 'rehearsal', 'Candidate policy applies only to tag or rehearsal preflight')
    sha(head, 'Release HEAD')
    const approved = Boolean(approvedSourceSha)
    assert(approved || mode !== 'tag' || version.includes('-'), 'Stable publication requires an explicit approved-source-sha and successful matching preview evidence')
    if (approved) {
        sha(approvedSourceSha, 'Approved source')
        assert(head === approvedSourceSha, `Release HEAD ${head} differs from approved source ${approvedSourceSha}; refusing to substitute a moving branch tip`)
        assert(onMaster === true, `Approved source ${head} must be contained in origin/master`)
    } else {
        assert(head === master, `Release HEAD ${head} must exactly match origin/master ${master}`)
    }
    return Object.freeze({ head, approved })
}

export function validatePreviewManifest({ manifest, candidateSha, version, sourceRepository, buildRepository }) {
    sha(candidateSha, 'Candidate')
    repository(sourceRepository, 'Release source repository')
    repository(buildRepository, 'Trusted preview build repository')
    assert(manifest?.schemaVersion === 1 && manifest.distribution === 'preview', 'Approval requires the reviewed schema-1 preview.json')
    assert(manifest.source?.repository === sourceRepository, 'Preview source repository differs from the release repository')
    assert(manifest.source?.sha === candidateSha, 'Preview source SHA differs from the approved release candidate')
    assert(manifest.source?.version === version, 'Preview source version differs from the final lockstep version; preview the versioned candidate before approval')
    assert(typeof manifest.version === 'string' && manifest.version.startsWith(`${version}-`), 'Evidence must describe a preview build of the final source version')
    assert(manifest.build?.repository === buildRepository, 'Preview build repository differs from the configured trusted builder')
    sha(manifest.build?.workflowSha, 'Preview control workflow')
    for (const field of ['runId', 'runAttempt']) {
        assert(typeof manifest.build[field] === 'string' && /^[1-9]\d*$/.test(manifest.build[field]), `Preview ${field} must be a positive decimal string`)
    }
    const requestId = manifest.build.requestId ?? null
    assert(requestId === null || (typeof requestId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(requestId)), 'Preview requestId must be absent/null or a valid explicit request identity')
    assert(typeof manifest.installer?.name === 'string' && manifest.installer.name.length > 0
        && Number.isSafeInteger(manifest.installer.size) && manifest.installer.size > 0
        && /^[a-f0-9]{64}$/.test(manifest.installer.sha256 || ''), 'Preview installer provenance is incomplete')
    return Object.freeze({
        repository: buildRepository,
        runId: manifest.build.runId,
        runAttempt: manifest.build.runAttempt,
        requestId,
        workflowSha: manifest.build.workflowSha,
        sourceSha: candidateSha
    })
}

export function validatePreviewRun(identity, run) {
    assert(String(run?.id) === identity.runId && String(run.run_attempt) === identity.runAttempt, 'Actions evidence is for a different preview run or attempt')
    assert(run.repository?.full_name === identity.repository && run.head_repository?.full_name === identity.repository, 'Actions evidence is from a different build repository')
    assert(run.event === 'workflow_dispatch' && run.path === '.github/workflows/windows-preview.yml', 'Actions evidence is not the explicitly requested Windows preview workflow')
    // Actions head_sha is the control workflow commit, not the source checkout.
    assert(run.head_sha === identity.workflowSha, 'Actions control workflow SHA differs from preview provenance')
    const expectedTitle = `Preview ${identity.sourceSha}${identity.requestId ? ` request:${identity.requestId}` : ''}`
    assert(run.display_title === expectedTitle, 'Actions request does not identify the approved source SHA and explicit request identity')
    assert(run.status === 'completed' && run.conclusion === 'success', 'Approved preview run attempt must be completed and successful')
    return `https://github.com/${identity.repository}/actions/runs/${identity.runId}/attempts/${identity.runAttempt}`
}

export async function readPreviewRun(identity, { token, fetchImpl = fetch } = {}) {
    const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
    if (token) headers.Authorization = `Bearer ${token}`
    const response = await fetchImpl(
        `https://api.github.com/repos/${identity.repository}/actions/runs/${identity.runId}/attempts/${identity.runAttempt}`,
        { headers, signal: AbortSignal.timeout(15_000), redirect: 'error' }
    )
    assert(response.ok, `Cannot verify approved preview attempt: GitHub HTTP ${response.status}`)
    return response.json()
}
