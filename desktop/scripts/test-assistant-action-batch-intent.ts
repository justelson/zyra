import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mock } from 'bun:test'
import { serializeAssistantActivityPayload } from '../src/main/assistant/persistence-activity-payload'

const userDataPath = mkdtempSync(join(tmpdir(), 'zyra-action-batch-intent-'))
const electronNoop = (): undefined => undefined
mock.module('electron', () => ({
    app: {
        getPath: () => userDataPath,
        isReady: () => true,
        on: electronNoop,
        once: electronNoop
    },
    BrowserWindow: class {
        static getAllWindows(): never[] { return [] }
        static fromWebContents(): null { return null }
    },
    screen: {
        getAllDisplays: () => [],
        getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 } })
    },
    globalShortcut: { register: () => true, unregister: electronNoop, unregisterAll: electronNoop },
    nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) },
    webContents: { fromId: () => null },
    safeStorage: { isEncryptionAvailable: () => false }
}))

const { projectCanonicalTimeline } = await import('../src/main/assistant/service')
const createdAt = '2026-09-04T16:00:00.000Z'
const timestamp = Date.parse(createdAt)
const projection = projectCanonicalTimeline([
    {
        type: 'message', id: 'entry:batch-user', timestamp: createdAt,
        message: {
            id: 'message:batch-user', role: 'user', timestamp,
            content: [{ type: 'text', text: 'Review the timeline behavior.' }]
        }
    },
    {
        type: 'message', id: 'entry:batch-intent-call', timestamp: createdAt,
        message: {
            id: 'message:batch-intent-call', role: 'assistant', timestamp: timestamp + 1,
            content: [{ type: 'toolCall', id: 'batch-intent-call', name: 'begin_action_batch', arguments: { title: 'Reviewing timeline behavior' } }]
        }
    },
    {
        type: 'message', id: 'entry:batch-intent-result', timestamp: createdAt,
        message: {
            id: 'message:batch-intent-result', role: 'toolResult', toolCallId: 'batch-intent-call',
            toolName: 'begin_action_batch', isError: false, timestamp: timestamp + 2,
            content: [{ type: 'text', text: 'Action batch intent set.' }]
        }
    },
    {
        type: 'message', id: 'entry:batch-read-call', timestamp: createdAt,
        message: {
            id: 'message:batch-read-call', role: 'assistant', timestamp: timestamp + 3,
            content: [{ type: 'toolCall', id: 'batch-read-call', name: 'read', arguments: { path: 'src/timeline.ts' } }]
        }
    },
    {
        type: 'message', id: 'entry:batch-read-result', timestamp: createdAt,
        message: {
            id: 'message:batch-read-result', role: 'toolResult', toolCallId: 'batch-read-call',
            toolName: 'read', isError: false, timestamp: timestamp + 4,
            content: [{ type: 'text', text: 'timeline source' }]
        }
    }
], 'canonical-action-batch', 'action-batch', createdAt, 0, 'C:/fixture')

assert.deepEqual(projection.activities.map((activity) => activity.id), ['zyra-tool-batch-read-call'], 'the presentation marker never becomes a visible Action')
assert.equal(projection.activities[0]?.payload?.actionBatchIntent, 'Reviewing timeline behavior', 'the declared intent persists on the following Action for replay')
assert.ok(projection.legacyActivityIds.includes('zyra-tool-batch-intent-call'), 'older persisted marker projections are removed during reconciliation')
const compactedPayload = JSON.parse(serializeAssistantActivityPayload({
    actionBatchIntent: 'Reviewing timeline behavior',
    output: 'x'.repeat(600_000)
})) as Record<string, unknown>
assert.equal(compactedPayload.actionBatchIntent, 'Reviewing timeline behavior', 'oversized Action evidence keeps the settled batch title')

const bridgeSource = readFileSync(new URL('../../src/zyra-ui-bridge.mjs', import.meta.url), 'utf8')
const runtimeSource = readFileSync(new URL('../src/main/assistant/zyra-pi-runtime.ts', import.meta.url), 'utf8')
const sdkSource = readFileSync(new URL('../../src/zyra-sdk.mjs', import.meta.url), 'utf8')
assert.match(bridgeSource, /if \(isActionBatchIntentEvent\(normalized\)\)[\s\S]*return;/, 'the live marker is consumed before transport')
assert.match(bridgeSource, /normalized\.actionBatchIntent = activeActionBatchIntent/, 'following live tool events carry the active intent')
assert.match(runtimeSource, /classified\.data\['actionBatchIntent'\] = actionBatchIntent/, 'Desktop persists live intent metadata on the Action payload')
assert.match(sdkSource, /createAssistantActionBatchTool\(\)/, 'the hidden declaration tool is registered in normal sessions')
assert.match(sdkSource, /Immediately before each consecutive Action group/, 'the Desktop surface guide tells the agent where to place declarations')

rmSync(userDataPath, { recursive: true, force: true })
console.log('Assistant Action batch intent: ok')
