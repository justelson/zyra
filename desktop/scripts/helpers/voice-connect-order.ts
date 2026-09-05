import assert from 'node:assert/strict'

// Exercise the actual service method without constructing the credential-backed service.
export async function assertVoiceConnectOrder(source: string): Promise<void> {
    const start = source.indexOf('    async connect(options?: AssistantConnectOptions)')
    const end = source.indexOf('\n    async disconnect(', start)
    assert.ok(start >= 0 && end > start, 'the canonical service connect method must exist')
    const code = new Bun.Transpiler({ loader: 'ts' }).transformSync(`class VoiceConnectProbe {${source.slice(start, end)}}`)

    async function scenario({ voice = true, invalidate = false, development = false } = {}) {
        const calls: string[] = []
        const thread = { id: 'fixture-thread' }
        const session = { id: development ? 'development-fixture' : 'fixture-session', chatScope: { fixture: true } }
        const configuration = { fixture: 'voice-configuration' }
        const result = { success: true, threadId: thread.id }
        let finishConnect!: () => void
        let announceConnect!: () => void
        const connected = new Promise<void>((resolve) => { finishConnect = resolve })
        const started = new Promise<void>((resolve) => { announceConnect = resolve })
        const Constructor = new Function('deps', `
            const { connectAssistantSession, requireSession, getSelectedSession, getActiveThread,
                isAssistantDevelopmentChatFixtureSessionId, requireCanonicalVoiceExecutionConfiguration } = deps;
            ${code}
            return VoiceConnectProbe;
        `)({
            connectAssistantSession: async (_deps: unknown, options: { voicePreparation?: unknown }) => {
                assert.equal(options.voicePreparation, voice ? configuration : undefined)
                calls.push('connect:start')
                announceConnect()
                await connected
                calls.push('connect:done')
                return result
            },
            requireSession: (_snapshot: unknown, id: string) => { assert.equal(id, session.id); return session },
            getSelectedSession: () => session,
            getActiveThread: () => thread,
            isAssistantDevelopmentChatFixtureSessionId: (id: string) => id === 'development-fixture',
            requireCanonicalVoiceExecutionConfiguration: (value: unknown) => { assert.equal(value, configuration); return value }
        })
        const service = Object.assign(new Constructor(), {
            state: { snapshot: {} }, actionDeps: {}, voicePrimaryPreparationGeneration: 0,
            activeCanonicalVoice: null, pendingCanonicalVoiceStart: null, realtimeVoiceOwnerId: null,
            ensureReady: async () => { calls.push('ready') },
            getSessionRuntimeCwd: () => 'C:/fixture',
            prepareVoicePrimaryWorker: (threadId: string, cwd: string, scope: unknown, config: unknown) => {
                assert.equal(threadId, thread.id)
                assert.equal(cwd, 'C:/fixture')
                assert.equal(scope, session.chatScope)
                assert.equal(config, configuration)
                calls.push('prepare')
            }
        })
        const pending = service.connect({ sessionId: session.id, ...(voice ? { voicePreparation: configuration } : {}) })
        if (development) {
            if (voice) await assert.rejects(pending, /read-only local fixtures/)
            else assert.deepEqual(await pending, result)
            assert.deepEqual(calls, ['ready'], 'development fixtures never start either worker')
            return
        }
        await started
        assert.deepEqual(calls, ['ready', 'connect:start'], 'voice preparation waits for canonical startup')
        if (invalidate) service.voicePrimaryPreparationGeneration += 1
        finishConnect()
        assert.equal(await pending, result)
        assert.deepEqual(calls, ['ready', 'connect:start', 'connect:done', ...(voice && !invalidate ? ['prepare'] : [])])
    }

    await scenario()
    await scenario({ invalidate: true })
    await scenario({ voice: false })
    await scenario({ development: true })
    await scenario({ development: true, voice: false })
}

export async function assertVoiceHistoryPreloadOrder(source: string): Promise<void> {
    const start = source.indexOf('        const historyPreload = record.thread.providerThreadId')
    const end = source.indexOf('        const conversationId = connected.thread.providerThreadId', start)
    assert.ok(start >= 0 && end > start, 'the canonical Voice connection/history sequence must exist')
    const code = new Bun.Transpiler({ loader: 'ts' }).transformSync(`async function run() {${source.slice(start, end)} return connected; }`)
    const calls: string[] = []
    const record = { session: { id: 'fixture-session' }, thread: { id: 'fixture-thread', providerThreadId: 'provider-old' } }
    const connected = { session: record.session, thread: { id: record.thread.id, providerThreadId: 'provider-current', state: 'ready' } }
    let finishHistory!: () => void
    let finishConnect!: () => void
    let announceConnect!: () => void
    let announceConfiguration!: () => void
    const history = new Promise<void>((resolve) => { finishHistory = resolve })
    const connection = new Promise<void>((resolve) => { finishConnect = resolve })
    const started = new Promise<void>((resolve) => { announceConnect = resolve })
    const configured = new Promise<void>((resolve) => { announceConfiguration = resolve })
    let historyCalls = 0
    const context = {
        state: { snapshot: {} },
        ensureCanonicalHistoryLoaded: async (session: unknown, thread: unknown) => {
            assert.equal(session, record.session)
            historyCalls += 1
            if (historyCalls === 1) {
                assert.equal(thread, record.thread)
                calls.push('history:start')
                await history
            } else {
                assert.equal(thread, connected.thread)
                calls.push('history:current')
            }
        },
        connectSessionRuntime: async (session: unknown, thread: unknown) => {
            assert.equal(session, record.session)
            assert.equal(thread, record.thread)
            calls.push('connect:start')
            announceConnect()
            await connection
            calls.push('connect:done')
        },
        runtime: {
            hasSession: () => false,
            configureSession: async (id: string) => {
                assert.equal(id, connected.thread.providerThreadId)
                calls.push('configure')
                announceConfiguration()
            }
        }
    }
    const pending = new Function('deps', `
        const { record, executionConfiguration, signal, throwIfVoiceStartAborted, findThreadRecord } = deps;
        ${code}
        return run.call(deps.context);
    `)({ context, record, executionConfiguration: {}, signal: new AbortController().signal,
        throwIfVoiceStartAborted: (signal: AbortSignal) => { assert.equal(signal.aborted, false) },
        findThreadRecord: () => connected })
    await started
    assert.deepEqual(calls, ['history:start', 'connect:start'], 'history loading and the authority-aware connection overlap')
    finishConnect()
    await configured
    assert.equal(historyCalls, 1, 'the current history read waits for the preload to settle')
    finishHistory()
    assert.equal(await pending, connected)
    assert.deepEqual(calls, ['history:start', 'connect:start', 'connect:done', 'configure', 'history:current'])
}
