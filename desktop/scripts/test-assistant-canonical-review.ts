import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mock } from 'bun:test'

const userDataPath = mkdtempSync(join(tmpdir(), 'zyra-canonical-review-'))
const electronNoop = (): undefined => undefined
mock.module('electron', () => ({
    app: {
        getPath: () => userDataPath,
        isReady: () => true,
        on: electronNoop,
        once: electronNoop
    },
    BrowserWindow: class {
        static getAllWindows(): never[] { return [] }
        static fromWebContents(): null { return null }
    },
    screen: {
        getAllDisplays: () => [],
        getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 } })
    },
    nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) },
    webContents: { fromId: () => null },
    safeStorage: { isEncryptionAvailable: () => false },
    shell: { openExternal: electronNoop, openPath: async () => '' },
    globalShortcut: { register: () => true, unregisterAll: electronNoop }
}))

const canonicalChatId = 'canonical-review-chat'
const canonicalCreatedAt = '2026-08-04T08:00:00.000Z'
const canonicalModifiedAt = ['2026-08-04T08:01:00.000Z', '2026-08-04T08:02:00.000Z']
const patch = [
    '--- C:/fixture/src/review-index.ts',
    '+++ C:/fixture/src/review-index.ts',
    '@@ -1 +1 @@',
    '-old review',
    '+new review'
].join('\n')
const firstTurn = [
    {
        type: 'message',
        timestamp: '2026-08-04T08:00:00.000Z',
        message: { role: 'user', timestamp: 1_785_830_400_000, content: [{ type: 'text', text: 'Review this file' }] }
    },
    {
        type: 'message',
        timestamp: '2026-08-04T08:00:01.000Z',
        message: {
            role: 'assistant',
            timestamp: 1_785_830_401_000,
            content: [{
                type: 'toolCall',
                id: 'review-edit-call',
                name: 'edit',
                arguments: {
                    path: 'C:/fixture/src/review-index.ts',
                    edits: [{ oldText: 'old review', newText: 'new review' }]
                }
            }]
        }
    },
    {
        type: 'message',
        id: 'entry:review-edit-result',
        timestamp: '2026-08-04T08:00:02.000Z',
        historyBodyRef: {
            version: 1,
            canonicalChatId,
            entryIndex: 2,
            entryId: 'entry:review-edit-result',
            entrySha256: 'c'.repeat(64),
            toolCallId: 'review-edit-call',
            toolName: 'edit',
            bodyBytes: 900_000,
            contentTypes: ['text'],
            imageCount: 0
        },
        message: {
            id: 'message:review-edit-result',
            role: 'toolResult',
            timestamp: 1_785_830_402_000,
            toolCallId: 'review-edit-call',
            toolName: 'edit',
            isError: false
        }
    },
    {
        type: 'message',
        timestamp: '2026-08-04T08:00:03.000Z',
        message: { role: 'assistant', timestamp: 1_785_830_403_000, content: [{ type: 'text', text: 'Review complete' }] }
    }
]
const secondTurn = [
    {
        type: 'message',
        timestamp: '2026-08-04T08:01:00.000Z',
        message: { role: 'user', timestamp: 1_785_830_460_000, content: [{ type: 'text', text: 'Review the follow-up' }] }
    },
    {
        type: 'message',
        timestamp: '2026-08-04T08:01:01.000Z',
        message: { role: 'assistant', timestamp: 1_785_830_461_000, content: [{ type: 'text', text: 'Follow-up complete' }] }
    }
]

let timelineVersion = 0
const historyRequests: Array<{ before: string | null; version: number; limit: number | undefined }> = []
const { ZyraRuntime } = await import('../src/main/assistant/zyra-runtime')
ZyraRuntime.prototype.listCanonicalChats = async () => [{
    version: 1,
    canonicalChatId,
    sessionPath: 'C:/fixture/.zyra/sessions/canonical-review.jsonl',
    project: 'C:/fixture',
    cwd: 'C:/fixture',
    title: 'Canonical Review fixture',
    createdAt: canonicalCreatedAt,
    modifiedAt: canonicalModifiedAt[timelineVersion]!,
    messageCount: timelineVersion === 0 ? 4 : 6,
    displayMessageCount: timelineVersion === 0 ? 2 : 4,
    toolCallCount: 1,
    errorCount: 0,
    imageCount: 0,
    entryCount: timelineVersion === 0 ? 4 : 6,
    archived: false
}]
ZyraRuntime.prototype.readCanonicalChatHistory = async (_session, _project, options = {}) => {
    const before = options.before || null
    historyRequests.push({ before, version: timelineVersion, limit: options.limit })
    if (timelineVersion === 1) {
        const entries = [...firstTurn, ...secondTurn]
        return {
            chat: {
                version: 1,
                canonicalChatId,
                sessionPath: 'C:/fixture/.zyra/sessions/canonical-review.jsonl',
                project: 'C:/fixture',
                cwd: 'C:/fixture',
                title: 'Canonical Review fixture',
                createdAt: canonicalCreatedAt,
                modifiedAt: canonicalModifiedAt[1]!,
                messageCount: 6,
                displayMessageCount: 4,
                toolCallCount: 1,
                errorCount: 0,
                imageCount: 0,
                entryCount: 6,
                archived: false
            },
            entries,
            pageInfo: { startCursor: '0', endCursor: '6', oldestCursor: null, hasOlder: false, totalEntries: 6 }
        }
    }
    const older = before === '2'
    return {
        chat: {
            version: 1,
            canonicalChatId,
            sessionPath: 'C:/fixture/.zyra/sessions/canonical-review.jsonl',
            project: 'C:/fixture',
            cwd: 'C:/fixture',
            title: 'Canonical Review fixture',
            createdAt: canonicalCreatedAt,
            modifiedAt: canonicalModifiedAt[0]!,
            messageCount: 4,
            displayMessageCount: 2,
            toolCallCount: 1,
            errorCount: 0,
            imageCount: 0,
            entryCount: 4,
            archived: false
        },
        entries: older ? firstTurn.slice(0, 2) : firstTurn.slice(2),
        pageInfo: older
            ? { startCursor: '0', endCursor: '2', oldestCursor: null, hasOlder: false, totalEntries: 4 }
            : { startCursor: '2', endCursor: '4', oldestCursor: '2', hasOlder: true, totalEntries: 4 }
    }
}
ZyraRuntime.prototype.prewarm = async () => []
let historyBodyReads = 0
const toolOutputSearches: string[] = []
ZyraRuntime.prototype.searchCanonicalToolOutputs = async (_session, _project, query) => {
    toolOutputSearches.push(query)
    return query === 'provider-only-output' ? [{ toolCallId: 'review-edit-call' }] : []
}
ZyraRuntime.prototype.readCanonicalHistoryEntryBody = async (_session, _project, ref) => {
    historyBodyReads += 1
    const isEdit = ref.entryId === 'entry:deferred-edit-result'
    const isReviewEdit = ref.entryId === 'entry:review-edit-result'
    return {
        entry: {
            type: 'message',
            id: isReviewEdit ? 'entry:review-edit-result' : isEdit ? 'entry:deferred-edit-result' : 'entry:deferred-read-result',
            message: isReviewEdit ? {
                id: 'message:review-edit-result',
                role: 'toolResult',
                toolCallId: 'review-edit-call',
                toolName: 'edit',
                isError: false,
                content: [{ type: 'text', text: 'Successfully replaced 1 block.' }],
                details: { patch, diff: patch }
            } : isEdit ? {
                id: 'message:deferred-edit-result',
                role: 'toolResult',
                toolCallId: 'deferred-edit-call',
                toolName: 'edit',
                isError: false,
                content: [{ type: 'text', text: 'Successfully replaced 1 block.' }],
                details: { patch, diff: patch }
            } : {
                id: 'message:deferred-read-result',
                role: 'toolResult',
                toolCallId: 'deferred-read-call',
                toolName: 'read',
                isError: false,
                content: [{ type: 'text', text: 'deferred file contents' }]
            }
        }
    }
}

const { AssistantService, projectCanonicalTimeline, reconcileCanonicalFileChangeActivity } = await import('../src/main/assistant/service')
const oldDelegation = 'Delegated goal: Inspect the sidebar.\n\nKeep its animations.\n\nRead scope:\n- desktop\n\nAttempt: 1 (11111111-1111-1111-1111-111111111111)\n\nReturn only the bounded work result and evidence. Parent policy remains authoritative.'
const delegationEntry = { type: 'message', id: 'delegated-task', timestamp: canonicalCreatedAt, message: { role: 'user', content: [{ type: 'text', text: oldDelegation }] } }
const legacyDelegation = projectCanonicalTimeline([delegationEntry], 'child', 'child', canonicalCreatedAt, 0, 'C:/fixture', 'parent')
assert.equal(legacyDelegation.messages.length, 0, 'Legacy delegation is agent context rather than a user bubble')
assert.equal(legacyDelegation.activities[0]?.detail, 'Inspect the sidebar.\n\nKeep its animations.', 'Multi-paragraph goals stay intact without internal envelope fields')
assert(legacyDelegation.legacyMessageIds.length > 0, 'Existing raw projection is replaced rather than duplicated')
assert.equal(projectCanonicalTimeline([delegationEntry], 'root', 'root', canonicalCreatedAt, 0).messages.length, 1, 'A user quoting an envelope in an ordinary chat keeps their message')
const newDelegation = projectCanonicalTimeline([{ type: 'custom_message', id: 'task', customType: 'zyra_thread_message', timestamp: canonicalCreatedAt,
    details: { messageId: 'task', senderThreadId: 'parent', recipientThreadId: 'child', senderLabel: 'Xara', text: 'Inspect the sidebar.', origin: 'delegation' } }], 'child', 'child', canonicalCreatedAt, 0)
assert.equal(newDelegation.messages.length, 0)
assert.equal(newDelegation.activities[0]?.payload?.senderLabel, 'Xara')
const reconciledCanonicalActivity = reconcileCanonicalFileChangeActivity({
    id: 'zyra-tool-review-edit-call',
    kind: 'file-change',
    tone: 'tool',
    summary: 'Edited file',
    detail: 'C:/fixture/src/review-index.ts',
    turnId: 'turn:review',
    createdAt: '2026-08-04T08:00:01.000Z',
    payload: {
        provider: 'pi',
        source: 'provider-result',
        status: 'completed',
        authoritative: true,
        patch,
        paths: ['C:/fixture/src/review-index.ts']
    }
}, {
    id: 'zyra-tool-review-edit-call',
    kind: 'file-change',
    tone: 'tool',
    summary: 'Edited file',
    detail: 'C:/fixture/src/review-index.ts',
    turnId: 'turn:review',
    createdAt: '2026-08-04T08:00:01.000Z',
    payload: {
        provider: 'pi',
        source: 'args-preview',
        status: 'completed',
        authoritative: false,
        historyBodyRef: (firstTurn[2] as any).historyBodyRef,
        paths: ['C:/fixture/src/review-index.ts']
    }
})
assert.equal(reconciledCanonicalActivity.payload?.patch, patch, 'canonical text-only replay cannot erase an authoritative live patch')
assert.equal(reconciledCanonicalActivity.payload?.source, 'provider-result')
assert.deepEqual(reconciledCanonicalActivity.payload?.historyBodyRef, (firstTurn[2] as any).historyBodyRef, 'canonical lazy-body metadata still joins the authoritative activity')
const internalTitleProjection = projectCanonicalTimeline([
    {
        type: 'message',
        id: 'entry:title-utility-prompt',
        timestamp: '2026-08-04T07:59:00.000Z',
        message: {
            id: 'message:title-utility-prompt',
            role: 'user',
            timestamp: 1_785_830_340_000,
            content: [{
                type: 'text',
                text: [
                    'You write concise titles for coding assistant chat sessions.',
                    'Return only the title text. Do not use quotes, markdown, JSON, or commentary.',
                    '',
                    'User request to title:',
                    'Keep this visible turn'
                ].join('\n')
            }]
        }
    },
    {
        type: 'message',
        id: 'entry:title-utility-response',
        timestamp: '2026-08-04T07:59:01.000Z',
        message: {
            id: 'message:title-utility-response',
            role: 'assistant',
            timestamp: 1_785_830_341_000,
            content: [
                { type: 'thinking', thinking: 'Select the shortest useful title.' },
                { type: 'text', text: 'Visible Turn' }
            ]
        }
    },
    {
        type: 'message',
        id: 'entry:real-prompt',
        timestamp: '2026-08-04T08:00:00.000Z',
        message: {
            id: 'message:real-prompt',
            role: 'user',
            timestamp: 1_785_830_400_000,
            content: [{ type: 'text', text: 'Keep this visible turn' }]
        }
    },
    {
        type: 'message',
        id: 'entry:real-response',
        timestamp: '2026-08-04T08:00:01.000Z',
        message: {
            id: 'message:real-response',
            role: 'assistant',
            timestamp: 1_785_830_401_000,
            content: [{ type: 'text', text: 'Visible response' }]
        }
    }
], canonicalChatId, 'internal-title', canonicalCreatedAt, 0, 'C:/fixture')
assert.deepEqual(
    internalTitleProjection.messages.map((message) => message.text),
    ['Keep this visible turn', 'Visible response'],
    'canonical Review projection must omit title-utility prompts and their generated title response'
)
assert.equal(
    internalTitleProjection.activities.some((activity) => activity.kind === 'reasoning'),
    false,
    'title-utility reasoning must stay out of the visible Review timeline'
)

const service = new AssistantService()
try {
    const snapshot = await service.getSnapshot()
    const deferredProjection = projectCanonicalTimeline([
        {
            type: 'message', id: 'entry:deferred-read-call', timestamp: canonicalCreatedAt,
            message: {
                id: 'message:deferred-read-call', role: 'assistant', timestamp: Date.parse(canonicalCreatedAt),
                content: [{ type: 'toolCall', id: 'deferred-read-call', name: 'read', arguments: { path: 'large-fixture.txt' } }]
            }
        },
        {
            type: 'message', id: 'entry:deferred-read-result', timestamp: canonicalCreatedAt,
            historyBodyRef: {
                version: 1,
                canonicalChatId,
                entryIndex: 77,
                entryId: 'entry:deferred-read-result',
                entrySha256: 'a'.repeat(64),
                toolCallId: 'deferred-read-call',
                toolName: 'read',
                bodyBytes: 500_000,
                contentTypes: ['text'],
                imageCount: 0
            },
            message: {
                id: 'message:deferred-read-result', role: 'toolResult', toolCallId: 'deferred-read-call',
                toolName: 'read', isError: false, timestamp: Date.parse(canonicalCreatedAt), content: []
            }
        }
    ], canonicalChatId, 'deferred-key', canonicalCreatedAt, 0, 'C:/fixture')
    const deferredActivity = deferredProjection.activities.find((activity) => activity.id === 'zyra-tool-deferred-read-call')
    assert.equal(deferredActivity?.payload?.output, undefined, 'canonical projection must not persist a deferred tool body')
    assert.equal((deferredActivity?.payload?.historyBodyRef as { canonicalChatId?: string })?.canonicalChatId, canonicalChatId)
    const thread = snapshot.sessions
        .flatMap((session) => session.threads)
        .find((candidate) => candidate.providerThreadId === canonicalChatId)
    assert.ok(thread, 'canonical chat catalog rows must create a Desktop compatibility thread')
    await (service as any).persistence.projectCanonicalReviewTimeline({
        threadId: thread.id,
        messages: [],
        activities: [deferredActivity]
    })
    const hydratedBody = await service.hydrateHistoryBody({
        activityId: deferredActivity!.id,
        ref: deferredActivity!.payload!.historyBodyRef as any
    })
    assert.equal(hydratedBody.body.payload.output, 'deferred file contents')
    await service.hydrateHistoryBody({ activityId: deferredActivity!.id, ref: deferredActivity!.payload!.historyBodyRef as any })
    assert.equal(historyBodyReads, 1, 'the main process retains only recently requested historical bodies in its LRU cache')
    await assert.rejects(() => service.hydrateHistoryBody({
        activityId: deferredActivity!.id,
        ref: { ...(deferredActivity!.payload!.historyBodyRef as any), bodyBytes: 1 }
    }), /does not match the stored activity/, 'renderer metadata cannot bypass canonical cache accounting')

    const deferredEditProjection = projectCanonicalTimeline([
        {
            type: 'message', id: 'entry:deferred-edit-call', timestamp: canonicalCreatedAt,
            message: {
                id: 'message:deferred-edit-call', role: 'assistant', timestamp: Date.parse(canonicalCreatedAt),
                content: [{
                    type: 'toolCall', id: 'deferred-edit-call', name: 'edit',
                    arguments: { path: 'C:/fixture/src/review-index.ts', edits: [{ oldText: 'old review', newText: 'new review' }] }
                }]
            }
        },
        {
            type: 'message', id: 'entry:deferred-edit-result', timestamp: canonicalCreatedAt,
            historyBodyRef: {
                version: 1,
                canonicalChatId,
                entryIndex: 78,
                entryId: 'entry:deferred-edit-result',
                entrySha256: 'b'.repeat(64),
                toolCallId: 'deferred-edit-call',
                toolName: 'edit',
                bodyBytes: 500_000,
                contentTypes: ['text'],
                imageCount: 0
            },
            message: {
                id: 'message:deferred-edit-result', role: 'toolResult', toolCallId: 'deferred-edit-call',
                toolName: 'edit', isError: false, timestamp: Date.parse(canonicalCreatedAt)
            }
        }
    ], canonicalChatId, 'deferred-edit-key', canonicalCreatedAt, 0, 'C:/fixture')
    const deferredEditActivity = deferredEditProjection.activities.find((activity) => activity.id === 'zyra-tool-deferred-edit-call')!
    await (service as any).persistence.projectCanonicalReviewTimeline({
        threadId: thread.id,
        messages: [],
        activities: [deferredEditActivity]
    })
    const hydratedEdit = await service.hydrateHistoryBody({
        activityId: deferredEditActivity.id,
        ref: deferredEditActivity.payload!.historyBodyRef as any
    })
    assert.equal(hydratedEdit.body.payload.patch, patch, 'file-change patches hydrate only when their historical body is requested')
    assert.equal(hydratedEdit.body.payload.authoritative, true)
    assert.equal(historyBodyReads, 2)
    await (service as any).persistence.projectCanonicalReviewTimeline({
        threadId: thread.id,
        messages: [],
        activities: [],
        removedActivityIds: [deferredActivity!.id, deferredEditActivity.id]
    })

    const session = snapshot.sessions.find((candidate) => candidate.threads.some((entry) => entry.id === thread.id))!
    await (service as any).ensureCanonicalReviewHistoryIndexed(session, thread)
    const firstReview = await service.getReviewIndex(thread.id)
    assert.equal(firstReview.index.totalTurns, 1)
    assert.equal(firstReview.index.turns[0]?.prompt?.text, 'Review this file')
    assert.equal(firstReview.index.turns[0]?.response?.text, 'Review complete')
    assert.equal(firstReview.index.turns[0]?.changes.length, 1)
    assert.equal(firstReview.index.turns[0]?.changes[0]?.filePath.replace(/\\/g, '/').endsWith('/src/review-index.ts'), true)
    assert.equal(firstReview.index.turns[0]?.changes[0]?.additions, 1)
    assert.equal(firstReview.index.turns[0]?.changes[0]?.deletions, 1)
    assert.equal(historyBodyReads, 2, 'opening the Review index keeps every deferred historical body lazy')
    assert.deepEqual(historyRequests.map((request) => request.before), ['128', null, '2'], 'one startup title lookup precedes the explicit canonical indexer backfill')
    assert.equal(historyRequests[0]?.limit, 128, 'startup title eligibility never performs a full history backfill')
    const indexedEditActivity = await (service as any).persistence.readActivity(thread.id, 'zyra-tool-review-edit-call')
    assert.equal(indexedEditActivity?.turnId, firstReview.index.turns[0]!.id)
    assert.equal(indexedEditActivity?.payload?.patch, undefined, 'Review indexing keeps the exact provider patch lazy')
    assert.match(String(indexedEditActivity?.payload?.previewPatch || ''), /-old review[\s\S]*\+new review/, 'structured edit arguments keep Review useful before exact patch hydration')
    const directMergedSearch = await (service as any).persistence.mergeSearchTurnIds(thread.id, [], ['zyra-tool-review-edit-call'])
    assert.deepEqual(directMergedSearch.turnIds, [firstReview.index.turns[0]!.id])
    const deferredOutputSearch = await service.searchTurns(thread.id, 'provider-only-output')
    assert.deepEqual(toolOutputSearches, ['provider-only-output'])
    assert.deepEqual(deferredOutputSearch.result.turnIds, [firstReview.index.turns[0]!.id], 'search merges matching deferred canonical output back into Review turns')

    const firstTurnDetail = await service.getTurnDetail(thread.id, firstReview.index.turns[0]!.id)
    assert.deepEqual(firstTurnDetail.detail.messages.map((message) => message.text), ['Review this file', 'Review complete'])
    const reviewedFileChange = firstTurnDetail.detail.activities.find((activity) => activity.kind === 'file-change')
    assert.equal(reviewedFileChange?.payload?.patch, patch, 'the selected Review turn hydrates its authoritative patch')
    assert.equal(reviewedFileChange?.payload?.authoritative, true)
    assert.equal(historyBodyReads, 3, 'opening one turn hydrates only that turn’s deferred file changes')
    const persistedReviewedFileChange = await (service as any).persistence.readActivity(thread.id, 'zyra-tool-review-edit-call')
    assert.equal(persistedReviewedFileChange?.payload?.patch, patch, 'a selectively hydrated patch remains available to later Review reads')
    const hydratedReviewIndex = await (service as any).persistence.readReviewIndex(thread.id)
    assert.equal(hydratedReviewIndex.turns[0]?.changes[0]?.additions, 1)
    assert.equal(hydratedReviewIndex.turns[0]?.changes[0]?.deletions, 1)

    await service.getReviewIndex(thread.id)
    assert.equal(historyRequests.length, 3, 'opening or refreshing Review adds no requests after startup and explicit indexing')

    const runtime = (service as any).runtime
    runtime.emit('catalog.changed', { canonicalChatId, presence: true })
    assert.equal((service as any).canonicalReviewHistoryState.size, 1, 'presence-only catalog changes do not trigger history backfills')
    runtime.emit('catalog.changed', { canonicalChatId })
    assert.equal((service as any).canonicalReviewHistoryState.size, 0, 'cross-surface transcript changes invalidate Review/search history state')
    timelineVersion = 1
    await (service as any).ensureCanonicalReviewHistoryIndexed(session, thread)
    const updatedReview = await service.getReviewIndex(thread.id)
    assert.equal(updatedReview.index.totalTurns, 2)
    assert.equal(updatedReview.index.turns[0]?.prompt?.text, 'Review the follow-up')
    assert.equal(updatedReview.index.turns[1]?.changes.length, 1, 'incremental canonical refresh retains older indexed changes')
    assert.equal(historyRequests.length, 4, 'the explicit indexer adds a later TUI turn from the latest page without rereading older pages')
} finally {
    await service.dispose()
    rmSync(userDataPath, { recursive: true, force: true })
}

console.log('Assistant canonical Review history: ok')
