import React, { act, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { FileText, SquareTerminal } from 'lucide-react'
import { AssistantTimelineActionShell } from '../../src/renderer/src/pages/assistant/AssistantTimelineActionShell'
import { AssistantTimelineActionBatch } from '../../src/renderer/src/pages/assistant/AssistantTimelineActionBatch'
import type { AssistantActivity } from '../../src/shared/assistant/contracts'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const nativeMatchMedia = window.matchMedia.bind(window)
// Both motion modes are explicit; hosted Windows may prefer reduced motion.
let systemReducedMotion = false
window.matchMedia = query => {
    const media = nativeMatchMedia(query)
    if (query === '(prefers-reduced-motion: reduce)') Object.defineProperty(media, 'matches', { value: systemReducedMotion })
    return media
}
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message) }
const wait = (ms = 80) => new Promise(resolve => setTimeout(resolve, ms))
const host = document.createElement('main')
host.style.cssText = 'width:min(760px,100%);margin:40px auto;padding:0 16px'
document.body.append(host)
const root = createRoot(host)
let activities: AssistantActivity[] = [
    { id: 'edit', kind: 'file-change', tone: 'tool', summary: 'Edited settings', createdAt: '2026-09-29T12:00:00Z', payload: { additions: 34, deletions: 12, status: 'completed', actionBatchIntent: 'Updating settings presentation' } },
    { id: 'check', kind: 'command', tone: 'tool', summary: 'Checked changes', createdAt: '2026-09-29T12:00:00Z', payload: { command: 'bun test', status: 'completed' } }
]
const animationCalls: Array<{ frames: unknown; options: unknown }> = []
let renderedLists = 0
let mountedDetails = 0
function Details() {
    useEffect(() => { mountedDetails++; return () => { mountedDetails-- } }, [])
    return <div data-on-demand-detail>Captured output</div>
}
function Action({ index }: { index: number }) {
    const [expanded, setExpanded] = useState(false)
    return <AssistantTimelineActionShell activityId={`fixture:${index}`} icon={index % 2 ? <SquareTerminal size={13} /> : <FileText size={13} />}
        title={index % 2 ? 'Running tests' : `Reading action-${index}.tsx`} status="success" createdAt="2026-09-29T12:00:00Z"
        expandable expanded={expanded} onToggle={() => setExpanded(value => !value)}><Details /></AssistantTimelineActionShell>
}
const nativeAnimate = Element.prototype.animate
Element.prototype.animate = function (frames, options) {
    animationCalls.push({ frames, options })
    return nativeAnimate.call(this, frames, options)
}
const render = async (count: number) => {
    await act(async () => { root.render(<AssistantTimelineActionBatch activities={activities}>
        {() => { renderedLists++; return Array.from({ length: count }, (_, index) => <div key={index} data-action-row={index}>
            <Action index={index} />
        </div>) }}
    </AssistantTimelineActionBatch>) })
    await act(async () => { await wait() })
}
const viewport = () => document.querySelector<HTMLDivElement>('[data-assistant-action-batch-scroll]')!
const trigger = () => document.querySelector<HTMLButtonElement>('[data-assistant-action-batch-trigger]')!
const scroll = async (top: number) => {
    await act(async () => { viewport().scrollTop = top; viewport().dispatchEvent(new Event('scroll', { bubbles: true })); await wait() })
}
async function run() {
    await render(160)
    assert(trigger().getAttribute('aria-expanded') === 'false', 'batch starts collapsed')
    assert(trigger().querySelector('[data-diff-additions="34"][data-diff-deletions="12"]'), 'collapsed heading exposes colored edit totals')
    assert(!viewport() && renderedLists === 0, 'collapsed batch never builds or mounts its tool list')
    assert(animationCalls.length === 0, 'initial counter mount is steady, without an entrance animation')
    activities = activities.map(entry => entry.id === 'edit' ? { ...entry, payload: { ...entry.payload, additions: 87, deletions: 23 } } : entry)
    await render(160)
    assert(animationCalls.length === 4, `both totals roll and fade their outgoing and incoming values (calls=${animationCalls.length}, reducedMotion=${matchMedia('(prefers-reduced-motion: reduce)').matches})`)
    assert(animationCalls.every(call => (call.options as KeyframeAnimationOptions).duration === 220), 'counter animation is short and consistent')
    assert(trigger().querySelector('[data-diff-additions="87"][data-diff-deletions="23"]'), 'accessible totals immediately reflect the real values')
    assert(trigger().querySelector('[data-rolling-diff-number="87"]')?.textContent === '3487', 'the outgoing value is retained only for the roll')
    await render(160)
    assert(animationCalls.length === 4, 'unchanged totals do not restart animations')
    activities = activities.map(entry => entry.id === 'edit' ? { ...entry, payload: { ...entry.payload, additions: 102, deletions: 27 } } : entry)
    await render(160)
    assert(animationCalls.length === 8, 'rapid updates retarget instead of queueing old totals')
    document.body.classList.add('zyra-reduce-motion')
    activities = activities.map(entry => entry.id === 'edit' ? { ...entry, payload: { ...entry.payload, additions: 103, deletions: 28 } } : entry)
    await render(160)
    assert(animationCalls.length === 8, 'app reduced-motion mode updates totals without animation')
    document.body.classList.remove('zyra-reduce-motion')
    systemReducedMotion = true
    activities = activities.map(entry => entry.id === 'edit' ? { ...entry, payload: { ...entry.payload, additions: 104, deletions: 29 } } : entry)
    await render(160)
    assert(animationCalls.length === 8, 'system reduced-motion preference is honored')
    systemReducedMotion = false
    await act(async () => { trigger().click() })
    await act(async () => { await wait(300) })
    const cap = Math.min(256, innerHeight * 0.35)
    assert(viewport().clientHeight <= cap + 1 && viewport().clientHeight > 100, 'expanded viewport has a responsive height cap')
    assert(viewport().scrollHeight > viewport().clientHeight, 'long lists scroll internally')
    assert(document.querySelectorAll('[data-action-row]').length === 160, 'every action is retained')
    assert(mountedDetails === 0, 'opening the list leaves every deeper detail unmounted')
    const detailTrigger = document.querySelector<HTMLButtonElement>('[data-action-row="0"] button')!
    await act(async () => { detailTrigger.click() })
    assert(mountedDetails === 1, 'opening one action mounts only its own details')
    await act(async () => { detailTrigger.click() })
    await act(async () => { await wait(300) })
    assert(mountedDetails === 0, 'closing details releases them after the exit animation')
    const rowElements = Array.from(document.querySelectorAll<HTMLElement>('[data-action-row]'))
    const referenceIcon = rowElements[0]!.querySelector('[data-assistant-action-icon]')!.getBoundingClientRect()
    const referenceTitle = rowElements[0]!.querySelector('[data-assistant-action-title]')!.getBoundingClientRect()
    for (const row of rowElements.slice(0, 12)) {
        const icon = row.querySelector('[data-assistant-action-icon]')!.getBoundingClientRect()
        const title = row.querySelector('[data-assistant-action-title]')!.getBoundingClientRect()
        assert(icon.width === 16 && icon.height === 16, 'all icons share a fixed 16px slot')
        assert(Math.abs(icon.left - referenceIcon.left) < 0.5 && Math.abs(title.left - referenceTitle.left) < 0.5, 'icons and titles have identical left edges')
        assert(Math.abs((icon.top + icon.height / 2) - (title.top + title.height / 2)) < 0.5, 'icons and labels are vertically centered together')
    }
    assert(getComputedStyle(viewport()).overflowY === 'auto', 'scrollbar is native overflow')
    assert(getComputedStyle(viewport()).overscrollBehaviorY === 'contain', 'scrolling does not chain into the conversation')
    assert(viewport().dataset.scrollFadeTop === 'false' && viewport().dataset.scrollFadeBottom === 'true', 'at start only the bottom edge fades')
    assert(getComputedStyle(viewport()).maskImage !== 'none', 'overflow actually renders a mask')
    await scroll(200)
    assert(viewport().dataset.scrollFadeTop === 'true' && viewport().dataset.scrollFadeBottom === 'true', 'middle fades both offscreen edges')
    const pageScroll = window.scrollY
    await scroll(viewport().scrollHeight)
    assert(viewport().dataset.scrollFadeTop === 'true' && viewport().dataset.scrollFadeBottom === 'false', 'at end only the top edge fades')
    assert(window.scrollY === pageScroll, 'internal scroll leaves page position alone')
    const last = document.querySelector('[data-action-row="159"]')!.getBoundingClientRect()
    const bounds = viewport().getBoundingClientRect()
    assert(last.bottom <= bounds.bottom + 1 && last.top >= bounds.top, 'last action is reachable without paging')
    const beforeAppend = viewport().scrollTop
    await render(180)
    assert(Math.abs(viewport().scrollTop - beforeAppend) <= 1, 'appending does not yank the current scroll position')
    assert(viewport().dataset.scrollFadeBottom === 'true', 'new content restores the bottom fade')
    host.style.width = '320px'
    await act(async () => { await wait() })
    assert(viewport().scrollHeight > viewport().clientHeight, 'narrow wrapping remains scrollable')
    const stats = trigger().querySelector('[data-assistant-action-diff-stats]')!.getBoundingClientRect()
    const heading = trigger().getBoundingClientRect()
    assert(stats.right <= heading.right && stats.left >= heading.left, 'change totals stay inside narrow headers')
    await render(2)
    assert(viewport().clientHeight < cap, 'short lists retain natural height')
    assert(viewport().dataset.scrollFadeTop === 'false' && viewport().dataset.scrollFadeBottom === 'false', 'non-overflowing lists have no fades')
    assert(getComputedStyle(viewport()).maskImage === 'none', 'short content is not masked')
    await act(async () => { trigger().click(); await wait(300) })
    assert(!viewport(), 'collapse releases the tool list after its exit animation')
    await act(async () => { trigger().click(); await wait(300) })
    assert(!viewport().closest('[inert]'), 'reopening restores keyboard access')
    await render(160)
    host.style.width = '760px'
    await act(async () => { await wait() })
    await scroll(300)
    ;(globalThis as any).__actionBatchReady = true
    console.log('Action batch scroll: bounded full list, aligned rows, rolling totals, reduced motion, directional fades and live growth: ok')
}
void run().catch(error => { (globalThis as any).__testFailed = String(error); console.error(error) })
