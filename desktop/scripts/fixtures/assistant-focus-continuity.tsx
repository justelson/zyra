import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { TimelineTurnWorkSummary } from '../../src/renderer/src/pages/assistant/AssistantTimelineWorkSummary'
import { createAssistantComposerHandlers } from '../../src/renderer/src/pages/assistant/assistant-composer-handlers'
import { ComposerTextInput } from '../../src/renderer/src/pages/assistant/ComposerTextInput'

const root = createRoot(document.getElementById('root')!)
// The offscreen owner never takes OS focus. Supply its native keyboard-owner
// fact explicitly; the guest-focus tests below flip it without activating a window.
Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => true })
const wait = (ms = 50) => new Promise(resolve => setTimeout(resolve, ms))
const failures: string[] = [], results: string[] = []
const check = (value: unknown, message: string) => { if (!value) failures.push(message) }
const composer = document.getElementById('composer') as HTMLTextAreaElement
const browser = document.getElementById('browser') as HTMLIFrameElement
browser.contentDocument!.body.innerHTML = '<input id="page-input" value="Page draft">'
const pageInput = browser.contentDocument!.getElementById('page-input') as HTMLInputElement
const noop = () => {}

async function checkDelayedSend(dispatchMode: 'immediate' | 'queue' | 'steer', accepted: boolean, destination: 'browser' | 'composer' | 'switched-input') {
    let finish!: (accepted: boolean) => void
    const ref = { current: composer }
    const handlers = createAssistantComposerHandlers({
        text: 'Initial prompt', inlineMentionTags: [], contextFiles: [], removingAttachmentIds: [],
        selectedRuntimeMode: 'full-access', selectedInteractionMode: 'default', selectedEffort: 'medium', selectedModel: 'fixture/model',
        isConnected: true, isThinking: dispatchMode !== 'immediate', busyMessageMode: dispatchMode,
        textareaRef: ref, onSend: () => new Promise(resolve => { finish = resolve }),
        setText: noop, setInlineMentionTags: noop, setContextFiles: noop, setHistoryCursor: noop,
        setDraftBeforeHistory: noop, setSentPromptHistory: noop
    } as any)
    composer.focus()
    const sending = dispatchMode === 'immediate' ? handlers.handleSend() : dispatchMode === 'queue' ? handlers.handleQueueSend() : handlers.handleForceSend()
    await wait()
    check(document.activeElement === composer, 'Submitting deliberately keeps the composer ready')
    if (destination === 'browser') pageInput.focus()
    else if (destination === 'switched-input') { ref.current = document.getElementById('other-composer') as HTMLTextAreaElement; ref.current.focus(); ref.current.setSelectionRange(1, 3) }
    else { composer.value = 'New draft while work streams'; composer.setSelectionRange(2, 7) }
    finish(accepted); await sending; await wait()
    if (destination === 'browser') check(document.activeElement === browser && browser.contentDocument!.activeElement === pageInput,
        `${dispatchMode}/${accepted}: delayed send acknowledgement must not take focus from the Browser page`)
    else if (destination === 'switched-input') check(ref.current.selectionStart === 1 && ref.current.selectionEnd === 3,
        `${dispatchMode}/${accepted}: an old submission must not move a newly selected chat's caret`)
    else check(document.activeElement === composer && composer.selectionStart === 2 && composer.selectionEnd === 7,
        `${dispatchMode}/${accepted}: delayed send acknowledgement must preserve the new draft's caret and selection`)
}

function work(running: boolean) {
    flushSync(() => root.render(<TimelineTurnWorkSummary startedAt="2026-11-08T09:00:00Z" completedAt={running ? null : '2026-11-08T09:01:00Z'} running={running}
        outcome={running ? null : 'completed'} renderChildren={() => <div><button id="tool">Inspect output</button><pre id="output">Stable selected tool output</pre></div>} />))
}

;(window as any).focusContinuityCheck = (async () => {
    for (const mode of ['immediate', 'queue', 'steer'] as const) for (const accepted of [true, false]) {
        for (const destination of ['browser', 'composer', 'switched-input'] as const) await checkDelayedSend(mode, accepted, destination)
    }
    results.push('Immediate, queued and steering send acknowledgements preserve page focus, draft selection and the newly selected chat')
    for (const moveBeforeFrame of [false, true]) {
        const sendButton = document.createElement('button'); document.body.append(sendButton); sendButton.focus()
        const handlers = createAssistantComposerHandlers({ text: 'Click send', inlineMentionTags: [], contextFiles: [], removingAttachmentIds: [], isConnected: true,
            selectedRuntimeMode: 'full-access', selectedModel: 'fixture/model', selectedEffort: 'medium', textareaRef: { current: composer },
            onSend: async () => true, setText: noop, setInlineMentionTags: noop, setContextFiles: noop, setHistoryCursor: noop, setDraftBeforeHistory: noop, setSentPromptHistory: noop } as any)
        const sending = handlers.handleSend()
        if (moveBeforeFrame) pageInput.focus()
        await sending; await wait()
        check(document.activeElement === (moveBeforeFrame ? browser : composer), 'Send-click focus belongs only to the current deliberate action, never a later reader')
        sendButton.remove()
    }
    const nativeSendButton = document.createElement('button'); document.body.append(nativeSendButton); nativeSendButton.focus()
    const ownerHasFocus = document.hasFocus
    let nativeOwnerFocused = true
    Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => nativeOwnerFocused })
    try {
        const handlers = createAssistantComposerHandlers({ text: 'Native race', inlineMentionTags: [], contextFiles: [], removingAttachmentIds: [], isConnected: true,
            selectedRuntimeMode: 'full-access', selectedModel: 'fixture/model', selectedEffort: 'medium', textareaRef: { current: composer },
            onSend: async () => true, setText: noop, setInlineMentionTags: noop, setContextFiles: noop, setHistoryCursor: noop, setDraftBeforeHistory: noop, setSentPromptHistory: noop } as any)
        const sending = handlers.handleSend(); nativeOwnerFocused = false
        await sending; await wait()
        check(document.activeElement === nativeSendButton, 'A native Browser taking focus before the send frame cancels the old focus request even when DOM activeElement is stale')
    } finally { Object.defineProperty(document, 'hasFocus', { configurable: true, value: ownerHasFocus }); nativeSendButton.remove() }
    work(true); await wait()
    const tool = document.getElementById('tool')!; if (!tool) throw Error('Work content did not mount: '+document.getElementById('root')!.innerHTML); tool.focus()
    work(false); await wait(650)
    check(tool.isConnected && document.activeElement === tool, 'Successful completion cannot collapse the tool the user is focused on')
    flushSync(() => root.render(null)); work(true); await wait()
    const text = document.getElementById('output')!.firstChild!, range = document.createRange()
    range.setStart(text, 2); range.setEnd(text, 15); window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range)
    const selected = window.getSelection()!.toString()
    work(false); await wait(650)
    check(text.isConnected && window.getSelection()!.toString() === selected, 'Successful completion cannot discard the output being selected')
    window.getSelection()!.removeAllRanges()
    flushSync(() => root.render(null)); work(true); await wait(); pageInput.focus(); work(false); await wait(650)
    check(document.querySelector('[aria-controls]')?.getAttribute('aria-expanded') === 'false', 'Unread work retains normal automatic completion collapse')
    check(document.activeElement === browser && browser.contentDocument!.activeElement === pageInput, 'Completion cannot move Browser page focus')
    results.push('Completion preserves actively read tools and selected output, while unattended work still collapses')
    const rich = (value: string) => flushSync(() => root.render(<ComposerTextInput value={value} tags={[]} theme="dark" onRemoveTag={noop} onTagsChange={noop} />))
    rich('Previous draft'); await wait()
    const editor = document.querySelector<HTMLElement>('[data-composer-text-input]')!; editor.focus()
    const selection = document.getSelection()!, originalAddRange = selection.addRange, originalHasFocus = document.hasFocus
    let selectionWrites = 0
    // Native WebContentsView focus leaves the owner's DOM activeElement stale.
    // Keep that exact state while reporting that the native page owns input.
    Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => false })
    selection.addRange = function (range) { selectionWrites++; return originalAddRange.call(this, range) }
    try {
        rich('Accepted draft update'); await wait()
        check(selectionWrites === 0, 'An unfocused native document must not restore a stale composer selection and reclaim Browser keyboard input')
    } finally {
        selection.addRange = originalAddRange
        Object.defineProperty(document, 'hasFocus', { configurable: true, value: originalHasFocus })
    }
    results.push('Rich-composer synchronization leaves selection untouched when the native Browser owns the keyboard')
    if (failures.length) throw new Error(failures.join('\n'))
    return results
})().catch(error => { console.error(error.stack); throw error })
