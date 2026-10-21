import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { AppOperationReceipts } from '../src/main/assistant/app-operation-receipts'
import { AgentAppService, type AgentAppDependencies, type AppActor } from '../src/main/assistant/agent-app-service'
import { DevicePreferencesService } from '../src/main/setup/device-preferences-service'
import { desktopNamespaceId } from '../src/main/assistant/agent-server-namespace'
import type { AssistantService } from '../src/main/assistant/service'

const directory = await mkdtemp(join(tmpdir(), 'zyra-app-service-'))
try {
    const preferences = new DevicePreferencesService(join(directory, 'prefs.json'))
    const makeChat = (id: string, projectId: string, source = 'chat') => ({ id, title: id, projectId, projectPath: `/projects/${projectId}`, workingRoot: `/projects/${projectId}`, activeThreadId: `thread-${id}`, threads: [{ id: `thread-${id}`, providerThreadId: `canonical-${id}`, source, model: 'test/model', runtimeMode: 'approval-required', thinking: 'medium', latestTurn: { id: `turn-${id}`, state: 'running' } }] })
    const chats = [makeChat('origin', 'allowed'), makeChat('other', 'allowed'), makeChat('foreign', 'private'), makeChat('supporting', 'allowed', 'subagent')]
    const snapshot = { sessions: chats, selectedSessionId: 'foreign' }
    const renames: string[] = [], rendererRequests: unknown[] = [], creates: Record<string, unknown>[] = []
    let originDeleted = false
    const service = {
        ensureCanonicalChatAvailable: async () => !originDeleted,
        getSnapshot: async () => ({ ...snapshot, sessions: originDeleted ? chats.filter(chat => chat.id !== 'origin') : chats }),
        renameSession: async (id: string, title: string, expected: string) => { const chat = chats.find(chat => chat.id === id)!; if (chat.title !== expected) throw new Error('Title changed'); renames.push(id); chat.title = title; return { success: true } },
        createSession: async (input: Record<string, unknown>) => { creates.push(input); return { success: true, sessionId: 'new-chat' } },
        listModels: async () => ({ success: true, models: [] }),
        getSessionTurnUsage: async () => ({ success: true, usage: { turns: Array.from({ length: 200 }, (_, index) => ({ id: `usage-${index}` })), totals: { contextTokens: 128 }, fetchedAt: 'observed' } }),
        getHistoryAroundMessage: async (threadId: string, messageId: string) => ({ threadId, messageId }),
    } as unknown as AssistantService
    const deps = { stateDirectory: directory, getAssistant: () => service,
        setup: { preferences, secrets: { getHostedAiStatus: async () => ({ groqConfigured: false, geminiConfigured: false }) } },
        renderer: async (request: { params: { area?: string } }) => { rendererRequests.push(request); return request.params.area === 'remembered' ? { choices: { model: 'chosen/model', effort: 'high', runtimeMode: 'approval-required' } } : { owner: 'test' } },
        open: async () => ({ opened: true }),
    } as unknown as AgentAppDependencies
    class FixtureAppService extends AgentAppService {
        override execute(raw: Record<string, unknown>, validate: () => Promise<void> = async () => {}) { return super.execute(raw, validate) }
    }
    const app = new FixtureAppService(deps)
    const actor: AppActor = { canonicalChatId: 'canonical-origin', parentChatId: 'canonical-origin', project: '/projects/allowed', permissionMode: 'full-access', child: false, turnId: 'turn-origin', namespaceId: desktopNamespaceId(directory), approved: true }
    let index = 0
    const operation = (domain: string, action: string, params: Record<string, unknown>, override: Partial<AppActor> = {}) => ({ operationId: createHash('sha256').update(String(++index)).digest('hex'), domain, operation: action, params, actor: { ...actor, ...override } })
    const beforeInvalidRead = rendererRequests.length
    await assert.rejects(app.execute(operation('app', 'read', { area: 'order', target: 'origin', input: { owner: 'live', group: 'chats', before: 'other' } }, { permissionMode: 'read-only' })), /Reads never change/)
    await assert.rejects(app.execute(operation('app', 'preview', { area: 'queues', target: 'origin' })), /Reads never change/)
    assert.equal(rendererRequests.length, beforeInvalidRead, 'read-classified verbs cannot reach a mutating owner fallback')
    const list = await app.execute(operation('app', 'list', { area: 'chats' }))
    assert.deepEqual((list.chats as Array<{ id: string }>).map(chat => chat.id), ['origin', 'other'])
    const childList = await app.execute(operation('app', 'list', { area: 'chats' }, { child: true }))
    assert.deepEqual((childList.chats as Array<{ id: string }>).map(chat => chat.id), ['origin'])
    await assert.rejects(app.execute(operation('app', 'list', { area: 'chats' }, { appScope: 'installation', approved: false })), /actual user consent/)
    const expanded = await app.execute(operation('app', 'list', { area: 'chats' }, { appScope: 'installation', approved: true }))
    assert.deepEqual((expanded.chats as Array<{ id: string }>).map(chat => chat.id), ['origin', 'other', 'foreign'], 'real per-operation consent expands only app-object scope, not filesystem roots')
    const current = await app.execute(operation('app', 'inspect', { area: 'chats', target: 'current' }))
    assert.equal((current.chat as { id: string }).id, 'origin', 'current is authenticated origin, not the foreign selected UI Chat')
    await assert.rejects(app.execute(operation('app', 'inspect', { area: 'chats', target: 'foreign' })), /Project/)
    await assert.rejects(app.execute(operation('app', 'inspect', { area: 'chats', target: 'supporting' })), /Project/)
    await assert.rejects(app.execute(operation('app', 'list', {}, { namespaceId: 'wrong-namespace' })), /namespace/)
    await assert.rejects(app.execute(operation('settings', 'get', {})), /not dumped/)
    assert.equal(await preferences.getAssistantMemoryEnabled(), false)
    const revision = (await preferences.get({ surface: 'desktop' })).revision
    const patch = operation('settings', 'apply', { expectedRevision: revision, patch: { appearanceCodeScale: 115 } }, { approved: false })
    assert.equal((await app.execute(patch)).applied, true)
    assert.equal(await preferences.getAssistantMemoryEnabled(), false, 'ordinary preference writes cannot silently enable Memory before first UI migration')
    assert.equal((await app.execute(patch)).replayed, true)
    const rename = operation('app', 'rename', { area: 'chats', target: 'other', input: { title: 'Updated', expectedTitle: 'other' } })
    await app.execute(rename)
    assert.deepEqual(renames, ['other'])
    chats.find(chat => chat.id === 'other')!.projectId = 'private'
    await assert.rejects(app.execute(rename), /Project/, 'receipt replay rechecks target scope')
    chats.find(chat => chat.id === 'other')!.projectId = 'allowed'
    const created = await app.execute(operation('app', 'create', { area: 'chats' }))
    assert.equal(created.navigationChanged, false)
    assert.equal(creates[0].select, false)
    assert.deepEqual(creates[0].composer, { model: 'chosen/model', effort: 'high', runtimeMode: 'approval-required' })
    const usage = await app.execute(operation('usage', 'get', { area: 'chat' }))
    assert.equal((usage.usage as { returnedTurns: number }).returnedTurns, 20, 'usage is bounded even for long histories')
    assert.equal(usage.remainingContextTokens, null)
    assert.equal(usage.usedContextTokensEstimate, 128)
    await assert.rejects(app.execute(operation('app', 'rename', { area: 'chats', input: { title: 'bad', expectedTitle: 'origin' } }, { child: true })), /cannot mutate/)
    const liveRequired = operation('settings', 'apply', { expectedRevision: (await preferences.get({ surface: 'desktop' })).revision, patch: { appearanceCodeScale: 120 } })
    await assert.rejects(new AgentAppService(deps).execute(liveRequired), /Live authenticated/)
    let release!: () => void, started!: () => void
    const entered = new Promise<void>(resolve => { started = resolve })
    deps.actions = { 'test.wait': { label: 'Synthetic owner', route: '/settings', effect: 'fixture only', run: async () => { started(); await new Promise<void>(resolve => { release = resolve }); return { done: true } } } }
    const busy = app.execute(operation('settings_action', 'run', { area: 'test.wait' }))
    await entered
    let queued!: () => void
    const enqueued = new Promise<void>(resolve => { queued = resolve })
    const run = app.receipts.run.bind(app.receipts)
    app.receipts.run = (request, work, authorize) => { const result = run(request, work, authorize); if (request.operationId === rename.operationId) queued(); return result }
    const cached = app.execute(rename)
    await enqueued
    const delayed = app.execute(liveRequired, async () => { throw new Error('Originating turn stopped while queued') })
    chats.find(chat => chat.id === 'other')!.projectId = 'private'
    release(); await busy
    await assert.rejects(cached, /Project/, 'cached replay rechecks target scope after waiting in the queue')
    await assert.rejects(delayed, /stopped while queued/)
    app.receipts.run = run
    chats.find(chat => chat.id === 'other')!.projectId = 'allowed'
    await assert.rejects(app.execute(patch, async () => { throw new Error('stopped cached delivery') }), /stopped cached delivery/, 'even a completed settings receipt rechecks the live owner before delivering cached values')
    assert.equal((await preferences.get({ surface: 'desktop' })).settings.appearanceCodeScale, 115, 'Stop before a queued owner operation starts prevents its side effect')
    let rollbacks = 0
    const forkScope = { projectId: 'allowed', workingRoot: '/projects/allowed/fork', roots: [] }
    Object.assign(service, {
        prepareAgentForkWorkspace: async (_id: string, _isolated: boolean, ready: (rollback: () => Promise<void>) => void) => { ready(async () => { rollbacks++ }); return forkScope },
        confirmAgentForkWorkspace: async () => {},
        completeAgentForkScope: async () => ({ sessionId: 'saved-fork' })
    })
    const preparation = operation('app', 'fork_prepare', { area: 'chats', input: { worktree: 'isolated', expectedSourceCanonicalChatId: 'canonical-origin' } })
    const prepared = await app.execute(preparation)
    const cleanup = operation('app', 'fork_rollback', { area: 'chats', input: { rollbackToken: prepared.rollbackToken, prepareOperationId: preparation.operationId } })
    await app.execute(cleanup)
    assert.equal(rollbacks, 1)
    await assert.rejects(app.execute(preparation), /cancelled/, 'cancelled preparation cannot replay in process')
    const reopenedReceipts = new AppOperationReceipts(join(directory, 'agent-app-receipts.json'))
    await assert.rejects(reopenedReceipts.run({ ...preparation, actor: actor.canonicalChatId }, async () => { throw new Error('must not run') }), /cancelled/, 'rollback invalidation is durable across owner restart')
    const publishedPreparation = operation('app', 'fork_prepare', { area: 'chats', input: { worktree: 'isolated', expectedSourceCanonicalChatId: 'canonical-origin' } })
    const published = await app.execute(publishedPreparation)
    await app.execute(operation('app', 'fork_attach', { area: 'chats', input: { canonicalChatId: 'saved-fork', scope: forkScope, rollbackToken: published.rollbackToken, prepareOperationId: publishedPreparation.operationId } }))
    await assert.rejects(app.execute(operation('app', 'fork_rollback', { area: 'chats', input: { rollbackToken: published.rollbackToken, prepareOperationId: publishedPreparation.operationId } })), /unavailable/, 'saved history releases unpublished-only cleanup authority')
    assert.equal(rollbacks, 1)
    originDeleted = true
    await assert.rejects(app.execute(patch), /originating Chat/)
    const journal = await readFile(join(directory, 'agent-app-receipts.json'), 'utf8')
    assert.ok(!journal.includes('"params"'), 'raw inputs are fingerprinted, never journaled')
    console.log('Main app owner: exact originating Chat, Project/namespace/child limits, reauthorized receipt replay, no-navigation creation, copied remembered choices, bounded usage and no implicit Memory opt-in passed')
} finally { await rm(directory, { recursive: true, force: true }) }
