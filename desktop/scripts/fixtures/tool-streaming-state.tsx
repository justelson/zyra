import { flushSync } from 'react-dom'
import { createRef } from 'react'
import type { Root } from 'react-dom/client'
import { TimelineToolCallList } from '../../src/renderer/src/pages/assistant/AssistantTimelineToolCalls'
import { AssistantTimeline } from '../../src/renderer/src/pages/assistant/AssistantTimeline'
import type { AssistantActivity, AssistantMessage } from '../../src/shared/assistant/contracts'

const wait = (ms = 80) => new Promise(resolve => setTimeout(resolve, ms))
const check = (value: unknown, message: string) => { if (!value) throw new Error(message) }
const command = (id: string, status = 'completed', output = 'Captured fixture output'): AssistantActivity => ({
    id, kind: 'command', tone: 'tool', turnId: 'stream-turn', createdAt: '2026-11-06T12:00:00Z', summary: 'Fixture command',
    payload: { toolName: 'exec_command', command: 'echo fixture', status, output, actionBatchIntent: 'Checking actions' }
})
const control = (id: string): AssistantActivity => ({ ...command(id), kind: 'browser-control', payload: {
    toolName: 'browser_act', args: { action: { type: 'click' } }, status: 'completed', output: 'Control fixture details'
} })

export async function checkToolStreamingState(root: Root): Promise<string[]> {
    const render = async (activities: AssistantActivity[]) => {
        flushSync(() => root.render(<TimelineToolCallList activities={activities} toolOutputDefaultMode="collapsed" />))
        await wait()
    }
    const batch = () => document.querySelector<HTMLButtonElement>('[data-assistant-action-batch-trigger]')
    const tool = () => document.querySelector<HTMLButtonElement>('[data-assistant-tool-call] > button')
    const outputOpen = () => tool()?.nextElementSibling?.getAttribute('data-state') === 'open'
    const click = async (node: HTMLElement | null) => { check(node, 'Expected an interactive disclosure'); node!.click(); await wait(300) }
    const a = command('stream-a', 'running', Array.from({ length: 150 }, (_, i) => `Captured fixture output ${i}`).join('\n'))
    const b = command('stream-b')
    await render([a, b]); await click(batch()); await click(tool())
    const button = tool()!; button.focus()
    const textSpan = document.querySelector('[data-assistant-tool-call] pre > span')!
    const textNode = textSpan.firstChild instanceof Text ? textSpan.firstChild : textSpan.firstChild!.firstChild!
    const viewport = textSpan.closest('pre')!.parentElement!
    // Force a bounded viewport even when the harness uses scoped Tailwind scanning.
    viewport.style.maxHeight = '120px'
    viewport.scrollTop = 0
    viewport.dispatchEvent(new Event('scroll'))
    check(viewport.scrollHeight > viewport.clientHeight, 'The output fixture must actually overflow')
    const range = document.createRange(); range.setStart(textNode, 10); range.setEnd(textNode, 35)
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range)
    const selected = window.getSelection()!.toString()
    const updated = { ...a, payload: { ...a.payload, output: `${a.payload!.output}\nNew captured chunk` } }
    await render([updated, b])
    check(tool() === button && document.activeElement === button && outputOpen(), 'Output chunks preserve the open tool and keyboard focus')
    check(textNode.isConnected && window.getSelection()!.toString() === selected, 'Output chunks preserve the selected text node and selection')
    check(viewport.scrollTop === 0, 'Output chunks preserve a reader scrolled away from the tail')
    window.getSelection()!.removeAllRanges()
    viewport.scrollTop = viewport.scrollHeight; viewport.dispatchEvent(new Event('scroll'))
    await render([{ ...updated, payload: { ...updated.payload, output: `${updated.payload.output}\nTail chunk` } }, b])
    check(viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop < 2, 'Output continues following when the reader returns to the tail')
    await render([command(a.id, 'completed', String(updated.payload.output)), b]); await wait(650)
    check(tool() === button && outputOpen(), 'Completing a manually opened command preserves its disclosure')
    await click(tool()); await render([command(a.id, 'failed'), b]); await wait(650)
    check(!outputOpen(), 'A manually closed output stays closed on later status updates')

    await render([])
    flushSync(() => root.render(<TimelineToolCallList activities={[a]} toolOutputDefaultMode="expanded" />))
    await wait()
    check(outputOpen(), 'An untouched live command still follows the expanded output setting')
    flushSync(() => root.render(<TimelineToolCallList activities={[command(a.id)]} toolOutputDefaultMode="expanded" />))
    await wait(650)
    check(!outputOpen(), 'An untouched auto-expanded command retains normal completion collapse')

    await render([]); await render([a]); await render([command(a.id)])
    await click(tool()); await wait(600)
    check(outputOpen(), 'Opening output during the completion delay cancels its pending automatic collapse')

    await render([]); await render([a]); await click(tool())
    const single = tool()!; single.focus()
    await render([a, b])
    check(tool() === single && document.activeElement === single && outputOpen(), 'A second ordinary action preserves the tool DOM, open state and focus')
    check(batch()?.getAttribute('aria-expanded') === 'true', 'A new group preserves its actively read child')
    await render([a, b, command('stream-c')])
    check(tool() === single && outputOpen(), 'Further ordinary actions preserve the existing open tool')

    await render([]); await render([control('control-one'), control('control-two')]); await click(batch())
    const oldBatch = batch()!; oldBatch.focus()
    await render([control('control-one'), control('control-two'), b])
    check(oldBatch.isConnected && oldBatch.getAttribute('aria-expanded') === 'true' && document.activeElement === oldBatch, 'A new outer group preserves an expanded control group and focus')
    check(batch()?.getAttribute('aria-expanded') === 'true', 'A new outer group keeps an actively read control group visible')

    await render([]); await render([control('single-control')])
    const singleControl = document.querySelector<HTMLButtonElement>('[data-assistant-typed-action] button')!
    await click(singleControl); singleControl.focus()
    await render([control('single-control'), control('next-control')])
    check(document.querySelector('[data-assistant-typed-action] button') === singleControl && singleControl.getAttribute('aria-expanded') === 'true' && document.activeElement === singleControl, 'Growing a single browser action into a control group preserves its open details and focus')

    const messages: AssistantMessage[] = [{ id: 'stream-prompt', role: 'user', text: 'Run fixture actions', turnId: 'stream-turn', timelineSequence: 1, createdAt: '2026-11-06T11:59:59Z', updatedAt: '2026-11-06T11:59:59Z' }]
    const scrollContainerRef = createRef<HTMLDivElement>()
    const renderTimeline = async (activities: AssistantActivity[], timelineMessages = messages) => {
        flushSync(() => root.render(<div style={{ height: 720, width: 900 }}><textarea id="stream-draft" defaultValue="Keep this draft" /><iframe id="stream-page" title="Synthetic browser page" /><AssistantTimeline threadId="stream-fixture" windowKey="stream-fixture" isWorking messages={timelineMessages} activities={activities} assistantToolOutputDefaultMode="collapsed" scrollContainerRef={scrollContainerRef} /></div>))
        await wait(500)
    }
    await renderTimeline([a]); await click(tool())
    const fullSingle = tool()!; fullSingle.focus()
    const fullText = document.querySelector('[data-assistant-tool-call] pre > span > span')!.firstChild!
    const fullRange = document.createRange(); fullRange.setStart(fullText, 10); fullRange.setEnd(fullText, 35)
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(fullRange)
    const fullSelected = window.getSelection()!.toString()
    const work = document.querySelector('[data-assistant-work-summary-shell] button[aria-controls]')
    await renderTimeline([b, a]) // Store activities arrive newest first.
    check(document.querySelector('[data-assistant-work-summary-shell] button[aria-controls]') === work, 'The full timeline preserves its Work shell')
    check(tool() === fullSingle && outputOpen() && document.activeElement === fullSingle, 'The full timeline preserves tool identity, disclosure and focus through single-to-group growth')
    check(fullText.isConnected && window.getSelection()!.toString() === fullSelected, 'Full timeline grouping preserves the active output text selection')
    const correction: AssistantMessage = { ...messages[0]!, id: 'live-steering', text: 'Keep the current tool open while steering', createdAt: '2026-11-06T12:00:01Z', updatedAt: '2026-11-06T12:00:01Z', timelineSequence: 3 }
    await renderTimeline([b, a], [...messages, correction])
    check(document.querySelectorAll('[data-assistant-work-summary-shell]').length === 1 && document.querySelector('[data-assistant-work-summary-shell] button[aria-controls]') === work, 'Steering retains the original single Work shell and timer')
    check(work!.closest('[data-assistant-work-summary-shell]')?.textContent?.includes(correction.text), 'The actual steering user bubble appears chronologically within the existing Work section')
    check(tool() === fullSingle && outputOpen() && document.activeElement === fullSingle, 'Steering preserves open tools and keyboard focus')
    check(fullText.isConnected && window.getSelection()!.toString() === fullSelected, 'Steering preserves the text selection inside ongoing work')
    const afterSteer = { ...command('after-live-steering'), createdAt: '2026-11-06T12:00:02Z', timelineSequence: 4 }
    await renderTimeline([afterSteer, b, a], [...messages, correction])
    check(document.querySelectorAll('[data-assistant-work-summary-shell]').length === 1 && tool() === fullSingle && outputOpen(), 'Tool actions arriving after steering continue inside the same open work')
    window.getSelection()!.removeAllRanges()
    const draft = document.getElementById('stream-draft') as HTMLTextAreaElement
    draft.focus(); draft.setSelectionRange(2, 6)
    for (let chunk = 0; chunk < 8; chunk++) {
        await renderTimeline([{ ...afterSteer, payload: { ...afterSteer.payload, output: `Streaming chunk ${chunk}`, status: chunk === 7 ? 'completed' : 'running' } }, b, a], [...messages, correction])
        check(document.activeElement === draft && draft.selectionStart === 2 && draft.selectionEnd === 6 && draft.value === 'Keep this draft', 'Streaming tools cannot disturb the active composer, draft or selection')
    }
    const page = document.getElementById('stream-page') as HTMLIFrameElement
    page.contentDocument!.body.innerHTML = '<input id="page-draft" value="Browser draft">'
    const pageDraft = page.contentDocument!.getElementById('page-draft') as HTMLInputElement
    pageDraft.focus(); pageDraft.setSelectionRange(1, 4)
    await renderTimeline([command('arriving-command', 'running'), afterSteer, b, a], [...messages, correction])
    check(document.activeElement === page && page.contentDocument!.activeElement === pageDraft && pageDraft.selectionStart === 1 && pageDraft.selectionEnd === 4, 'New tool calls cannot move focus or selection out of the Browser page')
    return ['Streaming tool updates preserve disclosure, selection, focus and reader-owned output scrolling through list and full timeline grouping transitions', 'Mid-turn user steering retains one original Work shell, chronological bubbles, open tools, focus and selection as actions continue']
}
