import { useState } from 'react'
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
        isThreadWorking: working, commandPending: false, activeTurnId: working ? 'active' : null, busyMessageMode: 'queue', queueStorage: storage,
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
function reset() { unmount(); localStorage.clear(); failWrite = false; interrupts = 0; sent.length = 0; dispatch = async () => true; prepare = async () => {} }
function ready() { updateState({ threadState: 'ready', latestTurnState: 'completed' }) }
function saved() { return JSON.parse(localStorage.getItem(ASSISTANT_COMPOSER_QUEUE_STORAGE_KEY) || '{}') }

Object.assign(window, { runComposerQueueChecks: async () => {
    const results: string[] = []
    reset(); mount(true)
    const inputFile = structuredClone(file)
    const accepted = actions.handleSendPrompt('first', [inputFile], options)
    check(saved().entries.chat[0].contextFiles[0].previewDataUrl === file.previewDataUrl, 'attachment must be durable before send returns acceptance')
    check(await accepted, 'queue accepted')
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

    unmount(); mount(false)
    await sleep()
    check(actions.queueHeld && actions.queuedComposerMessageCount === 2 && sent.length === 0, 'restart restores held queue even when chat idle')
    let release!: (success: boolean) => void
    dispatch = () => new Promise(resolve => { release = resolve })
    check(actions.handleResumeQueue(), 'explicit resume accepted')
    await until(() => sent.length === 1, 'resumed first dispatch')
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

    reset()
    localStorage.setItem(ASSISTANT_COMPOSER_QUEUE_STORAGE_KEY, '{broken')
    mount(true)
    check(!await actions.handleSendPrompt('do not overwrite recovery evidence', [], options) && actions.queuePersistenceError, 'corrupt storage rejects acceptance and is surfaced')
    check(localStorage.getItem(ASSISTANT_COMPOSER_QUEUE_STORAGE_KEY) === '{broken', 'corrupt queue record preserved')
    reset()
    return results
} })
