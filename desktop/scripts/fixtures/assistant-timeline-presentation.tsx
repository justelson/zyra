import { createRef, type ComponentProps } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import type { LegendListRef } from '@legendapp/list/react'
import { AssistantVirtualTimeline } from '../../src/renderer/src/pages/assistant/AssistantVirtualTimeline'
import type { TimelineDisplayRow } from '../../src/renderer/src/pages/assistant/assistant-timeline-helpers'

const container = document.getElementById('root')!
const root = createRoot(container)
const listRef = createRef<LegendListRef>()
const scrollContainerRef = createRef<HTMLDivElement>()
const results: string[] = []
type TimelineProps = ComponentProps<typeof AssistantVirtualTimeline>
const pause = () => new Promise<void>(resolve => setTimeout(resolve, 20))

function check(condition: boolean, label: string) {
    if (!condition) throw new Error(label)
}

async function waitFor(condition: () => boolean, label: string) {
    const deadline = performance.now() + 2_000
    while (!condition() && performance.now() < deadline) await pause()
    check(condition(), label)
}

function rows(key: string): TimelineDisplayRow[] {
    return (['user', 'assistant'] as const).map(role => {
        const id = `${key}-${role}`
        const createdAt = '2026-01-01T00:00:00.000Z'
        return {
            id, kind: 'message', createdAt,
            message: { id, role, text: `${role} greeting`, turnId: key, streaming: false, createdAt, updatedAt: createdAt }
        }
    })
}

function render(key: string, overrides: Partial<TimelineProps> = {}) {
    flushSync(() => root.render(<AssistantVirtualTimeline
        rows={rows(key)} windowKey={key} listRef={listRef} scrollContainerRef={scrollContainerRef}
        contentInsetEndAdjustment={0} isWorking={false} selectionHydrating={false} coldStart
        hasOlder={false} hasNewer={false} loadingOlder={false} loadingNewer={false}
        loadOlderError={null} loadNewerError={null} onLoadOlder={() => false}
        renderRow={row => row.kind === 'message' ? <p>{row.message.text}</p> : null}
        {...overrides}
    />))
}

function loading() {
    return container.textContent?.includes('Loading chat') === true
}

async function expectVisible(key: string, label: string) {
    await waitFor(() => {
        const message = container.querySelector(`[data-assistant-timeline-row-id="${key}-assistant"]`)
        return Boolean(message && getComputedStyle(message).visibility === 'visible' && !loading())
    }, label)
    results.push(label)
}

async function run() {
    // Real React, LegendList, layout and animation frames; no mocked readiness state.
    render('first')
    await expectVisible('first', 'A cold one-turn chat reveals without a further render or user input')
    const originalList = listRef.current

    render('second')
    await expectVisible('second', 'Switching the reused timeline completes the new presentation')
    check(originalList === listRef.current, 'Chat switching must preserve the virtual list instance')

    render('hydrating', { rows: [], selectionHydrating: true })
    await pause()
    check(loading(), 'A chat with pending hydration stays in its loading presentation')
    render('hydrating')
    await expectVisible('hydrating', 'Delayed hydration reveals the newly received messages')

    let pageRequests = 0
    let resolvePage!: (accepted: boolean) => void
    const page = new Promise<boolean>(resolve => { resolvePage = resolve })
    render('paging', { hasOlder: true, onLoadOlder: () => { pageRequests++; return page } })
    await waitFor(() => pageRequests === 1, 'The underfilled initial viewport requests older history')
    check(loading(), 'Initial paging keeps the incomplete one-turn view hidden')
    render('paging', { rows: [...rows('older'), ...rows('paging')] })
    resolvePage(true)
    await expectVisible('paging', 'The completed initial page reveals the filled timeline')
    check(pageRequests === 1, 'Initial history requests cannot overlap')

    render('failed-page', { hasOlder: true, onLoadOlder: async () => { throw new Error('Page unavailable') } })
    await expectVisible('failed-page', 'A failed older page still reveals the available messages')

    let resolveAbandonedPage!: (accepted: boolean) => void
    let abandonedPageStarted = false
    const abandonedPage = new Promise<boolean>(resolve => { resolveAbandonedPage = resolve })
    render('abandoned', { hasOlder: true, onLoadOlder: () => { abandonedPageStarted = true; return abandonedPage } })
    await waitFor(() => abandonedPageStarted, 'The old chat starts paging')
    render('current', { rows: [], selectionHydrating: true })
    resolveAbandonedPage(true)
    await pause()
    check(loading(), 'An abandoned page cannot reveal the next chat before it hydrates')
    render('current')
    await expectVisible('current', 'Navigation during paging leaves the current chat usable')
    root.unmount()
    return results
}

Object.assign(window, { timelinePresentationCheck: run() })
