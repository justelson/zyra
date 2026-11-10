import assert from 'node:assert/strict'
import { buildAssistantChatResourceTurns, buildAssistantPreviewResources } from '../src/renderer/src/pages/assistant/assistant-chat-resources'
import type { AssistantMessage } from '../src/shared/assistant/contracts'

const messages: AssistantMessage[] = [
    { id: 'user', role: 'user', text: 'Show the previews', turnId: 'turn', streaming: false, createdAt: '2026-11-09T00:00:00Z', updatedAt: '2026-11-09T00:00:00Z' },
    { id: 'progress', role: 'assistant', text: '![Preview](<C:/project/preview.png>)', turnId: 'turn', streaming: false, createdAt: '2026-11-09T00:00:01Z', updatedAt: '2026-11-09T00:00:01Z' },
    { id: 'final', role: 'assistant', text: 'Done. [Preview](<c:/project/preview.png>)', turnId: 'turn', streaming: false, createdAt: '2026-11-09T00:00:02Z', updatedAt: '2026-11-09T00:00:02Z' }
]
const turns = buildAssistantChatResourceTurns({ messages, activities: [], projectPath: 'C:/project' })
const resources = buildAssistantPreviewResources({ turns, projectPath: 'C:/project', activeFile: { path: 'C:/project/preview.png', name: 'preview.png', type: 'image' } })
assert.equal(resources.length, 1, 'repeated references and the active preview share one resource')
assert.equal(resources[0].origins.length, 1, 'repeated same-turn references keep one origin')
const earlierOnly = buildAssistantPreviewResources({ turns: buildAssistantChatResourceTurns({ messages: [messages[0], messages[1], { ...messages[2], text: 'Finished.' }], activities: [], projectPath: 'C:/project' }), projectPath: 'C:/project' })
assert.equal(earlierOnly.length, 1, 'a progress image remains available after a later final answer')
const fallback = buildAssistantPreviewResources({ turns: [], projectPath: null, activeFile: { path: 'C:/old/image.png', name: 'image.png', type: 'image' } })
assert.equal(fallback.length, 1, 'the current image never has an empty resource navigator')
assert.equal(fallback[0].origins.length, 0, 'a fallback never invents provenance')
console.log('Chat resources: progress, repeated references, current-image fallback and independent transcript discovery passed')

const repeatedRemote = buildAssistantPreviewResources({ turns: buildAssistantChatResourceTurns({ messages: [messages[0], { ...messages[1], text: '![One](https://example.test/image.png#one) ![Again](https://example.test/image.png#two)' }, messages[2]], activities: [], projectPath: 'C:/project' }), projectPath: 'C:/project', activeFile: { path: 'https://example.test/image.png#zoom', name: 'image.png', type: 'image' } })
assert.equal(repeatedRemote.filter(r => r.url?.includes('example.test')).length, 1, 'image fragments and the opened image resolve to one resource')

const orphan = buildAssistantPreviewResources({turns:buildAssistantChatResourceTurns({messages:[messages[1]],activities:[],projectPath:'C:/project'}),projectPath:'C:/project'})
assert.equal(orphan.length,1,'an image in a partial transcript remains discoverable without its older prompt')
assert.equal(orphan[0].latestTurnNumber,0,'unknown turn position is not invented')
