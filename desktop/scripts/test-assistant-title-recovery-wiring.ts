import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const noop = () => undefined
const directory = await mkdtemp(join(tmpdir(), 'zyra-title-wiring-'))
mock.module('electron-log', () => ({ default: { info: noop, warn: noop, error: noop, debug: noop } }))
mock.module('electron', () => ({ shell: { openExternal: async () => undefined }, ipcMain: { on: noop, handle: noop }, app: { getPath: () => directory, isReady: () => true, on: noop, once: noop },
    BrowserWindow: class { static getAllWindows() { return [] } }, screen: { getAllDisplays: () => [] },
    nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) }, webContents: { fromId: () => null }, safeStorage: { isEncryptionAvailable: () => false } }))
mock.module('../src/main/agent-control', () => ({ getAgentControlBroker: () => ({ revokePrincipal: noop }) }))
try {
    const { AssistantService, projectCanonicalTimeline } = await import('../src/main/assistant/service')
    const titleHistory = projectCanonicalTimeline([
        { type: 'message', id: 'u', message: { role: 'user', content: 'Fix startup' } },
        { type: 'message', id: 'a', message: { role: 'assistant', content: [{ type: 'toolCall', id: 'hidden-title', name: 'set_chat_title', arguments: { title: 'Metadata only' } }] } },
        { type: 'message', id: 'r', message: { role: 'toolResult', toolCallId: 'hidden-title', toolName: 'set_chat_title', content: [{ type: 'text', text: 'Metadata only' }] } },
        { type: 'message', id: 'f', message: { role: 'assistant', content: 'Visible answer' } }
    ], 'canonical-title', 'title-thread', '2026-10-21T10:00:00Z', 0, directory)
    assert.deepEqual(titleHistory.messages.map(message => message.text), ['Fix startup', 'Visible answer'], 'neither title text nor tool result becomes a bubble or spoken response')
    assert.equal(titleHistory.activities.length, 0, 'the hidden title action cannot add to Work or action counts after reopening')
    assert.ok(titleHistory.legacyActivityIds.includes('zyra-tool-hidden-title'), 'old cached title actions are removed during reconciliation')
    const session = { id: 'title-wiring', title: 'Repair startup', activeThreadId: 'title-thread', threads: [{ id: 'title-thread', source: 'root', parentThreadId: null, providerThreadId: 'canonical-title', messages: [] }] }
    let enabled = false, source = 'model', generated = 0
    const writes: unknown[] = []
    const turns = Array.from({ length: 3 }, (_, index) => ({ id: `turn-${index}`, state: 'completed', requestedAt: `2026-10-21T10:0${index}:00Z`,
        prompt: { text: index === 0 ? 'hi' : 'Fix current sidebar topic' }, response: { text: 'Current sidebar repair details' } }))
    const service = Object.assign(Object.create(AssistantService.prototype), {
        state: { snapshot: { sessions: [session], selectedSessionId: session.id } },
        autoTitleMilestones: new Set(),
        options: { getTitleAutomation: async () => ({ enabled, turnInterval: 3 }), getTitleGenerationModel: async () => 'synthetic-provider/title-model' },
        persistence: { readFirstUserMessageText: async () => 'hi', readReviewIndex: async () => ({ turns }) },
        ensureCanonicalHistoryLoaded: async () => undefined,
        runtime: {
            getCanonicalChat: async () => ({ titleSource: source }),
            generateText: async (prompt: string, options: { model: string }) => {
                generated++; assert.equal(options.model, 'synthetic-provider/title-model')
                assert.match(prompt, /Current sidebar repair details/, 'refresh uses completed context, not just the greeting')
                return { success: true, text: 'Current sidebar repair' }
            },
            updateCanonicalChat: async (_id: string, patch: unknown) => { writes.push(patch) }
        },
        getSessionRuntimeCwd: () => directory,
        appendEvent: (_type: unknown, _time: string, payload: any) => Object.assign(session, payload.patch)
    })
    await service.maybeAutoRegenerateSessionTitle(session.id, 'title-thread')
    assert.equal(generated, 0, 'completion with automation disabled cannot start initial utility generation')
    enabled = true
    source = 'manual'
    await service.maybeAutoRegenerateSessionTitle(session.id, 'title-thread')
    assert.equal(generated, 0, 'periodic refresh respects a durable manual rename')
    source = ''
    await service.maybeAutoRegenerateSessionTitle(session.id, 'title-thread')
    assert.equal(generated, 0, 'legacy names without ownership are not guessed automatic')
    source = 'model'
    await service.maybeAutoRegenerateSessionTitle(session.id, 'title-thread')
    assert.equal(generated, 1, 'periodic refresh still uses its independently selected utility model')
    assert.deepEqual(writes, [{ title: 'Current sidebar repair', titleSource: 'refresh' }])
    assert.equal(session.title, 'Current sidebar repair')
    await service.maybeAutoRegenerateSessionTitle(session.id, 'title-thread')
    assert.equal(generated, 1, 'replayed completion cannot duplicate the refresh')
    source = 'manual'
    session.title = 'My chosen name'
    await service.regenerateSessionTitle(session.id)
    assert.equal(generated, 2, 'an explicit refresh still works for a manually named chat')
    assert.deepEqual(writes[1], { title: 'Current sidebar repair' })
    console.log('Title refresh wiring: no competing initial utility, periodic model, completed context, durable manual protection and explicit refresh: ok')
} finally { await rm(directory, { recursive: true, force: true }) }
