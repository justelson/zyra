import assert from 'node:assert/strict'
import { projectVoiceLiveTimelineMessages } from '../src/renderer/src/pages/assistant/assistant-voice-live-timeline'
import { getTimelineEntries } from '../src/renderer/src/pages/assistant/assistant-timeline-helpers'
import type { AssistantActivity } from '../src/shared/assistant/contracts'

const startedAt = '2026-10-04T10:00:00.000Z'
const transcript = [{ id: 'spoken-intro', role: 'assistant', text: 'Let me check the available plugins.', final: false }]
const first = projectVoiceLiveTimelineMessages({ transcript, canonicalMessages: [], voiceStartedAt: startedAt, nowMs: Date.parse(startedAt) + 1000 })
assert.equal(first.messages.length, 1, 'assistant speech must appear before completion, just like user speech')
assert.equal(first.messages[0]?.streaming, true)
const plugin: AssistantActivity = { id: 'plugin', kind: 'tool', tone: 'tool', summary: 'Using plugin_mcp', turnId: null, createdAt: '2026-10-04T10:00:02.000Z', payload: { toolName: 'plugin_mcp', status: 'running' } }
const next = projectVoiceLiveTimelineMessages({ transcript: [{ ...transcript[0]!, text: 'Let me check the available plugins now.' }], canonicalMessages: [], activities: [plugin], voiceStartedAt: startedAt, previousAnchors: first.anchors, nowMs: Date.parse(startedAt) + 3000 })
assert.equal(next.messages[0]?.createdAt, first.messages[0]?.createdAt, 'new actions must not move an existing spoken introduction below the work')
assert.deepEqual(getTimelineEntries(next.messages, [plugin]).map(entry => entry.type), ['message', 'activity'])
const completed = projectVoiceLiveTimelineMessages({ transcript: [{ ...transcript[0]!, final: true }], canonicalMessages: [], activities: [plugin], voiceStartedAt: startedAt, previousAnchors: next.anchors, nowMs: Date.parse(startedAt) + 4000 })
assert.equal(completed.messages[0]?.createdAt, first.messages[0]?.createdAt, 'completion keeps the introduction in its original position')
console.log('Voice chat rail: live assistant words and narration-before-action ordering: ok')
