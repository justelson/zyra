import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import './fixtures/unused-diff-worker'
import { renderToStaticMarkup } from 'react-dom/server'
import { projectThreadMessage } from '../src/shared/assistant/thread-message'
import { buildTimelineRows, getTimelineEntries } from '../src/renderer/src/pages/assistant/assistant-timeline-helpers'
import { groupTimelineRowsIntoWorkSummaries } from '../src/renderer/src/pages/assistant/assistant-turn-work'
import { resolveAgentThreadOwner } from '../src/shared/assistant/thread-owner'
import { buildSessionSubagentTree, isAssistantDraftThread } from '../src/renderer/src/pages/assistant/assistant-sessions-rail-utils'
import type { AssistantSession, AssistantThread } from '../src/shared/assistant/contracts'
import { findAssistantThreadLink } from '../src/renderer/src/pages/assistant/assistant-thread-navigation'
// Canvas-dependent Markdown is verified in the hidden renderer fixture.
mock.module('../src/renderer/src/pages/assistant/AssistantTimelineText', () => ({ CollapsibleUserMessageBody: ({ content }: { content: string }) => <span>{content}</span> }))
const { AssistantConversationHeader } = await import('../src/renderer/src/pages/assistant/AssistantConversationHeader')
const { AssistantTimelineThreadMessage } = await import('../src/renderer/src/pages/assistant/AssistantTimelineThreadMessage')

const details = { messageId: 'receipt-1', senderThreadId: 'agent-run:a', senderCanonicalThreadId: 'chat-a', senderLabel: 'Xara', recipientThreadId: 'chat-b', text: 'Check the evidence from my thread.', createdAt: '2026-10-01T12:00:00.000Z' }
const live = projectThreadMessage(details, '2026-10-01T12:00:01.000Z')!
const history = projectThreadMessage(details, '2026-10-01T12:00:02.000Z', 12)!
assert.equal(live.id, history.id, 'Live events and replayed history share one receipt identity')
assert.equal(live.createdAt, history.createdAt)
assert.equal(live.turnId, null, 'A peer message cannot become a user turn')
assert.equal(projectThreadMessage({ ...details, messageId: '' }, details.createdAt), null)
const markup = renderToStaticMarkup(<AssistantTimelineThreadMessage activity={history} />)
assert.match(markup, /Message from Xara in another thread/)
assert.match(markup, /Check the evidence from my thread/)
assert.match(markup, /data-assistant-thread-message-bubble/)
assert(markup.indexOf('data-assistant-thread-message-label') < markup.indexOf('data-assistant-thread-message-body'), 'Sender provenance sits above the bubble')
assert(!markup.includes('Dismiss') && !markup.includes('more messages'))
const messages = [
    { id: 'user', role: 'user', text: 'Start work', turnId: 'turn', createdAt: '2026-10-01T11:59:00.000Z', updatedAt: '2026-10-01T11:59:00.000Z', streaming: false },
    { id: 'before', role: 'assistant', text: 'Checking', turnId: 'turn', createdAt: '2026-10-01T11:59:30.000Z', updatedAt: '2026-10-01T11:59:30.000Z', streaming: false },
    { id: 'after', role: 'assistant', text: 'Checked', turnId: 'turn', createdAt: '2026-10-01T12:00:30.000Z', updatedAt: '2026-10-01T12:00:30.000Z', streaming: false },
] as any
for (const isWorking of [false, true]) {
    const entries = getTimelineEntries(messages, [history])
    const rows = groupTimelineRowsIntoWorkSummaries({ rows: buildTimelineRows(entries, isWorking, messages[0].createdAt), messages, latestAssistantMessageId: 'after', latestTurnStartedAt: messages[0].createdAt, isWorking })
    const flatten = (rows: any[]): any[] => rows.flatMap(row => row.kind === 'turn-work-summary' ? flatten(row.rows) : [row])
    assert.deepEqual(flatten(rows).filter(row => row.kind !== 'working').map(row => row.id), entries.map(entry => entry.id), 'Peer bubble keeps its original position between earlier and later work blocks, live and settled')
    assert(rows.some(row => row.kind === 'message' && row.threadMessage?.id === history.id), 'Received messages cannot be collapsed into work summaries')
}
const legacyMessages = [{ ...messages[0], turnId: null }, { ...messages[2], turnId: null }]
const legacyTool = { id: 'legacy-read', kind: 'file-read', tone: 'tool', summary: 'Read source', turnId: null, createdAt: messages[1].createdAt, payload: { status: 'completed' } } as any
const legacyRows = groupTimelineRowsIntoWorkSummaries({ rows: buildTimelineRows(getTimelineEntries(legacyMessages, [legacyTool]), false, null), messages: legacyMessages, latestAssistantMessageId: 'after', latestTurnStartedAt: null, isWorking: false })
assert(legacyRows.some(row => row.kind === 'turn-work-summary' && !row.running && row.rows.length > 0), 'Agent SDK history without turn ids still has a completed collapsible work block')
assert.equal(legacyMessages[0].turnId, null, 'Renderer grouping does not mutate canonical task messages')
const parent = { id: 'local-parent', providerThreadId: 'canonical-parent', source: 'root' } as AssistantThread
const child = { id: 'local-child', providerThreadId: 'canonical-child', providerParentThreadId: 'canonical-parent', source: 'subagent' } as AssistantThread
const owner = { id: 'owner', threads: [parent], chatScope: { workingRoot: 'saved-root' } } as AssistantSession
assert.equal(resolveAgentThreadOwner([owner], child)?.session, owner, 'Reconnect uses the owner session and its saved authority')
assert.equal(resolveAgentThreadOwner([owner], parent), null)
assert.equal(isAssistantDraftThread(child), false, 'A new agent thread stays discoverable before its first answer')
assert.equal(isAssistantDraftThread({ ...parent, messages: [], latestTurn: null, activityCount: 1 } as AssistantThread), false, 'A shell with a context receipt is not an empty draft')
assert.deepEqual(buildSessionSubagentTree({ id: 'child-session', threads: [child] } as AssistantSession), [], 'A standalone agent thread does not repeat itself as its own sidebar child')
const snapshot = { sessions: [owner, { id: 'child-session', threads: [child] }], fleetByThreadId: { 'local-parent': { agents: { child: { providerSessionId: 'canonical-child' } } } } } as any
assert.equal(findAssistantThreadLink(snapshot, 'canonical-parent'), '/assistant/chat/owner/thread/local-parent')
assert.equal(findAssistantThreadLink(snapshot, 'local-parent'), '/assistant/chat/owner/thread/local-parent')
assert.equal(findAssistantThreadLink(snapshot, 'agent-run:child'), '/assistant/chat/child-session/thread/local-child')
assert.equal(findAssistantThreadLink(snapshot, 'deleted'), null)
const noop = () => undefined
const header = renderToStaticMarkup(<AssistantConversationHeader rightPanelOpen={false} rightPanelMode="none" selectedSessionTitle="Hi" canonicalThreadId="canonical-child"
    activeThreadIsSubagent activeThreadLabel="Hi" selectedProjectTooltip="" selectedProjectPath={null} latestProjectLabel="" projectDirectoryLocked
    onCreateThread={noop} onRenameChat={noop} onCreateProjectChat={noop} onChooseProject={noop} onArchiveChat={noop} onDeleteChat={noop} onToggleRightSidebar={noop} />)
assert.match(header, /aria-label="Agent thread: Hi"/, 'The robot badge identifies the agent without a duplicate text pill')
console.log('PASS attributed peer bubbles render in chronological live and replayed history')
