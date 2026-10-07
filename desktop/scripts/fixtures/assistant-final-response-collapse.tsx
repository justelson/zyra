import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { TimelineTurnWorkSummary } from '../../src/renderer/src/pages/assistant/AssistantTimelineWorkSummary'
import { TimelineWorkingIndicator } from '../../src/renderer/src/pages/assistant/AssistantTimelineWorkingIndicator'
import { groupTimelineRowsIntoWorkSummaries } from '../../src/renderer/src/pages/assistant/assistant-turn-work'
import { buildTimelineRows, getTimelineEntries } from '../../src/renderer/src/pages/assistant/assistant-timeline-helpers'
import type { AssistantMessage, AssistantActivity } from '../../src/shared/assistant/contracts'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message) }
const wait = (ms = 40) => new Promise(resolve => setTimeout(resolve, ms))
const at = new Date(Date.now() - 5000).toISOString()
const user: AssistantMessage = { id: 'phase-user', role: 'user', text: 'Repair the preview startup', turnId: 'phase-turn', streaming: false, createdAt: at, updatedAt: at }
const action: AssistantActivity = { id: 'phase-action', kind: 'command', tone: 'tool', summary: 'Checking startup', turnId: user.turnId,
    createdAt: at, payload: { status: 'running' } }
const response: AssistantMessage = { id: 'phase-final', role: 'assistant', text: '', turnId: user.turnId, streaming: true,
    createdAt: new Date().toISOString(), updatedAt: at }
const container = document.createElement('main'); document.body.append(container)
const root = createRoot(container)
const button = () => document.querySelector<HTMLButtonElement>('[data-assistant-work-summary-shell] button')!
const panel = () => document.querySelector<HTMLElement>('[data-state]')!
const render = async (mode: 'minimal' | 'detailed', phase?: AssistantMessage['phase'], text = '', running = true) => {
    const messages = [user, { ...response, phase, text }]
    const rows = groupTimelineRowsIntoWorkSummaries({ rows: buildTimelineRows(getTimelineEntries(messages, [action]), running, at), messages,
        latestAssistantMessageId: response.id, latestTurnStartedAt: at, isWorking: running })
    const work = rows.find(row => row.kind === 'turn-work-summary')!
    assert(work.kind === 'turn-work-summary', 'fixture must use the actual timeline projection')
    if (work.kind !== 'turn-work-summary') return
    await act(async () => {
        root.render(<><p>{user.text}</p><TimelineTurnWorkSummary key={mode} startedAt={at} completedAt={running ? null : new Date().toISOString()}
            displayMode={mode} running={running} collapseForTerminalResponse={work.terminalResponseVisible} outcome={work.outcome}
            renderChildren={() => <div data-action-evidence="true">Checking startup<br />Verifying title persistence<br />Running focused regressions</div>} />
            {text ? <article data-final-response="true">{text}</article> : null}</>)
        await wait()
    })
}
async function run() {
    for (const mode of ['minimal', 'detailed'] as const) {
        localStorage.setItem('zyra:assistant-work-expanded:v1', 'false')
        await render(mode, 'commentary', 'Inspecting startup now.')
        assert(button().disabled && button().getAttribute('aria-expanded') === 'true', 'ongoing-work preference keeps commentary expanded')
        await act(async () => { await wait(80) })
        assert(panel().getAttribute('data-state') === 'open', 'prior work is visibly expanded before the final phase')
        await render(mode, 'final_answer')
        assert(!button().disabled && button().getAttribute('aria-expanded') === 'false', 'final phase immediately collapses Work before text exists')
        assert(panel().getAttribute('data-state') === 'closed' && panel().getAttribute('aria-hidden') === 'true', 'real disclosure switches to its collapsed state')
        assert(!document.querySelector('[data-assistant-working-dots]') && button().textContent === 'Work', 'final-response Work header stops saying Working or animating while the owning turn remains live')
        await act(async () => { await wait(350) })
        assert(panel().getBoundingClientRect().height < 1, 'closed Work has zero rendered height after its animation')
        assert(!document.querySelector('[data-action-evidence]'), 'collapsed action content unmounts after the existing animation')
        await render(mode, 'final_answer', 'Startup is ready and titles now persist.')
        assert(document.querySelector('[data-final-response]')?.textContent === 'Startup is ready and titles now persist.', 'streamed final response is visible outside Work')
        await act(async () => { button().click(); await wait(80) })
        assert(button().getAttribute('aria-expanded') === 'true' && document.querySelector('[data-action-evidence]'), 'users can reopen Work while the final response streams')
        await render(mode, 'final_answer', 'Startup is ready and titles now persist. Checks passed.')
        assert(button().getAttribute('aria-expanded') === 'true', 'later final deltas preserve a manual reopen')
        await render(mode, 'final_answer', 'Startup is ready and titles now persist. Checks passed.', false)
        assert(!document.querySelector('[data-assistant-working-dots]'), 'only actual completion clears the turn activity indicator')
    }
    for (const text of ['', 'Here is the direct answer.']) {
        const messages = [user, { ...response, phase: 'final_answer' as const, text }]
        const rows = groupTimelineRowsIntoWorkSummaries({ rows: buildTimelineRows(getTimelineEntries(messages, []), true, at), messages,
            latestAssistantMessageId: response.id, latestTurnStartedAt: at, isWorking: true })
        await act(async () => {
            root.render(<>{rows.map(row => row.kind === 'message' ? <article key={row.id}>{row.message.text}</article>
                : row.kind === 'working' ? <TimelineWorkingIndicator key={row.id} startedAt={at} />
                    : row.kind === 'turn-work-summary' ? <TimelineTurnWorkSummary key={row.id} startedAt={at} completedAt={null}
                        running={row.running} collapseForTerminalResponse={row.terminalResponseVisible} hasWork={row.rows.length > 0} renderChildren={() => null} /> : null)}</>)
            await wait()
        })
        assert(!document.querySelector('[data-assistant-working-indicator], [data-assistant-work-summary-shell], [data-assistant-working-dots]'), 'final-only replies render without waiting chrome or an empty Work disclosure')
        if (text) assert(container.textContent?.includes(text), 'the direct answer is visible while its owning turn is still running')
    }
    await act(async () => { await wait(350) })
    console.log('Final response disclosure: final phase collapse before text, animated zero height, reopen, both modes and live turn preserved: ok')
}
void run().catch(error => { (globalThis as any).__testFailed = String(error); console.error(error) })
