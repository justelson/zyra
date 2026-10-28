import assert from 'node:assert/strict'
import { createAssistantComposerHandlers } from '../src/renderer/src/pages/assistant/assistant-composer-handlers'
import { buildPromptImageInputs, buildPromptWithContextFiles, getContextFileMeta, getContentTypeTag } from '../src/renderer/src/pages/assistant/assistant-composer-utils'
import type { ComposerContextFile } from '../src/renderer/src/pages/assistant/assistant-composer-types'
import { parseSerializedAssistantMessage } from '../src/shared/assistant/message-attachments'
import { readAssistantComposerSessionState, writeAssistantComposerSessionState } from '../src/renderer/src/pages/assistant/assistant-composer-session-state'
import { createAssistantComposerQueueStorage } from '../src/renderer/src/pages/assistant/assistant-composer-queue-storage'
import { getAssistantClipboardFiles, getAssistantVideoMimeType, MAX_CLIPBOARD_VIDEO_BYTES } from '../src/renderer/src/pages/assistant/assistant-clipboard-files'

// Synthetic clipboard only. Never reads or changes the operating-system clipboard.
const saved: any[] = []
let attachments: ComposerContextFile[] = []
const errors: string[] = []
Object.assign(globalThis, { window: { devscope: { assistant: {
    getPathForFile: () => '',
    persistClipboardImage: async (input: any) => { saved.push(input); return { success: true, path: 'C:\\fixture\\assistant\\attachments\\clipboard\\saved-clip.mp4' } }
} }, requestAnimationFrame: () => 0 } })
Object.assign(globalThis, { FileReader: class {
    result = ''; onload?: () => void; onerror?: () => void
    readAsDataURL(file: File) { void file.arrayBuffer().then(bytes => {
        this.result = `data:${file.type || 'application/octet-stream'};base64,${Buffer.from(bytes).toString('base64')}`
        this.onload?.()
    }).catch(() => this.onerror?.()) }
} })
const noop = () => {}
let ownerCurrent = true
const handlers = createAssistantComposerHandlers({
    setContextFiles: (update: any) => { attachments = typeof update === 'function' ? update(attachments) : update },
    contextFiles: [], removingAttachmentIds: [], onBlockedSend: (error: string) => errors.push(error),
    setRemovingAttachmentIds: noop, selectedModelInputModes: ['text'],
    textareaRef: { current: null }, isAttachmentOwnerCurrent: () => ownerCurrent
} as any)
const bytes = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 0, 255, 128, 1])
for (const mime of ['video/mp4', '']) {
    attachments = []; saved.length = 0
    const file = new File([bytes], 'clip.mp4', { type: mime })
    let textReads = 0
    file.text = async () => { textReads++; throw new Error('binary must not become text') }
    await handlers.attachFile(file, 'paste')
    assert.equal(attachments.length, 1)
    assert.equal(attachments[0].kind, 'video', 'pathless video must be classified before text fallback')
    assert.equal(textReads, 0)
    assert.equal(saved.length, 1)
    assert.deepEqual(Buffer.from(saved[0].dataUrl.split(',')[1], 'base64'), Buffer.from(bytes), 'persist exact binary bytes')
    assert.equal(attachments[0].content, undefined)
    assert.equal(getContextFileMeta(attachments[0]).category, 'video')
    assert.equal(getContentTypeTag(attachments[0]), 'VIDEO')
    assert.deepEqual(buildPromptImageInputs(attachments), [], 'video is not a provider-native image')
    const prompt = buildPromptWithContextFiles('Inspect this clip', attachments)
    assert.match(prompt, /\[VIDEO\]/)
    assert.match(prompt, /C:\\fixture\\assistant/, 'analysis tools need a durable accessible path')
    assert.match(prompt, /tools/i)
}
const videoAttachment = { ...attachments[0] }
const storageValues = new Map<string, string>()
const storage = { getItem: (key: string) => storageValues.get(key) ?? null, setItem: (key: string, value: string) => { storageValues.set(key, value) }, removeItem: (key: string) => { storageValues.delete(key) } }
Object.assign(globalThis, { localStorage: storage })
Object.assign(window, { dispatchEvent: () => true })
writeAssistantComposerSessionState('video-fixture', { contextFiles: [videoAttachment] }, { strict: true })
const restored = readAssistantComposerSessionState('video-fixture').contextFiles![0]
assert.equal(restored.kind, 'video', 'draft restore retains the video kind')
assert.equal(restored.path, videoAttachment.path)
const queue = createAssistantComposerQueueStorage(() => storage)
queue.write({ version: 1, entries: { 'video-fixture': [{ id: 'video-dispatch', sessionId: 'video-fixture', prompt: 'Inspect', contextFiles: [restored], options: { runtimeMode: 'approval-required', interactionMode: 'default', effort: 'medium' } }] }, held: {} })
const recovered = queue.read()
assert.equal(recovered.entries['video-fixture'][0].contextFiles[0].kind, 'video')
assert.equal(recovered.held['video-fixture'], true, 'queue restore never silently dispatches pasted videos')
const history = parseSerializedAssistantMessage(buildPromptWithContextFiles('Inspect', [restored]))
assert.equal(history.attachments[0].type, 'VIDEO')
assert.equal(history.attachments[0].path, restored.path)
assert.equal(history.attachments[0].content, null, 'sent history stores a file reference, not decoded video text')
const another = new File([bytes], 'second.webm', { type: 'video/webm' })
assert.deepEqual(getAssistantClipboardFiles({ items: [{ kind: 'file', getAsFile: () => null }] as any, files: [another] as any }), [another])
assert.deepEqual(getAssistantClipboardFiles({ items: [{ kind: 'file', getAsFile: () => another }] as any, files: [another, new File([bytes], 'third.mp4', { type: 'video/mp4' })] as any }).map(file => file.name), ['second.webm', 'third.mp4'], 'an incomplete item list cannot hide another file')
let prevented = false
handlers.handlePaste({ preventDefault: () => { prevented = true }, clipboardData: {
    items: [{ kind: 'file', getAsFile: () => null }], files: [], getData: () => 'valid text'
} } as any)
assert.equal(prevented, false, 'null file items must not swallow ordinary text')
attachments = []; saved.length = 0; prevented = false
const file = new File([bytes], 'clip.mp4', { type: 'video/mp4' })
handlers.handlePaste({ preventDefault: () => { prevented = true }, clipboardData: {
    items: [{ kind: 'file', getAsFile: () => file }], files: [file], getData: () => ''
} } as any)
await new Promise(resolve => setTimeout(resolve, 10))
assert.equal(prevented, true)
assert.equal(saved.length, 1, 'items/files overlap attaches only once')
attachments = []; saved.length = 0
handlers.handlePaste({ preventDefault: noop, clipboardData: { items: [], files: [file], getData: () => '' } } as any)
await new Promise(resolve => setTimeout(resolve, 10))
assert.equal(attachments.length, 1, 'clipboard.files fallback')
assert.deepEqual(errors, [])
assert.equal(getAssistantVideoMimeType('clip.MOV', ''), 'video/quicktime')
assert.equal(getAssistantVideoMimeType('source.ts', ''), null)
assert.equal(getAssistantVideoMimeType('clip.mp4', 'text/plain'), null)
attachments = []; saved.length = 0
const oversized = new File([bytes], 'large.mp4', { type: 'video/mp4' })
Object.defineProperty(oversized, 'size', { value: MAX_CLIPBOARD_VIDEO_BYTES + 1 })
await handlers.attachFile(oversized, 'paste')
assert.equal(saved.length, 0, 'oversize rejected before FileReader allocation')
assert.equal(attachments.length, 0)
assert.match(errors.pop() || '', /64 MB/)
;(window.devscope.assistant as any).persistClipboardImage = async () => ({ success: false, error: 'disk full' })
await handlers.attachFile(file, 'paste')
assert.equal(attachments.length, 0, 'failed persistence must not leave a dangling attachment')
assert.equal(errors.pop(), 'disk full')
let finishSave!: (value: any) => void
;(window.devscope.assistant as any).persistClipboardImage = () => new Promise(resolve => { finishSave = resolve })
const stalePaste = handlers.attachFile(file, 'paste')
await new Promise(resolve => setTimeout(resolve, 0))
ownerCurrent = false
finishSave({ success: true, path: 'C:\\synthetic\\durable.mp4' })
await stalePaste
assert.equal(attachments.length, 0, 'late file completion must not attach to another session/question')
assert.deepEqual(errors, [])
ownerCurrent = true
let dispatches = 0, pendingDraft = 'Keep this draft', finishPending!: (value: any) => void
;(window.devscope.assistant as any).persistClipboardImage = () => new Promise(resolve => { finishPending = resolve })
const pendingHandlers = createAssistantComposerHandlers({
    text: pendingDraft, setText: (value: string) => { pendingDraft = value }, contextFiles: [], setContextFiles: noop,
    inlineMentionTags: [], setInlineMentionTags: noop, setHistoryCursor: noop, setDraftBeforeHistory: noop,
    setSentPromptHistory: noop, textareaRef: { current: null }, setComposerCursor: noop,
    isConnected: true, isThinking: false, isSending: false, disabled: false, allowEmptySubmit: false,
    selectedModelInputModes: ['text'], selectedRuntimeMode: 'approval-required', selectedInteractionMode: 'default', selectedEffort: 'medium',
    onSend: async () => { dispatches++; return true }, onBlockedSend: (message: string) => errors.push(message),
    removingAttachmentIds: [], setRemovingAttachmentIds: noop
} as any)
const pendingPaste = pendingHandlers.attachFile(file, 'paste')
await new Promise(resolve => setTimeout(resolve, 0))
await pendingHandlers.handleSend()
assert.equal(dispatches, 0, 'Send cannot silently omit a video that is still being prepared')
assert.equal(pendingDraft, 'Keep this draft', 'a pending attachment must not clear the draft')
assert.match(errors.pop() || '', /attachments.*finish/i)
finishPending({ success: true, path: 'C:\\synthetic\\video.mp4' })
await pendingPaste
console.log('Video paste: exact bytes, empty MIME, draft/queue/history, clipboard fallbacks, pending-send guard and safe failures passed')
