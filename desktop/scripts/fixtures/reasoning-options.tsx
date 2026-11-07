import { ComposerSendButton } from '../../src/renderer/src/pages/assistant/ComposerSendButton'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { SettingsProvider, loadSettings } from '../../src/renderer/src/lib/settings'
import { useAssistantComposerController } from '../../src/renderer/src/pages/assistant/useAssistantComposerController'
import { ComposerFooterControls } from '../../src/renderer/src/pages/assistant/AssistantComposerSections'
import { rememberComposerChoices } from '../../src/renderer/src/pages/assistant/assistant-remembered-choices'
import type { AssistantModelInfo } from '../../src/shared/assistant/contracts'

checkSettingsDefaults()
function checkSettingsDefaults() {
    if (loadSettings({}).assistantBusyMessageMode !== 'steer' || loadSettings({ assistantBusyMessageMode: 'invalid' }).assistantBusyMessageMode !== 'steer') throw Error('missing/invalid busy preferences must default to Steer')
    if (loadSettings({ assistantBusyMessageMode: 'queue' }).assistantBusyMessageMode !== 'queue' || loadSettings({ assistantBusyMessageMode: 'force' }).assistantBusyMessageMode !== 'queue') throw Error('explicit Queue and legacy migration must be preserved')
}
const root = createRoot(document.getElementById('root')!)
const check = (value: unknown, message: string) => { if (!value) throw new Error(message) }
const sleep = (ms = 20) => new Promise(resolve => setTimeout(resolve, ms))
const wait = async (condition: () => boolean, label: string) => {
    const end = performance.now() + 3000
    while (!condition() && performance.now() < end) await sleep()
    check(condition(), label)
}
const first = 'openai-codex/unreleased-model-999'
const second = 'opencode-harness/new-provider/future-model'
const unknown = 'opencode-harness/new-provider/no-metadata'
let models: AssistantModelInfo[] = [
    { id: first, label: 'Future model', supportedEfforts: ['low', 'high', 'max'] },
    { id: second, label: 'Native variants', supportedEfforts: ['none', 'variant:Deep%20mode'] },
    { id: unknown, label: 'Metadata unavailable', reasoningStatus: 'unknown' },
]
let working = false
let stopped = 0
let defaults = true
let activeModel = first
let activeEffort: any = 'high'
let controller!: ReturnType<typeof useAssistantComposerController>
const sent: any[] = []
;(window as any).devscope = {
    preferences: { get: async () => ({ success: true, snapshot: { revision: 0, desktopLegacyMigrationComplete: true, settings: {} } }), onChanged: () => () => {}, update: async () => ({ success: true }) },
    secrets: { migrateLegacyHostedAiKeys: async () => ({ success: false }) },
}
rememberComposerChoices({ model: first, effort: 'high', runtimeMode: 'approval-required' })
function Fixture() {
    controller = useAssistantComposerController({ sessionId: 'reasoning-fixture', useSettingsDefaults: defaults,
        disabled: false, isConnected: true, isSending: false, isThinking: working, onStop: () => { stopped++ },
        activeModel, activeEffort, runtimeMode: 'approval-required', modelOptions: models,
        onSend: async (_text, _files, options) => { sent.push(options); return true },
    })
    return <div style={{ padding: 24, marginTop: 220, boxSizing: 'border-box', width: 'min(100%, 650px)' }}>
        <textarea ref={controller.textareaRef} value={controller.text} onChange={event => controller.setText(event.target.value)} />
        <ComposerFooterControls {...controller as any} placement="bottom" />
        <ComposerSendButton disabled={controller.capabilities.sendDisabled || Boolean(controller.selectionUnavailableReason)}
            isConnected isThinking={working} canSend={controller.capabilities.canSend}
            onStop={() => { stopped++ }} onSend={() => void controller.handleSend()} />
        <p role="status">{controller.selectionUnavailableReason}</p>
    </div>
}
const render = () => flushSync(() => root.render(<SettingsProvider><Fixture /></SettingsProvider>))
;(window as any).verifyReasoning = (async () => {
    render(); await wait(() => controller.selectedEffort === 'high', 'initial choice remains exact')
    flushSync(() => controller.setSelectedModel(second))
    await wait(() => controller.selectedEffort === 'default' && !controller.selectionUnavailableReason, 'model switch defaults without inventing an effort')
    flushSync(() => controller.setSelectedEffort('variant:Deep%20mode'))
    flushSync(() => controller.setSelectedModel(first))
    await wait(() => controller.selectedEffort === 'high', 'first model restores its own saved effort')
    flushSync(() => controller.setSelectedModel(second))
    await wait(() => controller.selectedEffort === 'variant:Deep%20mode', 'native choice restores by provider/model')
    flushSync(() => { controller.setText('fixture'); controller.setShowTraitsDropdown(true) })
    await wait(() => document.body.textContent?.includes('Deep mode') === true, 'opaque ID renders its native label')
    await controller.handleSend()
    check(sent[0]?.effort === 'variant:Deep%20mode' && sent[0]?.model === second, 'actual send preserves native selection')
    // Existing explicit values survive a catalog refresh and expose recovery.
    defaults = false
    activeModel = second
    activeEffort = 'variant:Deep%20mode'
    models = models.map(model => model.id === second ? { ...model, supportedEfforts: [] } : model)
    render()
    await wait(() => Boolean(controller.selectionUnavailableReason), 'removed option is visible instead of silently rewritten')
    await wait(() => Array.from(document.querySelectorAll('button')).some(button => button.textContent === 'Use provider default'), 'one-option catalog still exposes recovery')
    Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === 'Use provider default')!.click()
    await wait(() => controller.selectedEffort === 'default' && !controller.selectionUnavailableReason, 'recovery makes sending available')
    flushSync(() => controller.setSelectedModel(unknown))
    await wait(() => controller.selectedEffort === 'default' && !controller.selectionUnavailableReason, 'unknown metadata never means off or blocks sending')
    flushSync(() => controller.setText('default fixture'))
    await controller.handleSend()
    check(sent.at(-1)?.effort === 'default', 'unknown model sends the explicit provider-default choice')
    working = true; render()
    await wait(() => controller.busyMessageMode === 'steer', 'fresh settings default to steering')
    flushSync(() => controller.setText('steer while working'))
    const send = document.querySelector<HTMLButtonElement>('[aria-label="Send"]')!
    check(send && !document.querySelector('[aria-label="Stop current turn"]'), 'draft replaces Stop with Send during active work')
    send.click()
    await wait(() => sent.at(-1)?.dispatchMode === 'steer', 'primary button submits actual steering dispatch')
    check(stopped === 0, 'steering never invokes Stop')
    await wait(() => Boolean(document.querySelector('[aria-label="Stop current turn"]')), 'empty draft restores Stop')
    document.querySelector<HTMLButtonElement>('[aria-label="Stop current turn"]')!.click()
    check(stopped === 1, 'empty working composer still stops the turn')
    return ['working draft sends steer, empty draft stops, fresh settings default to steer', 'future models/native variants, per-model restore, exact submission, refresh invalidation/recovery, unknown capabilities']
})()

;(window as any).showNativeChoices = async () => {
    defaults = true; working = false; models = models.map(model => model.id === second ? { ...model, supportedEfforts: ['none', 'variant:Deep%20mode'] } : model)
    render(); flushSync(() => { controller.setSelectedModel(second); controller.setSelectedEffort('variant:Deep%20mode'); controller.setText('A message for the current task'); controller.setShowTraitsDropdown(true) })
    await sleep(350)
}
