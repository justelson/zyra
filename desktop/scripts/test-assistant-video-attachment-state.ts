import assert from 'node:assert/strict'
import { readAssistantComposerSessionState, writeAssistantComposerSessionState } from '../src/renderer/src/pages/assistant/assistant-composer-session-state'
import { createAssistantComposerQueueStorage } from '../src/renderer/src/pages/assistant/assistant-composer-queue-storage'
import { buildPromptWithContextFiles, buildPromptImageInputs, getContextFileMeta } from '../src/renderer/src/pages/assistant/assistant-composer-utils'
import type { ComposerContextFile } from '../src/renderer/src/pages/assistant/assistant-composer-types'

const records = new Map<string, string>()
const localStorage = { getItem: (key: string) => records.get(key) || null, setItem: (key: string, value: string) => { records.set(key, value) }, removeItem: (key: string) => { records.delete(key) } }
Object.assign(globalThis, { localStorage, window: { dispatchEvent: () => true } })
if (typeof CustomEvent === 'undefined') Object.assign(globalThis, { CustomEvent: class { constructor(public type: string, public options: unknown) {} } })
const video: ComposerContextFile = {
    id: 'video', path: 'C:\\synthetic\\assistant\\attachments\\clipboard\\durable-clip.mp4',
    name: 'clip.mp4', kind: 'video', mimeType: 'video/mp4', sizeBytes: 12, source: 'paste'
}
writeAssistantComposerSessionState('chat', { contextFiles: [video] }, { strict: true })
const restored = readAssistantComposerSessionState('chat').contextFiles!
assert.equal(restored[0].kind, 'video', 'draft normalization must retain video kind')
assert.equal(restored[0].path, video.path)
assert.equal(restored[0].content, undefined, 'binary payload is not copied into localStorage')
assert.equal(restored[0].previewDataUrl, undefined)
const queueStorage = createAssistantComposerQueueStorage(() => localStorage)
queueStorage.write({ version: 1, held: {}, entries: { chat: [{
    id: 'queued-video', sessionId: 'chat', prompt: 'Inspect the clip', contextFiles: restored,
    options: { runtimeMode: 'approval-required', interactionMode: 'default', effort: 'medium', dispatchMode: 'queue' }
}] } })
const recovered = queueStorage.read().entries.chat[0]
assert.equal(recovered.contextFiles[0].kind, 'video')
assert.equal(recovered.contextFiles[0].path, video.path)
assert.equal(getContextFileMeta(recovered.contextFiles[0]).category, 'video')
assert.equal(getContextFileMeta({ name: 'legacy.mp4', kind: 'file' }).category, 'video', 'legacy file classification recovers video by extension')
assert.deepEqual(buildPromptImageInputs(recovered.contextFiles), [])
const sent = buildPromptWithContextFiles(recovered.prompt, recovered.contextFiles)
assert.match(sent, /Pasted video \[VIDEO\]/)
assert.ok(sent.includes(video.path), 'canonical prompt retains durable tool-readable file reference')
assert.doesNotMatch(sent, /data:video/)
assert.match(sent, /explicit video\/file analysis tools/)
console.log('Video attachment draft/queue recovery and outgoing history serialization passed')
