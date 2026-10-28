import { flushSync } from 'react-dom'
import type { Root } from 'react-dom/client'
import { useAssistantSpeechInput } from '../../src/renderer/src/pages/assistant/useAssistantSpeechInput'
import { AssistantVoiceRecorderBar } from '../../src/renderer/src/pages/assistant/AssistantVoiceRecorderBar'
import { useAssistantComposerController } from '../../src/renderer/src/pages/assistant/useAssistantComposerController'
import { SettingsProvider } from '../../src/renderer/src/lib/settings'
import { readAssistantComposerSessionState, writeAssistantComposerSessionState } from '../../src/renderer/src/pages/assistant/assistant-composer-session-state'
import { ASSISTANT_COMPOSER_FOCUS_CLASS_NAME } from '../../src/renderer/src/pages/assistant/assistant-composer-focus'

export async function checkVoiceRecorderInput(root: Root): Promise<string[]> {
    const check = (value: unknown, label: string) => { if (!value) throw new Error(label) }
    const sleep = () => new Promise(resolve => setTimeout(resolve, 20))
    const wait = async (test: () => boolean, label: string) => {
        const deadline = performance.now() + 2500
        while (!test() && performance.now() < deadline) await sleep()
        check(test(), `${label}: ${JSON.stringify({ draft, sent: sent.length, scope, calls: apiCalls, error: voice?.speechError, recording: voice?.isRecording, transcribing: voice?.isTranscribing, model: controller?.selectedModel, effort: controller?.selectedEffort, effortOptions: controller?.effortOptions })}`)
    }
    const focusStyle = async (enabled: boolean) => {
        const request = { focusSelector: '[data-recorder-frame]', pseudoClass: 'focus-within', enabled, done: false }
        ;(window as any).sidebarPointerRequest = request
        await wait(() => request.done, 'Chromium applies the recording focus style without a foreground window')
    }
    let processor: any, stops = 0, closes = 0, apiCalls = 0
    const payloads: any[] = [], cancelledRequests: string[] = []
    let clockOffset = 0
    const realNow = performance.now.bind(performance)
    Object.defineProperty(performance, 'now', { configurable: true, value: () => realNow() + clockOffset })
    let voice!: ReturnType<typeof useAssistantSpeechInput>, setDraft!: (value: string) => void
    let draft = '', scope = 'voice-fixture:one', deferred = false, transcriptFails = false, sendFails = false
    const originalModel = 'openai-codex/gpt-6.1-sol'
    let mounted = true, model = originalModel, thinking = false
    let controller!: ReturnType<typeof useAssistantComposerController>
    const attachment = { id: 'file', path: '/fixture.ts', name: 'fixture.ts', kind: 'code' as const, source: 'manual' as const }
    const originalScope = scope
    writeAssistantComposerSessionState(scope, { draft: 'typed draft', contextFiles: [attachment], model, effort: 'high', runtimeMode: 'full-access', interactionMode: 'default' })
    let release!: (value: unknown) => void
    const sent: { sessionId: string; prompt: string; files: unknown[]; options: any }[] = []
    class SyntheticAudioContext {
        sampleRate = 24000
        destination = {}
        resume() { return Promise.resolve() }
        close() { closes++; return Promise.resolve() }
        createMediaStreamSource() { return { connect() {}, disconnect() {} } }
        createScriptProcessor() { processor = { connect() {}, disconnect() {}, onaudioprocess: null }; return processor }
        createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} } }
    }
    ;(window as any).AudioContext = SyntheticAudioContext
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [{ stop() { stops++ } }] }) } })
    ;(window as any).devscope = {
        preferences: {
            get: async () => ({ success: true, snapshot: { revision: 1, desktopLegacyMigrationComplete: true, settings: { assistantTranscriptionEngine: 'codex' } } }),
            onChanged: () => () => {}
        },
        secrets: { migrateLegacyHostedAiKeys: async () => ({ success: false }) },
        assistant: { cancelVoiceTranscription: async (id: string) => { cancelledRequests.push(id); return { success: true, cancelled: true } }, transcribeVoice: (payload: any) => {
        payloads.push(payload)
        apiCalls++
        check(stops >= apiCalls && closes >= apiCalls, 'Microphone and audio context stop before transcription')
        if (deferred) return new Promise(resolve => { release = resolve })
        return Promise.resolve(transcriptFails ? { success: false, error: 'Synthetic transcription failure' } : { success: true, text: 'spoken words' })
    } } }
    function ComposerFixture() {
        const targetSession = scope
        controller = useAssistantComposerController({
            sessionId: targetSession,
            disabled: false, isConnected: true, isSending: false, isThinking: thinking,
            activeModel: model, activeEffort: 'high', runtimeMode: 'full-access', interactionMode: 'default',
            modelOptions: [{ id: model, label: model, supportedEfforts: ['high'] }],
            onSend: async (prompt, files, options) => { sent.push({ sessionId: targetSession, prompt, files, options }); return !sendFails }
        })
        const { text, setText, textareaRef } = controller
        draft = text; setDraft = setText
        voice = controller.voiceInput
        const showRecorder = voice.isRecording || voice.isTranscribing
        return <div>
            <button onClick={voice.startRecording}>Record</button>
            <div data-recorder-frame className={`w-[620px] rounded-full border border-white/[0.09] ${ASSISTANT_COMPOSER_FOCUS_CLASS_NAME}`}>
                {showRecorder ? <AssistantVoiceRecorderBar durationLabel={voice.durationLabel} isTranscribing={voice.isTranscribing} waveformLevels={voice.waveformLevels} onCancel={voice.cancelRecording} onSubmit={voice.submitRecording} onSend={voice.submitAndSendRecording} />
                    : <textarea ref={textareaRef} value={text} onChange={event => setText(event.target.value)} />}
            </div>
            {voice.speechError ? <div role="alert">{voice.speechError}</div> : null}
        </div>
    }
    const render = () => flushSync(() => root.render(<SettingsProvider>{mounted ? <ComposerFixture /> : <button data-navigation-target>Other page</button>}</SettingsProvider>))
    const action = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
    const start = async (text = 'typed draft') => {
        flushSync(() => { setDraft(text); controller.upsertAttachment(attachment) }); voice.startRecording()
        await wait(() => voice.isRecording, 'Recording starts without device access')
        processor.onaudioprocess({ inputBuffer: { numberOfChannels: 1, length: 4096, getChannelData: () => new Float32Array(4096).fill(.1) } })
    }
    render(); await sleep(); await sleep()
    await start()
    const input = document.querySelector<HTMLElement>('[aria-label="Voice note recorder"]')!
    check(document.activeElement === input, 'Recording input receives focus')
    const frame = document.querySelector<HTMLElement>('[data-recorder-frame]')!
    input.blur()
    await focusStyle(false)
    await sleep()
    const unfocusedShadow = getComputedStyle(frame).boxShadow
    await focusStyle(true)
    await wait(() => getComputedStyle(frame).boxShadow !== unfocusedShadow, `Focused recording shows the composer focus ring (baseline: ${unfocusedShadow}; classes: ${frame.className})`)
    input.blur(); await focusStyle(false); await sleep()
    check(document.activeElement !== input, 'Recording input releases DOM focus')
    action('Stop and transcribe voice note').click()
    await wait(() => !voice.isRecording && !voice.isTranscribing, 'Stop finishes transcription')
    check(draft === 'typed draft spoken words' && sent.length === 0, `Stop leaves the transcript in the draft without sending: ${JSON.stringify({ draft, sent: sent.length, apiCalls, payloads: payloads.length, error: voice.speechError, starting: voice.isStarting, recording: voice.isRecording, transcribing: voice.isTranscribing, loadedSessionId: controller.loadedSessionId, stored: readAssistantComposerSessionState(scope), model: controller.selectedModel })}`)

    await start('long draft')
    const longSamples = new Float32Array(24000 * 130).fill(.1)
    processor.onaudioprocess({ inputBuffer: { numberOfChannels: 1, length: longSamples.length, getChannelData: () => longSamples } })
    clockOffset = 130_000
    await new Promise(resolve => setTimeout(resolve, 180))
    check(voice.isRecording && !voice.isTranscribing && voice.durationMs > 120_000, 'Recording continues beyond the old two-minute auto-stop')
    action('Stop and transcribe voice note').click()
    await wait(() => !voice.isRecording && !voice.isTranscribing, 'Long recording finishes normally')
    check(payloads.at(-1).durationMs > 130_000 && payloads.at(-1).durationMs < 480_000, 'The complete long PCM recording reaches transcription, without truncation at two minutes')
    check(draft === 'long draft spoken words' && sent.length === 0, 'A long Stop result remains a draft, not an automatic send')
    clockOffset = 0


    await start()
    action('Transcribe and send voice note').click()
    voice.submitAndSendRecording()
    await wait(() => !voice.isTranscribing && sent.length === 1, 'Send transcribes and submits once')
    check(sent[0].prompt === 'typed draft spoken words', 'Submission uses the complete transcript instead of stale text')
    check(sent[0].files.length === 1 && sent[0].options.model === originalModel && sent[0].options.effort === 'high' && sent[0].options.dispatchMode === 'immediate', 'Voice send preserves files, model, effort, permissions and normal dispatch')
    check(draft === '', 'Successful send clears the draft')

    await start('')
    document.querySelector<HTMLElement>('[aria-label="Voice note recorder"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await wait(() => !voice.isTranscribing && sent.length === 2, 'Enter transcribes and sends from the recording input')
    check(sent[1].prompt === 'spoken words', 'Enter submits the transcript')

    await start('keep draft'); transcriptFails = true
    action('Transcribe and send voice note').click()
    await wait(() => !voice.isRecording && !voice.isTranscribing, 'Failed transcription settles')
    check(sent.length === 2 && draft === 'keep draft' && voice.speechError, 'Failed transcription sends nothing and preserves the draft')
    transcriptFails = false

    await start(); sendFails = true
    action('Transcribe and send voice note').click()
    await wait(() => !voice.isTranscribing && sent.length === 3, 'Failed send settles')
    check(draft === 'typed draft spoken words', 'A rejected send restores the full transcript')
    sendFails = false

    deferred = true
    await start('keep cancelled draft')
    action('Transcribe and send voice note').click()
    await wait(() => voice.isTranscribing && Boolean(release), 'Deferred transcription starts')
    action('Cancel transcription').click()
    release({ success: true, text: 'discard cancelled result' }); await sleep(); await sleep()
    check(sent.length === 3 && draft === 'keep cancelled draft', 'Cancellation suppresses late transcription and sending')
    check(cancelledRequests.at(-1) === payloads.at(-1).requestId, 'Cancel targets the exact active backend upload/chunk job')

    release = undefined as any
    await start('original send draft')
    action('Transcribe and send voice note').click()
    await wait(() => voice.isTranscribing && Boolean(release), 'Thread-switch transcription starts')
    const originalRelease = release
    scope = 'voice-fixture:other'; model = 'fixture/other-model'; thinking = true
    writeAssistantComposerSessionState(scope, { draft: 'other chat typing' })
    render(); await sleep()
    const navigationTarget = document.querySelector<HTMLButtonElement>('button')!
    navigationTarget.focus()
    originalRelease({ success: true, text: 'original transcript' })
    await wait(() => sent.length === 4, 'Explicit send completes for the original chat after navigation')
    await sleep()
    check(sent[3].sessionId === originalScope && sent[3].prompt === 'original send draft original transcript', 'Captured dispatch targets the original session')
    check(sent[3].options.model === originalModel && sent[3].options.effort === 'high' && sent[3].options.runtimeMode === 'full-access' && sent[3].options.dispatchMode === 'immediate' && sent[3].files.length === 1, 'Navigation does not replace captured configuration, attachments or dispatch mode')
    check(draft === 'other chat typing' && document.activeElement === navigationTarget, 'A detached result neither edits nor focuses the selected chat')
    check(cancelledRequests.length === 1, 'Navigation leaves the original upload running')

    scope = originalScope; model = originalModel; thinking = false; render(); await sleep()
    release = undefined as any
    await start('recording before navigation')
    const callsBeforeNavigation = apiCalls
    scope = 'voice-fixture:other'; render()
    await wait(() => apiCalls === callsBeforeNavigation + 1 && Boolean(release), 'Navigation stops the microphone and transcribes captured audio')
    check(!voice.isRecording && !voice.isTranscribing, 'The new chat does not inherit recorder presentation')
    release({ success: true, text: 'recovered audio' }); await sleep(); await sleep()
    check(readAssistantComposerSessionState(originalScope).draft === 'recording before navigation recovered audio' && sent.length === 4, 'Navigation recovers audio into the original backing draft without sending')
    check(draft === 'other chat typing', 'Recovery preserves the other chat')
    scope = originalScope; render(); await sleep()
    check(draft === 'recording before navigation recovered audio', 'Returning hydrates the completed original draft')
    await new Promise(resolve => setTimeout(resolve, 450))
    check(readAssistantComposerSessionState(originalScope).draft === draft, 'A stale persistence debounce cannot overwrite recovery')

    release = undefined as any
    await start('pending edit')
    action('Stop and transcribe voice note').click()
    await wait(() => Boolean(release), 'Delayed draft transcription starts')
    scope = 'voice-fixture:other'; render(); await sleep()
    scope = originalScope; render(); await sleep()
    flushSync(() => setDraft('pending edit plus typed changes'))
    release({ success: true, text: 'late speech' }); await sleep(); await sleep()
    check(draft === 'pending edit plus typed changes late speech', 'A result reads the returned owner and preserves edits made while it was pending')
    check(sent.length === 4, 'Stop never becomes a send after navigation')

    release = undefined as any
    await start('unmounted pending draft')
    action('Stop and transcribe voice note').click()
    await wait(() => Boolean(release), 'Pending-unmount transcription starts')
    mounted = false; render()
    const otherPage = document.querySelector<HTMLButtonElement>('[data-navigation-target]')!
    otherPage.focus()
    release({ success: true, text: 'finished off page' }); await sleep(); await sleep()
    check(readAssistantComposerSessionState(originalScope).draft === 'unmounted pending draft finished off page', 'An unmounted composer writes completion to its original backing draft')
    check(document.activeElement === otherPage && sent.length === 4, 'Off-page completion neither steals focus nor sends')
    mounted = true; render(); await sleep()
    check(draft === 'unmounted pending draft finished off page', 'Remount restores the completed off-page transcription')

    release = undefined as any
    await start('unmount live audio')
    const callsBeforeUnmount = apiCalls
    mounted = false; render()
    await wait(() => apiCalls === callsBeforeUnmount + 1 && Boolean(release), 'Unmount stops live capture and recovers its audio')
    release({ success: true, text: 'saved after unmount' }); await sleep(); await sleep()
    check(readAssistantComposerSessionState(originalScope).draft === 'unmount live audio saved after unmount', 'Unmounted live audio reaches the original draft')
    check(cancelledRequests.length === 1 && sent.length === 4, 'Only explicit cancel cancels uploads; navigation and unmount never auto-send')

    mounted = true; render(); await sleep()
    release = undefined as any
    await start('clicked send text')
    action('Transcribe and send voice note').click()
    await wait(() => Boolean(release), 'Post-click edit transcription starts')
    flushSync(() => setDraft('clicked send text plus newer typing'))
    release({ success: true, text: 'delayed speech' })
    await wait(() => !voice.isTranscribing && sent.length === 5, 'Post-click edit send finishes')
    check(sent[4].prompt === 'clicked send text delayed speech', 'Transcribe-and-send dispatches the draft captured at the send gesture')
    check(draft === 'clicked send text plus newer typing delayed speech', 'Accepted send cannot clear edits made after clicking while transcription was pending')
    root.unmount()
    delete (performance as any).now
    return ['actual composer controller + speech hook: long PCM capture, explicit Send/Enter with original configuration/files, delayed cross-chat completion without focus theft, navigation and unmount recording recovery, returned-owner typed edits, persistence debounce, failures and exact-request cancellation pass (synthetic microphone/API)']
}
