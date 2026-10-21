import { join, resolve } from 'node:path'
import type { AssistantService } from './service'
import type { AssistantSessionShell, AssistantThreadShell, AssistantChatScope, AssistantCreateSessionInput } from '../../shared/assistant/contracts'
import type { DesktopSetupServices } from '../setup'
import { AgentSettings } from './agent-settings'
import { AppOperationReceipts } from './app-operation-receipts'
import { desktopNamespaceId } from './agent-server-namespace'
import { validateAgentAppActionInput } from './agent-app-action-inputs'
import { APP_AREA_OPERATIONS, isAppAreaOperation } from '../../../../src/app-area-operations.mjs'

export type AppActor = { canonicalChatId: string; parentChatId: string; project: string; permissionMode: string; child: boolean; turnId: string | null; namespaceId: string; approved: boolean; appScope?: 'project' | 'installation' }
export type AppRequest = { domain: string; operation: string; operationId: string; params: Record<string, unknown>; actor: AppActor }
export type AppOwnerAction = { label: string; route: string; effect: string; parameters?: Record<string, unknown>; run: (input: Record<string, unknown>, actor: AppActor) => Promise<unknown> }
export type AgentAppDependencies = { stateDirectory: string; getAssistant: () => AssistantService; setup: DesktopSetupServices;
    renderer: (request: AppRequest) => Promise<Record<string, unknown>>;
    open: (route: string, actor: AppActor) => Promise<Record<string, unknown>>;
    actions?: Record<string, AppOwnerAction> }
const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const text = (value: unknown, maximum = 512) => typeof value === 'string' ? value.trim().slice(0, maximum) : ''
const projectKey = (chat: AssistantSessionShell) => chat.projectId || (chat.projectPath ? (process.platform === 'win32' ? resolve(chat.projectPath).toLowerCase() : resolve(chat.projectPath)) : `chat:${chat.id}`)
const readActions = new Set(['list', 'get', 'inspect', 'search', 'read', 'preview', 'history', 'refresh'])
const AREAS = [
    { id: 'chats', actions: ['list', 'inspect', 'search', 'read', 'rename', 'refresh_title', 'move', 'reorder', 'pin', 'unpin', 'settle', 'restore', 'archive', 'unarchive', 'create', 'fork', 'open'], owner: 'chat-service and visible-sidebar' },
    { id: 'projects', actions: ['list', 'inspect', 'create', 'update', 'open'], owner: 'Project catalog' },
    { id: 'work', actions: ['inspect', 'read', 'stop'], owner: 'canonical runtime' },
    { id: 'queues', actions: ['inspect', 'update', 'move', 'remove', 'hold', 'resume'], owner: 'Desktop profile queue', persistence: 'profile-local' },
    { id: 'resources', actions: ['list', 'read', 'open'], owner: 'versioned visualization store', relatedTools: ['visualization'] },
    { id: 'models', actions: ['list', 'inspect'], owner: 'authenticated model registry' },
    { id: 'plugins', actions: ['list', 'inspect'], owner: 'Plugin registry', mutationTool: 'settings_action' },
    { id: 'skills', actions: ['list', 'inspect'], owner: 'Skill source registry', mutationTool: 'settings_action' },
    { id: 'connections', actions: ['inspect'], owner: 'connection services', mutationTool: 'settings_action' },
    { id: 'attention', actions: ['inspect'], owner: 'canonical request state', cannotAnswerForUser: true },
    { id: 'runtime', actions: ['inspect'], owner: 'installation runtime', mutationTool: 'settings_action' },
    { id: 'files', actions: [], relatedTools: ['read', 'edit', 'write'], requires: 'Chat filesystem scope' },
    { id: 'git', actions: [], relatedTools: ['bash'], requires: 'Explicit commit/push/publication intent and filesystem scope' },
    { id: 'agents', actions: ['inspect'], relatedTools: ['agent', 'thread'], requires: 'Inherited scope and delegation budgets' },
    { id: 'workflows', actions: ['inspect'], relatedTools: ['workflow'], requires: 'Saved workflow policy and explicit scheduling support' },
    { id: 'browser', actions: [], relatedTools: ['browser_use'], requires: 'Exact browser target grant' },
    { id: 'computer', actions: [], relatedTools: ['computer'], requires: 'Exact computer target grant' },
]

export function redactAppData(value: unknown, depth = 0): unknown {
    if (depth > 12) return '[bounded]'
    if (typeof value === 'string') return value.replace(/\b(?:sk-[a-zA-Z0-9_-]{16,}|gh[pousr]_[a-zA-Z0-9]{20,}|eyJ[a-zA-Z0-9_-]{15,}\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+)\b/g, '[redacted]')
        .replace(/\bBearer\s+[^\s"']+/gi, 'Bearer [redacted]')
        .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]')
        .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token)=)[^&\s]+/gi, '$1[redacted]')
    if (Array.isArray(value)) return value.slice(0, 200).map(entry => redactAppData(entry, depth + 1))
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(Object.entries(value).filter(([key]) => !/(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|authorization|auth[_-]?token|cookie)s?$/i.test(key) && !/^(?:authorityProof|secret|token|credentials|env|headers|email)$/i.test(key)).map(([key, entry]) => [key, redactAppData(entry, depth + 1)]))
}

/** Provider windows are observations. Absence is never invented free capacity. */
export function projectUsageWindow(value: unknown, observedAt?: string, now = Date.now()) {
    const raw = asRecord(value), used = raw.usedPercent
    if (typeof used !== 'number' || !Number.isFinite(used) || used < 0) return null
    const durationSeconds = typeof raw.windowSeconds === 'number' && Number.isFinite(raw.windowSeconds) && raw.windowSeconds > 0 ? raw.windowSeconds : null
    const resetMs = typeof raw.resetAt === 'string' ? Date.parse(raw.resetAt) : NaN
    const resetAt = Number.isFinite(resetMs) ? new Date(resetMs).toISOString() : null
    if (used === 0 && durationSeconds === null && resetAt === null) return null
    const label = durationSeconds === 604800 ? 'Weekly' : durationSeconds && durationSeconds % 3600 === 0 ? `${durationSeconds / 3600}-hour window` : durationSeconds ? `${durationSeconds}-second window` : 'Unspecified window'
    return { label, usedPercent: used, remainingPercent: Math.max(0, 100 - used), durationSeconds, resetAt,
        resetsInSeconds: resetAt ? Math.max(0, Math.ceil((resetMs - now) / 1000)) : null,
        absoluteLimit: typeof raw.limit === 'number' && Number.isFinite(raw.limit) && raw.limit >= 0 ? raw.limit : null,
        source: 'provider-reported', observedAt: observedAt || null, resetPassed: resetAt ? resetMs <= now : null }
}

export class AgentAppService {
    readonly receipts: AppOperationReceipts
    private readonly settings: AgentSettings
    constructor(private readonly deps: AgentAppDependencies) {
        this.settings = new AgentSettings(deps.setup.preferences, deps.setup.secrets)
        this.receipts = new AppOperationReceipts(join(deps.stateDirectory, 'agent-app-receipts.json'))
    }
    private async context(actor: AppActor) {
        if (!actor?.canonicalChatId || !actor.parentChatId || !actor.namespaceId) throw new Error('Authenticated app caller identity is required.')
        if (actor.namespaceId !== desktopNamespaceId(this.deps.stateDirectory)) throw new Error('This app principal belongs to a different installation namespace.')
        const service = this.deps.getAssistant()
        await service.ensureCanonicalChatAvailable(actor.parentChatId)
        const snapshot = await service.getSnapshot()
        const origin = snapshot.sessions.find(chat => chat.threads.some(thread => thread.providerThreadId === actor.parentChatId))
        if (!origin) throw new Error('The originating Chat is not available in this installation.')
        if (actor.appScope === 'installation' && (!actor.approved || actor.child)) throw new Error('Installation app scope requires actual user consent for this exact operation.')
        const allowed = snapshot.sessions.filter(chat => (projectKey(chat) === projectKey(origin) || actor.appScope === 'installation') && (!actor.child || chat.id === origin.id) && chat.threads.some(thread => thread.source !== 'subagent'))
        return { service, snapshot, origin, allowed }
    }
    private target(chats: AssistantSessionShell[], actor: AppActor, selector: unknown) {
        const id = !selector || selector === 'current' ? actor.canonicalChatId : text(selector)
        const chat = chats.find(chat => chat.id === id || chat.threads.some(thread => thread.providerThreadId === id || thread.id === id))
        if (!chat) throw new Error('Chat is unavailable in the caller\'s Project. Discover an authorized exact target first.')
        return { chat, thread: chat.threads.find(thread => thread.providerThreadId === id || thread.id === id) || chat.threads.find(thread => thread.id === chat.activeThreadId) || chat.threads[0]! }
    }
    private checkScopeTargets(request: AppRequest, admission: Awaited<ReturnType<AgentAppService['context']>>) {
        const area = text(request.params.area, 80), input = asRecord(request.params.input)
        if (area === 'chat' || ['chats', 'work', 'queues'].includes(area) && !['list', 'search', 'create'].includes(request.operation)) this.target(admission.allowed, request.actor, request.params.target)
        if (Array.isArray(input.changes)) for (const change of input.changes) this.target(admission.allowed, request.actor, asRecord(change).chatId)
        if (area === 'order') for (const id of [request.params.target, input.before, input.after].filter(Boolean)) this.target(admission.allowed, request.actor, id)
        if (area === 'projects' && request.params.target && request.params.target !== 'current' && request.actor.appScope !== 'installation' && request.params.target !== admission.origin.projectId) throw new Error('The Project target is outside the approved app scope.')
        if (request.operation === 'fork_attach') {
            const existing = admission.snapshot.sessions.find(chat => chat.threads.some(thread => thread.providerThreadId === input.canonicalChatId))
            const source = this.target(admission.allowed, request.actor, request.params.target)
            const ownedProjectlessFork = existing && !existing.projectId && !source.chat.projectId && existing.forkOrigin?.canonicalChatId === source.thread.providerThreadId
            if (existing && !ownedProjectlessFork && !admission.allowed.some(chat => chat.id === existing.id)) throw new Error('The saved fork moved outside the current app scope.')
        }
    }
    async execute(raw: Record<string, unknown>, assertCurrent?: () => Promise<void>): Promise<Record<string, unknown>> {
        const request = raw as unknown as AppRequest
        if (!/^[a-f0-9]{64}$/.test(request.operationId || '') || !['settings', 'settings_action', 'app', 'usage'].includes(request.domain)) throw new Error('Invalid authenticated app operation envelope.')
        request.params = asRecord(request.params)
        if (request.domain === 'app' && !['fork_prepare', 'fork_attach'].includes(request.operation) && !isAppAreaOperation(text(request.params.area, 80), request.operation)) throw new Error('Unsupported operation for this app area. Reads never change ordering or queues.')
        const admission = await this.context(request.actor)
        // Recheck scope even when returning a completed receipt. Project movement
        // must not turn old receipt data into a cross-Project read capability.
        this.checkScopeTargets(request, admission)
        const mutation = !readActions.has(request.operation)
        if (mutation && (request.actor.child || request.actor.permissionMode === 'read-only')) throw new Error('This caller cannot mutate app state.')
        const needsLiveOwner = mutation || request.actor.appScope === 'installation'
        if (needsLiveOwner && !assertCurrent) throw new Error('Live authenticated app-owner validation is required before mutation or expanded reads.')
        const authorize = async () => {
            const current = await this.context(request.actor)
            this.checkScopeTargets(request, current)
            if (needsLiveOwner) await assertCurrent!()
            return current
        }
        const work = async () => {
            const current = await authorize()
            const result = await this.perform(request, current)
            const clean = redactAppData(result) as Record<string, unknown>
            if (JSON.stringify(clean).length > 256_000) throw new Error('Result is too large. Narrow the target or read one message/resource at a time.')
            if (request.domain === 'settings' && mutation && JSON.stringify(result) !== JSON.stringify(clean)) clean.undoEligible = false
            return clean
        }
        try {
            if (!mutation) return await work()
            return await this.receipts.run({ operationId: request.operationId, actor: request.actor.canonicalChatId, domain: request.domain, operation: request.operation, params: request.params }, work, async () => { await authorize() })
        } catch (error) {
            throw new Error(String(redactAppData(error instanceof Error ? error.message : 'The app operation failed.')).slice(0, 2000))
        }
    }
    private async perform(request: AppRequest, context: Awaited<ReturnType<AgentAppService['context']>>): Promise<Record<string, unknown>> {
        const { domain, operation, params, actor } = request
        const { service, allowed, origin } = context
        const area = text(params.area, 80), input = asRecord(params.input)
        if (domain === 'settings') {
            if (operation === 'get' && (!area || area === 'all') && !Array.isArray(params.keys)) throw new Error('Discover with settings list, then get one area or exact setting IDs. Private effective values are not dumped by default.')
            if (operation === 'get' || operation === 'list') {
                const readOwner = ({ delegation: 'delegation.get', runtime: 'runtime.inspect', startup: 'startup.get', extensions: 'browser.extensions' } as Record<string, string>)[area]
                if (readOwner && this.deps.actions?.[readOwner]) return { owner: readOwner, value: await this.deps.actions[readOwner]!.run({}, actor) }
                if (area === 'providers') return { status: await this.deps.setup.auth.getConnectionsStatus(), credentialValuesExposed: false }
                if (area === 'plugins') return service.getPluginCatalog()
                if (area === 'skills') return service.getSkillSourceOverview(origin.workingRoot || origin.projectPath)
                if (area === 'memory' && this.deps.actions?.['memory.status']) return { ...await this.settings.inspect(params), processing: await this.deps.actions['memory.status']!.run({}, actor) }
                if (area === 'accounts') return this.perform({ ...request, domain: 'usage', operation: 'get', params: { area: 'accounts' } }, context)
            }
            if (area === 'remembered') return this.deps.renderer(request)
            if (area === 'voice' && (operation === 'get' || operation === 'list')) return { ...await this.settings.inspect(params), voiceLab: await this.deps.renderer(request).catch(() => ({ available: false, reason: 'Desktop Voice Lab owner is unavailable.' })) }
            if (area === 'voice' && Object.keys(asRecord(params.patch)).some(key => ['voice', 'outputModality', 'instructions'].includes(key))) return this.deps.renderer(request)
            if (area === 'chat') {
                const { chat, thread } = this.target(allowed, actor, params.target)
                if (!['get', 'list', 'preview', 'apply'].includes(operation)) throw new Error('This Chat owner supports get, preview and apply.')
                if (operation === 'apply' && !actor.approved) throw new Error('Chat execution configuration changes require actual user approval.')
                return this.deps.renderer({ ...request, params: { ...params, target: chat.id, input: { ...input,
                    base: { model: thread.model, effort: thread.thinking || 'medium', runtimeMode: thread.runtimeMode }, currentTurn: thread.latestTurn } } })
            }
            if (operation === 'list' || operation === 'get') {
                const result = await this.settings.inspect(params)
                if (operation === 'list') return { ...result, settings: result.settings.map(({ savedValue, effectiveValue, ...descriptor }) => descriptor) }
                return result
            }
            if (operation === 'preview') return this.settings.preview(params, input.reset === true)
            if (operation === 'apply' || operation === 'reset') return this.settings.apply(params, actor.approved, operation === 'reset')
            if (operation === 'history') return { receipts: await this.receipts.history(actor.canonicalChatId), source: 'agent operations in this Chat', detailedReceiptRetention: 500, durableIdentityClaims: 'retained independently; expired results never re-execute' }
            if (operation === 'undo') return this.settings.undo(params, actor.canonicalChatId, actor.approved, this.receipts)
            if (operation === 'open') {
                const result = await this.settings.inspect(params)
                const route = result.settings[0]?.settingsRoute || '/settings'
                return this.deps.open(route, actor)
            }
            throw new Error('Unknown settings operation.')
        }
        if (domain === 'settings_action') {
            const entries = Object.entries(this.deps.actions || {}).map(([id, action]) => ({ id, label: action.label, settingsRoute: action.route, effect: action.effect, parameters: action.parameters || { type: 'object' }, requiresApproval: true }))
            if (operation === 'list') return { operations: entries, credentials: 'Secure entry only; credential values never pass through tools.' }
            const action = this.deps.actions && Object.hasOwn(this.deps.actions, area) ? this.deps.actions[area] : undefined
            if (!action) throw new Error('Unknown named operation. Read settings_action list first.')
            validateAgentAppActionInput(action.parameters, input)
            if (operation === 'preview') return { operation: entries.find(entry => entry.id === area), input, target: params.target || 'current' }
            if (operation !== 'run' || !actor.approved) throw new Error('This named operation needs actual user approval.')
            return { operation: area, result: await action.run(input, actor) }
        }
        if (domain === 'usage') {
            if (area === 'accounts' || !area) {
                try {
                    const pool = await this.deps.setup.auth.getChatGptAccounts(operation === 'refresh')
                    return { checkedAt: pool.checkedAt, routing: pool.policy, accounts: pool.accounts.map(account => ({ id: account.id, alias: account.alias || null,
                        primary: account.primary, enabled: account.enabled, state: account.state, plan: account.plan,
                        windows: { primary: projectUsageWindow(account.usage?.primary, account.usage?.updatedAt), secondary: projectUsageWindow(account.usage?.secondary, account.usage?.updatedAt) },
                        availableResetCount: account.usage?.availableResetCount ?? null, observedAt: account.usage?.updatedAt || null,
                        freshness: !account.usage || !Number.isFinite(Date.parse(account.usage.updatedAt)) ? 'unknown' : Date.now() - Date.parse(account.usage.updatedAt) > 300_000 ? 'stale' : 'recent' })) }
                } catch { return { available: false, reason: 'Account usage could not be observed.', accounts: [], remaining: null } }
            }
            if (area === 'models') return { ...await service.listModels(operation === 'refresh'), source: 'authenticated catalog; capacities may be unknown' }
            if (area === 'runtime') return { status: await service.getStatus() }
            const { chat, thread } = this.target(allowed, actor, params.target)
            const usage = await service.getSessionTurnUsage({ sessionId: chat.id })
            const models = await service.listModels(false)
            const model = models.success ? models.models.find(model => model.id === thread.model) : undefined
            const contextCapacity = thread.latestTurn?.usage?.modelContextWindow || model?.contextWindow || null
            const contextEstimate = usage.usage.totals?.contextTokens
            const hasContextEstimate = typeof contextEstimate === 'number' && Number.isFinite(contextEstimate) && contextEstimate >= 0
            const turns = input.turnId ? usage.usage.turns.filter(turn => turn.id === input.turnId) : usage.usage.turns.slice(-Math.min(100, Math.max(1, Number(input.limit) || 20)))
            return { chatId: chat.id, model: thread.model, contextCapacity, remainingContextTokens: null,
                usedContextTokensEstimate: hasContextEstimate ? contextEstimate : null,
                remainingContextTokensEstimate: hasContextEstimate && contextCapacity ? Math.max(0, contextCapacity - contextEstimate) : null,
                contextObservation: hasContextEstimate ? 'Runtime-reported context estimate, not cumulative token consumption.' : 'No current context-size observation supplied; cumulative consumption is not context size.',
                usage: { ...usage, usage: { ...usage.usage, turns }, returnedTurns: turns.length, totalTurns: usage.usage.turns.length }, compactionThreshold: (await this.deps.setup.preferences.getAssistantRuntimePolicy()).contextCompactionThresholdTokens }
        }
        if (operation === 'list' && !area) return { currentChatId: actor.canonicalChatId, projectId: origin.projectId || null, namespaceId: actor.namespaceId, appScope: actor.appScope || 'project', availableScopeRequests: ['project', 'installation, with per-operation real user consent; no filesystem grant'], areas: [...AREAS.map(area => ({ ...area, actions: APP_AREA_OPERATIONS[area.id] || [] })), { id: 'order', actions: APP_AREA_OPERATIONS.order, owner: 'visible Desktop-profile sidebar' }, { id: 'navigation', actions: APP_AREA_OPERATIONS.navigation, owner: 'explicit in-app navigation' }] }
        if (area === 'chats') {
            if (['move', 'reorder', 'pin', 'unpin', 'undo'].includes(operation)) {
                const target = this.target(allowed, actor, params.target)
                const before = input.before ? this.target(allowed, actor, input.before).chat.id : undefined
                const after = input.after ? this.target(allowed, actor, input.after).chat.id : undefined
                return this.deps.renderer({ ...request, params: { ...params, target: target.chat.id, input: { ...input, before, after, allowedIds: allowed.map(chat => chat.id) } } })
            }
            if (operation === 'fork_prepare') {
                if (!actor.approved || actor.child) throw new Error('Forks require actual user approval.')
                const { chat, thread } = this.target(allowed, actor, params.target)
                if (chat.mode === 'playground' || !thread.providerThreadId) throw new Error('Forks need a persisted non-Playground Chat.')
                const scope = await service.prepareAgentForkWorkspace(chat.id, input.worktree === 'isolated')
                return { sourceCanonicalChatId: thread.providerThreadId, scope, workingRoot: scope?.workingRoot || thread.cwd || chat.projectPath, filesystemRestored: false }
            }
            if (operation === 'fork_attach') {
                if (!actor.approved || actor.child) throw new Error('Forks require actual user approval.')
                const { chat } = this.target(allowed, actor, params.target)
                return service.completeAgentForkScope(text(input.canonicalChatId), chat.id, input.scope as AssistantChatScope | null, input)
            }
            if (operation === 'list') return { chats: allowed.slice(0, 100).map(chat => ({ id: chat.id, canonicalChatId: chat.threads.find(thread => thread.id === chat.activeThreadId)?.providerThreadId || null, title: chat.title, titleManuallySet: chat.titleManuallySet === true, archived: chat.archived, settled: chat.settled, projectId: chat.projectId || null, updatedAt: chat.updatedAt })), navigation: await this.deps.renderer({ ...request, operation: 'inspect', params: { area: 'order', input: { allowedIds: allowed.map(chat => chat.id) } } }).catch(() => ({ available: false, reason: 'Visible sidebar owner is not connected.' })) }
            if (operation === 'search') {
                const result = await service.searchChats({ query: text(params.query, 2000), scope: input.archived === true ? 'all' : 'active', limit: 100 })
                const ids = new Set(allowed.map(chat => chat.id))
                return { result: { ...result.result, matches: result.result.matches.filter(match => ids.has(match.sessionId)).slice(0, 50) } }
            }
            if (operation === 'create') {
                if (input.projectId && input.projectId !== origin.projectId) throw new Error('Creating a Chat in another Project requires a separately scoped request.')
                const remembered = await this.deps.renderer({ ...request, domain: 'settings', operation: 'get', params: { area: 'remembered' } })
                const composer = remembered.choices as AssistantCreateSessionInput['composer']
                const result = await service.createSession({ mode: 'work', projectId: origin.projectId || undefined, workingRoot: origin.workingRoot || origin.projectPath || undefined, select: false, ...(composer ? { composer: { ...composer } } : {}), ...(typeof input.title === 'string' ? { title: text(input.title, 240) } : {}) })
                return { ...result, snapshot: undefined, navigationChanged: false, started: false }
            }
            if ((operation === 'rename' || operation === 'preview') && Array.isArray(input.changes)) {
                if (!input.changes.length || input.changes.length > 20) throw new Error('Choose 1–20 exact Chat title changes.')
                const changes = input.changes.map(value => {
                    const item = asRecord(value), target = this.target(allowed, actor, item.chatId)
                    const title = text(item.title, 240)
                    if (!title || typeof item.expectedTitle !== 'string') throw new Error('Each title change needs its exact Chat ID, expectedTitle and new title.')
                    return { chatId: target.chat.id, before: target.chat.title, expectedTitle: item.expectedTitle, title }
                })
                if (new Set(changes.map(change => change.chatId)).size !== changes.length) throw new Error('A batch cannot rename one Chat twice.')
                if (operation === 'preview') return { atomic: false, changes, applied: false, ownership: 'user-directed manual titles' }
                const results = []
                for (const change of changes) {
                    try { await service.renameSession(change.chatId, change.title, change.expectedTitle); results.push({ ...change, applied: true }) }
                    catch { results.push({ ...change, applied: false, error: 'This target changed or its owning service rejected the rename. Read it again.' }) }
                }
                return { results, atomic: false, partial: results.some(result => !result.applied), selectionUnchanged: true }
            }
            const { chat, thread } = this.target(allowed, actor, params.target)
            if (operation === 'inspect') return { chat, currentTurn: thread.latestTurn }
            if (operation === 'read') {
                const messageId = text(input.messageId)
                if (!messageId) throw new Error('Choose the exact message ID from scoped search first.')
                return { history: await service.getHistoryAroundMessage(thread.id, messageId, 1) }
            }
            if (operation === 'rename') {
                const title = text(input.title, 240)
                if (!title || /[\u0000-\u001f]/.test(title)) throw new Error('Provide a nonempty plain-text title.')
                if (input.expectedTitle !== chat.title) throw new Error('The title changed. Read the Chat again before renaming it.')
                await service.renameSession(chat.id, title, input.expectedTitle as string)
                return { chatId: chat.id, before: chat.title, title, titleSource: 'manual', changed: true, turnUnchanged: true }
            }
            if (operation === 'refresh_title') return { chatId: chat.id, ...await service.regenerateSessionTitle(chat.id, thread.providerThreadId || undefined) }
            if (operation === 'archive' || operation === 'unarchive') return { chatId: chat.id, ...await service.archiveSession(chat.id, operation === 'archive') }
            if (operation === 'settle' || operation === 'restore') return { chatId: chat.id, ...await service.setSessionSettled(chat.id, operation === 'settle') }
            if (operation === 'open') return this.deps.open(`/assistant/chat/${encodeURIComponent(chat.id)}/thread/${encodeURIComponent(thread.id)}`, actor)
            if (operation === 'preview') return { chatId: chat.id, title: chat.title, updatedAt: chat.updatedAt, input, applied: false }
        }
        if (area === 'order' || area === 'queues' || area === 'navigation') {
            const { chat } = this.target(allowed, actor, params.target)
            const before = area === 'order' && input.before ? this.target(allowed, actor, input.before).chat.id : input.before
            const after = area === 'order' && input.after ? this.target(allowed, actor, input.after).chat.id : input.after
            return this.deps.renderer({ ...request, params: { ...params, target: chat.id, input: { ...input, before, after, allowedIds: allowed.map(chat => chat.id) } } })
        }
        if (area === 'models') return service.listModels(false)
        if (area === 'projects') {
            const catalog = await service.listProjects()
            if (operation === 'list' || operation === 'inspect') return { ...catalog, catalog: { ...catalog.catalog, projects: catalog.catalog.projects.filter(project => actor.appScope === 'installation' || project.id === origin.projectId), candidates: [] } }
            if (operation === 'preview') return { projectId: origin.projectId || null, input, applied: false, requiresApproval: true }
            if (!actor.approved) throw new Error('Project mutations require actual user approval.')
            if (operation === 'create') return { ...await service.createProject({ name: text(input.name, 160) }) }
            if (operation === 'update') {
                const projectId = typeof params.target === 'string' ? params.target : origin.projectId
                if (!projectId || !catalog.catalog.projects.some(project => project.id === projectId) || actor.appScope !== 'installation' && projectId !== origin.projectId) throw new Error('The Project target is outside the approved app scope.')
                return service.updateProject({ projectId, name: typeof input.name === 'string' ? input.name : undefined, archived: typeof input.archived === 'boolean' ? input.archived : undefined })
            }
        }
        if (area === 'skills') return service.getSkillSourceOverview(origin.workingRoot || origin.projectPath)
        if (area === 'plugins') return service.getPluginCatalog()
        if (area === 'connections') return { status: await this.deps.setup.auth.getConnectionsStatus(), credentialValuesExposed: false }
        if (area === 'work' || area === 'attention' || area === 'agents' || area === 'workflows' || area === 'resources') {
            const { chat, thread } = this.target(allowed, actor, params.target)
            if (area === 'resources') {
                if (operation === 'list') return { ...await service.listVisualizations({ threadId: thread.id, scope: 'thread' }) }
                if (operation === 'read') return { ...await service.getVisualization({ threadId: thread.id, id: text(input.id), version: typeof input.version === 'number' ? input.version : undefined }) }
            }
            if (area === 'agents' || area === 'workflows') return service.getFleetSnapshot(thread.id)
            if (operation === 'stop') {
                if (!actor.approved || input.turnId !== thread.latestTurn?.id || thread.latestTurn?.state !== 'running') throw new Error('Stop requires approval and the exact current running turn.')
                return this.deps.renderer({ ...request, params: { area: 'queues', target: chat.id, input: { action: 'stop', turnId: input.turnId, allowedIds: allowed.map(chat => chat.id) } } })
            }
            if (area === 'attention') return { chats: allowed.filter(chat => chat.threads.some(thread => thread.hasPendingApprovals || thread.hasPendingUserInputs)).map(chat => ({ id: chat.id, title: chat.title, threads: chat.threads.map(thread => ({ id: thread.id, approval: thread.hasPendingApprovals, input: thread.hasPendingUserInputs, state: thread.state })) })), asynchronousQuestionsAreNotPermission: true }
            if (operation === 'read' && input.turnId) return service.getTurnDetail(thread.id, text(input.turnId))
            return { chatId: chat.id, threadId: thread.id, latestTurn: thread.latestTurn, canonicalPresence: thread.canonicalPresence || null, observedAt: thread.updatedAt }
        }
        if (area === 'runtime' || !area && operation === 'inspect') return { currentChatId: actor.canonicalChatId, namespaceId: actor.namespaceId, status: await service.getStatus(), areas: AREAS, filesystemScope: origin.chatScope || null, activeSelectionIsNotAuthority: true }
        throw new Error('This action is not supported by the selected owner. Read app list and use the existing scoped tool or secure UI indicated there.')
    }
}
