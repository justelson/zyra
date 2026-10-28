import { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createAssistantComposerHandlers } from '../../src/renderer/src/pages/assistant/assistant-composer-handlers'
import { getContextFileMeta, getContentTypeTag, buildPromptWithContextFiles, buildPromptImageInputs, toKbLabel } from '../../src/renderer/src/pages/assistant/assistant-composer-utils'
import { AssistantAttachmentPill } from '../../src/renderer/src/pages/assistant/AssistantAttachmentCards'
import AssistantAttachmentPreviewModal from '../../src/renderer/src/pages/assistant/AssistantAttachmentPreviewModal'
import { TimelineMessage } from '../../src/renderer/src/pages/assistant/AssistantTimelineRows'
import type { ComposerContextFile } from '../../src/renderer/src/pages/assistant/assistant-composer-types'
import { SYNTHETIC_VIDEO_BASE64 } from './assistant-video-paste-data.mjs'

const bytes = Uint8Array.from(atob(SYNTHETIC_VIDEO_BASE64), value => value.charCodeAt(0))
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const check = (value: unknown, message: string) => { if (!value) throw new Error(message) }
async function wait(test: () => unknown, message: string) { for (let n = 0; n < 150; n++) { if (test()) return; await sleep(20) } throw new Error(message) }
let saves = 0, liveFiles: ComposerContextFile[] = [], imageInputs = 0
;(window as any).devscope = { assistant: {
    getPathForFile: () => '',
    persistClipboardImage: async ({ dataUrl }: { dataUrl: string }) => {
        const saved = Uint8Array.from(atob(dataUrl.split(',')[1]), value => value.charCodeAt(0))
        check(saved.length === bytes.length && saved.every((byte, index) => byte === bytes[index]), 'The real FileReader preserves every video byte')
        saves++
        return { success: true, path: (window as any).fixtureVideoURL }
    }
} }
const noop = () => undefined
function App() {
    const [files, setFiles] = useState<ComposerContextFile[]>([])
    const [text, setText] = useState('Inspect this clip')
    const [error, setError] = useState('')
    const [preview, setPreview] = useState<ComposerContextFile | null>(null)
    const [sent, setSent] = useState('')
    const [removing, setRemoving] = useState<string[]>([])
    const textareaRef = useRef<HTMLTextAreaElement | null>(null)
    liveFiles = files
    const handlers = createAssistantComposerHandlers({
        text, setText, contextFiles: files, setContextFiles: setFiles,
        disabled: false, isConnected: true, isSending: false, isThinking: false, allowEmptySubmit: false,
        inlineMentionTags: [], setInlineMentionTags: noop, removingAttachmentIds: removing, setRemovingAttachmentIds: setRemoving,
        selectedModelInputModes: ['text'], selectedModel: 'fixture-text-model', selectedRuntimeMode: 'default', selectedInteractionMode: 'default', selectedEffort: 'medium',
        setHistoryCursor: noop, setDraftBeforeHistory: noop, setSentPromptHistory: noop,
        textareaRef, setComposerCursor: noop, onBlockedSend: setError,
        onSend: async (prompt, attached) => { imageInputs = buildPromptImageInputs(attached).length; setSent(buildPromptWithContextFiles(prompt, attached)); return true }
    } as any)
    const meta = preview ? getContextFileMeta(preview) : null
    return <main className="flex h-full flex-col gap-5 p-6">
        {sent ? <section data-video-history><TimelineMessage message={{ id: 'video-message', role: 'user', text: sent, turnId: 'turn', createdAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-01T12:00:00.000Z' }} /></section> : null}
        <section className="mt-auto rounded-xl border border-[var(--surface-divider)] p-3">
            <div className="mb-2 flex gap-2" data-video-draft>{files.map(file => <AssistantAttachmentPill key={file.id} name={getContextFileMeta(file).name} category={getContextFileMeta(file).category} onOpen={() => setPreview(file)} onRemove={() => handlers.removeAttachment(file.id)} removing={removing.includes(file.id)} />)}</div>
            <textarea data-video-input className="w-full bg-transparent p-2 text-sm" ref={textareaRef} value={text} onChange={event => setText(event.target.value)} onPaste={handlers.handlePaste} />
            {error ? <p role="alert">{error}</p> : null}
            <button type="button" data-video-send disabled={!files.length} onClick={() => { void handlers.handleSend() }} className="rounded-md border border-[var(--surface-divider)] px-3 py-1">Send</button>
        </section>
        <AssistantAttachmentPreviewModal file={preview} meta={meta} contentType={preview ? getContentTypeTag(preview) : ''} sizeLabel={toKbLabel(preview?.sizeBytes)} showFormattingWarning={false} onClose={() => setPreview(null)} />
    </main>
}
createRoot(document.getElementById('root')!).render(<App />)
async function click(element: HTMLElement) {
    element.scrollIntoView({ block: 'nearest' }); await sleep(20)
    const box = element.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2
    check(element.contains(document.elementFromPoint(x, y)), 'The file control can actually be clicked')
    const request = { x, y, click: true, done: false }; (window as any).sidebarPointerRequest = request
    await wait(() => request.done, 'Hidden pointer delivered')
}
const video = () => document.querySelector<HTMLVideoElement>('video')
function settleMotion() { for (const animation of document.getAnimations()) { if (animation.effect?.getTiming().iterations !== Infinity) animation.finish() } }
async function close() { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait(() => !video(), 'Escape closes the video preview') }
async function run() {
    await wait(() => document.querySelector('[data-video-input]'), 'Input is mounted')
    const file = new File([bytes], 'synthetic-clip.mp4', { type: 'video/mp4' })
    let textReads = 0
    file.text = async () => { textReads++; throw new Error('Video bytes must not become text') }
    const transfer = new DataTransfer(); transfer.items.add(file)
    const event = new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true })
    document.querySelector('[data-video-input]')!.dispatchEvent(event)
    check(event.defaultPrevented, 'Paste is handled as a file, not inserted as binary text')
    await wait(() => liveFiles.length === 1, 'Video appears as a composer attachment')
    check(saves === 1 && textReads === 0 && liveFiles[0].kind === 'video' && !liveFiles[0].content, 'Video persistence/classification does not corrupt bytes or create native image input')
    check((document.querySelector('[data-video-input]') as HTMLTextAreaElement).value === 'Inspect this clip', 'Paste retains the typed draft')
    const pill = document.querySelector<HTMLElement>('[data-video-draft] button[title="Open preview"]') || document.querySelector<HTMLElement>('[data-video-draft] button')!
    check(pill.querySelector('.lucide-film'), 'Video attachments have a video icon')
    await click(pill)
    await wait(() => video()?.readyState! >= 2, 'The real local H.264 video decodes its first frame')
    check(video()!.paused && !video()!.autoplay && video()!.controls && video()!.videoWidth === 64, 'The actual player decodes video with controls and no autoplay')
    settleMotion()
    check(video()!.getBoundingClientRect().width >= Math.min(250, innerWidth - 80), 'The player fills the viewer rather than staying at tiny intrinsic dimensions')
    await video()!.play(); await wait(() => video()!.currentTime > .1, 'The pasted video really plays')
    video()!.pause(); video()!.currentTime = .5
    await wait(() => Math.abs(video()!.currentTime - .5) < .1, 'Video seeking works')
    await close()
    await click(document.querySelector('[data-video-send]')!)
    await wait(() => document.querySelector('[data-video-history] .lucide-film'), 'Sent history retains the VIDEO attachment and icon')
    check(imageInputs === 0 && liveFiles.length === 0, 'Send clears the attachment after acceptance and never submits it as an image')
    const history = document.querySelector('[data-video-history]')!
    check(!history.textContent?.includes('content:\\n') && !history.querySelector('[data-pasted-text]'), 'Sent videos never become pasted-text cards')
    await click(history.querySelector<HTMLElement>('button[title="Open preview"]') || history.querySelector<HTMLElement>('button')!)
    await wait(() => video()?.readyState! >= 2, 'Reopened history decodes a real video frame')
    check(video()!.paused && !video()!.autoplay && video()!.videoWidth === 64, 'History preview still has the original playable file without autoplay')
    settleMotion()
    return ['actual clipboard File event, binary persistence, video pill/preview, real H.264 playback/seek, text-model send and playable sent-history reopening without autoplay']
}
;(window as any).sidebarContinuityCheck = run()
