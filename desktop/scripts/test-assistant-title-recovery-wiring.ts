import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import { recoverAssistantSidebarTitles } from '../src/main/assistant/sidebar-title-recovery'
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
    const { AssistantService } = await import('../src/main/assistant/service')
    const session = { id: 'title-wiring', title: 'Fix the renderer', activeThreadId: 'title-thread', threads: [{ id: 'title-thread', source: 'root', parentThreadId: null, providerThreadId: 'canonical-title', messages: [] }] }
    let writes = 0, periodicReads = 0
    const service = Object.assign(Object.create(AssistantService.prototype), {
        state: { snapshot: { sessions: [session], selectedSessionId: session.id } },
        canonicalReviewHistoryState: new Map([['canonical-title', {}]]),
        options: { getTitleAutomation: async () => { periodicReads++; return { enabled: false } }, getTitleGenerationModel: async () => 'synthetic-provider/title-model' },
        persistence: { readFirstUserMessageText: async () => 'Fix the renderer', readReviewIndex: async () => ({ turns: [] }) },
        runtime: { generateText: async (_prompt: string, options: { model: string }) => { assert.equal(options.model, 'synthetic-provider/title-model'); return { success: true, text: 'Renderer startup repair' } }, updateCanonicalChat: async () => { if (++writes === 1) throw Error('Synthetic transient metadata failure') } },
        getSessionRuntimeCwd: () => directory,
        appendEvent: (_type: unknown, _time: string, payload: any) => Object.assign(session, payload.patch)
    })
    await service.maybeAutoRegenerateSessionTitle(session.id, 'title-thread')
    assert.equal(session.title, 'Renderer startup repair', 'seed recovery is wired before disabled periodic automation')
    assert.equal(periodicReads, 0)
    assert.equal(writes, 2, 'the real service canonical callback propagates failure into bounded recovery')
    const originalPrompt = 'Repair original startup'
    const latestPrompt = 'Change the latest sidebar'
    const at = '2026-10-06T10:00:00.000Z'
    const prefix = { chat: { cwd: directory }, pageInfo: { startCursor: '0', totalEntries: 10_000 }, entries: [
        { type: 'message', id: 'first-entry', timestamp: at, message: { id: 'first-user', role: 'user', content: [{ type: 'text', text: originalPrompt }] } }
    ] }
    async function recoverUnindexed(title: string, history: unknown, withRecentContext = false) {
        const chat = { ...session, title, createdAt: at, threads: [{ ...session.threads[0]!, createdAt: at }] }
        let prefixReads = 0, reviewReads = 0, generated = 0, canonicalWrites = 0
        const recentTurns = withRecentContext ? [{ id: 'recent-turn', state: 'completed', requestedAt: at,
            prompt: { text: originalPrompt }, response: { text: 'Persisted repair context' } }] : []
        const unindexed = Object.assign(Object.create(AssistantService.prototype), {
            state: { snapshot: { sessions: [chat], selectedSessionId: chat.id } },
            canonicalReviewHistoryState: new Map(),
            ensureCanonicalReviewHistoryIndexed: async () => { throw Error('Title eligibility must not index complete history') },
            options: { getTitleGenerationModel: async () => 'synthetic-provider/title-model' },
            persistence: { readFirstUserMessageText: async () => latestPrompt, readReviewIndex: async () => { reviewReads++; return { turns: recentTurns } } },
            runtime: {
                readCanonicalChatHistory: async (id: string, cwd: string, options: unknown) => {
                    prefixReads++; assert.equal(id, 'canonical-title'); assert.equal(cwd, directory)
                    assert.deepEqual(options, { before: '128', limit: 128, toolResultBodies: 'lazy-v1' })
                    return history
                },
                generateText: async (prompt: string) => {
                    generated++; assert.ok(prompt.includes(originalPrompt), 'recovery uses the original prompt, not the persisted latest fragment')
                    assert.equal(prompt.includes('Persisted repair context'), withRecentContext, 'existing persisted Review context reaches recovery without backfill')
                    assert.ok(!prompt.includes(latestPrompt)); return { success: true, text: 'Original startup repair' }
                },
                updateCanonicalChat: async () => { canonicalWrites++ }
            },
            getSessionRuntimeCwd: () => directory,
            appendEvent: (_type: unknown, _time: string, payload: any) => Object.assign(chat, payload.patch)
        })
        const attempted = await unindexed.recoverSessionTitle(chat.id)
        assert.equal(prefixReads, 1, 'eligibility reads one bounded original prefix, even for long chats')
        return { attempted, title: chat.title, generated, canonicalWrites, reviewReads }
    }
    assert.deepEqual(await recoverUnindexed(originalPrompt, prefix), { attempted: true, title: 'Original startup repair', generated: 1, canonicalWrites: 1, reviewReads: 1 })
    assert.deepEqual(await recoverUnindexed(originalPrompt, prefix, true), { attempted: true, title: 'Original startup repair', generated: 1, canonicalWrites: 1, reviewReads: 1 })
    for (const manual of ['My custom chat name', latestPrompt]) {
        assert.deepEqual(await recoverUnindexed(manual, prefix), { attempted: false, title: manual, generated: 0, canonicalWrites: 0, reviewReads: 0 }, 'manual titles remain untouched, including a title matching the latest fragment')
    }
    const nonUserPrefix = Array.from({ length: 128 }, (_, index) => ({ type: 'message', id: `preamble-${index}`, timestamp: at,
        message: { role: 'system', content: [{ type: 'text', text: 'Preamble' }] } }))
    for (const unavailable of [null, { ...prefix, pageInfo: { startCursor: '64' } }, { ...prefix, pageInfo: {} }, { ...prefix, entries: [] }, { ...prefix, entries: nonUserPrefix }]) {
        assert.deepEqual(await recoverUnindexed(originalPrompt, unavailable), { attempted: false, title: originalPrompt, generated: 0, canonicalWrites: 0, reviewReads: 0 }, 'unknown origin or no original user within the first 128 entries skips repair safely')
    }
    const candidates = Array.from({ length: 20 }, (_, index) => ({ id: String(index), updatedAt: `2026-10-${String(index + 1).padStart(2, '0')}`, archived: index === 19, threads: [{}] }))
    const recovered: string[] = []; let active = 0, maxActive = 0, errors = 0
    await recoverAssistantSidebarTitles({ sessions: candidates as any, selectedSessionId: '0', recover: async id => {
        maxActive = Math.max(maxActive, ++active); recovered.push(id); await Promise.resolve(); active--; if (id === '18') throw Error('Synthetic isolated failure')
    }, onError: () => { errors++ } })
    assert.equal(recovered.length, 12, 'startup queue has a fixed bound')
    assert.equal(recovered[0], '0', 'the selected chat repairs first')
    assert.equal(recovered[1], '18', 'recent visible chats follow selection')
    assert.equal(maxActive, 1, 'utility work never fans out across the sidebar')
    assert.equal(errors, 1, 'one chat failure does not strand later repairs')
    console.log('Title recovery wiring: real completion, canonical retries, bounded original prefix, manual preservation, safe skips and serial sidebar repairs: ok')
} finally { await rm(directory, { recursive: true, force: true }) }
