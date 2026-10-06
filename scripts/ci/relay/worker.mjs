const encoder = new TextEncoder()
const SHA = /^[a-f0-9]{40}$/
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
    if (body.action === 'labeled') mode = { 'ci:preview': 'preview', 'ci:full': 'full', 'ci:quick': 'quick' }[body.label?.name] || null
    return mode ? { kind: 'request', mode, pr: pr.number, sha: pr.head.sha } : null
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
            await storage.put(`queue:${delivery}`, event)
            await storage.setAlarm(Date.now() + 1)
            return true
        })
        return response({ queued }, 202)
    }
    async saveRecord(key, record) {
        await this.state.storage.transaction(async storage => {
            await storage.put(key, record)
            if (['completed', 'failed'].includes(record.phase)) await storage.delete(`pending:${key}`)
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
        let pending = false
        const runsByMode = new Map()
        for (const [key, record] of requests) {
            if (record.phase === 'completed' || record.phase === 'failed') continue
            try {
                const run = await this.findRun(record, runsByMode)
                if (run) await this.finish(key, record, run)
                else if (Date.now() - record.createdAt > 100 * 60 * 1000) await this.fail(key, record, 'No matching helper result arrived. Inspect the helper run before manually requesting another build.')
            } catch { /* Reporting outage does not authorize a new dispatch. */ }
            const latest = await this.state.storage.get(key)
            pending ||= latest && !['completed', 'failed'].includes(latest.phase)
        }
        const seen = await this.state.storage.list({ prefix: 'seen:' })
        for (const [key, at] of seen) if (Date.now() - at > 7 * 86400000) await this.state.storage.delete(key)
        const history = await this.state.storage.list({ prefix: 'request:' })
        for (const [key, record] of history) if (['completed', 'failed'].includes(record.phase) && Date.now() - record.createdAt > 7 * 86400000) await this.state.storage.delete(key)
        const failed = await this.state.storage.list({ prefix: 'failed:' })
        for (const [key, entry] of failed) if (Date.now() - entry.at > 7 * 86400000) await this.state.storage.delete(key)
        const hasQueue = (await this.state.storage.list({ prefix: 'queue:', limit: 1 })).size > 0
        if (pending || hasQueue) await this.state.storage.setAlarm(Date.now() + 60000)
        else if (seen.size || history.size || failed.size) await this.state.storage.setAlarm(Date.now() + 86400000)
    }
    async currentPR(number) { return this.api.request('source', `/pulls/${number}`) }
    matchesRun(record, run) {
        return (!record.runId || record.runId === run.id) && run.event === 'workflow_dispatch' && run.path === `.github/workflows/${modes[record.mode].workflow}` && run.head_branch === this.env.AUTOMATION_REF && run.display_title === `${modes[record.mode].title} ${record.sha}`
    }
    async findRun(record, cache = new Map()) {
        if (record.runId) {
            const run = await this.api.request('helper', `/actions/runs/${record.runId}`)
            return run && this.matchesRun(record, run) ? run : undefined
        }
        if (!cache.has(record.mode)) cache.set(record.mode, await this.api.request('helper', `/actions/workflows/${modes[record.mode].workflow}/runs?event=workflow_dispatch&per_page=50`))
        return cache.get(record.mode).workflow_runs.find(run => this.matchesRun(record, run))
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
        const key = `request:${event.mode}:${event.sha}`
        const record = { mode: event.mode, sha: event.sha, pr: event.pr, phase: 'preparing', createdAt: Date.now(), checkId: null }
        const claimed = await this.state.storage.transaction(async storage => {
            const existing = await storage.get(key)
            if (existing && (!['completed', 'failed'].includes(existing.phase) || Date.now() - existing.createdAt < 7 * 86400000)) return false
            await storage.put(key, record)
            await storage.put(`pending:${key}`, record)
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
            const existing = await this.findRun(record)
            if (existing) { record.runId = existing.id; await this.saveRecord(key, record); await this.finish(key, record, existing); return }
            const inputs = { source_repository: this.env.SOURCE_REPOSITORY, source_sha: event.sha }
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
            record.phase = 'uncertain'
            await this.saveRecord(key, record)
        }
    }
    async fail(key, record, summary) {
        if (record.checkId) await this.api.request('source', `/check-runs/${record.checkId}`, 'PATCH', { status: 'completed', conclusion: 'failure', output: { title: 'Helper result unavailable', summary } })
        await this.saveRecord(key, { ...record, phase: 'failed' })
    }
    async finish(key, record, run) {
        if (record.phase === 'completed' || record.phase === 'failed') return
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
        // Persist before the optional comment to avoid duplicate installer replies.
        await this.saveRecord(key, { ...record, phase: 'completed', runId: run.id })
        if (record.mode !== 'preview' || !success) return
        const pr = await this.currentPR(record.pr)
        if (pr.state !== 'open' || pr.head.sha !== record.sha) return
        const artifacts = await this.api.request('helper', `/actions/runs/${run.id}/artifacts`)
        const artifact = artifacts.artifacts.find(item => !item.expired && item.name === `zyra-preview-windows-${run.id}-${run.run_attempt}`)
        if (!artifact) return
        const download = `${url}/artifacts/${artifact.id}`
        await this.api.request('source', `/issues/${record.pr}/comments`, 'POST', {
            body: `Personal Windows preview for \`${record.sha}\`: [download installer ZIP](${download}).\n\nUnsigned. Install **Zyra Preview** beside stable. The ZIP includes source provenance and SHA256SUMS; the [build summary](${url}) shows the installer checksum. GitHub login is required. The link expires after one day; the installed app does not expire. No stable release was published.`
        })
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
