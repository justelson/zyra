import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import initSqlJs from 'sql.js/dist/sql-asm.js'
import { SettingsProvider } from '../src/renderer/src/lib/settings'
import { AssistantAgentInboxSidebar } from '../src/renderer/src/pages/assistant/AssistantAgentInboxSidebar'
import type { AssistantSession, AssistantThread } from '../src/shared/assistant/contracts'
import { primeProjectDetailsCache } from '../src/renderer/src/lib/projectViewCache'
import { createDefaultSnapshot } from '../src/main/assistant/projector'
import { initializeAssistantPersistenceSchema } from '../src/main/assistant/persistence-utils'
import { readAssistantPersistenceRecord } from '../src/main/assistant/persistence-read'
import { replaceAssistantSnapshot } from '../src/main/assistant/persistence-write'
import { applyAssistantDomainEvent } from '../src/shared/assistant/projector'

const now = new Date().toISOString()
const thread = {
    id: 'work-thread', providerThreadId: 'canonical-work', source: 'root', state: 'ready', cwd: 'C:/workspace', model: 'fixture/model', lastError: null,
    parentThreadId: null, providerParentThreadId: null, subagentDepth: null, agentNickname: null, agentRole: null,
    runtimeMode: 'approval-required', interactionMode: 'default', lastSeenCompletedTurnId: null, activePlan: null, proposedPlans: [],
    messages: [{ id: 'reply', role: 'assistant', text: 'Saved answer', turnId: null, streaming: false, createdAt: now, updatedAt: now }],
    activities: [], pendingApprovals: [], pendingUserInputs: [], messageCount: 1, activityCount: 0,
    hasPendingApprovals: false, hasPendingUserInputs: false, latestTurn: null, createdAt: now, updatedAt: now
} as AssistantThread
const base = { id: 'work-chat', title: 'Investigate transcription', mode: 'work', projectPath: null, workingRoot: thread.cwd, projectId: null, chatScope: null, threads: [thread], threadIds: [thread.id], activeThreadId: thread.id, archived: false, playgroundLabId: null, pendingLabRequest: null, createdAt: now, updatedAt: now } as AssistantSession
const workContext = { folderPath: 'C:/workspace/zyra', kind: 'coding' as const, updatedAt: now }
const render = (session: AssistantSession) => renderToStaticMarkup(createElement(SettingsProvider, null, createElement(AssistantAgentInboxSidebar, { sessions: [session], activeSessionId: session.id, activeThreadId: thread.id, commandPending: false, pendingControlThreadIds: new Set<string>(), projectIconOverrides: {}, headerActions: null, onCreateProjectChat: () => {}, onSelectSession: () => {}, onRename: () => {}, getSessionMenuItems: () => [], onOpenContextMenu: () => {} })))
const before = JSON.stringify(base)
assert.match(render(base), />Chat</, 'untouched chats remain neutral until substantial work is reported')
const coding = render({ ...base, workContext })
assert.match(coding, />zyra</, 'work folder replaces Chat in the existing row')
assert.match(coding, /data-work-kind="coding"/)
assert.match(coding, /lucide-code/)
assert.equal(JSON.stringify(base), before, 'rendering changes neither cwd nor Project membership')
const research = render({ ...base, workContext: { ...workContext, folderPath: null, kind: 'research' } })
assert.match(research, />workspace</, 'unknown task folder falls back to the agent directory')
assert.match(research, /lucide-search/)
assert.match(render({ ...base, workContext: { ...workContext, kind: 'music' } }), /lucide-music/)
primeProjectDetailsCache({ path: 'C:/workspace/zyra', name: 'Zyra', type: 'node', projectIconPath: 'C:/workspace/zyra/public/icon.png', frameworks: [], markers: [] })
const branded = render({ ...base, workContext })
assert.match(branded, /icon\.png/, 'existing artwork resolver/cache wins over the category fallback')
assert.doesNotMatch(branded, /lucide-code/)
const SQL = await initSqlJs()
const db = new SQL.Database()
try {
    initializeAssistantPersistenceSchema(db)
    const snapshot = { ...createDefaultSnapshot(now), sessions: [{ ...base, workContext }], selectedSessionId: base.id }
    replaceAssistantSnapshot(db, snapshot)
    const restored = readAssistantPersistenceRecord(db)!.snapshot
    assert.deepEqual(restored.sessions[0].workContext, workContext, 'SQLite cache retains context on cold read')
    assert.equal(restored.sessions[0].projectPath, null)
    const changed = { ...workContext, folderPath: null, kind: 'music' as const, updatedAt: new Date(Date.parse(now) + 60_000).toISOString() }
    const next = applyAssistantDomainEvent(restored, { id: 'work-update', sequence: 1, type: 'session.updated', occurredAt: changed.updatedAt, sessionId: base.id, threadId: thread.id, payload: { sessionId: base.id, patch: { workContext: changed } } })
    assert.deepEqual(next.sessions[0].workContext, changed, 'ordinary session projection updates metadata without changing selected Chat')
    assert.equal(next.selectedSessionId, base.id)
    replaceAssistantSnapshot(db, next)
    assert.deepEqual(readAssistantPersistenceRecord(db)!.snapshot.sessions[0].workContext, changed)
    db.run("UPDATE assistant_meta SET value = ? WHERE key = ?", ['{"kind":"unknown"}', `workContext:${base.id}`])
    assert.equal(readAssistantPersistenceRecord(db)!.snapshot.sessions[0].workContext, undefined, 'corrupt cached metadata falls back safely')
} finally { db.close() }
console.log('PASS: actual Inbox work-folder/category/artwork rendering, current-folder fallback, untouched Project authority and SQLite cold-read/projection persistence')
