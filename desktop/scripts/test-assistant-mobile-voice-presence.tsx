import assert from 'node:assert/strict'
import './fixtures/unused-diff-worker'
import { renderToStaticMarkup } from 'react-dom/server'
import { MobileVoicePresence } from '../src/main/assistant/mobile-voice-presence'
import { MobileVoiceSession } from '../../mobile/gateway/src/voice-session.mjs'
import { createAssistantThread } from '../src/main/assistant/service-state'
import { createAssistantSessionRecord } from '../src/main/assistant/service-records'
import { createDefaultAssistantSnapshot, applyAssistantDomainEvent } from '../src/shared/assistant/projector'
import { recoverPersistedSnapshot } from '../src/main/assistant/projector'
import { toAssistantShellSnapshot } from '../src/main/assistant/persistence-snapshot'
import { areAssistantConversationSelectionsEqual } from '../src/renderer/src/lib/assistant/assistant-store-selection-helpers'

const { AssistantConversationHeader } = await import('../src/renderer/src/pages/assistant/AssistantConversationHeader')
const now = '2026-09-16T00:00:00Z'
const thread = createAssistantThread(now)
thread.providerThreadId = 'canonical-chat'
thread.canonicalPresence = { state: 'ready', activeTurnId: null, clients: [{ clientId: 'phone', surface: 'mobile', displayName: 'Test phone' }], backgroundWorkActive: false }
const other = createAssistantThread(now)
let snapshot = createDefaultAssistantSnapshot()
snapshot.sessions = [createAssistantSessionRecord({ sessionId: 'session', title: 'Test conversation', projectPath: null, createdAt: now, thread }), createAssistantSessionRecord({ sessionId: 'other', title: 'Other conversation', projectPath: null, createdAt: now, thread: other })]
const presence = new MobileVoicePresence((sessionId, threadId, deviceName) => {
    snapshot = applyAssistantDomainEvent(snapshot, { eventId: 'presence:' + snapshot.snapshotSequence, sequence: snapshot.snapshotSequence + 1, occurredAt: now,
        type: 'thread.updated', sessionId, threadId, payload: { threadId, patch: { mobileVoice: deviceName ? { deviceName } : null } } })
})
const current = () => snapshot.sessions[0]!.threads[0]!
function header(active = current()) {
    return renderToStaticMarkup(<AssistantConversationHeader rightPanelOpen={false} rightPanelMode="none" selectedSessionTitle="Test conversation"
        canonicalThreadId={active.providerThreadId} canonicalPresence={active.canonicalPresence} mobileVoice={active.mobileVoice}
        activeThreadIsSubagent={false} activeThreadLabel={null} selectedProjectTooltip="" selectedProjectPath={null} latestProjectLabel="Project"
        projectDirectoryLocked={false} onCreateThread={() => {}} onRenameChat={() => {}} onCreateProjectChat={() => {}} onChooseProject={() => {}}
        onArchiveChat={() => {}} onDeleteChat={() => {}} onToggleRightSidebar={() => {}} />)
}
const selection = (activeThread: typeof thread) => ({ activeThread, phase: { key: '', label: '' }, knownModels: [], timelineMessages: [], activityFeed: [], pendingUserInputs: [] } as any)
assert.ok(header().includes('Open on Test phone'))
assert.ok(!header().includes('data-mobile-voice'), 'an attached phone does not imply active Voice')
let owner: number | null = null
let adapter: string | undefined
const socket = (id: number) => new MobileVoiceSession({
    subscribe: () => () => {},
    start: async (_session: string, _input: unknown, signal: AbortSignal) => {
        owner = id; adapter = 'adapter:' + id
        presence.activate({ owner: id, adapterSessionId: adapter, sessionId: 'session', threadId: thread.id, deviceName: 'Test phone' }, { owner, adapterSessionId: adapter }, signal)
        return { adapterSessionId: adapter, sdp: 'v=0 answer', realtimeSessionId: 'rtc', realtimeSessionGeneration: 1 }
    },
    stop: async () => { if (owner === id) { presence.clearOwner(id); owner = null; adapter = undefined } }
}, () => {})
const phone = socket(-2000000001)
const before = current()
await phone.dispatch('voice.start', { sdp: 'v=0 offer' }, { canonicalChatId: 'canonical-chat' })
assert.ok(header().includes('data-mobile-voice="active"'))
assert.ok(header().includes('Live Voice on Test phone'))
assert.ok(header().includes('lucide-audio-lines'))
assert.ok(!header(snapshot.sessions[1]!.threads[0]!).includes('data-mobile-voice'), 'only the owning conversation gets live Voice')
assert.equal(areAssistantConversationSelectionsEqual(selection(before), selection(current())), false, 'live start invalidates the actual conversation selection')
assert.equal(toAssistantShellSnapshot(snapshot).sessions[0]!.threads[0]!.mobileVoice?.deviceName, 'Test phone', 'bootstrap preserves currently active voice')
await assert.rejects(phone.dispatch('voice.stop', {}, { canonicalChatId: 'other-chat' }), /does not own/)
assert.ok(header().includes('data-mobile-voice="active"'))
await phone.dispatch('voice.stop', {}, { canonicalChatId: 'canonical-chat' })
assert.ok(!header().includes('data-mobile-voice'))
await phone.dispatch('voice.start', { sdp: 'v=0 offer' }, { canonicalChatId: 'canonical-chat' })
const persisted = structuredClone(snapshot)
assert.equal(recoverPersistedSnapshot(persisted).sessions[0]!.threads[0]!.mobileVoice, null, 'process restart cannot resurrect an old live call')
await phone.close()
assert.ok(!header().includes('data-mobile-voice'), 'socket disconnect clears Voice')
const next = socket(-2000000002)
await next.dispatch('voice.start', { sdp: 'v=0 offer' }, { canonicalChatId: 'canonical-chat' })
presence.clearOwner(-2000000001)
presence.clearAdapter('adapter:-2000000001')
assert.ok(header().includes('data-mobile-voice="active"'), 'late old disconnect/provider close cannot clear a new owner')
presence.clearAdapter('adapter:-2000000002')
assert.ok(!header().includes('data-mobile-voice'), 'matching provider close clears Voice')
const cancelled = new AbortController(); cancelled.abort()
assert.equal(presence.activate({ owner: 1, adapterSessionId: 'cancelled', sessionId: 'session', threadId: thread.id }, { owner: 1, adapterSessionId: 'cancelled' }, cancelled.signal), false)
assert.equal(presence.activate({ owner: 1, adapterSessionId: 'wrong', sessionId: 'session', threadId: thread.id }, { owner: 2, adapterSessionId: 'wrong' }, new AbortController().signal), false)
assert.ok(!header().includes('data-mobile-voice'), 'cancelled or nonowning activation stays invisible')
await next.close()
console.log('Mobile Voice lease -> domain projection -> matching conversation header: passed')
