import { readSentAttachmentPreview, rememberSentAttachmentPreviews } from '../src/renderer/src/pages/assistant/assistant-sent-attachment-previews'
import assert from 'node:assert/strict'
import { mock, setSystemTime } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { resolveAssistantInitialHistoryBackfill } from '../src/renderer/src/pages/assistant/assistant-history-streaming-policy'
import { resolveAssistantTurnPresentationStartedAt, resolveAssistantWorkingStartedAt } from '../src/renderer/src/pages/assistant/assistant-conversation-surface-mode'
import { buildPromptWithContextFiles } from '../src/renderer/src/pages/assistant/assistant-composer-utils'
import { buildTimelineRows, getTimelineEntries } from '../src/renderer/src/pages/assistant/assistant-timeline-helpers'
import { groupTimelineRowsIntoWorkSummaries } from '../src/renderer/src/pages/assistant/assistant-turn-work'
import type { AssistantActivity, AssistantMessage } from '../src/shared/assistant/contracts'

mock.module('../src/renderer/src/lib/settings', () => ({ getThemeAppearance: () => 'dark', useSettings: () => ({ settings: {
    assistantShowActionStats: false, assistantAllowCollapseWhileWorking: false
} }) }))
const { TimelineTurnWorkSummary } = await import('../src/renderer/src/pages/assistant/AssistantTimelineWorkSummary')
const at = '2026-11-07T10:00:00.000Z'
const failures: Error[] = []
const test = (name: string, run: () => void) => { try { run(); console.log('PASS ' + name) } catch (error) { console.error('FAIL ' + name); failures.push(error as Error) } }
const user: AssistantMessage = { id: 'stability-user', role: 'user', text: 'Inspect the page', turnId: 'stability-turn', streaming: false, createdAt: at, updatedAt: at }
test('current request never inherits the previous idle turn clock', () => {
    assert.equal(resolveAssistantTurnPresentationStartedAt(at, '2026-11-07T02:00:00.000Z'), at)
    const oldTurn = { id:'old-turn',state:'completed' as const,startedAt:'2026-11-07T02:00:00.000Z',requestedAt:'2026-11-07T02:00:00.000Z',completedAt:'2026-11-07T02:01:00.000Z',updatedAt:'2026-11-07T02:01:00.000Z' }
    assert.equal(resolveAssistantWorkingStartedAt({updatedAt:at,latestTurn:oldTurn}),at,'sidebar warm-up cannot time a terminal previous turn')
    assert.equal(resolveAssistantWorkingStartedAt({updatedAt:at,latestTurn:{...oldTurn,state:'running'}}),oldTurn.startedAt,'a genuinely running turn keeps its original duration')
})
test('initial history continues filling after three short pages', () => {
    assert.equal(resolveAssistantInitialHistoryBackfill({ initialLayoutReady: true, selectionSettled: true, hasOlder: true, loadingOlder: false,
        hasLoadError: false, requestPending: false, viewportSize: 720, contentLength: 240, }).shouldRequest, true)
})
test('mid-turn compaction does not turn commentary into a final response', () => {
    const commentary: AssistantMessage = { ...user, id: 'commentary', role: 'assistant', phase: undefined, text: 'I am still checking.', createdAt: '2026-11-07T10:00:01.000Z', updatedAt: '2026-11-07T10:00:01.000Z' }
    const actions: AssistantActivity[] = [{ id: 'check', kind: 'command', tone: 'tool', summary: 'Checking', turnId: user.turnId, createdAt: at, payload: { status: 'completed' } },
        { id: 'compact', kind: 'context.compaction', tone: 'tool', summary: 'Compacting context', turnId: user.turnId, createdAt: '2026-11-07T10:00:02.000Z', payload: { status: 'running', category: 'context-compaction', startedAt: '2026-11-07T10:00:02.000Z' } }]
    const messages = [user, commentary]
    const rows = groupTimelineRowsIntoWorkSummaries({ rows: buildTimelineRows(getTimelineEntries(messages, [...actions].reverse()), true, at), messages,
        latestAssistantMessageId: commentary.id, latestTurnStartedAt: at, isWorking: true })
    const work = rows.find(row => row.kind === 'turn-work-summary')
    assert.ok(work?.kind === 'turn-work-summary' && work.running && !work.terminalResponseVisible)
})
test('a still-running work disclosure retains elapsed time', () => {
    setSystemTime(new Date('2026-11-07T10:00:12.000Z'))
    try { assert.match(renderToStaticMarkup(<TimelineTurnWorkSummary startedAt={at} completedAt={null} running collapseForTerminalResponse renderChildren={() => <div>Work</div>} />), /Working for 12s/) }
    finally { setSystemTime() }
})
test('preview handoff is scoped, bounded, transient, and absent from prompt text', () => {
    const file = { id: 'preview', path: 'clipboard://same-name.png', name: 'same-name.png', kind: 'image' as const, source: 'paste' as const, previewDataUrl: 'data:image/png;base64,AAAA' }
    rememberSentAttachmentPreviews('preview-one', [file])
    rememberSentAttachmentPreviews('preview-two', [{ ...file, previewDataUrl: 'data:image/png;base64,BBBB' }])
    assert.equal(readSentAttachmentPreview('preview-one', file.path)?.previewDataUrl, file.previewDataUrl)
    assert.equal(readSentAttachmentPreview('preview-two', file.path)?.previewDataUrl, 'data:image/png;base64,BBBB')
    assert.doesNotMatch(buildPromptWithContextFiles('Inspect', [file]), /base64|AAAA/)
    const large = { ...file, path: 'C:/synthetic/large.png', previewDataUrl: 'data:image/png;base64,' + 'A'.repeat(5 * 1024 * 1024) }
    rememberSentAttachmentPreviews('large-path', [large])
    assert.equal(readSentAttachmentPreview('large-path', large.path)?.path, large.path, 'large originals retain an immediate durable preview without retaining oversized bytes')
    assert.equal(readSentAttachmentPreview('large-path', large.path)?.previewDataUrl, undefined)
    for (let index = 0; index < 40; index++) rememberSentAttachmentPreviews(`bounded-${index}`, [file])
    assert.equal(readSentAttachmentPreview('bounded-0', file.path), undefined)
    assert.ok(readSentAttachmentPreview('bounded-39', file.path))
    const later = Date.now() + 31 * 60_000
    setSystemTime(new Date(later))
    try { assert.equal(readSentAttachmentPreview('bounded-39', file.path), undefined) }
    finally { setSystemTime() }
})
if (failures.length) throw new AggregateError(failures, `${failures.length} chat presentation regressions`)
