import { createRoot } from 'react-dom/client'
import { checkToolStreamingState } from './tool-streaming-state'
import { flushSync } from 'react-dom'
import { useRef } from 'react'
import type { AssistantActivity, AssistantMessage } from '../../src/shared/assistant/contracts'
import { TimelineToolCallList } from '../../src/renderer/src/pages/assistant/AssistantTimelineToolCalls'
import { AssistantTimeline } from '../../src/renderer/src/pages/assistant/AssistantTimeline'
import { TimelineContextCompactionMarker } from '../../src/renderer/src/pages/assistant/AssistantTimelineCompaction'
import { getTimelineActivityDomId } from '../../src/renderer/src/pages/assistant/assistant-timeline-helpers'
import { assertLeftAlignedActionRow } from './assistant-action-row-assertions'
import { AssistantAgentDetailPage } from '../../src/renderer/src/pages/assistant/AssistantAgentDetailPage'
import { createWorkflowReviewSeed } from '../../src/renderer/src/reviews/agents-review-workflow-fixture'
import type { AgentTranscriptPage } from '../../src/shared/assistant/contracts'

const root = createRoot(document.getElementById('root')!)
const at = '2026-10-01T10:00:00.000Z'
const hydrationRequests: string[] = []
;(window as any).devscope = { assistant: { hydrateHistoryBody: async ({ activityId }: { activityId: string }) => {
    hydrationRequests.push(activityId)
    return { success: true, body: { payload: { output: `Captured output for ${activityId}`, status: 'completed' } } }
} } }
const activities: AssistantActivity[] = Array.from({ length: 80 }, (_, index) => ({
    id: `command-${index}`, kind: 'command', tone: 'tool', createdAt: at, summary: 'Running checks', payload: {
        command: `echo check-${index}`, status: 'completed', toolName: 'exec_command', actionBatchIntent: 'Running tests',
        historyBodyRef: { version: 1, canonicalChatId: 'synthetic', entryIndex: index, entryId: `entry-${index}`, entrySha256: 'a'.repeat(64) }
    }
}))
activities.splice(1, 0, ...[0, 1].map(index => ({ id: `browser-${index}`, kind: 'browser-control' as const, tone: 'tool' as const, createdAt: at,
    summary: 'Inspecting browser', payload: { toolName: 'browser_observe', operation: 'observe', status: 'completed', actionBatchIntent: 'Checking the browser', url: 'https://example.com' } })))
activities.push({ id: 'web-search', kind: 'web-search', tone: 'tool', createdAt: at, summary: 'Searching documentation', payload: {
    toolName: 'web_search', query: 'SDK hooks', status: 'completed', actionBatchIntent: 'Running tests',
    webResults: [{ title: 'Captured documentation', url: 'https://example.com/docs', snippet: 'Stored evidence' }]
} })
const wait = (ms = 40) => new Promise(resolve => setTimeout(resolve, ms))
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
async function click(element: HTMLElement) { element.click(); await wait(300) }
const timestamp = (second: number) => new Date(Date.parse(at) + second * 1000).toISOString()
const jumpMessages: AssistantMessage[] = [
    { id: 'user-one', role: 'user', text: 'Run the first checks', turnId: 'turn-one', timelineSequence: 1, createdAt: timestamp(0), updatedAt: timestamp(0) },
    { id: 'answer-one', role: 'assistant', phase: 'final_answer', text: 'First checks finished', turnId: 'turn-one', timelineSequence: 4, createdAt: timestamp(4), updatedAt: timestamp(4) },
    { id: 'user-two', role: 'user', text: 'Check their status', turnId: 'turn-two', timelineSequence: 5, createdAt: timestamp(5), updatedAt: timestamp(5) },
    { id: 'answer-two', role: 'assistant', phase: 'final_answer', text: 'Status checked', turnId: 'turn-two', timelineSequence: 7, createdAt: timestamp(7), updatedAt: timestamp(7) }
]
const jumpActivities: AssistantActivity[] = [
    { ...activities[0]!, id: 'original-command', turnId: 'turn-one', timelineSequence: 2, createdAt: timestamp(1), payload: { ...activities[0]!.payload, jobId: 'jump-job' } },
    { ...activities[1]!, id: 'other-command', kind: 'command', turnId: 'turn-one', timelineSequence: 3, createdAt: timestamp(2), payload: { command: 'echo second', status: 'completed' } },
    { id: 'status-checkpoint', kind: 'command.checkpoint', tone: 'tool', summary: 'Checked command', detail: 'jump-job', turnId: 'turn-two', timelineSequence: 6,
        createdAt: timestamp(6), payload: { category: 'command-checkpoint', commandAction: 'status', args: { action: 'status', jobId: 'jump-job' }, jobId: 'jump-job', status: 'completed' } }
]
function TimelineScene() {
    const scrollContainerRef = useRef<HTMLDivElement | null>(null)
    return <div style={{ height: 720, width: 900, display: 'flex', flexDirection: 'column' }}>
        <AssistantTimeline threadId="jump-thread" messages={jumpMessages} activities={jumpActivities} latestAssistantMessageId="answer-two" scrollContainerRef={scrollContainerRef} />
    </div>
}
function checkCenteredSummary(row: HTMLElement, label: string) {
    const content = row.querySelector<HTMLElement>('[data-assistant-action-summary]')
    check(content, `${label}: summary has a shared centered wrapper`)
    const bounds = row.getBoundingClientRect()
    const summary = content.getBoundingClientRect()
    check(Math.abs((summary.left + summary.right) / 2 - (bounds.left + bounds.right) / 2) < 1, `${label}: summary is horizontally centered`)
    check(summary.left >= bounds.left && summary.right <= bounds.right, `${label}: summary fits the row`)
}
async function run() {
    for (const width of [760, 320]) {
        for (const status of ['running', 'completed', 'failed', 'cancelled']) {
            flushSync(() => root.render(<div style={{ width }}><TimelineContextCompactionMarker activity={{
                id: 'compaction-layout', kind: 'context.compaction', tone: 'info', summary: 'Context compaction', createdAt: at, payload: { status }
            }} /></div>))
            checkCenteredSummary(document.querySelector<HTMLElement>('[data-assistant-compaction]')!, `${status} compaction at ${width}px`)
        }
    }
    for (const width of [760, 320]) {
        const plugin: AssistantActivity = { id: 'plugin-layout', kind: 'plugin-mcp', tone: 'tool', createdAt: at, summary: 'Listing tools', payload: { status: 'completed', action: 'tools', pluginName: 'Fixture' } }
        for (const activity of [activities[0]!, activities.at(-1)!, plugin]) {
            flushSync(() => root.render(<div style={{ width }}><TimelineToolCallList activities={[activity]} /></div>))
            assertLeftAlignedActionRow(document.querySelector<HTMLElement>('[data-assistant-action-row]')!, `Single ${activity.kind} at ${width}px`)
        }
    }
    flushSync(() => root.render(<div style={{ width: 760 }}><TimelineToolCallList activities={activities} /></div>))
    await wait()
    const outer = document.querySelector<HTMLButtonElement>('[data-assistant-action-batch-trigger]')!
    check(outer.textContent?.includes('Running tests'), 'Top-level saved preview stays visible')
    assertLeftAlignedActionRow(outer, 'Collapsed tool batch')
    check(!document.querySelector('[data-assistant-tool-call], [data-assistant-typed-action]'), 'Closed group mounts no tool rows')
    check(hydrationRequests.length === 0, 'Opening the chat fetches no saved tool bodies')
    await click(outer)
    check(document.querySelectorAll('[data-assistant-tool-call]').length === 80, 'Expansion reveals every command without a last-N slice')
    check(!document.querySelector('[data-assistant-typed-action^="browser-"]'), 'Nested control group stays unmounted')
    check(!document.querySelector('[data-assistant-web-results]'), 'Web results remain unmounted beneath their action preview')
    check(hydrationRequests.length === 0, 'Opening the list does not hydrate deeper outputs')
    assertLeftAlignedActionRow(document.querySelector<HTMLElement>('[data-assistant-tool-call] button')!, 'Command tool preview')
    assertLeftAlignedActionRow(document.querySelector<HTMLElement>('[data-assistant-typed-action="web-search"] button')!, 'Typed tool preview')
    const inner = document.querySelector<HTMLButtonElement>('[data-assistant-control-run] [data-assistant-action-batch-trigger]')!
    await click(inner)
    check(document.querySelectorAll('[data-assistant-typed-action^="browser-"]').length === 2, 'Nested expansion mounts its own browser actions')
    check(hydrationRequests.length === 0, 'Nested action previews do not fetch bodies')
    const command = document.querySelector<HTMLElement>('[data-assistant-tool-call] button')!
    await click(command)
    check(hydrationRequests.length === 1 && hydrationRequests[0] === 'command-0', 'Opening one tool hydrates only its own saved output')
    check(document.body.textContent?.includes('Captured output for command-0'), 'Hydrated output is actually rendered')
    await click(document.querySelector<HTMLElement>('[data-assistant-typed-action="web-search"] button')!)
    check(document.querySelector('[data-assistant-web-results]')?.textContent?.includes('Captured documentation'), 'Opening a web action renders its complete captured evidence')
    await click(outer)
    const exitDeadline = performance.now() + 2000
    while (document.querySelector('[data-assistant-tool-call], [data-assistant-typed-action]') && performance.now() < exitDeadline) await wait()
    check(!document.querySelector('[data-assistant-tool-call], [data-assistant-typed-action]'), `Closing the group releases all nested tool components (expanded=${outer.getAttribute('aria-expanded')}, connected=${outer.isConnected})`)
    await click(outer)
    check(document.querySelectorAll('[data-assistant-tool-call]').length === 80, 'Reopening retains every captured command')
    check(hydrationRequests.length === 1, 'Reopening a group does not refetch closed tool details')
    flushSync(() => root.render(<TimelineScene />))
    await wait(400)
    const workTriggers = [...document.querySelectorAll<HTMLButtonElement>('[data-assistant-work-summary-shell] button[aria-controls]')]
    check(workTriggers.length === 2, 'The real virtual timeline contains both completed work summaries')
    check(!document.getElementById(getTimelineActivityDomId('original-command')), 'Original command starts unmounted inside closed work')
    await click(workTriggers[1]!)
    const checkpoint = document.getElementById(getTimelineActivityDomId('status-checkpoint'))?.querySelector<HTMLButtonElement>('button')
    check(checkpoint, 'Opening the later work exposes its command follow-up')
    check(checkpoint.title === 'Go to original command', 'The follow-up links to the original canonical command')
    const requestsBeforeJump = hydrationRequests.length
    await click(checkpoint)
    const jumpDeadline = performance.now() + 3000
    while (!document.getElementById(getTimelineActivityDomId('original-command')) && performance.now() < jumpDeadline) await wait()
    const original = document.getElementById(getTimelineActivityDomId('original-command'))
    check(original, 'Following a command mounts its original work and lazy action group')
    await wait(350)
    check(workTriggers[0]!.getAttribute('aria-expanded') === 'true', 'The original work summary opens for the explicit jump')
    check(original.closest('[data-assistant-action-batch]')?.querySelector('button')?.getAttribute('aria-expanded') === 'true', 'The matching inner action group opens for the jump')
    check(document.activeElement === original.querySelector('button'), 'The jump focuses the original command preview')
    check(hydrationRequests.length === requestsBeforeJump, 'Navigating to a tool preview does not fetch its output')
    const demoAgent = Object.values(createWorkflowReviewSeed().snapshot.agents)[0]!
    const childEntries: AgentTranscriptPage['entries'] = [
        { index: 0, type: 'message', timestamp: timestamp(0), message: { role: 'user', content: [{ type: 'text', text: 'Inspect the synthetic auth module' }] } },
        { index: 1, type: 'message', timestamp: timestamp(1), message: { role: 'assistant', content: [{ type: 'toolCall', id: 'read-auth', name: 'read', arguments: { path: 'demo/auth.ts' } }] } },
        { index: 2, type: 'message', timestamp: timestamp(2), message: { role: 'toolResult', toolCallId: 'read-auth', content: [{ type: 'text', text: 'Synthetic captured source' }] } },
        { index: 3, type: 'message', timestamp: timestamp(3), message: { role: 'assistant', content: [{ type: 'toolCall', id: 'search-auth', name: 'rg', arguments: { pattern: 'authorize', path: 'demo/' } }] } },
        { index: 4, type: 'message', timestamp: timestamp(4), message: { role: 'toolResult', toolCallId: 'search-auth', content: [{ type: 'text', text: 'demo/auth.ts:12' }] } },
        { index: 5, type: 'message', timestamp: timestamp(5), message: { role: 'assistant', phase: 'final_answer', content: [{ type: 'text', text: 'Synthetic review complete' }] } }
    ]
    flushSync(() => root.render(<AssistantAgentDetailPage
        run={{ ...demoAgent, status: 'completed', createdAt: timestamp(0), startedAt: timestamp(0), completedAt: timestamp(5), result: null }}
        transcript={{ agentRunId: demoAgent.agentRunId, entries: childEntries, nextBefore: null, nextAfter: null, totalEntries: childEntries.length, truncatedEntries: 0, hydrated: childEntries.length }}
        loading={false} error={null} onBack={() => {}} onLoadOlder={() => {}} onRetry={() => {}} />))
    await wait()
    check(!document.querySelector('[data-assistant-typed-action]'), 'Saved child Work initially leaves its tools unmounted')
    const childWork = document.querySelector<HTMLButtonElement>('[data-assistant-work-summary-shell] button[aria-controls]')
    check(childWork, 'Actual child conversation renders the shared Work disclosure')
    await click(childWork)
    const childBatch = document.querySelector<HTMLButtonElement>('[data-assistant-action-batch-trigger]')
    check(childBatch && childBatch.getAttribute('aria-expanded') === 'false', 'Opening child Work keeps its inner Action batch collapsed')
    check(!document.querySelector('[data-assistant-typed-action]'), 'Opening child Work does not eagerly render nested tools')
    await click(childBatch)
    check(document.querySelectorAll('[data-assistant-typed-action]').length === 2, 'Expanding the actual child batch mounts both saved tools')
    check(document.querySelector('[data-assistant-typed-action="agent-tool:read-auth"]'), 'Child batch retains the saved read identity')
    check(document.querySelector('[data-assistant-typed-action="agent-tool:search-auth"]'), 'Child batch retains the saved search identity')
    check(document.body.textContent?.includes('Synthetic review complete'), 'The final child response remains outside the tool disclosure')
    await click(childBatch)
    check(!document.querySelector('[data-assistant-typed-action]'), 'Closing the actual child batch releases its tool rows')
    await click(childBatch)
    check(document.querySelectorAll('[data-assistant-typed-action]').length === 2, 'Reopening the actual child batch retains both saved tools')
    const streamingResults = await checkToolStreamingState(root)
    // Leave the checked scene mounted for the harness's optional screenshot.
    return ['Real tool groups defer lists, nested runs and exact output hydration independently; command jumps open lazy work and focus their target; actual saved child conversation expands, releases and restores both tools', ...streamingResults]
}
;(window as any).sidebarContinuityCheck = run()
