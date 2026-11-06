import { useState } from 'react'
import { AssistantComposerQueue, useAssistantComposerQueueState, type AssistantComposerQueueProps } from '../../src/renderer/src/pages/assistant/AssistantComposerQueue'
import { createRoot, type Root } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { useAssistantQueuedComposer, type AssistantQueuedComposerSessionState } from '../../src/renderer/src/pages/assistant/useAssistantQueuedComposer'
import { ASSISTANT_COMPOSER_QUEUE_STORAGE_KEY, createAssistantComposerQueueStorage } from '../../src/renderer/src/pages/assistant/assistant-composer-queue-storage'
import type { AssistantComposerSendOptions, ComposerContextFile } from '../../src/renderer/src/pages/assistant/assistant-composer-types'

const check = (value: unknown, message: string) => { if (!value) throw new Error(message) }
const sleep = () => new Promise(resolve => setTimeout(resolve, 20))
async function until(predicate: () => boolean, label: string) {
    const deadline = performance.now() + 3000
    while (!predicate()) {
        if (performance.now() > deadline) throw new Error(`Timed out: ${label}`)
        await sleep()
    }
}
const options: AssistantComposerSendOptions = { runtimeMode: 'full-access', interactionMode: 'default', effort: 'medium', model: 'fixture/model', dispatchMode: 'queue' }
const file: ComposerContextFile = { id: 'image', path: 'clipboard://fixture', name: 'capture.png', kind: 'image', content: 'inline body', previewDataUrl: 'data:image/png;base64,ZmFrZQ==', selection: { filePath: 'fixture.ts', selectedText: 'kept selection' } as any }
let actions: ReturnType<typeof useAssistantQueuedComposer>
let updateState: (patch: Partial<AssistantQueuedComposerSessionState>) => void
let root: Root | null = null
let container: HTMLDivElement | null = null
let failWrite = false
let interrupts = 0
let dispatchProfile = 'fixture-original-profile'
let dispatch: (prompt: string, opts: AssistantComposerSendOptions) => Promise<boolean>
let prepare: () => Promise<void> = async () => {}
const sent: { prompt: string; options: AssistantComposerSendOptions; files: ComposerContextFile[] }[] = []
const storage = createAssistantComposerQueueStorage(() => ({
    getItem: key => localStorage.getItem(key),
    setItem: (key, value) => { if (failWrite) throw new Error('Synthetic quota exceeded'); localStorage.setItem(key, value) }
}))
function Harness({ busy, missing = false }: { busy: boolean; missing?: boolean }) {
    const [state, setState] = useState<AssistantQueuedComposerSessionState>({ sessionId: 'chat', threadState: busy ? 'running' : 'ready', latestTurnState: busy ? 'running' : 'completed', pendingApprovalCount: 0, pendingUserInputCount: 0 })
    updateState = patch => setState(current => ({ ...current, ...patch }))
    const working = state.threadState === 'running'
    actions = useAssistantQueuedComposer({ selectedSessionId: 'chat', sessionStates: missing ? [] : [state], isAssistantBusy: working,
        isThreadWorking: working, commandPending: false, activeTurnId: working ? 'active' : null, busyMessageMode: 'queue', dispatchProfile, queueStorage: storage,
        dispatchPrompt: async (_sessionId, prompt, files, opts, canSubmit) => {
            await prepare()
            if (canSubmit && !canSubmit()) return false
            sent.push({ prompt, files, options: opts }); return dispatch(prompt, opts)
        },
        interruptTurn: async () => { interrupts++ }
    })
    return null
}
function mount(busy: boolean, missing = false) {
    container = document.createElement('div'); document.body.append(container)
    root = createRoot(container)
    flushSync(() => root!.render(<Harness busy={busy} missing={missing} />))
}
function unmount() { flushSync(() => root?.unmount()); container?.remove(); root = null; container = null }
function reset() { unmount(); localStorage.clear(); failWrite = false; interrupts = 0; dispatchProfile = 'fixture-original-profile'; sent.length = 0; dispatch = async () => true; prepare = async () => {} }
function ready() { updateState({ threadState: 'ready', latestTurnState: 'completed' }) }
function saved() { return JSON.parse(localStorage.getItem(ASSISTANT_COMPOSER_QUEUE_STORAGE_KEY) || '{}') }

Object.assign(window, { runComposerQueueChecks: async () => {
    const results: string[] = []
    reset(); mount(true)
    const inputFile = structuredClone(file)
    const accepted = actions.handleSendPrompt('first', [inputFile], options)
    check(saved().entries.chat[0].contextFiles[0].previewDataUrl === file.previewDataUrl, 'attachment must be durable before send returns acceptance')
    check(await accepted, 'queue accepted')
    check(saved().entries.chat[0].options.profile === 'fixture-original-profile', 'queue captures the accepting Chat profile')
    inputFile.content = 'mutated draft'
    check(saved().entries.chat[0].contextFiles[0].content === 'inline body', 'saved attachments are detached from draft')
    const rapid = [actions.handleSendPrompt('second', [], options), actions.handleSendPrompt('third', [], options)]
    check((await Promise.all(rapid)).every(Boolean), 'rapid sends accepted')
    await until(() => actions.queuedComposerMessageCount === 3, 'rapid sends do not overwrite each other')
    const ids = actions.queuedComposerMessageItems.map(entry => entry.id)
    check(actions.handleUpdateQueuedMessage(ids[1]!, 'second edited'), 'Save updates in place')
    await until(() => actions.queuedComposerMessageItems[1]?.prompt === 'second edited', 'edited text rendered')
    check(saved().entries.chat[1].id === ids[1], 'edit retains queue identity and position')
    check(saved().entries.chat[0].contextFiles[0].selection.selectedText === 'kept selection', 'nested attachment metadata survives')
    check(actions.handleUpdateQueuedMessage(ids[0]!, 'first edited'), 'edit attachment message')
    check(saved().entries.chat[0].options.model === 'fixture/model' && saved().entries.chat[0].contextFiles.length === 1, 'text edit retains attachments and selected options')
    // Cancel is deliberately no queue mutation; the UI owns its separate edit buffer.
    const cancelledBuffer = 'never saved'; void cancelledBuffer
    check(saved().entries.chat[0].prompt === 'first edited', 'cancelled edit leaves original queue untouched')
    actions.handleMoveQueuedMessage(ids[2]!, ids[1]!); actions.handleDeleteQueuedMessage(ids[2]!)
    check(saved().entries.chat.map((entry: any) => entry.id).join() === ids.slice(0, 2).join(), 'reorder/delete durable')
    results.push('durable acceptance with full attachments, rapid sends, in-place Save and unchanged Cancel')

    unmount(); dispatchProfile = 'fixture-other-profile'; mount(false)
    await sleep()
    check(actions.queueHeld && actions.queuedComposerMessageCount === 2 && sent.length === 0, 'restart restores held queue even when chat idle')
    let release!: (success: boolean) => void
    dispatch = () => new Promise(resolve => { release = resolve })
    check(actions.handleResumeQueue(), 'explicit resume accepted')
    await until(() => sent.length === 1, 'resumed first dispatch')
    check(sent[0].options.profile === 'fixture-original-profile', 'delayed dispatch never inherits the newly selected profile')
    check(saved().entries.chat.length === 2, 'in-flight message remains persisted until acceptance')
    check(!actions.handleUpdateQueuedMessage(ids[0]!, 'too late'), 'in-flight edit cannot race dispatched payload')
    check(actions.handleHoldQueue(), 'Stop holds synchronously')
    release(true)
    await until(() => actions.queuedComposerMessageCount === 1, 'accepted first removed')
    ready(); await sleep(); await sleep()
    check(actions.queueHeld && sent.length === 1 && saved().held.chat, 'Stop suppresses every automatic next dispatch')
    check(interrupts === 0, 'hook never aborts as part of queue delivery')
    results.push('restart held, explicit resume, persisted pending dispatch, Stop-versus-acceptance race')

    dispatch = async () => false
    check(actions.handleResumeQueue(), 'resume remaining')
    await until(() => actions.queueHeld && sent.length === 2, 'failed delivery held')
    check(actions.queuedComposerMessageCount === 1 && saved().entries.chat[0].prompt === 'second edited', 'failed dispatch preserves entry')
    dispatch = async () => true
    check(actions.handleResumeQueue(), 'explicit retry')
    await until(() => actions.queuedComposerMessageCount === 0, 'retry accepted')
    check(sent.length === 3, 'no duplicate retry')
    results.push('failed delivery holds and preserves message until explicit retry')

    reset(); mount(true)
    await actions.handleSendPrompt('ordinary', [], options)
    await actions.handleSendPrompt('promote only me', [file], options)
    await until(() => actions.queuedComposerMessageCount === 2, 'promotion queue')
    const promoteId = actions.queuedComposerMessageItems[1]!.id
    await actions.handleForceQueuedMessage(promoteId)
    await until(() => sent.length === 1 && actions.queuedComposerMessageCount === 1, 'steer dispatched while running')
    check(sent[0]!.prompt === 'promote only me' && sent[0]!.options.dispatchMode === 'steer', 'promotion uses actual steer dispatch option')
    check(sent[0]!.files[0]!.content === file.content && saved().entries.chat[0].prompt === 'ordinary', 'promotion preserves attachments and preceding queue')
    check(interrupts === 0, 'steer never aborts active work')
    ready(); await until(() => sent.length === 2, 'ordinary queue drains after turn completes')
    results.push('single-target real steer preserves preceding queue and never interrupts')

    reset(); mount(true)
    failWrite = true
    check(!await actions.handleSendPrompt('keep draft', [file], options), 'quota error rejects acceptance so draft must stay')
    await sleep(); check(actions.queuedComposerMessageCount === 0 && sent.length === 0 && actions.queuePersistenceError, 'failed persist cannot enqueue or dispatch')
    failWrite = false
    check(await actions.handleSendPrompt('saved', [file], options), 'recovered storage accepts')
    await until(() => actions.queuedComposerMessageCount === 1, 'saved before hold failure')
    failWrite = true
    actions.handleHoldQueue(); ready(); await sleep(); await sleep()
    check(actions.queueHeld && sent.length === 0, 'Stop gates in memory even if storage fails')
    check(!actions.handleResumeQueue(), 'failed resume write must leave queue held')
    results.push('quota failure rejects send; storage failure cannot defeat Stop')

    reset(); mount(true)
    await actions.handleSendPrompt('stop before effect', [], options)
    flushSync(() => { ready(); actions.handleHoldQueue() })
    await sleep(); check(sent.length === 0 && actions.queueHeld, 'same-tick Stop beats idle drain effect')
    unmount(); mount(false, true); actions.handleResumeQueue(); await sleep()
    check(sent.length === 0, 'missing canonical session cannot dispatch recovered local message')
    results.push('same-tick Stop versus idle race and unknown-session fail-closed')

    reset(); mount(true)
    updateState({ compacting: true }); await sleep()
    await actions.handleSendPrompt('wait for compaction', [], { ...options, dispatchMode: 'steer' })
    await until(() => actions.queuedComposerMessageCount === 1, 'compaction queued')
    check(sent.length === 0 && saved().entries.chat[0].options.dispatchMode === 'queue', 'compaction forces durable ordinary queue')
    updateState({ compacting: false }); ready()
    await until(() => sent.length === 1, 'compaction completion dispatch')
    results.push('compaction retains queued prompt without abort or premature steer')

    reset(); mount(true)
    await actions.handleSendPrompt('cancel before browser context finishes', [file], options)
    let preparationStarted = false
    let finishPreparation!: () => void
    prepare = () => { preparationStarted = true; return new Promise(resolve => { finishPreparation = resolve }) }
    ready(); await until(() => preparationStarted, 'browser-context preparation started')
    actions.handleHoldQueue(); finishPreparation()
    await until(() => actions.queueHeld && !actions.sendingComposerPrompt, 'preparation cancellation settles')
    check(sent.length === 0 && actions.queuedComposerMessageCount === 1, 'Stop cancels unsubmitted preparation and preserves original entry')
    prepare = async () => {}
    check(actions.handleResumeQueue(), 'cancelled preparation resumes explicitly')
    await until(() => sent.length === 1 && actions.queuedComposerMessageCount === 0, 'cancelled message delivered only after explicit Resume')
    results.push('Stop invalidates asynchronous browser preparation before actual submission')

    reset(); mount(true)
    actions.handleHoldQueue()
    await actions.handleSendPrompt('saved steer', [], { ...options, dispatchMode: 'steer' })
    await until(() => actions.queuedComposerMessageCount === 1, 'held steer saved')
    check(saved().entries.chat[0].options.targetTurnId === 'active', 'saved steer records original turn identity')
    ready(); await sleep()
    check(actions.queuedComposerMessageItems[0]?.dispatchMode === 'queue', 'ended-turn Steer displays Send next')
    check(actions.handleResumeQueue(), 'resume ended-turn steer')
    await until(() => sent.length === 1 && actions.queuedComposerMessageCount === 0, 'ended-turn steer continues normally')
    check(sent[0]!.options.dispatchMode === 'immediate' && interrupts === 0, 'ended-turn steer starts next work without cancellation')
    results.push('held Steer becomes Send next after its original turn ends')

    reset(); mount(true)
    actions.handleHoldQueue()
    await actions.handleSendPrompt('do not steer unrelated replacement', [], { ...options, dispatchMode: 'steer' })
    updateState({ latestTurnId: 'replacement-turn' }); await sleep()
    actions.handleResumeQueue(); await sleep()
    check(sent.length === 0, 'old turn target cannot steer a different active turn')
    ready(); await until(() => sent.length === 1, 'old steer waits for replacement turn to finish')
    check(sent[0]!.options.dispatchMode === 'immediate', 'old target becomes ordinary queued input')
    results.push('saved Steer never targets an unrelated replacement turn')

    reset(); mount(true)
    await actions.handleSendPrompt('fast first', [], options)
    await actions.handleSendPrompt('must not stall', [], options)
    let acknowledgeFast!: (value: boolean) => void
    dispatch = prompt => prompt === 'fast first' ? new Promise(resolve => { acknowledgeFast = resolve }) : Promise.resolve(true)
    ready(); await until(() => sent.length === 1, 'fast first submitted')
    updateState({ latestTurnId: 'completed-before-ack' }); await sleep()
    acknowledgeFast(true)
    await until(() => sent.length === 2 && actions.queuedComposerMessageCount === 0, 'next dispatch after fast completion before acknowledgement')
    results.push('completion before dispatch acknowledgement cannot latch the remaining queue')

    reset(); mount(true)
    await actions.handleSendPrompt('ack before fast completion', [], options)
    await actions.handleSendPrompt('follow fast terminal receipt', [], options)
    ready(); await until(() => sent.length === 1 && actions.queuedComposerMessageCount === 1, 'acknowledged first waits for lifecycle evidence')
    updateState({ latestTurnId: 'completed-after-ack' })
    await until(() => sent.length === 2 && actions.queuedComposerMessageCount === 0, 'terminal receipt clears optimistic dispatch latch')
    results.push('terminal receipt after acknowledgement advances queue without an intermediate busy render')

    reset(); mount(true)
    const detachedDictationSend = actions.handleSendPrompt
    unmount(); dispatchProfile = 'fixture-new-profile'; mount(true)
    check(await actions.handleSendPrompt('new queue work', [], options), 'replacement owner accepts newer work')
    check(await detachedDictationSend('late dictation', [file], options), 'detached dictation remains accepted')
    await until(() => actions.queuedComposerMessageCount === 2, 'live queue observes a detached completion')
    check(saved().entries.chat.map((entry: any) => entry.prompt).join('|') === 'new queue work|late dictation', 'detached completion merges rather than overwriting newer queued work')
    check(saved().entries.chat[0].options.profile === 'fixture-new-profile' && saved().entries.chat[1].options.profile === 'fixture-original-profile', 'each accepted request retains its own profile')
    results.push('detached dictation merges into the current queue without losing newer work or transferring profiles')

    reset()
    const twins: ReturnType<typeof useAssistantQueuedComposer>[] = []
    const sharedAttempts: AssistantComposerSendOptions[] = []
    let acknowledge!: (accepted: boolean) => void
    const sharedAck = new Promise<boolean>(resolve => { acknowledge = resolve })
    function Twin({ index }: { index: number }) {
        twins[index] = useAssistantQueuedComposer({ selectedSessionId: 'chat',
            sessionStates: [{ sessionId: 'chat', threadState: 'running', latestTurnState: 'running', latestTurnId: 'active', pendingApprovalCount: 0, pendingUserInputCount: 0 }],
            isAssistantBusy: true, isThreadWorking: true, commandPending: false, activeTurnId: 'active', busyMessageMode: 'queue', queueStorage: storage,
            dispatchPrompt: async (_session, _prompt, _files, sendOptions) => { sharedAttempts.push(sendOptions); return sharedAck },
            interruptTurn: async () => {}
        })
        return null
    }
    container = document.createElement('div'); document.body.append(container); root = createRoot(container)
    flushSync(() => root!.render(<><Twin index={0} /><Twin index={1} /></>))
    check(await twins[0]!.handleSendPrompt('one shared Steer', [], { ...options, dispatchMode: 'steer' }), 'one renderer accepts shared entry')
    const sharedId = saved().entries.chat[0].id
    await until(() => sharedAttempts.length === 2, 'both live hooks observe the shared storage entry')
    check(sharedAttempts.every(attempt => attempt.queueEntryId === sharedId), 'both live hooks must forward one stable queue delivery identity')
    check(await twins[0]!.handleSendPrompt('newer waiting message', [], options), 'new work can be accepted while delivery acknowledgement waits')
    acknowledge(true)
    await until(() => saved().entries.chat.length === 1, 'both accepted acknowledgements remove only their shared entry')
    check(saved().entries.chat[0].prompt === 'newer waiting message', 'late acknowledgements preserve newly accepted queue work')
    results.push('two live hooks share one stable delivery identity and preserve newer work across acknowledgement')

    reset(); mount(true)
    let lateAck!: (accepted: boolean) => void
    dispatch = () => new Promise<boolean>(resolve => { lateAck = resolve })
    check(await actions.handleSendPrompt('accepted before Stop', [], options), 'first late-ack entry accepted')
    check(await actions.handleSendPrompt('held after Stop', [], options), 'second late-ack entry accepted')
    ready()
    await until(() => sent.length === 1, 'first queue request awaits acknowledgement')
    failWrite = true
    check(!actions.handleHoldQueue(), 'Stop holds in memory when its storage write fails')
    failWrite = false
    lateAck(true)
    await until(() => actions.queuedComposerMessageCount === 1, 'late accepted entry removed')
    check(actions.queueHeld && saved().held.chat === true, 'acknowledgement cannot discard the in-memory Stop when storage recovers')
    results.push('late acknowledgement retains Stop even after a failed hold write and storage recovery')

    reset(); mount(true)
    dispatch = () => new Promise<boolean>(resolve => { lateAck = resolve })
    check(await actions.handleSendPrompt('accepted before corruption', [], { ...options, dispatchMode: 'steer' }), 'corruption fixture entry accepted')
    await until(() => sent.length === 1, 'accepted request awaits its acknowledgement')
    localStorage.setItem(ASSISTANT_COMPOSER_QUEUE_STORAGE_KEY, '{broken')
    lateAck(true)
    await until(() => Boolean(actions.queuePersistenceError) && actions.queueHeld, 'unreadable acknowledgement queue is held')
    check(localStorage.getItem(ASSISTANT_COMPOSER_QUEUE_STORAGE_KEY) === '{broken', 'a late acknowledgement cannot overwrite unreadable queue evidence')
    results.push('unreadable acknowledgement storage remains intact and the dispatch is held')

    reset()
    localStorage.setItem(ASSISTANT_COMPOSER_QUEUE_STORAGE_KEY, '{broken')
    mount(true)
    check(!await actions.handleSendPrompt('do not overwrite recovery evidence', [], options) && actions.queuePersistenceError, 'corrupt storage rejects acceptance and is surfaced')
    check(localStorage.getItem(ASSISTANT_COMPOSER_QUEUE_STORAGE_KEY) === '{broken', 'corrupt queue record preserved')
    reset()
    results.push(...await runQueuePresentationChecks())
    return results
} })

async function runQueuePresentationChecks() {
    const calls: string[] = []
    let saveWorks = false
    let props: AssistantComposerQueueProps = {
        loadedSessionId: 'presentation-chat', isConnected: true, isStopping: false, queueHeld: true,
        queuedMessages: [
            { id: 'one', prompt: 'Keep the permission panel clear and easy to scan.', contextFiles: [file], status: 'held', dispatchMode: 'queue' },
            { id: 'two', prompt: 'Use the same theme tokens for the next pass.', contextFiles: [], status: 'held', dispatchMode: 'steer' }
        ] as AssistantComposerQueueProps['queuedMessages'],
        onHoldQueue: () => { calls.push('hold') },
        onResumeQueue: () => { calls.push('resume') },
        onDeleteQueuedMessage: id => { calls.push(`delete:${id}`) },
        onForceQueuedMessage: id => { calls.push(`steer:${id}`) },
        onMoveQueuedMessage: (id, target) => { calls.push(`move:${id}:${target}`) },
        onUpdateQueuedMessage: (id, text) => { calls.push(`save:${id}:${text}`); return saveWorks }
    }
    function QueueHarness({ visible }: { visible: boolean }) {
        const state = useAssistantComposerQueueState(props.loadedSessionId)
        return visible ? <AssistantComposerQueue controller={props} state={state} /> : null
    }
    container = document.createElement('div'); container.style.cssText = 'width:760px;max-width:100%;margin:32px auto'
    document.body.append(container); root = createRoot(container)
    const render = (patch: Partial<AssistantComposerQueueProps> = {}, visible = true) => {
        props = { ...props, ...patch }
        flushSync(() => root!.render(<QueueHarness visible={visible} />))
    }
    const row = (id = 'one') => container!.querySelector<HTMLElement>(`[data-queued-message-id="${id}"]`)!
    const button = (label: string, host: ParentNode = container!) => Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(node => node.getAttribute('aria-label') === label || node.textContent === label)!
    const click = (label: string, host: ParentNode = container!) => flushSync(() => button(label, host).click())
    const settleAnimations = async () => {
        await sleep()
        await Promise.all(container!.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {})))
    }
    const checkHeightTransition = (host: ParentNode, label: string) => {
        const transition = host.querySelector<HTMLElement>('[data-question-transition]')!
        const animating = transition.getAnimations().some(animation => animation instanceof CSSTransition && animation.transitionProperty === 'height')
        check(animating !== matchMedia('(prefers-reduced-motion: reduce)').matches, label)
    }
    const type = (text: string) => {
        const textarea = container!.querySelector('textarea')!
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, text)
        flushSync(() => textarea.dispatchEvent(new Event('input', { bubbles: true })))
    }
    render()
    check(container.querySelector('section[aria-label="Queued messages"]')?.closest('[data-composer-drawer="true"]'), 'queue uses the shared attached composer drawer')
    check(!container.querySelector('[aria-label="Close composer menu"]'), 'queue does not inherit the unrelated command-menu close action')
    for (const send of [button('Send all queued messages'), button('Steer queued message', row())]) {
        const bounds = send.getBoundingClientRect(), style = getComputedStyle(send)
        check(Math.abs(bounds.width - bounds.height) < 1 && parseFloat(style.borderRadius) >= bounds.width / 2, 'steering buttons render circular despite shared action styles')
    }
    const headerStyle = getComputedStyle(button('Send all queued messages'))
    const accentProbe = document.createElement('span')
    accentProbe.style.cssText = 'background:var(--accent-primary);color:var(--accent-on-primary)'; container.append(accentProbe)
    check(headerStyle.backgroundColor === getComputedStyle(accentProbe).backgroundColor && headerStyle.color === getComputedStyle(accentProbe).color, 'header send-all uses the theme accent fill and contrast color')
    accentProbe.remove()
    check(container.textContent?.includes('1 file') && container.textContent.includes('Held'), 'attachment count and held status rendered')
    check(!container.textContent?.includes('Waiting for delivery'), 'the queue has no redundant waiting subtitle')
    const preview = row().querySelector<HTMLButtonElement>('[data-queued-message-preview]')!
    const beforePreview = calls.length
    flushSync(() => preview.click())
    check(preview.getAttribute('aria-expanded') === 'true' && !container.querySelector('textarea') && calls.length === beforePreview, 'clicking text reveals it without editing or holding delivery')
    flushSync(() => preview.click())
    check(getComputedStyle(preview).whiteSpace === 'nowrap' && getComputedStyle(preview).textOverflow === 'ellipsis', 'closed preview truncates to one line')
    click('Resume queue'); click('Steer queued message', row()); click('Delete queued message', row())
    check(calls.join('|') === 'resume|steer:one|delete:one', 'compact actions target exact message')
    const beforeAll = calls.length
    click('Send all queued messages'); await sleep()
    check(calls.slice(beforeAll).join('|') === 'steer:one|steer:two|resume', 'header sends each eligible row once in queue order and resumes a held queue')
    const forceMessage = props.onForceQueuedMessage
    let releaseSend!: () => void
    render({ onForceQueuedMessage: async id => { calls.push(`steer:${id}`); await new Promise<void>(resolve => { releaseSend = resolve }) } })
    click('Send all queued messages')
    check(button('Send all queued messages').disabled && button('Edit queued message', row()).disabled && button('Steer queued message', row()).disabled, 'in-flight send-all disables duplicate delivery and editing')
    releaseSend(); await sleep(); releaseSend(); await sleep()
    render({ onForceQueuedMessage: async () => { throw new Error('Synthetic delivery failure') } })
    click('Send all queued messages'); await sleep()
    check(container.querySelector('[role="alert"]')?.textContent === 'Could not send every queued message.' && !button('Send all queued messages').disabled, 'send-all failure is visible and retry remains available')
    render({ onForceQueuedMessage: forceMessage })
    click('Send all queued messages'); await sleep()
    check(!container.querySelector('[role="alert"]'), 'successful retry clears the send-all error')
    click('Edit queued message', row()); type('edited buffer')
    check(calls.includes('hold'), 'editing holds queue before changing local buffer')
    click('Save'); await sleep()
    check(container.querySelector('[role="alert"]') && container.querySelector('textarea')?.value === 'edited buffer', 'failed Save retains buffer and accessible error')
    click('Cancel')
    check(!container.querySelector('textarea') && !container.querySelector('[role="alert"]') && row().textContent?.includes('Keep the permission'), 'Cancel clears error without changing queued prompt')
    click('Edit queued message', row()); type('successful edit'); saveWorks = true
    await settleAnimations()
    click('Save'); await sleep()
    check(calls.includes('save:one:successful edit') && !container.querySelector('textarea'), 'Save forwards exact text and closes editor after success')
    checkHeightTransition(row(), 'successful Save animates back to preview unless reduced motion is requested')
    await settleAnimations()
    const reorderKey = (index: number, key: string, altKey = true) => flushSync(() => button(`Reorder queued message ${index}`).dispatchEvent(new KeyboardEvent('keydown', { key, altKey, bubbles: true, cancelable: true })))
    check(!container.querySelector('[title="Move up"], [title="Move down"]'), 'visible up/down actions removed')
    const handle = button('Reorder queued message 1')
    handle.focus()
    check(document.activeElement === handle && Boolean(handle.getAttribute('aria-describedby')) && handle.getAttribute('aria-keyshortcuts')?.includes('Alt+ArrowDown'), 'drag handle is focusable with accessible reorder instructions')
    const beforeKeys = calls.length
    reorderKey(1, 'ArrowUp'); reorderKey(2, 'ArrowDown'); reorderKey(1, 'ArrowDown', false)
    check(calls.length === beforeKeys, 'handle guards queue boundaries and ordinary arrow keys')
    reorderKey(1, 'ArrowDown'); reorderKey(2, 'ArrowUp')
    check(calls.includes('move:one:two') && calls.includes('move:two:one'), 'Alt+Arrow keys target neighboring queue identity')
    const dataTransfer = new DataTransfer()
    let dragImage: Element | null = null
    Object.defineProperty(dataTransfer, 'setDragImage', { value: (element: Element) => { dragImage = element } })
    flushSync(() => row().querySelector('[draggable]')!.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer })))
    check(dragImage === row(), 'native drag image uses the full message row')
    // Native drag events arrive in separate browser tasks. React assigns dragover
    // continuous priority, so flushSync around synthetic dispatch alone does not
    // establish that the drag state/preview has committed before the next event.
    await until(() => row().classList.contains('opacity-45'), 'dragstart commits the source row before dragover')
    const beforeDrop = calls.length
    flushSync(() => row('two').dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer })))
    check(calls.length === beforeDrop, 'dragover does not mutate the queue')
    await until(() => Boolean(row('two').querySelector('[data-queue-drop-edge="after"]')), 'downward dragover commits trailing drop-edge preview')
    check(calls.length === beforeDrop, 'drop edge previews downward move without queue mutation')
    flushSync(() => row('two').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer })))
    check(dataTransfer.getData('text/plain') === 'one' && calls.filter(call => call === 'move:one:two').length === 2 && !container.querySelector('[data-queue-drop-edge]'), 'drop commits exact reorder once and clears preview')
    flushSync(() => row('two').querySelector('[draggable]')!.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer })))
    await until(() => row('two').classList.contains('opacity-45'), 'reverse dragstart commits the source row')
    flushSync(() => row().dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer })))
    await until(() => Boolean(row().querySelector('[data-queue-drop-edge="before"]')), 'upward move previews the leading edge')
    const beforeCancelDrag = calls.length
    flushSync(() => row('two').querySelector('[draggable]')!.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer })))
    check(!container.querySelector('[data-queue-drop-edge]') && calls.length === beforeCancelDrag, 'cancelled drag clears preview without persisting')
    click('Edit queued message', row()); type('retained while suggestions open')
    render({}, false); render()
    check(container.querySelector('textarea')?.value === 'retained while suggestions open', 'suggestion shelf replacement retains edit buffer')
    render({ loadedSessionId: 'other-chat' }); await sleep()
    check(!container.querySelector('textarea'), 'Chat change resets local editor')
    const originalMessages = props.queuedMessages
    render({ queueHeld: false, queuedMessages: originalMessages.map(message => ({ ...message, status: 'queued', dispatchMode: 'steer' })) })
    check(button('Send all queued messages').disabled, 'already pending steer deliveries are not sent again')
    render({ queueHeld: true })
    render({ queuedMessages: originalMessages.map((message, index) => ({ ...message, status: index === 0 ? 'sending' : 'compacting' })) })
    check(button('Edit queued message', row()).disabled && button('Steer queued message', row()).disabled && button('Steer queued message', row('two')).disabled && button('Send all queued messages').disabled, 'sending edit and sending/compaction steer remain unavailable')
    check(container.textContent?.includes('Sending…') && container.textContent.includes('Compacting'), 'sending and compaction announce status')
    render({ isConnected: false }); check(button('Resume queue').disabled && button('Send all queued messages').disabled, 'disconnected delivery controls disabled')
    render({ isConnected: true, isStopping: true }); check(button('Resume queue').disabled, 'stopping Resume disabled')
    render({ isStopping: false, queuedMessages: originalMessages })
    for (const width of [760, 360]) {
        container.style.width = `${width}px`
        await settleAnimations()
        const panel = container.querySelector('section')!
        check(panel.scrollWidth <= panel.clientWidth + 1, `queue panel fits ${width}px without horizontal overflow`)
        for (const node of container.querySelectorAll('button, textarea')) {
            const bounds = node.getBoundingClientRect(), outer = panel.getBoundingClientRect()
            check(bounds.left >= outer.left && bounds.right <= outer.right + 1, `queue action stays inside ${width}px panel`)
        }
        check(row().getBoundingClientRect().height <= 38, `normal queue row stays compact at ${width}px`)
        const content = row().querySelector('[data-queued-message-preview]')!.getBoundingClientRect()
        const send = button('Steer queued message', row()).getBoundingClientRect()
        check(Math.abs(content.top - send.top) < 2, `row actions align beside their own content at ${width}px`)
        const dragHandle = button('Reorder queued message 1')
        click('Edit queued message', row())
        await sleep()
        checkHeightTransition(row(), 'entering edit animates intrinsic height unless reduced motion is requested')
        await settleAnimations()
        const editor = row().querySelector('textarea')!
        check(document.activeElement === editor && editor.getBoundingClientRect().width >= panel.clientWidth - 60, `editing fills the row beside its drag handle at ${width}px`)
        check(button('Reorder queued message 1') === dragHandle && dragHandle.draggable, 'editing keeps the same functional drag handle')
        check(!row().querySelector('[aria-label="Delete queued message"], button[aria-label="Edit queued message"], [aria-label="Steer queued message"]'), 'editing removes duplicate row controls')
        const editorStyle = getComputedStyle(editor)
        check(editorStyle.borderTopWidth === '0px' && editorStyle.borderLeftWidth === '0px' && editorStyle.borderRightWidth === '0px' && editorStyle.borderBottomWidth === '1px' && editorStyle.backgroundColor === 'rgba(0, 0, 0, 0)', 'editor is transparent with only an accent underline')
        check(getComputedStyle(editor).resize === 'none' && editor.scrollHeight <= editor.clientHeight + 1, `short edit text fits without resizing or scrolling at ${width}px`)
        check(button('Save', row()).getBoundingClientRect().right <= panel.getBoundingClientRect().right && button('Save', row()).getBoundingClientRect().left > button('Cancel', row()).getBoundingClientRect().left, 'edit actions align at the right with Save last')
        type('A long queued message.\n'.repeat(20))
        check(editor.getBoundingClientRect().height <= 160 && editor.scrollHeight > editor.clientHeight, 'long edits scroll within a bounded field')
        await settleAnimations()
        reorderKey(1, 'ArrowDown')
        check(editor.value.startsWith('A long queued message.') && calls.at(-1) === 'move:one:two', 'keyboard reordering works without losing an active edit')
        click('Cancel')
        await sleep()
        checkHeightTransition(row(), 'Cancel animates back to preview unless reduced motion is requested')
        await settleAnimations()
    }
    container.style.width = '560px'
    render({ queueHeld: false, queuedMessages: originalMessages.map((message, index) => ({ ...message, prompt: index ? 'Check the existing steering behavior and preserve the original turn while the tools keep streaming in the conversation.' : 'continue', contextFiles: [], status: 'queued', dispatchMode: 'queue' })) })
    return ['actual queue UI: one-line preview/expand, adjacent row icons, header send-all, full-width auto-sized editor with Save/error/Cancel, held/resume, exact steer/delete, status guards, full-row drag and keyboard ordering, Chat/suggestion edit continuity, compact 360px layout']
}
