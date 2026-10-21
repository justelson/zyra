import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { AssistantCitationSelection } from '../../src/renderer/src/pages/assistant/AssistantCitationSelection'
import { AssistantCitationChip } from '../../src/renderer/src/pages/assistant/AssistantCitationChip'
import { subscribeCodeContext } from '../../src/renderer/src/pages/assistant/assistant-code-context'
import { assistantCitationSourceHref } from '../../src/renderer/src/pages/assistant/assistant-citations'
import { useAssistantCitationNavigation } from '../../src/renderer/src/pages/assistant/useAssistantCitationNavigation'
import { assistantCitationFingerprint } from '../../src/shared/assistant/assistant-citations'
import type { ComposerContextFile } from '../../src/renderer/src/pages/assistant/assistant-composer-types'

const w = window as any
const sleep = (ms = 25) => new Promise(resolve => setTimeout(resolve, ms))
function check(value: unknown, label: string): asserts value { if (!value) throw new Error(label) }
async function waitFor(test: () => unknown, label: string) { for (let n = 0; n < 160; n++) { if (test()) return; await sleep() }; throw new Error(label) }
async function click(element: HTMLElement) {
    const rect = element.getBoundingClientRect()
    const request = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, done: false }
    w.__pointer = request
    await waitFor(() => request.done, 'Hidden Electron delivered citation click')
}
const prefix = 'Before: ', quote = 'Keep this exact quoted passage.', suffix = ' After.'
let captured: ComposerContextFile | undefined
let updated: ComposerContextFile | undefined
let setFile: (file: ComposerContextFile | undefined) => void
let locationState: ReturnType<typeof useLocation>
const unavailable = (message: string) => { w.__citationUnavailable = message }
function View() {
    const [file, updateFile] = useState<ComposerContextFile>()
    setFile = updateFile
    locationState = useLocation()
    const atSource = locationState.pathname.startsWith('/assistant/chat/source-chat')
    useAssistantCitationNavigation(locationState, atSource ? 'source-chat' : 'target-chat', atSource ? 'source-thread' : 'target-thread', unavailable)
    return <div style={{ padding: 24, width: 500 }}>
        <AssistantCitationSelection messageId="message-source"><p id="response">{prefix}<strong>{quote}</strong>{suffix}</p></AssistantCitationSelection>
        {/* Deliberately isolated draft state; full production composer is outside this UI fixture. */}
        <textarea id="draft" aria-label="Draft" defaultValue="Keep my unsent draft" />
        {file && <div id="chip"><AssistantCitationChip file={file} onUpdate={next => { updated = next; updateFile(next) }} onRemove={() => updateFile(undefined)} /></div>}
    </div>
}
w.__selectionUICheck = (async () => {
    w.__fixtureSnapshot = { selectedSessionId: 'target-chat', sessions: [{ id: 'source-chat', threads: [{ id: 'source-thread', messages: [{ id: 'message-source', role: 'assistant', text: '**Markdown source differs from rendered text**' }] }] }] }
    const root = createRoot(document.getElementById('root')!)
    const stop = subscribeCodeContext('target-chat', file => { captured = file; setFile(file) })
    const wrong: ComposerContextFile[] = []
    const stopWrong = subscribeCodeContext('later-chat', file => wrong.push(file))
    try {
        flushSync(() => root.render(<MemoryRouter><View /></MemoryRouter>))
        await sleep(100)
        const response = document.querySelector<HTMLElement>('#response')!
        const text = response.querySelector('strong')!.firstChild!
        const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, quote.length)
        const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range)
        response.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, pointerType: 'mouse' }))
        await waitFor(() => document.querySelector('[data-citation-controls] button'), 'Actual DOM Range and pointerup expose Cite')
        // Destination is captured at selection time, before a subsequent chat switch.
        w.__fixtureSnapshot.selectedSessionId = 'later-chat'
        await click(document.querySelector<HTMLButtonElement>('[data-citation-controls] button')!)
        await waitFor(() => captured && document.querySelector('#chip'), 'Real context pipeline delivers citation chip')
        const citation = captured!.citation!
        check(wrong.length === 0, 'Cite retains original target chat')
        check(citation.text === quote && citation.start === prefix.length && citation.end === prefix.length + quote.length, 'Exact rendered quote and offsets preserved')
        check(citation.prefix === prefix && citation.suffix === suffix && citation.sourceFingerprint === assistantCitationFingerprint(prefix + quote + suffix), 'Rendered response anchors and fingerprint captured')
        check(citation.sessionId === 'source-chat' && citation.threadId === 'source-thread' && citation.messageId === 'message-source', 'Source identity survives cross-chat citation')
        check(captured!.path === assistantCitationSourceHref(citation) && captured!.content?.includes('> ' + quote), 'Context file retains source URL and exact quote')
        check((document.querySelector('#draft') as HTMLTextAreaElement).value === 'Keep my unsent draft', 'Attaching citation leaves isolated unsent draft untouched')
        await click(document.querySelector<HTMLButtonElement>('#chip button[aria-expanded]')!)
        await waitFor(() => document.querySelector('#chip textarea'), 'Citation chip expands with comment editor')
        const input = document.querySelector<HTMLTextAreaElement>('#chip textarea')!
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'My passage comment')
        input.dispatchEvent(new Event('input', { bubbles: true }))
        await waitFor(() => updated?.citation?.comment === 'My passage comment', 'Actual controlled comment editor updates context')
        check(updated!.id === captured!.id && updated!.citation!.text === quote && updated!.content?.includes('User comment:\nMy passage comment'), 'Comment edit preserves file identity and quote; updates serialized context')
        await click(document.querySelector<HTMLAnchorElement>('#chip a')!)
        await waitFor(() => locationState.pathname === '/assistant/chat/source-chat/thread/source-thread', 'Source link navigates to exact source chat/thread')
        check(locationState.search === '?message=message-source' && locationState.state?.assistantCitation?.text === quote && locationState.state.assistantCitation.comment === 'My passage comment', 'Source link carries message and edited citation navigation state')
        await waitFor(() => (CSS as any).highlights?.get('zyra-citation'), 'Source navigation highlights the exact rendered passage')
        const highlighted = () => [...((CSS as any).highlights.get('zyra-citation') || [])] as Range[]
        check(highlighted()[0]?.toString() === quote && highlighted()[0].startContainer.isConnected, 'Live highlight range addresses the exact source quote')
        const replacement = document.createElement('strong'); replacement.textContent = quote
        response.replaceChildren(document.createTextNode(prefix), replacement, document.createTextNode(suffix))
        await waitFor(() => highlighted()[0]?.startContainer === replacement.firstChild, 'Lazy-render node replacement refreshes highlight without stale detached ranges')
        check(highlighted()[0].toString() === quote, 'Highlight survives DOM replacement with exact text')
        await click(document.querySelector<HTMLButtonElement>('#chip button[aria-label="Remove citation"]')!)
        await waitFor(() => !document.querySelector('#chip'), 'Remove callback removes citation chip')
        check((document.querySelector('#draft') as HTMLTextAreaElement).value === 'Keep my unsent draft', 'Removing citation preserves isolated draft')
        return ['actual response DOM Range → pointerup → native Cite click → real context subscription: exact quote/source/anchors and original target chat', 'actual citation chip expansion, controlled comment edit, serialized context update, source-link route/state, exact CSS passage highlight across lazy DOM replacement and removal; isolated draft unchanged']
    } finally { stop(); stopWrong(); root.unmount() }
})()
