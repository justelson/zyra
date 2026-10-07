import { previewComment, upsertPreviewComment } from './preview-report.mjs'

const encoder = new TextEncoder()
const SHA = /^[a-f0-9]{40}$/
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const modes = {
    quick: { name: 'Zyra quick checks', workflow: 'helper-checks.yml', title: 'Quick checks' },
    full: { name: 'Zyra full checks', workflow: 'desktop-ci.yml', title: 'Full checks' },
    preview: { name: 'Zyra Windows preview', workflow: 'windows-preview.yml', title: 'Preview' }
}
const response = (body, status = 200) => Response.json(body, { status })
const configured = env => ['GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_WEBHOOK_SECRET', 'SOURCE_INSTALLATION_ID', 'HELPER_INSTALLATION_ID', 'SOURCE_REPOSITORY', 'HELPER_REPOSITORY', 'AUTOMATION_REF', 'MAINTAINER_IDS'].every(key => Boolean(env[key]))

export async function verifyWebhook(secret, signature, body) {
    if (!secret || !/^sha256=[a-f0-9]{64}$/.test(signature || '')) return false
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
    const bytes = Uint8Array.from(signature.slice(7).match(/../g), hex => parseInt(hex, 16))
    return crypto.subtle.verify('HMAC', key, bytes, body)
}

export function normalizeWebhook(event, body, env) {
    const repository = body.repository?.full_name
    if (event === 'workflow_run' && body.action === 'completed' && repository === env.HELPER_REPOSITORY) {
        const run = body.workflow_run
        if (!Number.isSafeInteger(run?.id) || run.head_branch !== env.AUTOMATION_REF) return null
        return { kind: 'completion', runId: run.id }
    }
    if (event !== 'pull_request' || repository !== env.SOURCE_REPOSITORY) return null
    const allowed = String(env.MAINTAINER_IDS || '').split(',').map(value => value.trim())
    if (!allowed.includes(String(body.sender?.id))) return null
    const pr = body.pull_request
    if (!SHA.test(pr?.head?.sha || '') || pr.head.repo?.full_name !== env.SOURCE_REPOSITORY || !Number.isSafeInteger(pr.number) || pr.state !== 'open') return null
    let mode = null
    if (['opened', 'synchronize', 'reopened', 'ready_for_review'].includes(body.action)) mode = 'quick'
    if (body.action === 'labeled') mode = { 'ci:preview': 'preview', 'ci:preview-retry': 'preview', 'ci:full': 'full', 'ci:quick': 'quick' }[body.label?.name] || null
    return mode ? { kind: 'request', mode, pr: pr.number, sha: pr.head.sha,
        ...(body.label?.name === 'ci:preview-retry' && body.action === 'labeled' ? { retry: true } : {}) } : null
}

function base64url(bytes) {
    return btoa(typeof bytes === 'string' ? bytes : String.fromCharCode(...new Uint8Array(bytes))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

export class GitHub {
    constructor(env) { this.env = env; this.tokens = new Map() }
    async jwt() {
        if (!this.key) {
            const pem = this.env.GITHUB_APP_PRIVATE_KEY
            if (!pem.includes('BEGIN PRIVATE KEY')) throw new Error('GitHub App key must be PKCS8')
            const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----|\s/g, '')), value => value.charCodeAt(0))
            this.key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
        }
        const now = Math.floor(Date.now() / 1000)
        const unsigned = `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: this.env.GITHUB_APP_ID }))}`
        return `${unsigned}.${base64url(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', this.key, encoder.encode(unsigned)))}`
    }
    async raw(route, method, body, token) {
        const result = await fetch(`https://api.github.com${route}`, {
            method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'zyra-ci-relay', 'X-GitHub-Api-Version': '2026-03-10' },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000)
        })
        // Never log GitHub response bodies, headers, tokens or private keys.
        if (!result.ok) throw new Error(`GitHub request failed with HTTP ${result.status}`)
        return result.status === 204 ? null : result.json()
    }
    async token(role) {
        const cached = this.tokens.get(role)
        if (cached && cached.until > Date.now()) return cached.value
        const repository = this.env[role === 'source' ? 'SOURCE_REPOSITORY' : 'HELPER_REPOSITORY'].split('/')[1]
        const id = this.env[role === 'source' ? 'SOURCE_INSTALLATION_ID' : 'HELPER_INSTALLATION_ID']
        const permissions = role === 'source' ? { checks: 'write', pull_requests: 'write' } : { actions: 'write' }
        const result = await this.raw(`/app/installations/${id}/access_tokens`, 'POST', { repositories: [repository], permissions }, await this.jwt())
        this.tokens.set(role, { value: result.token, until: Date.parse(result.expires_at) - 60000 })
        return result.token
    }
    async request(role, route, method = 'GET', body) {
        return this.raw(`/repos/${this.env[role === 'source' ? 'SOURCE_REPOSITORY' : 'HELPER_REPOSITORY']}${route}`, method, body, await this.token(role))
    }
}

export class RelayCoordinator {
    constructor(state, env, api = new GitHub(env)) { this.state = state; this.env = env; this.api = api }
    async fetch(request) {
        const { delivery, event } = await request.json()
        const queued = await this.state.storage.transaction(async storage => {
            const seenAt = await storage.get(`seen:${delivery}`)
            if (seenAt && Date.now() - seenAt < 7 * 86400000) return false
            await storage.put(`seen:${delivery}`, Date.now())
            await storage.put(`queue:${delivery}`, event.mode === 'preview'
                ? { ...event, requestId: delivery, ...(event.retry ? { attempt: delivery } : {}) } : event)
            await storage.setAlarm(Date.now() + 1)
            return true
        })
        return response({ queued }, 202)
    }
    async saveRecord(key, record) {
        await this.state.storage.transaction(async storage => {
            await storage.put(key, record)
            if (['completed', 'failed'].includes(record.phase) && record.reportPhase !== 'pending') await storage.delete(`pending:${key}`)
            else await storage.put(`pending:${key}`, record)
        })
    }
    async pendingRecords() {
        const records = await this.state.storage.list({ prefix: 'pending:' })
        return new Map([...records].map(([key, record]) => [key.slice('pending:'.length), record]))
    }
    async alarm() {
        const queue = await this.state.storage.list({ prefix: 'queue:', limit: 8 })
        for (const [key, event] of queue) {
            // Consume once. Reporting may poll/retry; installer dispatch never retries.
            await this.state.storage.delete(key)
            try { await this.handle(event) } catch {
                await this.state.storage.put(`failed:${key}`, { event, at: Date.now(), message: 'Relay request failed. No build was automatically retried.' })
                console.warn('Relay event failed before completion; inspect failed delivery metadata', key)
            }
        }
        const requests = await this.pendingRecords()
        let nextPollAt = Infinity
        const runsByMode = new Map()
        for (const [key, record] of requests) {
            if (record.phase === 'failed' || (record.phase === 'completed' && record.reportPhase !== 'pending')) continue
            try {
                if (record.phase === 'completed') {
                    if (!record.reportNextAt || record.reportNextAt <= Date.now()) await this.reportPreview(key, record)
                }
                else {
                    const run = await this.findRun(record, runsByMode)
                    if (run) await this.finish(key, record, run)
                    else if (Date.now() - record.createdAt > 100 * 60 * 1000) await this.fail(key, record, 'No matching helper result arrived. Inspect the helper run before adding ci:preview-retry or manually requesting another build. No build was automatically retried.')
                }
            } catch { /* Reporting outage does not authorize a new dispatch. */ }
            let latest = await this.state.storage.get(key)
            if (latest?.phase === 'completed' && latest.reportPhase === 'pending') {
                if (!latest.reportNextAt || latest.reportNextAt <= Date.now()) {
                    const reportAttempts = (latest.reportAttempts || 0) + 1
                    latest = { ...latest, reportAttempts, reportNextAt: Date.now() + Math.min(15 * 60000, 60000 * 2 ** Math.min(reportAttempts - 1, 4)) }
                    await this.saveRecord(key, latest)
                }
                nextPollAt = Math.min(nextPollAt, latest.reportNextAt)
            } else if (latest && !['completed', 'failed'].includes(latest.phase)) nextPollAt = Math.min(nextPollAt, Date.now() + 60000)
        }
        const seen = await this.state.storage.list({ prefix: 'seen:' })
        for (const [key, at] of seen) if (Date.now() - at > 7 * 86400000) await this.state.storage.delete(key)
        const history = await this.state.storage.list({ prefix: 'request:' })
        for (const [key, record] of history) if (['completed', 'failed'].includes(record.phase) && record.reportPhase !== 'pending' && Date.now() - record.createdAt > 7 * 86400000) {
            await this.state.storage.delete(key)
            if (await this.state.storage.get(`preview-latest:${record.pr}`) === key) await this.state.storage.delete(`preview-latest:${record.pr}`)
        }
        const failed = await this.state.storage.list({ prefix: 'failed:' })
        for (const [key, entry] of failed) if (Date.now() - entry.at > 7 * 86400000) await this.state.storage.delete(key)
        const hasQueue = (await this.state.storage.list({ prefix: 'queue:', limit: 1 })).size > 0
        if (hasQueue) nextPollAt = Math.min(nextPollAt, Date.now() + 60000)
        if (Number.isFinite(nextPollAt)) await this.state.storage.setAlarm(nextPollAt)
        else if (seen.size || history.size || failed.size) await this.state.storage.setAlarm(Date.now() + 86400000)
    }
    async currentPR(number) { return this.api.request('source', `/pulls/${number}`) }
    matchesRun(record, run) {
        // New previews have an attempt token in their run name. Legacy retries
        // without one still require a returned run ID; a plain same-SHA title
        // can never identify those attempts after a lost dispatch response.
        const title = `${modes[record.mode].title} ${record.sha}${record.requestId ? ` request:${record.requestId}` : ''}`
        return (!record.retry || record.requestId || Number.isSafeInteger(record.runId)) && (!record.runId || record.runId === run.id) && run.event === 'workflow_dispatch' && run.path === `.github/workflows/${modes[record.mode].workflow}` && run.head_branch === this.env.AUTOMATION_REF && run.display_title === title
    }
    async findRun(record, cache = new Map()) {
        if (record.runId) {
            const run = await this.api.request('helper', `/actions/runs/${record.runId}`)
            return run && this.matchesRun(record, run) ? run : undefined
        }
        if (record.retry && !record.requestId) return undefined
        if (!cache.has(record.mode)) cache.set(record.mode, await this.api.request('helper', `/actions/workflows/${modes[record.mode].workflow}/runs?event=workflow_dispatch&per_page=50`))
        const candidates = cache.get(record.mode).workflow_runs.filter(run => this.matchesRun(record, run))
        return candidates.length === 1 ? candidates[0] : undefined
    }
    async handle(event) {
        if (event.kind === 'completion') {
            const run = await this.api.request('helper', `/actions/runs/${event.runId}`)
            const records = await this.pendingRecords()
            for (const [key, record] of records) if (this.matchesRun(record, run)) await this.finish(key, record, run)
            return
        }
        const pr = await this.currentPR(event.pr)
        if (pr.state !== 'open' || pr.head.sha !== event.sha || pr.head.repo.full_name !== this.env.SOURCE_REPOSITORY) return
        if (event.retry && (event.mode !== 'preview' || !/^[a-zA-Z0-9_-]{1,80}$/.test(event.attempt || ''))) return
        const requestId = event.mode === 'preview' ? (event.requestId || event.attempt || crypto.randomUUID()) : undefined
        if (requestId && !REQUEST_ID.test(requestId)) return
        const legacyKey = `request:${event.mode}:${event.sha}${event.retry ? `:retry:${event.attempt}` : ''}`
        const key = event.mode === 'preview' ? `${legacyKey}:pr:${event.pr}` : legacyKey
        const record = { mode: event.mode, sha: event.sha, pr: event.pr, phase: 'preparing', createdAt: Date.now(), checkId: null,
            ...(requestId ? { requestId } : {}),
            ...(event.retry ? { retry: true, attempt: event.attempt } : {}) }
        const claimed = await this.state.storage.transaction(async storage => {
            const legacy = event.mode === 'preview' ? await storage.get(legacyKey) : undefined
            const existing = await storage.get(key) || (legacy?.pr === event.pr ? legacy : undefined)
            if (existing && (!['completed', 'failed'].includes(existing.phase) || Date.now() - existing.createdAt < 7 * 86400000)) return false
            const pending = await storage.list({ prefix: 'pending:request:' })
            if ([...pending.values()].some(item => item.mode === event.mode && item.sha === event.sha && (event.mode !== 'preview' || item.pr === event.pr) && !['completed', 'failed'].includes(item.phase))) return false
            await storage.put(key, record)
            await storage.put(`pending:${key}`, record)
            if (event.mode === 'preview') await storage.put(`preview-latest:${event.pr}`, key)
            return true
        })
        if (!claimed) return
        try {
            const check = await this.api.request('source', '/check-runs', 'POST', {
                name: modes[event.mode].name, head_sha: event.sha, status: 'in_progress', external_id: key,
                output: { title: 'Requested exact source revision', summary: `Source \`${event.sha}\`. Scope: ${event.mode}. Installer work is request-only.` }
            })
            record.checkId = check.id
            await this.saveRecord(key, record)
            const existing = event.mode === 'preview' ? undefined : await this.findRun(record)
            if (existing) { record.runId = existing.id; await this.saveRecord(key, record); await this.finish(key, record, existing); return }
            const inputs = { source_repository: this.env.SOURCE_REPOSITORY, source_sha: event.sha }
            if (event.mode === 'preview') {
                inputs.source_pr = String(event.pr)
                inputs.request_id = requestId
                inputs.target = 'windows-x64'
            }
            if (event.mode === 'quick') {
                const files = await this.api.request('source', `/pulls/${event.pr}/files?per_page=100`)
                inputs.source_pr = String(event.pr)
                inputs.desktop_checks = String(pr.changed_files > files.length || !files.every(file => /^(docs\/|[^/]+\.md$)/.test(file.filename)))
            }
            record.phase = 'dispatching'
            await this.saveRecord(key, record)
            const dispatch = await this.api.request('helper', `/actions/workflows/${modes[event.mode].workflow}/dispatches`, 'POST', { ref: this.env.AUTOMATION_REF, inputs })
            if (Number.isSafeInteger(dispatch?.workflow_run_id)) record.runId = dispatch.workflow_run_id
            record.phase = 'submitted'
            await this.saveRecord(key, record)
        } catch {
            // A lost HTTP response may hide an accepted run. Retain the claim,
            // poll for its result, and never automatically send another dispatch.
            const latest = await this.state.storage.get(key)
            if (latest?.phase === 'completed' || latest?.phase === 'failed') return
            record.phase = 'uncertain'
            await this.saveRecord(key, record)
        }
    }
    async fail(key, record, summary) {
        if (record.checkId) await this.api.request('source', `/check-runs/${record.checkId}`, 'PATCH', { status: 'completed', conclusion: 'failure', output: { title: 'Helper result unavailable', summary } })
        await this.saveRecord(key, { ...record, phase: 'failed' })
    }
    async finish(key, record, run) {
        if (record.phase === 'completed') {
            if (record.reportPhase === 'pending') await this.reportPreview(key, record)
            return
        }
        if (record.phase === 'failed') return
        if (!this.matchesRun(record, run) || !record.checkId) return
        const url = `https://github.com/${this.env.HELPER_REPOSITORY}/actions/runs/${run.id}`
        if (run.status !== 'completed') {
            await this.api.request('source', `/check-runs/${record.checkId}`, 'PATCH', { details_url: url })
            return
        }
        const success = run.conclusion === 'success'
        const conclusion = success ? 'success' : ['cancelled', 'timed_out'].includes(run.conclusion) ? run.conclusion : 'failure'
        await this.api.request('source', `/check-runs/${record.checkId}`, 'PATCH', {
            status: 'completed', conclusion, details_url: url,
            output: { title: success ? 'Exact revision verified by helper' : 'Helper check did not pass', summary: `Source \`${record.sha}\`. Scope: ${record.mode}. [Run evidence](${url}). Quick checks are not full release acceptance.` }
        })
        // Build completion and link delivery are independent. Persist the exact
        // run attempt before any lookup or comment request that could fail.
        const completed = { ...record, phase: 'completed', runId: run.id, runAttempt: run.run_attempt,
            ...(record.mode === 'preview' && success ? { reportPhase: 'pending', reportStartedAt: Date.now() } : {}) }
        await this.saveRecord(key, completed)
        if (completed.reportPhase === 'pending') await this.reportPreview(key, completed)
    }
    async previewIsCurrent(key, record) {
        const latest = await this.state.storage.get(`preview-latest:${record.pr}`)
        if (latest && latest !== key) return false
        const pr = await this.currentPR(record.pr)
        return pr.state === 'open' && pr.head.sha === record.sha && pr.head.repo?.full_name === this.env.SOURCE_REPOSITORY
    }
    async reportPreview(key, record) {
        if (record.reportPhase !== 'pending') return
        const stop = reportPhase => this.saveRecord(key, { ...record, reportPhase })
        // Seven-day artifacts cannot be delivered indefinitely. Keep the build
        // result successful and require an explicit retry for a new installer.
        if (Date.now() - record.reportStartedAt > 7 * 86400000) { await stop('expired'); return }
        if (!await this.previewIsCurrent(key, record)) { await stop('superseded'); return }
        const run = { id: record.runId, run_attempt: record.runAttempt }
        const artifacts = await this.api.request('helper', `/actions/runs/${run.id}/artifacts?per_page=100`)
        const artifact = artifacts.artifacts.find(item => item.name === `zyra-preview-windows-${run.id}-${run.run_attempt}`)
        if (!artifact) return // Eventual artifact visibility is reporting work.
        if (artifact.expired || (artifact.expires_at && Date.parse(artifact.expires_at) <= Date.now())) { await stop('expired'); return }
        const result = await upsertPreviewComment(this.api, this.env, record,
            previewComment(record, run, artifact, this.env.HELPER_REPOSITORY), () => this.previewIsCurrent(key, record))
        await this.saveRecord(key, { ...record, reportPhase: result.skipped ? 'superseded' : 'delivered',
            ...(result.commentId ? { commentId: result.commentId } : {}) })
    }
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url)
        if (url.pathname === '/health' && request.method === 'GET') return response({ configured: configured(env) })
        if (url.pathname !== '/github' || request.method !== 'POST') return response({ error: 'Not found' }, 404)
        if (!configured(env)) return response({ error: 'Relay setup incomplete' }, 503)
        if (Number(request.headers.get('content-length')) > 1048576) return response({ error: 'Webhook too large' }, 413)
        const bytes = await request.arrayBuffer()
        if (bytes.byteLength > 1048576) return response({ error: 'Webhook too large' }, 413)
        if (!await verifyWebhook(env.GITHUB_WEBHOOK_SECRET, request.headers.get('x-hub-signature-256'), bytes)) return response({ error: 'Invalid signature' }, 401)
        let body
        try { body = JSON.parse(new TextDecoder().decode(bytes)) } catch { return response({ error: 'Invalid JSON' }, 400) }
        const event = normalizeWebhook(request.headers.get('x-github-event'), body, env)
        if (!event) return response({ ignored: true })
        const delivery = request.headers.get('x-github-delivery')
        if (!/^[a-zA-Z0-9_-]{1,80}$/.test(delivery || '')) return response({ error: 'Missing delivery identity' }, 400)
        const coordinator = env.RELAY.get(env.RELAY.idFromName(env.SOURCE_REPOSITORY))
        return coordinator.fetch(new Request('https://relay.internal/event', { method: 'POST', body: JSON.stringify({ delivery, event }) }))
    }
}
