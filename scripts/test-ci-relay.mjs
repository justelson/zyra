import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import worker, { normalizeWebhook, verifyWebhook, RelayCoordinator, GitHub } from './ci/relay/worker.mjs'
const env = { SOURCE_REPOSITORY: 'source/app', HELPER_REPOSITORY: 'helper/app', AUTOMATION_REF: 'ci/automation', MAINTAINER_IDS: '1,2' }
const sha = 'a'.repeat(40), other = 'b'.repeat(40)
const payload = action => ({ action, repository: { full_name: env.SOURCE_REPOSITORY }, sender: { id: 1 }, pull_request: { number: 3, state: 'open', head: { sha, repo: { full_name: env.SOURCE_REPOSITORY } } } })
assert.equal(normalizeWebhook('pull_request', payload('synchronize'), env).mode, 'quick')
assert.equal(normalizeWebhook('pull_request', { ...payload('synchronize'), label: { name: 'ci:preview' } }, env).mode, 'quick', 'Retained labels never turn pushes into installers')
for (const action of ['edited', 'closed', 'unlabeled']) assert.equal(normalizeWebhook('pull_request', payload(action), env), null)
assert.equal(normalizeWebhook('issue_comment', payload('created'), env), null)
assert.equal(normalizeWebhook('pull_request', { ...payload('labeled'), label: { name: 'ci:preview' } }, env).mode, 'preview')
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
    const runs = [], artifacts = [{ id: 7, name: 'zyra-preview-windows-42-1', expired: false }]
    let uncertain = false
    const api = { async request(role, route, method = 'GET', body) {
        calls.push({ role, route, method, body })
        if (route === '/pulls/3') return structuredClone(pr)
        if (route.includes('/files?')) return [{ filename: 'desktop/src/main/index.ts' }]
        if (route.includes('/runs?')) return { workflow_runs: structuredClone(runs) }
        if (route === '/check-runs' && method === 'POST') return { id: 5 }
        if (route.endsWith('/dispatches')) { if (uncertain) throw new Error('lost dispatch response'); return { workflow_run_id: 42 } }
        if (route === '/actions/runs/42') return structuredClone(runs[0])
        if (route.endsWith('/artifacts')) return { artifacts }
        return null
    } }
    return { storage, calls, pr, runs, artifacts, coordinator: new RelayCoordinator({ storage }, env, api), loseResponse() { uncertain = true } }
}
const event = { kind: 'request', mode: 'preview', pr: 3, sha }
const f = fixture()
const enqueue = delivery => f.coordinator.fetch(new Request('https://relay.internal', { method: 'POST', body: JSON.stringify({ delivery, event }) }))
assert.equal((await (await enqueue('delivery1')).json()).queued, true)
assert.equal((await (await enqueue('delivery1')).json()).queued, false)
await enqueue('delivery2')
await f.coordinator.alarm()
assert.equal(f.calls.filter(call => call.route.endsWith('/dispatches')).length, 1, 'Different deliveries for the same source revision deduplicate')
assert.deepEqual(f.calls.find(call => call.route.endsWith('/dispatches')).body, { ref: env.AUTOMATION_REF, inputs: { source_repository: env.SOURCE_REPOSITORY, source_sha: sha } })
assert.equal(f.calls.find(call => call.route === '/check-runs').body.head_sha, sha)
assert.equal((await f.storage.get(`request:preview:${sha}`)).runId, 42, 'New dispatches retain the returned run identity')
const run = { id: 42, run_attempt: 1, event: 'workflow_dispatch', path: '.github/workflows/windows-preview.yml', head_branch: env.AUTOMATION_REF, display_title: `Preview ${sha}`, status: 'completed', conclusion: 'success' }
f.runs.push(run)
await f.coordinator.handle({ kind: 'completion', runId: 42 })
assert.equal(f.calls.filter(call => call.route.endsWith('/comments')).length, 1)
assert.match(f.calls.find(call => call.route.endsWith('/comments')).body.body, /Unsigned/)
await f.coordinator.handle({ kind: 'completion', runId: 42 })
assert.equal(f.calls.filter(call => call.route.endsWith('/comments')).length, 1, 'Completion replay does not duplicate links')
const stale = fixture(); stale.pr.head.sha = other
await stale.coordinator.handle(event)
assert.equal(stale.calls.filter(call => call.route.endsWith('/dispatches')).length, 0)
const moved = fixture(); await moved.coordinator.handle(event); moved.pr.head.sha = other; moved.runs.push(run)
await moved.coordinator.handle({ kind: 'completion', runId: 42 })
assert.equal(moved.calls.filter(call => call.route.endsWith('/comments')).length, 0, 'A stale build is never presented as the latest preview')
const unknown = fixture(); unknown.loseResponse(); await unknown.coordinator.handle(event); await unknown.coordinator.handle(event); await unknown.coordinator.alarm()
assert.equal(unknown.calls.filter(call => call.route.endsWith('/dispatches')).length, 1, 'Uncertain HTTP responses never retry installer dispatch')
unknown.runs.push(run); await unknown.coordinator.alarm()
assert.equal((await unknown.storage.get(`request:preview:${sha}`)).phase, 'completed', 'Reporting recovers an accepted run without redispatching')
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
console.log('Relay: signature, repository/maintainer/source allowlists, explicit expensive requests, durable deduplication, exact-SHA reporting, stale results and uncertain-dispatch recovery passed')
