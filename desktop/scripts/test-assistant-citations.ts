import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { assistantCitationFingerprint, locateAssistantCitation, assistantCitationSourceHref, formatAssistantCitation, parseAssistantCitation, type AssistantCitation } from '../src/shared/assistant/assistant-citations'

import { citationContextFile, updateCitationComment } from '../src/renderer/src/pages/assistant/assistant-citations'
import { buildPromptWithContextFiles } from '../src/renderer/src/pages/assistant/assistant-composer-utils'
import { readAssistantComposerSessionState, writeAssistantComposerSessionState } from '../src/renderer/src/pages/assistant/assistant-composer-session-state'
import { createAssistantComposerQueueStorage } from '../src/renderer/src/pages/assistant/assistant-composer-queue-storage'
import { parseSerializedAssistantMessage } from '../src/shared/assistant/message-attachments'

const citation: AssistantCitation = { version: 1, sessionId: 'local chat', threadId: 'thread/one', messageId: 'message?one', text: 'A preserved passage.\nSecond line.', start: 12, end: 12 + 'A preserved passage.\nSecond line.'.length, prefix: 'Earlier text', suffix: 'Later text', comment: 'Explain this detail.' }
assert.deepEqual(parseAssistantCitation(citation), citation)
assert.deepEqual(parseAssistantCitation(JSON.parse(JSON.stringify(citation))), citation, 'reload preserves structured identity and passage')
for (const invalid of [null, [], {}, { ...citation, version: 2 }, { ...citation, sessionId: '' }, { ...citation, messageId: 'bad\nidentity' }, { ...citation, threadId: '' }, { ...citation, text: ' ' }, { ...citation, start: -1 }, { ...citation, start: 0.5 }, { ...citation, end: citation.end + 1 }, { ...citation, end: Infinity }, { ...citation, prefix: 'a'.repeat(121) }, { ...citation, suffix: 'a'.repeat(121) }, { ...citation, comment: 'a'.repeat(8001) }, { ...citation, text: 'a'.repeat(8001), start: 0, end: 8001 }]) assert.equal(parseAssistantCitation(invalid), null)
assert.ok(parseAssistantCitation({ ...citation, text: 'a'.repeat(8000), start: 0, end: 8000, comment: 'b'.repeat(8000) }), 'inclusive payload boundaries')
assert.equal(assistantCitationSourceHref(citation), '/assistant/chat/local%20chat/thread/thread%2Fone?message=message%3Fone')
assert.equal(assistantCitationSourceHref({ ...citation, threadId: undefined }), '/assistant/chat/local%20chat?message=message%3Fone')
const formatted = formatAssistantCitation(citation)
assert.match(formatted, /Quoted assistant response \(preserved snapshot\)/)
assert.ok(formatted.includes('> A preserved passage.\n> Second line.'))
assert.ok(formatted.includes('User comment:\nExplain this detail.'))
assert.ok(!formatAssistantCitation({ ...citation, comment: '' }).includes('User comment:'))
// Wiring regression checks supplement pure protocol tests; DOM behavior still needs a renderer smoke.
const source = (name: string) => readFileSync(new URL(`../src/renderer/src/pages/assistant/${name}`, import.meta.url), 'utf8')
assert.match(source('assistant-composer-types.ts'), /citation\?:/)
assert.match(source('AssistantTimelineRows.tsx'), /<AssistantCitationSelection messageId=\{message.id\}>/)
assert.match(source('AssistantComposerSections.tsx'), /file.citation \? \([\s\S]*?<AssistantCitationChip/)
assert.match(source('assistant-composer-utils.ts'), /parseAssistantCitation\(file.citation\)/)
assert.match(source('assistant-composer-utils.ts'), /formatAssistantCitation\(citation\)/)
const selection = source('AssistantCitationSelection.tsx')
assert.match(selection, /root.contains\(range.startContainer\)/)
assert.match(selection, /root.contains\(range.endContainer\)/)
assert.match(selection, /range.intersectsNode\(element\)/)
assert.match(selection, /requestAssistantContextFile\(citationContextFile\(pick.citation\), pick.targetChat\)/)
assert.match(selection, /onPointerDown=\{event => event.preventDefault\(\)\}/)
assert.ok(!selection.includes('onSend('), 'Cite must never send a prompt')
const fullText = citation.prefix + citation.text + citation.suffix
const anchored = { ...citation, sourceFingerprint: assistantCitationFingerprint(fullText) }
assert.deepEqual(locateAssistantCitation(fullText, anchored), { start: citation.start, end: citation.end })
assert.deepEqual(locateAssistantCitation('Changed. ' + fullText, anchored), { start: citation.start + 9, end: citation.end + 9 })
assert.equal(locateAssistantCitation(citation.text + ' x ' + citation.text, anchored), null, 'changed/ambiguous text cannot silently select another passage')
const storageData = new Map<string, string>()
const storage = { getItem: (key: string) => storageData.get(key) || null, setItem: (key: string, value: string) => { storageData.set(key, value) }, removeItem: (key: string) => { storageData.delete(key) } }
const oldWindow = globalThis.window, oldStorage = globalThis.localStorage
Object.assign(globalThis, { window: new EventTarget(), localStorage: storage })
try {
    const file = updateCitationComment(citationContextFile(anchored, 'saved-citation'), 'A new comment')
    writeAssistantComposerSessionState('target-chat', { draft: 'Preserve my draft', contextFiles: [file] }, { strict: true })
    const reopened = readAssistantComposerSessionState('target-chat')
    assert.equal(reopened.draft, 'Preserve my draft')
    assert.deepEqual(reopened.contextFiles?.[0].citation, file.citation, 'actual draft sanitizer preserves citation identity, selector and comment')
    const queue = createAssistantComposerQueueStorage(() => storage)
    queue.write({ version: 1, held: {}, entries: { 'target-chat': [{ id: 'queued', sessionId: 'target-chat', prompt: 'Question', options: {}, contextFiles: [file] }] } })
    assert.deepEqual(queue.read().entries['target-chat'][0].contextFiles[0].citation, file.citation, 'durable queue recovery preserves attribution')
    const prompt = buildPromptWithContextFiles('Question', [file])
    assert.ok(prompt.includes('A new comment') && prompt.includes(citation.text.split('\n')[0]), 'actual provider prompt receives quote and comment')
    const sent = parseSerializedAssistantMessage(prompt)
    assert.deepEqual(sent.attachments[0].citation, file.citation, 'canonical saved message retains durable typed metadata, not only readable Markdown')
} finally { Object.assign(globalThis, { window: oldWindow, localStorage: oldStorage }) }
console.log('Assistant citations: strict protocol, reanchoring/ambiguity, actual draft and queue persistence, sent-history metadata, attributed provider quote/comment and source links passed')
