import assert from 'node:assert/strict'
import { mock } from 'bun:test'
mock.module('electron-log', () => ({ default: { warn: () => {} } }))
const { queueGeneratedSessionTitle, recoverSessionTitleFromHistory } = await import('../src/main/assistant/session-title-generation')
import type { AssistantSession } from '../src/shared/assistant/contracts'

function fixture(id: string) {
    const session = { id, title: 'Fix the renderer', threads: [] } as unknown as AssistantSession
    const canonical: string[] = []
    const args = {
        sessionId: id, threadId: `${id}-root`, messageText: 'Fix the renderer', seedTitle: session.title,
        cwd: 'C:/synthetic-project', getSnapshot: () => ({ sessions: [session] }),
        appendEvent: (_type: unknown, _date: string, payload: Record<string, unknown>) => Object.assign(session, payload.patch),
        onApplied: async (title: string) => { canonical.push(title) }
    }
    return { session, canonical, args }
}

const fallback = fixture('title-thrown-model')
let requests = 0
await queueGeneratedSessionTitle({ ...fallback.args, generateText: async () => {
    if (++requests === 1) throw new Error('Synthetic transient provider error')
    return { success: true, text: 'Renderer startup repair' }
} })
assert.equal(fallback.session.title, 'Renderer startup repair', 'a thrown utility error cannot skip all fallback candidates')
assert.deepEqual(fallback.canonical, ['Renderer startup repair'])

const retry = fixture('title-transient-retry')
let retryRequests = 0
await queueGeneratedSessionTitle({ ...retry.args, generateText: async () => {
    if (++retryRequests <= 2) return { success: false, error: 'Synthetic unavailable utility' }
    return { success: true, text: 'Reliable renderer startup' }
} })
assert.equal(retry.session.title, 'Reliable renderer startup', 'a temporary outage gets a bounded background retry')

const persistence = fixture('title-canonical-retry')
let saves = 0
await queueGeneratedSessionTitle({ ...persistence.args,
    generateText: async () => ({ success: true, text: 'Canonical renderer title' }),
    onApplied: async (title) => {
        if (++saves === 1) throw new Error('Synthetic canonical transport failure')
        persistence.canonical.push(title)
    }
})
assert.equal(saves, 2, 'canonical metadata is reconciled after a transient write failure')
assert.deepEqual(persistence.canonical, ['Canonical renderer title'])
assert.equal(persistence.session.title, persistence.canonical[0])

const manual = fixture('title-manual-during-retry')
let manualRequests = 0
await queueGeneratedSessionTitle({ ...manual.args, generateText: async () => {
    manualRequests++
    manual.session.title = 'My chosen title'
    return { success: false, error: 'Synthetic interrupted request' }
} })
assert.equal(manual.session.title, 'My chosen title')
assert.equal(manualRequests, 1, 'a manual rename cancels obsolete background requests')
assert.deepEqual(manual.canonical, [])

const exhausted = fixture('title-exhausted-save')
let failedSaves = 0
await queueGeneratedSessionTitle({ ...exhausted.args, generateText: async () => ({ success: true, text: 'A durable title' }),
    onApplied: async () => { failedSaves++; throw new Error('Synthetic offline metadata') } })
assert.equal(failedSaves, 3, 'canonical retries are bounded')
assert.equal(exhausted.session.title, exhausted.args.seedTitle, 'a failed canonical save leaves the seed eligible for later recovery')
exhausted.session.threads = [{ id: exhausted.args.threadId, source: 'root', parentThreadId: null }] as AssistantSession['threads']
await recoverSessionTitleFromHistory({ ...exhausted.args, firstUserMessage: exhausted.args.messageText,
    generateText: async () => ({ success: true, text: 'A durable title' }) })
assert.equal(exhausted.session.title, 'A durable title', 'unloaded history can recover using the persisted first user message')
assert.deepEqual(exhausted.canonical, ['A durable title'])
let unnecessaryGeneration = 0
await recoverSessionTitleFromHistory({ ...manual.args, firstUserMessage: manual.args.messageText,
    generateText: async () => { unnecessaryGeneration++; return { success: true, text: 'Do not replace a chosen title' } } })
assert.equal(unnecessaryGeneration, 0)

const conversation = fixture('title-completed-history')
conversation.session.threads = [{ id: conversation.args.threadId, source: 'root', parentThreadId: null }] as AssistantSession['threads']
await recoverSessionTitleFromHistory({ ...conversation.args, firstUserMessage: conversation.args.messageText,
    turns: [{ id: 'synthetic-completed-turn', state: 'completed', requestedAt: '2026-10-06T10:00:00.000Z',
        prompt: { text: 'Fix the renderer startup' }, response: { text: 'Startup readiness and title persistence repaired.' } }] as any,
    generateText: async prompt => {
        assert.match(prompt, /Startup readiness and title persistence repaired/)
        return { success: true, text: 'Startup readiness and titles' }
    } })
assert.equal(conversation.session.title, 'Startup readiness and titles', 'post-turn recovery uses completed conversation context without waiting for the periodic interval')

console.log('Title reliability: thrown request fallback, bounded recovery, canonical reconciliation, persisted-history recovery and manual rename: ok')
