import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import worker, { normalizeWebhook, verifyWebhook, RelayCoordinator, GitHub } from './ci/relay/worker.mjs'
import { PREVIEW_COMMENT_MARKER } from './ci/relay/preview-report.mjs'
const env = { SOURCE_REPOSITORY: 'source/app', HELPER_REPOSITORY: 'helper/app', AUTOMATION_REF: 'ci/automation', MAINTAINER_IDS: '1,2', GITHUB_APP_ID: '123' }
const sha = 'a'.repeat(40), other = 'b'.repeat(40)
const payload = action => ({ action, repository: { full_name: env.SOURCE_REPOSITORY }, sender: { id: 1 }, pull_request: { number: 3, state: 'open', head: { sha, repo: { full_name: env.SOURCE_REPOSITORY } } } })
assert.equal(normalizeWebhook('pull_request', payload('synchronize'), env).mode, 'quick')
assert.equal(normalizeWebhook('pull_request', { ...payload('synchronize'), label: { name: 'ci:preview' } }, env).mode, 'quick', 'Retained labels never turn pushes into installers')
for (const action of ['edited', 'closed', 'unlabeled']) assert.equal(normalizeWebhook('pull_request', payload(action), env), null)
assert.equal(normalizeWebhook('issue_comment', payload('created'), env), null)
assert.equal(normalizeWebhook('pull_request', { ...payload('labeled'), label: { name: 'ci:preview' } }, env).mode, 'preview')
assert.deepEqual(normalizeWebhook('pull_request', { ...payload('labeled'), label: { name: 'ci:preview-retry' } }, env), { kind: 'request', mode: 'preview', pr: 3, sha, retry: true })
assert.equal(normalizeWebhook('pull_request', { ...payload('synchronize'), label: { name: 'ci:preview-retry' } }, env).mode, 'quick', 'Retaining retry labels cannot build installers on pushes')
for (const override of [
    { sender: { id: 99 } },
    { repository: { full_name: env.HELPER_REPOSITORY } },
    { pull_request: { ...payload('labeled').pull_request, head: { sha, repo: { full_name: 'external/fork' } } } }
]) assert.equal(normalizeWebhook('pull_request', { ...payload('labeled'), label: { name: 'ci:preview-retry' }, ...override }, env), null, 'Retry requests retain every access guard')
assert.equal(normalizeWebhook('pull_request', { ...payload('labeled'), label: { name: 'ci:full' } }, env).mode, 'full')
assert.equal(normalizeWebhook('pull_request', { ...payload('opened'), sender: { id: 99 } }, env), null)
assert.equal(normalizeWebhook('pull_request', { ...payload('opened'), repository: { full_name: env.HELPER_REPOSITORY } }, env), null)
assert.equal(normalizeWebhook('pull_request', { ...payload('opened'), pull_request: { ...payload('opened').pull_request, head: { sha, repo: { full_name: 'external/fork' } } } }, env), null)
const bytes = new TextEncoder().encode(JSON.stringify(payload('opened')))
const secret = crypto.randomUUID()
const hmac = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
const signature = `sha256=${Buffer.from(await crypto.subtle.sign('HMAC', hmac, bytes)).toString('hex')}`
assert.equal(await verifyWebhook(secret, signature, bytes), true)
assert.equal(await verifyWebhook(secret, signature, new TextEncoder().encode('{}')), false)
assert.equal(await verifyWebhook(secret, 'sha256=bad', bytes), false)

// Real RSA signing with an ephemeral test key; no user key or network access.
const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, false, ['sign', 'verify'])
const adapter = new GitHub({ ...env, GITHUB_APP_ID: '123', SOURCE_INSTALLATION_ID: '11', HELPER_INSTALLATION_ID: '22' })
adapter.key = pair.privateKey
const minted = [], originalFetch = globalThis.fetch
try {
    globalThis.fetch = async (url, options) => {
        assert.match(url, /^https:\/\/api\.github\.com\/app\/installations\/(11|22)\/access_tokens$/)
        assert.equal(options.headers['X-GitHub-Api-Version'], '2026-03-10')
        const jwt = options.headers.Authorization.slice('Bearer '.length).split('.')
        assert.equal(JSON.parse(Buffer.from(jwt[1], 'base64url')).iss, '123')
        assert(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', pair.publicKey, Buffer.from(jwt[2], 'base64url'), new TextEncoder().encode(`${jwt[0]}.${jwt[1]}`)))
        minted.push(JSON.parse(options.body))
        return Response.json({ token: crypto.randomUUID(), expires_at: new Date(Date.now() + 3600000).toISOString() })
    }
    await adapter.token('source'); await adapter.token('helper'); await adapter.token('source')
    assert.deepEqual(minted, [
        { repositories: ['app'], permissions: { checks: 'write', pull_requests: 'write' } },
        { repositories: ['app'], permissions: { actions: 'write' } }
    ], 'Tokens narrow repository/role authority and cache only in memory')
} finally { globalThis.fetch = originalFetch }

class Storage {
    map = new Map()
    async get(key) { return structuredClone(this.map.get(key)) }
    async put(key, value) { this.map.set(key, structuredClone(value)) }
    async delete(key) { return this.map.delete(key) }
    async setAlarm(at) { this.alarm = at }
    async list({ prefix = '', limit = Infinity } = {}) { return new Map([...this.map].filter(([key]) => key.startsWith(prefix)).sort().slice(0, limit)) }
    async transaction(fn) { return fn(this) }
}
function fixture() {
    const storage = new Storage(), calls = []
    const pr = { ...payload('opened').pull_request, changed_files: 1 }
    const runs = [], artifacts = [{ id: 7, name: 'zyra-preview-windows-42-1', expired: false }], comments = []
    const failures = new Map()
    let uncertain = false, nextRunId = 42, checkId = 5, loseCommentResponse = false
    const api = { async request(role, route, method = 'GET', body) {
        calls.push({ role, route, method, body })
        const fault = `${method} ${route}`
        if (failures.get(fault)) { failures.set(fault, failures.get(fault) - 1); throw new Error('Synthetic GitHub outage') }
        if ((/^\/pulls\/\d+$/.test(route))) return structuredClone(pr)
        if (route.includes('/files?')) return [{ filename: 'desktop/src/main/index.ts' }]
        if (route.includes('/runs?')) return { workflow_runs: structuredClone(runs) }
        if (route === '/check-runs' && method === 'POST') return { id: checkId++ }
        if (route.endsWith('/dispatches')) { if (uncertain) throw new Error('lost dispatch response'); return { workflow_run_id: nextRunId++ } }
        if (/^\/actions\/runs\/\d+$/.test(route)) return structuredClone(runs.find(run => route === `/actions/runs/${run.id}`))
        if (route.includes('/artifacts')) return { artifacts: structuredClone(artifacts) }
        if (route.includes('/comments?')) {
            const page = Number(new URL(`https://test${route}`).searchParams.get('page'))
            return structuredClone(comments.slice((page - 1) * 100, page * 100))
        }
        if (route === '/issues/3/comments' && method === 'POST') {
            const comment = { id: comments.length + 10, ...body, performed_via_github_app: { id: 123 } }
            comments.push(comment)
            if (loseCommentResponse) { loseCommentResponse = false; throw new Error('lost accepted comment response') }
            return structuredClone(comment)
        }
        if (route.startsWith('/issues/comments/') && method === 'PATCH') {
            const comment = comments.find(item => route === `/issues/comments/${item.id}`)
            Object.assign(comment, body)
            return structuredClone(comment)
        }
        return null
    } }
    return { storage, calls, pr, runs, artifacts, comments, coordinator: new RelayCoordinator({ storage }, env, api), loseResponse() { uncertain = true },
        failNext(route, method = 'GET') { failures.set(`${method} ${route}`, 1) }, loseNextCommentResponse() { loseCommentResponse = true } }
}
const event = { kind: 'request', mode: 'preview', pr: 3, sha, requestId: 'delivery1' }
const f = fixture()
const enqueue = delivery => f.coordinator.fetch(new Request('https://relay.internal', { method: 'POST', body: JSON.stringify({ delivery, event }) }))
assert.equal((await (await enqueue('delivery1')).json()).queued, true)
assert.equal((await (await enqueue('delivery1')).json()).queued, false)
await enqueue('delivery2')
await f.coordinator.alarm()
assert.equal(f.calls.filter(call => call.route.endsWith('/dispatches')).length, 1, 'Different deliveries for the same source revision deduplicate')
assert.deepEqual(f.calls.find(call => call.route.endsWith('/dispatches')).body, { ref: env.AUTOMATION_REF, inputs: { source_repository: env.SOURCE_REPOSITORY, source_sha: sha, source_pr: '3', request_id: 'delivery1', target: 'windows-x64' } })
assert.equal(f.calls.find(call => call.route === '/check-runs').body.head_sha, sha)
assert.equal((await f.storage.get(`request:preview:${sha}:pr:3`)).runId, 42, 'New dispatches retain the returned run identity')
const run = { id: 42, run_attempt: 1, event: 'workflow_dispatch', path: '.github/workflows/windows-preview.yml', head_branch: env.AUTOMATION_REF, display_title: `Preview ${sha} request:delivery1`, status: 'completed', conclusion: 'success' }
f.runs.push(run)
await f.coordinator.handle({ kind: 'completion', runId: 42 })
assert.equal(f.calls.filter(call => call.route.endsWith('/comments')).length, 1)
assert.match(f.calls.find(call => call.route.endsWith('/comments')).body.body, /Unsigned/)
await f.coordinator.handle({ kind: 'completion', runId: 42 })
assert.equal(f.calls.filter(call => call.route.endsWith('/comments')).length, 1, 'Completion replay does not duplicate links')
assert.equal((await f.storage.get(`request:preview:${sha}:pr:3`)).reportPhase, 'delivered')

const requestKey = `request:preview:${sha}:pr:3`
const dispatches = fixture => fixture.calls.filter(call => call.route.endsWith('/dispatches')).length
const postCount = fixture => fixture.calls.filter(call => call.route === '/issues/3/comments' && call.method === 'POST').length
const retryEvent = attempt => ({ ...event, retry: true, attempt, requestId: attempt })
const deliver = (fixture, delivery, requestEvent = event) => fixture.coordinator.fetch(new Request('https://relay.internal', { method: 'POST', body: JSON.stringify({ delivery, event: requestEvent }) }))

// Identical revisions on separate PRs retain independent request/link identities.
const independent = fixture()
await independent.coordinator.handle(event)
await independent.coordinator.handle({ ...event, pr: 4, requestId: 'another-pr' })
assert.equal(dispatches(independent), 2, 'one PR cannot swallow another PR preview request for the same commit')
assert.equal((await independent.storage.get(`request:preview:${sha}:pr:4`)).pr, 4)
assert.equal(await independent.storage.get('preview-latest:4'), `request:preview:${sha}:pr:4`)
const legacy = fixture()
await legacy.storage.put(`request:preview:${sha}`, { mode: 'preview', sha, pr: 3, phase: 'completed', createdAt: Date.now() })
await legacy.coordinator.handle(event)
assert.equal(dispatches(legacy), 0, 'deploying PR-scoped keys preserves existing same-PR deduplication')
await legacy.coordinator.handle({ ...event, pr: 4, requestId: 'another-pr' })
assert.equal(dispatches(legacy), 1, 'legacy history from another PR cannot swallow this request')

// Explicit same-commit retries get their own claim and exact returned run ID.
await deliver(f, 'retry1', { ...event, retry: true })
assert.equal((await (await deliver(f, 'retry1', { ...event, retry: true })).json()).queued, false)
await f.coordinator.alarm()
assert.equal(dispatches(f), 2, 'Retry builds an unchanged SHA without reusing its successful old run')
const retryKey = `request:preview:${sha}:retry:retry1:pr:3`
assert.equal((await f.storage.get(retryKey)).runId, 43)
await f.coordinator.handle(retryEvent('retry1'))
assert.equal(dispatches(f), 2, 'Repeated explicit attempt does not redispatch')
await f.coordinator.handle(retryEvent('overlap'))
assert.equal(dispatches(f), 2, 'A pending or uncertain attempt cannot be overlapped for the same SHA')
await f.coordinator.handle({ kind: 'completion', runId: 42 })
assert.equal((await f.storage.get(retryKey)).phase, 'submitted', 'An old run cannot finish a retry attempt')
f.runs.push({ ...run, id: 43, display_title: `Preview ${sha} request:retry1` })
f.artifacts.push({ id: 8, name: 'zyra-preview-windows-43-1', expired: false })
await f.coordinator.handle({ kind: 'completion', runId: 43 })
assert.equal(f.comments.length, 1, 'A new attempt updates one marked PR comment')
assert.match(f.comments[0].body, /runs\/43\/artifacts\/8/)
assert.equal(postCount(f), 1)
assert.match(f.comments[0].body, /dev channel/)
assert.match(f.comments[0].body, /seven days/)
assert.equal((await f.storage.get(retryKey)).reportPhase, 'delivered')
assert.equal(f.calls.filter(call => call.route === '/issues/comments/10' && call.method === 'PATCH').length, 1)

for (const fault of ['artifact', 'comment-list', 'comment-write', 'accepted-comment']) {
    const outage = fixture(); await outage.coordinator.handle(event); outage.runs.push(run)
    if (fault === 'artifact') outage.failNext('/actions/runs/42/artifacts?per_page=100')
    if (fault === 'comment-list') outage.failNext('/issues/3/comments?per_page=100&page=1')
    if (fault === 'comment-write') outage.failNext('/issues/3/comments', 'POST')
    if (fault === 'accepted-comment') outage.loseNextCommentResponse()
    await assert.rejects(outage.coordinator.handle({ kind: 'completion', runId: 42 }))
    const completed = await outage.storage.get(requestKey)
    assert.equal(completed.phase, 'completed', `${fault}: build stays complete`)
    assert.equal(completed.reportPhase, 'pending', `${fault}: reporting stays pending`)
    await outage.coordinator.alarm()
    assert.equal((await outage.storage.get(requestKey)).reportPhase, 'delivered', `${fault}: polling repairs delivery`)
    assert.equal(dispatches(outage), 1, `${fault}: reporting never rebuilds`)
    assert.equal(outage.comments.length, 1, `${fault}: no duplicate comment`)
    await outage.coordinator.handle({ kind: 'completion', runId: 42 }); await outage.coordinator.alarm()
    assert.equal(outage.comments.length, 1)
    if (fault === 'accepted-comment') assert.equal(postCount(outage), 1, 'A lost accepted POST response is recovered through discovery')
}

const delayed = fixture(); await delayed.coordinator.handle(event); delayed.runs.push(run)
const delayedArtifact = delayed.artifacts.pop()
await delayed.coordinator.handle({ kind: 'completion', runId: 42 })
assert.equal((await delayed.storage.get(requestKey)).reportPhase, 'pending', 'Missing artifact visibility remains reportable')
delayed.artifacts.push(delayedArtifact); await delayed.coordinator.alarm()
assert.equal(delayed.comments.length, 1)

const backoff = fixture(); await backoff.coordinator.handle(event); backoff.runs.push(run); backoff.artifacts.length = 0
await backoff.coordinator.handle({ kind: 'completion', runId: 42 })
await backoff.coordinator.alarm()
const backoffRecord = await backoff.storage.get(requestKey)
assert.equal(backoffRecord.reportAttempts, 1)
assert.ok(backoffRecord.reportNextAt >= Date.now() + 55000)
const callsBeforeEarlyAlarm = backoff.calls.length
await backoff.coordinator.alarm()
assert.equal(backoff.calls.length, callsBeforeEarlyAlarm, 'reporting backoff skips API calls before the next delivery attempt')
assert.equal(backoff.storage.alarm, backoffRecord.reportNextAt)
backoff.artifacts.push({ id: 7, name: 'zyra-preview-windows-42-1', expired: false })
await backoff.storage.put(requestKey, { ...backoffRecord, reportNextAt: 0 })
await backoff.storage.put(`pending:${requestKey}`, { ...backoffRecord, reportNextAt: 0 })
await backoff.coordinator.alarm()
assert.equal((await backoff.storage.get(requestKey)).reportPhase, 'delivered')
assert.equal(dispatches(backoff), 1, 'backoff never dispatches an installer again')

const expired = fixture(); await expired.coordinator.handle(event); expired.runs.push(run); expired.artifacts[0].expired = true
await expired.coordinator.handle({ kind: 'completion', runId: 42 })
assert.equal((await expired.storage.get(requestKey)).reportPhase, 'expired')
await expired.coordinator.handle(retryEvent('expired-link'))
assert.equal(dispatches(expired), 2, 'Expired artifacts permit an explicitly requested same-SHA attempt')

const failedBuild = fixture(); await failedBuild.coordinator.handle(event); failedBuild.runs.push({ ...run, conclusion: 'failure' })
await failedBuild.coordinator.handle({ kind: 'completion', runId: 42 })
await failedBuild.coordinator.handle(retryEvent('failed-build'))
assert.equal(dispatches(failedBuild), 2, 'A failed build can be explicitly retried on the same SHA')
assert.equal(failedBuild.comments.length, 0)

const retryUncertain = fixture(); retryUncertain.runs.push(run); retryUncertain.loseResponse()
await retryUncertain.coordinator.handle(retryEvent('lost-response')); await retryUncertain.coordinator.alarm()
await retryUncertain.coordinator.handle({ kind: 'completion', runId: 42 })
assert.equal((await retryUncertain.storage.get(`request:preview:${sha}:retry:lost-response:pr:3`)).phase, 'uncertain')
assert.equal(retryUncertain.comments.length, 0, 'Ambiguous retry responses cannot report an old same-SHA run')
assert.equal(dispatches(retryUncertain), 1)
retryUncertain.runs.push({ ...run, id: 43, display_title: `Preview ${sha} request:lost-response` })
retryUncertain.artifacts.push({ id: 8, name: 'zyra-preview-windows-43-1', expired: false })
await retryUncertain.coordinator.alarm()
assert.equal((await retryUncertain.storage.get(`request:preview:${sha}:retry:lost-response:pr:3`)).reportPhase, 'delivered', 'A unique request token recovers a lost retry dispatch response')
assert.equal(dispatches(retryUncertain), 1)
assert.match(retryUncertain.comments[0].body, /runs\/43\/artifacts\/8/)

const noReuse = fixture(); noReuse.runs.push({ ...run, display_title: `Preview ${sha}` })
await noReuse.coordinator.handle(event)
assert.equal(dispatches(noReuse), 1, 'An old same-SHA preview title is never reused for a new request')
await noReuse.coordinator.handle({ kind: 'completion', runId: 42 })
assert.equal(noReuse.comments.length, 0, 'Even a matching run ID cannot bypass the request token guard')

const superseded = fixture(); await superseded.coordinator.handle(event); superseded.runs.push(run)
superseded.failNext('/actions/runs/42/artifacts?per_page=100')
await assert.rejects(superseded.coordinator.handle({ kind: 'completion', runId: 42 }))
await superseded.coordinator.handle(retryEvent('newest')); await superseded.coordinator.alarm()
assert.equal((await superseded.storage.get(requestKey)).reportPhase, 'superseded')
assert.equal(superseded.comments.length, 0, 'Old reporting cannot overwrite a newly requested preview')

const paginated = fixture(); await paginated.coordinator.handle(event); paginated.runs.push(run)
paginated.comments.push(...Array.from({ length: 100 }, (_, id) => ({ id, body: `${PREVIEW_COMMENT_MARKER}\nforged`, performed_via_github_app: { id: 999 } })),
    { id: 200, body: `${PREVIEW_COMMENT_MARKER}\nold`, performed_via_github_app: { id: 123 } })
await paginated.coordinator.handle({ kind: 'completion', runId: 42 })
assert.equal(postCount(paginated), 0, 'Marked App comments are discovered across pagination')
assert.match(paginated.comments[100].body, /artifacts\/7/)
assert.equal(paginated.comments[0].body, `${PREVIEW_COMMENT_MARKER}\nforged`, 'Foreign App comments are never edited')

const patchOutage = fixture(); await patchOutage.coordinator.handle(event); patchOutage.runs.push(run)
patchOutage.comments.push({ id: 200, body: `${PREVIEW_COMMENT_MARKER}\nprevious preview`, performed_via_github_app: { id: 123 } })
patchOutage.failNext('/issues/comments/200', 'PATCH')
await assert.rejects(patchOutage.coordinator.handle({ kind: 'completion', runId: 42 }))
await patchOutage.coordinator.alarm()
assert.equal(patchOutage.comments.length, 1)
assert.match(patchOutage.comments[0].body, /artifacts\/7/)
assert.equal(dispatches(patchOutage), 1, 'Comment update failures retry only reporting')

const checkOutage = fixture(); await checkOutage.coordinator.handle(event); checkOutage.runs.push(run)
checkOutage.failNext('/check-runs/5', 'PATCH')
await assert.rejects(checkOutage.coordinator.handle({ kind: 'completion', runId: 42 }))
await checkOutage.coordinator.alarm()
assert.equal((await checkOutage.storage.get(requestKey)).reportPhase, 'delivered')
assert.equal(dispatches(checkOutage), 1, 'Check-report failures never rebuild')

const storedOutage = fixture(); await storedOutage.coordinator.handle(event); storedOutage.runs.push(run)
const save = storedOutage.coordinator.saveRecord.bind(storedOutage.coordinator)
let loseReportSave = true
storedOutage.coordinator.saveRecord = async (key, record) => {
    if (record.reportPhase === 'delivered' && loseReportSave) { loseReportSave = false; throw new Error('Synthetic storage outage') }
    return save(key, record)
}
await assert.rejects(storedOutage.coordinator.handle({ kind: 'completion', runId: 42 }))
await storedOutage.coordinator.alarm()
assert.equal(postCount(storedOutage), 1, 'Losing delivery persistence rediscovers the accepted comment')
assert.equal(storedOutage.calls.filter(call => call.route.startsWith('/issues/comments/') && call.method === 'PATCH').length, 0, 'Unchanged comment content is idempotent')

for (const change of ['closed', 'moved', 'forked']) {
    const outdated = fixture(); await outdated.coordinator.handle(event); outdated.runs.push(run)
    outdated.failNext('/actions/runs/42/artifacts?per_page=100')
    await assert.rejects(outdated.coordinator.handle({ kind: 'completion', runId: 42 }))
    if (change === 'closed') outdated.pr.state = 'closed'
    if (change === 'moved') outdated.pr.head.sha = other
    if (change === 'forked') outdated.pr.head.repo.full_name = 'external/fork'
    await outdated.coordinator.alarm()
    assert.equal((await outdated.storage.get(requestKey)).reportPhase, 'superseded')
    assert.equal(outdated.comments.length, 0, `${change}: reporting recovery rechecks source eligibility`)
    assert.equal(dispatches(outdated), 1)
}

const timedReport = fixture(); await timedReport.coordinator.handle(event); timedReport.runs.push(run)
timedReport.failNext('/actions/runs/42/artifacts?per_page=100')
await assert.rejects(timedReport.coordinator.handle({ kind: 'completion', runId: 42 }))
await timedReport.coordinator.saveRecord(requestKey, { ...await timedReport.storage.get(requestKey), reportStartedAt: Date.now() - 7 * 86400000 - 1 })
timedReport.failNext('/pulls/3'); await timedReport.coordinator.alarm()
assert.equal((await timedReport.storage.get(requestKey)).reportPhase, 'expired', 'Expired report polling stops even during a PR API outage')
assert.equal((await timedReport.coordinator.pendingRecords()).size, 0)

const timedRetry = fixture(); timedRetry.loseResponse(); await timedRetry.coordinator.handle(retryEvent('timeout'))
const timedRetryKey = `request:preview:${sha}:retry:timeout:pr:3`
await timedRetry.coordinator.saveRecord(timedRetryKey, { ...await timedRetry.storage.get(timedRetryKey), createdAt: Date.now() - 101 * 60000 })
await timedRetry.coordinator.alarm()
assert.equal((await timedRetry.storage.get(timedRetryKey)).phase, 'failed')
assert.equal(dispatches(timedRetry), 1, 'An ambiguous retry timeout only reports failure')
assert.match(timedRetry.calls.find(call => call.body?.output?.title === 'Helper result unavailable').body.output.summary, /No build was automatically retried/)
await timedRetry.coordinator.handle(retryEvent('user-approved-next'))
assert.equal(dispatches(timedRetry), 2, 'After inspecting a timeout, a new explicit edge can authorize the next attempt')

// A retry retained at seven-day cleanup must not leave a latest pointer behind.
const cleanup = fixture()
await cleanup.storage.put(requestKey, { mode: 'preview', pr: 3, sha, phase: 'completed', reportPhase: 'delivered', createdAt: Date.now() - 8 * 86400000 })
await cleanup.storage.put('preview-latest:3', requestKey)
await cleanup.coordinator.alarm()
assert.equal(await cleanup.storage.get(requestKey), undefined)
assert.equal(await cleanup.storage.get('preview-latest:3'), undefined)
const stale = fixture(); stale.pr.head.sha = other
await stale.coordinator.handle(event)
assert.equal(stale.calls.filter(call => call.route.endsWith('/dispatches')).length, 0)
const moved = fixture(); await moved.coordinator.handle(event); moved.pr.head.sha = other; moved.runs.push(run)
await moved.coordinator.handle({ kind: 'completion', runId: 42 })
assert.equal(moved.calls.filter(call => call.route.endsWith('/comments')).length, 0, 'A stale build is never presented as the latest preview')
const unknown = fixture(); unknown.loseResponse(); await unknown.coordinator.handle(event); await unknown.coordinator.handle(event); await unknown.coordinator.alarm()
assert.equal(unknown.calls.filter(call => call.route.endsWith('/dispatches')).length, 1, 'Uncertain HTTP responses never retry installer dispatch')
unknown.runs.push(run); await unknown.coordinator.alarm()
assert.equal((await unknown.storage.get(`request:preview:${sha}:pr:3`)).phase, 'completed', 'Reporting recovers an accepted run without redispatching')
const wrong = fixture(); await wrong.coordinator.handle(event)
wrong.runs.push({ ...run, display_title: `Preview ${other}` }); await wrong.coordinator.handle({ kind: 'completion', runId: 42 })
assert.equal(wrong.calls.filter(call => call.body?.conclusion === 'success').length, 0, 'Results cannot green another source revision')
const wrongWorkflow = fixture(); await wrongWorkflow.coordinator.handle(event)
wrongWorkflow.runs.push({ ...run, path: '.github/workflows/unrelated.yml' }); await wrongWorkflow.coordinator.handle({ kind: 'completion', runId: 42 })
assert.equal(wrongWorkflow.calls.filter(call => call.body?.conclusion === 'success').length, 0, 'A matching title from a different workflow cannot green the requested check')
const quick = fixture(); await quick.coordinator.handle({ ...event, mode: 'quick' })
assert.equal(quick.calls.find(call => call.route.endsWith('/dispatches')).body.inputs.desktop_checks, 'true')
const req = new Request('https://worker.test/github', { method: 'POST', body: bytes, headers: { 'x-hub-signature-256': signature } })
assert.equal((await worker.fetch(req, {})).status, 503)

const signedRetry = fixture()
const signedEnv = { ...env, GITHUB_APP_PRIVATE_KEY: 'test-only-unused', GITHUB_WEBHOOK_SECRET: secret,
    SOURCE_INSTALLATION_ID: '11', HELPER_INSTALLATION_ID: '22', RELAY: {
        idFromName(name) { assert.equal(name, env.SOURCE_REPOSITORY); return name },
        get() { return signedRetry.coordinator }
    } }
const deliveryUUID = crypto.randomUUID()
async function signedRequest(body, delivery = deliveryUUID, tamper = false) {
    const raw = new TextEncoder().encode(JSON.stringify(body))
    const sig = `sha256=${Buffer.from(await crypto.subtle.sign('HMAC', hmac, raw)).toString('hex')}`
    return worker.fetch(new Request('https://worker.test/github', { method: 'POST', body: tamper ? '{}' : raw,
        headers: { 'x-hub-signature-256': sig, 'x-github-event': 'pull_request', 'x-github-delivery': delivery } }), signedEnv)
}
const retryPayload = { ...payload('labeled'), label: { name: 'ci:preview-retry' } }
assert.equal((await signedRequest(retryPayload, deliveryUUID, true)).status, 401)
assert.equal((await (await signedRequest({ ...retryPayload, sender: { id: 99 } })).json()).ignored, true)
assert.equal((await (await signedRequest(retryPayload)).json()).queued, true)
assert.equal((await (await signedRequest(retryPayload)).json()).queued, false)
await signedRetry.coordinator.alarm()
assert.deepEqual(signedRetry.calls.find(call => call.route.endsWith('/dispatches')).body.inputs,
    { source_repository: env.SOURCE_REPOSITORY, source_sha: sha, source_pr: '3', request_id: deliveryUUID, target: 'windows-x64' },
    'Verified retry webhook propagates its delivery UUID through dispatch')
assert.equal(dispatches(signedRetry), 1, 'Signed webhook redelivery remains exactly one attempt')

const previewWorkflow = await readFile(new URL('../.github/workflows/windows-preview.yml', import.meta.url), 'utf8')
assert.match(previewWorkflow, /^run-name: Preview \$\{\{ inputs\.source_sha \}\}\$\{\{ inputs\.request_id && format\(' request:\{0\}', inputs\.request_id\) \|\| '' \}\}$/m,
    'Preview workflow run title must implement the relay attempt-token contract with a legacy fallback')
for (const input of ['source_pr', 'request_id', 'target']) assert.match(previewWorkflow, new RegExp(`^      ${input}:`, 'm'))
assert.match(previewWorkflow, /retention-days: 7/, 'Download wording must agree with workflow artifact retention')
for (const workflow of ['helper-checks.yml', 'desktop-ci.yml']) {
    const yaml = await readFile(new URL(`../.github/workflows/${workflow}`, import.meta.url), 'utf8')
    assert.match(yaml, /workflow_dispatch:/)
    assert.doesNotMatch(yaml, /^  (push|pull_request|schedule):/m)
    assert.match(yaml, /persist-credentials: false/)
    assert.doesNotMatch(yaml, /upload-artifact|secrets\./)
    assert.match(yaml, /source_sha/)
}
const full = await readFile(new URL('../.github/workflows/desktop-ci.yml', import.meta.url), 'utf8')
assert.match(full, /ubuntu-24\.04/); assert.match(full, /windows-2025/); assert.match(full, /macos-15/)
console.log('Relay: signatures/allowlists, explicit same-SHA retries, durable delivery/attempt deduplication, exact run/SHA guards, independent report recovery, single-comment idempotency, stale/expired reporting and ambiguous-dispatch safety passed')
