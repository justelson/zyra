import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import type { AssistantActivity } from '../src/shared/assistant/contracts'
import { getTimelineEntries } from '../src/renderer/src/pages/assistant/assistant-timeline-helpers'

const activities: AssistantActivity[] = Array.from({ length: 200 }, (_, index) => ({
    id: `bounded-thought-${index}`,
    kind: 'assistant.internal',
    tone: 'info',
    summary: `Thought ${index}`,
    detail: `**Thought ${index}**\n\nhidden-markdown-body-${index} ${'detail '.repeat(180)}`,
    turnId: 'bounded-turn',
    timelineSequence: index + 1,
    createdAt: new Date(Date.UTC(2026, 7, 24, 10, 0, index)).toISOString(),
    payload: {
        category: 'assistant-internal',
        output: `**Thought ${index}**\n\nhidden-markdown-body-${index} ${'detail '.repeat(180)}`
    }
}))

const startedAt = performance.now()
const entries = getTimelineEntries([], activities)
const elapsedMs = performance.now() - startedAt

assert.deepEqual(entries, [], 'internal model thoughts never create visible chat timeline entries')
assert.ok(elapsedMs < 150, `hidden internal work is filtered within 150ms; received ${elapsedMs.toFixed(2)}ms`)

console.log(JSON.stringify({ activities: activities.length, visibleEntries: entries.length, filterMs: Number(elapsedMs.toFixed(2)) }, null, 2))
console.log('Assistant hidden internal work bounds: ok')
