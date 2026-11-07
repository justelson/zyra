import assert from 'node:assert/strict'
import type { AssistantActivity, AssistantMessage } from '../src/shared/assistant/contracts'
import { buildTimelineRows, getTimelineEntries } from '../src/renderer/src/pages/assistant/assistant-timeline-helpers'
import { groupTimelineRowsIntoWorkSummaries } from '../src/renderer/src/pages/assistant/assistant-turn-work'
import { projectThreadMessage } from '../src/shared/assistant/thread-message'

const at = (n: number) => new Date(Date.UTC(2026, 10, 6, 12, 0, n)).toISOString()
const user = (id: string, n: number, turnId: string | null = 'task'): AssistantMessage => ({ id, role: 'user', text: id, turnId, streaming: false, timelineSequence: n, createdAt: at(n), updatedAt: at(n) })
const assistant = (id: string, n: number, phase: AssistantMessage['phase'] = 'commentary', turnId = 'task'): AssistantMessage => ({ ...user(id, n, turnId), role: 'assistant', phase })
const tool = (id: string, n: number, turnId = 'task'): AssistantActivity => ({ id, kind: 'command', tone: 'tool', summary: id, turnId, timelineSequence: n, createdAt: at(n), payload: { command: 'echo fixture', status: 'completed' } })
const prompt = user('original-prompt', 0)
const first = assistant('first-update', 1)
const steer = user('steering-correction', 3)
const follow = assistant('following-correction', 4)
const tools = [tool('before-steer', 2), tool('after-steer', 5)]
const messages = [prompt, first, steer, follow]
const display = (messages: AssistantMessage[], activities: AssistantActivity[], working: boolean) => groupTimelineRowsIntoWorkSummaries({
    rows: buildTimelineRows(getTimelineEntries(messages, [...activities].reverse()), working, at(0)), messages,
    latestAssistantMessageId: messages.filter(message => message.role === 'assistant').at(-1)?.id || null,
    latestTurnStartedAt: at(0), isWorking: working
})
const original = display([prompt, first], [tools[0]!], true).find(row => row.kind === 'turn-work-summary')!
const active = display(messages, tools, true)
const work = active.filter(row => row.kind === 'turn-work-summary')
assert.equal(work.length, 1, 'steering must not finish the old Work block and start a new one')
assert.equal(work[0]!.id, original.id, 'the active work retains the original prompt anchor')
assert.equal(work[0]!.running, true)
assert.equal(work[0]!.startedAt, at(0), 'steering does not reset the working timer')
assert.deepEqual(work[0]!.rows.map(row => row.kind === 'message' ? row.message.id : 'activities' in row ? row.activities[0]!.id : row.id), ['first-update', 'before-steer', 'steering-correction', 'following-correction', 'after-steer'], 'steering remains at its actual chronological position')
assert.equal(work[0]!.turnId, 'task', 'presentation cannot manufacture an execution turn for steering')
assert.equal(active.filter(row => row.kind === 'message' && row.message.role === 'user').length, 1, 'only the original prompt owns the top-level turn boundary')
const final = assistant('final', 6, 'final_answer')
const settled = display([...messages, final], tools, false)
assert.equal(settled.filter(row => row.kind === 'turn-work-summary').length, 1, 'completed steered work stays one historical turn')
assert.equal(settled.at(-1)?.id, 'final')
const restored = display(JSON.parse(JSON.stringify([...messages, final])), JSON.parse(JSON.stringify(tools)), false)
assert.deepEqual(restored, settled, 'reopened stored turn IDs preserve the same grouping without transient UI state')
const twice = display([...messages, user('second-steer', 7), assistant('second-steer-update', 8)], [...tools, tool('after-second-steer', 9)], true)
assert.equal(twice.filter(row => row.kind === 'turn-work-summary').length, 1, 'multiple steering messages retain one active turn')
assert.equal(twice.find(row => row.kind === 'turn-work-summary')?.id, original.id)
const next = user('new-request', 10, 'next-task')
assert.equal(display([...messages, final, next, assistant('next-update', 11, 'commentary', 'next-task')], [...tools, tool('next-tool', 12, 'next-task')], true).filter(row => row.kind === 'turn-work-summary').length, 2, 'a new canonical turn remains a new task')
const stop: AssistantActivity = { ...tool('explicit-stop', 6), turnTerminalOutcome: 'interrupted', payload: { status: 'cancelled' } }
const stopped = display([...messages, user('after-stop', 8)], [...tools, stop, tool('resumed-tool', 9)], true)
assert.equal(stopped.filter(row => row.kind === 'turn-work-summary').length, 2, 'explicit Stop remains a boundary even in legacy histories that reuse a turn ID')
const peer = projectThreadMessage({ messageId: 'received-peer', senderThreadId: 'parent', recipientThreadId: 'child', senderLabel: 'Zyra', text: 'Another peer task', createdAt: at(8) }, at(8))!
assert.equal(display([...messages, assistant('peer-update', 9)], [...tools, peer, tool('peer-tool', 10)], false).filter(row => row.kind === 'turn-work-summary').length, 2, 'received peer tasks retain their separate boundary')
const unknown = display([user('legacy-first', 0, null), user('legacy-next', 3, null)], [], true)
assert.equal(unknown.filter(row => row.kind === 'message').length, 2, 'missing historical IDs never imply steering on their own')
const provisional = display([user('provisional', 0, null), first, steer, follow], tools, true)
assert.equal(provisional.filter(row => row.kind === 'turn-work-summary').length, 1, 'canonical work identifies steering after a provisional prompt with no turn ID')
assert.equal(prompt.turnId, 'task', 'grouping never mutates source messages')
const aliasPrompt = { ...prompt, turnId: 'saved-task' }
const aliased = display([aliasPrompt, first, steer, follow], tools, true)
assert.equal(aliased.filter(row => row.kind === 'turn-work-summary').length, 1, 'steering joins an original prompt whose saved ID differs from the live work ID')
const finalBeforeSteer = display([prompt, { ...first, phase: 'final_answer' }, steer, follow], tools, true)
assert.equal(finalBeforeSteer.filter(row => row.kind === 'turn-work-summary').length, 1, 'a response message alone cannot terminate a still-active canonical turn')
console.log('Steering timeline: one original work/timer, chronological corrections, completion/reopen, repeated steering, new tasks, Stop, peers and legacy boundaries: ok')
