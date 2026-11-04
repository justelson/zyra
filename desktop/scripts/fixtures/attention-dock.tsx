import { answer, approval, button, check, click, createPaneFixture, editor, request, sleep, typeAnswer, typeMessage, wait } from './chat-interactions'
import { readAssistantComposerSessionState, writeAssistantComposerSessionState } from '../../src/renderer/src/pages/assistant/assistant-composer-session-state'

let microphoneStarts = 0, microphoneStops = 0, transcriptionCalls = 0
let processor: { onaudioprocess?: (event: unknown) => void } | null = null
let releaseTranscript: ((value: unknown) => void) | null = null
class AudioContextFixture {
    sampleRate = 24000; destination = {}
    resume() { return Promise.resolve() }
    close() { return Promise.resolve() }
    createMediaStreamSource() { return { connect() {}, disconnect() {} } }
    createScriptProcessor() { processor = { connect() {}, disconnect() {}, onaudioprocess: null } as any; return processor }
    createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} } }
}
;(window as any).AudioContext = AudioContextFixture
Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => { microphoneStarts++; return { getTracks: () => [{ stop() { microphoneStops++ } }] } } } })
;(window as any).devscope = { assistant: {
    listPromptResources: async () => ({ success: true, commands: [], skills: [], diagnostics: [] }),
    getVoiceTranscriptionState: async () => ({ success: true, available: true, signedIn: true, provider: 'codex', status: 'ready' }),
    transcribeVoice: async () => { transcriptionCalls++; return new Promise(resolve => { releaseTranscript = resolve }) },
    cancelVoiceTranscription: async () => ({ success: true, cancelled: true }),
    updateSessionConfiguration: async () => ({ success: true }),
} }
const frameCount = () => document.querySelectorAll('[data-assistant-composer-frame="true"]').length
const startVoice = async () => {
    await click('Start voice input')
    await wait(() => Boolean(document.querySelector('[aria-label="Voice note recorder"]')), 'The shared recorder opens')
    processor!.onaudioprocess!({ inputBuffer: { numberOfChannels: 1, length: 4096, getChannelData: () => new Float32Array(4096).fill(.1) } })
}
;(window as any).attentionDockCheck = async () => {
    localStorage.clear()
    const file = { id: 'draft-file', path: '/fixture/draft.txt', name: 'draft.txt', kind: 'file' as const, source: 'manual' as const }
    writeAssistantComposerSessionState('attention-chat', { draft: 'Retained original', contextFiles: [file], model: 'fixture/model', runtimeMode: 'full-access', effort: 'medium' })
    const fixture = createPaneFixture()
    fixture.render(); await sleep(); await sleep()
    await typeMessage('Immediate unsaved message')
    editor()!.focus()
    const focused = document.activeElement
    fixture.render({ pendingUserInputs: [request('async-one'), request('async-two')], thinking: true })
    await sleep(); await sleep()
    check(document.activeElement === focused && !answer(), 'Async arrival cannot steal focus or mount an answer composer')
    check(frameCount() === 1 && editor()?.textContent === 'Immediate unsaved message', 'Arrival leaves one editable message dock and the exact draft')
    check(editor()?.getAttribute('aria-disabled') !== 'true', 'Answer-later does not block message composition')
    check(document.body.textContent?.includes('Agent is continuing') && document.body.textContent?.includes('2 requests'), 'Continuing state and queued request count are visible')
    check(fixture.responses.length === 0 && fixture.decisions.length === 0, 'Mounting never submits an answer or permission decision')
    const emptyQueue = document.querySelector('[aria-label="Queued messages"]')?.closest<HTMLElement>('[data-state="closed"]')
    check(!emptyQueue || getComputedStyle(emptyQueue).marginBottom === '0px', 'An empty queue cannot alter attachment-only shelf spacing')

    fixture.render({ queuedMessageCount: 1, queuedMessages: [{ id: 'queued-draft', prompt: 'Original queue prompt', contextFiles: [], dispatchMode: 'queue', status: 'queued' }] })
    const queueCard = document.querySelector<HTMLElement>('[aria-label="Queued messages"]')!
    const attentionCard = document.querySelector<HTMLElement>('[data-assistant-async-question]')!
    await wait(() => {
        const shelf = document.querySelector<HTMLElement>('[data-assistant-attention-shelf]')!
        return shelf.getBoundingClientRect().height >= attentionCard.getBoundingClientRect().height + 16
            && queueCard.closest('[data-state]')!.getBoundingClientRect().height >= queueCard.getBoundingClientRect().height - .5
            && attentionCard.getBoundingClientRect().bottom <= queueCard.getBoundingClientRect().top + 1
    }, 'Real attention and queue drawer animations finish before measuring stacking')
    check(queueCard && attentionCard.getBoundingClientRect().bottom <= queueCard.getBoundingClientRect().top + 1, `Answer-later tray stays above the queue and attachment shelf without covering controls: ${JSON.stringify({ attention: attentionCard?.getBoundingClientRect().toJSON(), queue: queueCard?.getBoundingClientRect().toJSON(), shelf: document.querySelector('[data-assistant-attention-shelf]')?.getBoundingClientRect().toJSON(), bottom: getComputedStyle(document.querySelector('[data-assistant-attention-shelf]')!).bottom, offset: getComputedStyle(attentionCard).getPropertyValue('--assistant-attention-shelf-offset'), grid: [...document.querySelectorAll('[data-state]')].map(node => ({ state: node.getAttribute('data-state'), rows: getComputedStyle(node).gridTemplateRows, display: getComputedStyle(node).display, height: node.getBoundingClientRect().height, css: node.className })) })}`)
    check(queueCard.closest('[data-composer-drawer="true"]'), 'Queue shares the attached question/permission surface')
    const queueAction = queueCard.querySelector<HTMLButtonElement>('[aria-label="Edit queued message"]')!
    const actionBounds = queueAction.getBoundingClientRect()
    check(queueAction.contains(document.elementFromPoint(actionBounds.left + actionBounds.width / 2, actionBounds.top + actionBounds.height / 2)), 'Stacked question and drawer seam do not intercept queue actions')
    await click('Edit queued message')
    const queuedEditor = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Edit queued message"]')!
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(queuedEditor, 'Uncommitted queue edit')
    queuedEditor.dispatchEvent(new Event('input', { bubbles: true })); await sleep()
    await click('Answer')
    await wait(() => Boolean(answer()), 'Explicit Answer opens the existing question composer')
    check(frameCount() === 1 && !editor(), 'The active question is the only mounted composer, not a hidden duplicate')
    const saved = readAssistantComposerSessionState('attention-chat')
    check(saved.draft === 'Immediate unsaved message' && saved.contextFiles?.[0].id === file.id && saved.effort === 'medium', 'Opening flushes immediate draft, attachment and configuration')
    await typeAnswer('Partly answered')
    await click('Back to message')
    await wait(() => Boolean(editor()), 'Back returns to the message dock')
    check(frameCount() === 1 && editor()?.textContent === saved.draft, 'Back restores the ordinary draft')
    check(readAssistantComposerSessionState('attention-chat').contextFiles?.[0].id === file.id, 'Back retains ordinary attachments')
    check(document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Edit queued message"]')?.value === 'Uncommitted queue edit', 'Back also preserves an unsaved queued-message edit')
    check(fixture.props.queuedMessages[0].prompt === 'Original queue prompt', 'Opening a question never implicitly saves the queue edit')
    await click('Cancel')
    fixture.render({ queuedMessageCount: 0, queuedMessages: [] })
    await click('Answer'); await wait(() => answer()?.value === 'Partly answered', 'The question draft survives returning to chat')
    fixture.rejectAnswer(true)
    await click('Submit answer')
    await wait(() => document.body.textContent?.includes('Fixture answer failed') === true, 'Submission errors keep the dock and show feedback')
    check(answer()?.value === 'Partly answered' && frameCount() === 1, 'Failed answers stay editable')
    fixture.rejectAnswer(false)
    await click('Submit answer')
    await wait(() => Boolean(editor()) && !answer(), 'Successful answer returns to the message dock without opening the next request')
    check(fixture.responses.length === 1 && fixture.responses[0].id === 'async-one' && (fixture.responses[0].answers as any).target === 'Partly answered', 'Answer targets the actual request with the exact entered text')
    check(editor()?.textContent === saved.draft && fixture.props.pendingUserInputs[0].requestId === 'async-two', 'Submitting never sends or clears the unrelated message draft')
    fixture.render({ thinking: false }); await sleep()
    editor()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await wait(() => fixture.sends.length === 1, 'Ordinary Enter sends while an async request remains pending').catch(error => { throw new Error(`${error.message}: ${JSON.stringify({ blocked: fixture.blockedSends, editor: editor()?.outerHTML, status: [...document.querySelectorAll('[role="status"]')].map(node => node.textContent) })}`) })
    check(fixture.responses.length === 1 && fixture.props.pendingUserInputs[0].requestId === 'async-two', 'Ordinary Send cannot answer or dismiss the pending question')
    await typeMessage('Continue my message')
    fixture.rejectDismiss(true)
    await click('Dismiss')
    await wait(() => document.body.textContent?.includes('Fixture dismiss failed') === true, 'Dismissal errors are visible')
    fixture.rejectDismiss(false); await click('Dismiss')
    check(fixture.dismissals[0] === 'async-two' && !document.querySelector('[data-assistant-async-question]'), 'Dismiss targets only the current request')

    // Switching the visible dock releases capture; a durable Chat transcript can
    // finish in its original saved draft, never in the active question answer.
    fixture.render({ pendingUserInputs: [request('voice-question')], thinking: false }); await sleep()
    await startVoice()
    await click('Answer')
    await wait(() => Boolean(answer()) && microphoneStops === microphoneStarts, 'Opening a question stops ordinary microphone capture')
    await wait(() => Boolean(releaseTranscript), 'Detached Chat dictation retains its existing durable transcription job')
    releaseTranscript!({ success: true, text: 'original chat speech' })
    await sleep(); await sleep()
    check(answer()?.value === '', 'Late ordinary dictation cannot enter the answer')
    await typeAnswer('Question voice draft')
    await startVoice()
    const callsBeforeBack = transcriptionCalls
    await click('Back to message')
    await wait(() => Boolean(editor()) && microphoneStops === microphoneStarts, 'Back stops question capture instead of hiding a recorder')
    check(transcriptionCalls === callsBeforeBack && !document.querySelector('[aria-label="Voice note recorder"]'), 'Question cleanup cancels capture without transcribing a hidden answer')
    check(editor()?.textContent?.includes('original chat speech'), 'The ordinary transcript returns to its original draft')
    await click('Answer'); await wait(() => answer()?.value === 'Question voice draft', 'Question text survives microphone cancellation')
    fixture.render({ selectedSessionId: 'other-chat' }); await sleep(); await sleep()
    check(!answer() && frameCount() === 1, 'Session changes close an active answer dock without auto-opening its request')
    fixture.render({ selectedSessionId: 'attention-chat' }); await sleep(); await sleep()
    check(!answer(), 'Returning to a chat does not automatically steal focus into its question')

    fixture.render({ pendingApprovals: [approval] }); await sleep(); await sleep()
    check(document.querySelector('[data-permission-tray] [role="status"]') && document.querySelector('[data-permission-tray]')?.closest('[data-composer-drawer]'), 'Permission uses the shared attached question-drawer surface')
    check(!document.querySelector('[data-assistant-async-question]') && frameCount() === 1 && editor(), 'Permission priority keeps one message composer and suppresses duplicate async trays')
    check(fixture.decisions.length === 0, 'Permission presentation has no implicit decision')
    const permissionDetails = document.querySelector<HTMLElement>('[data-permission-tray]')!
    const attachedItems = [...document.querySelectorAll<HTMLElement>('[data-composer-attachment-item="true"]')]
    check(attachedItems.every(item => permissionDetails.getBoundingClientRect().bottom <= item.getBoundingClientRect().top + 1), 'Permission details stay clear of the attachment shelf')
    await click('Allow once'); check(fixture.decisions.at(-1)?.decision === 'acceptOnce' && fixture.decisions.at(-1)?.id === approval.requestId, 'Allow once preserves exact backend semantics')
    await click('Deny'); check(fixture.decisions.at(-1)?.decision === 'decline', 'Deny preserves decline')
    await click('Other approval options')
    const scope = document.querySelector<HTMLButtonElement>('[role="menuitem"]')!
    check(scope?.getAttribute('aria-label') === approval.grantLabel, 'Broader scope exposes the complete backend grant label')
    scope.click(); await sleep()
    check(fixture.decisions.at(-1)?.decision === 'acceptForSession', 'Broader allowance stays a separate explicit decision')
    fixture.render({ commandPending: true }); await sleep()
    check([...document.querySelectorAll<HTMLButtonElement>('[data-permission-tray] button')].every(node => node.disabled), 'Permission response controls lock while saving')
    fixture.render({ commandPending: false, pendingApprovals: [], pendingUserInputs: [request('blocking-question', 'blocking')] }); await sleep(); await sleep()
    check(document.querySelector('[data-question-tray]') && !document.querySelector('[data-assistant-async-question]') && !button('Back to message') && frameCount() === 1, 'Blocking questions retain their original tray and footer, without async decoration')
    fixture.render({ pendingUserInputs: [] }); await sleep(); await sleep()
    check(editor() && frameCount() === 1, 'Removing requests restores the message dock')
    fixture.unmount()
    check(microphoneStops === microphoneStarts, 'No microphone capture remains after fixture cleanup')
    return ['Async arrival/focus, one dock, exact drafts/attachments/configuration, return, request queue, response/error/dismiss lifecycle', 'Real composer and question voice cleanup with late transcript isolation', 'Shared permission drawer, exact explicit decisions, busy lock and blocking-question preservation']
}

let previewFixture: ReturnType<typeof createPaneFixture> | null = null
;(window as any).attentionDockPreview = async (scenario: 'permission' | 'answer-later' | 'answer' | 'queue' | 'queue-question') => {
    previewFixture?.unmount()
    localStorage.clear()
    writeAssistantComposerSessionState('attention-chat', { draft: 'Keep this message while I answer the agent.', contextFiles: scenario === 'queue-question' ? [{ id: 'preview-file', path: '/fixture/notes.txt', name: 'notes.txt', kind: 'file', source: 'manual' }] : [], model: 'fixture/model', runtimeMode: 'full-access', effort: 'medium' })
    previewFixture = createPaneFixture()
    const queued = { queuedMessageCount: 1, queuedMessages: [{ id: 'preview-queue', prompt: 'Use the attached drawer for queued messages.', contextFiles: [], dispatchMode: 'queue' as const, status: 'queued' as const }] }
    previewFixture.render(scenario === 'permission' ? { pendingApprovals: [approval] } : scenario === 'queue' ? queued : { ...(scenario === 'queue-question' ? queued : {}), pendingUserInputs: [request('preview-question')], thinking: true })
    await sleep(); await sleep()
    if (scenario === 'answer') { await click('Answer'); await wait(() => Boolean(answer()), 'Preview opens the single answer composer') }
    await new Promise(resolve => setTimeout(resolve, 300))
    if (scenario === 'queue') {
        const drawer = document.querySelector<HTMLElement>('[aria-label="Queued message drawer"]')!
        const frame = document.querySelector<HTMLElement>('[data-assistant-composer-frame]')!
        const queue = document.querySelector<HTMLElement>('[aria-label="Queued messages"]')!
        const gap = frame.getBoundingClientRect().top - queue.getBoundingClientRect().bottom
        check(Math.abs(gap) <= 2, `Queue content joins the composer seam without a floating-card gap: ${gap}`)
        check(getComputedStyle(drawer, '::before').maskImage !== 'none', 'Actual drawer seam mask is rendered')
    }
    check(frameCount() === 1, 'Visual evidence retains exactly one composer')
    check(document.documentElement.scrollWidth <= innerWidth + 1, 'Dock fits the viewport without horizontal overflow')
}
