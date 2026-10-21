import type { AssistantComposerSessionState } from './assistant-composer-session-state'
import { readAssistantComposerSessionState, writeAssistantComposerSessionState } from './assistant-composer-session-state'

const revisions = new Map<string, { value: string; revision: number }>()
let nextRevision = Date.now() * 1000
export function appOwnerRevision(owner: string, value: unknown): number {
    const serialized = JSON.stringify(value), old = revisions.get(owner)
    if (old?.value === serialized) return old.revision
    const revision = ++nextRevision; revisions.set(owner, { value: serialized, revision }); return revision
}
export type ChatComposerPatch = Pick<AssistantComposerSessionState, 'model' | 'effort' | 'runtimeMode' | 'fastModeEnabled'>
type ComposerOwner = { read: () => AssistantComposerSessionState; apply: (patch: ChatComposerPatch) => void }
const composers = new Map<string, ComposerOwner>()
export function registerAppComposerOwner(sessionId: string, owner: ComposerOwner) {
    composers.set(sessionId, owner)
    return () => { if (composers.get(sessionId) === owner) composers.delete(sessionId) }
}
export function inspectAppComposer(sessionId: string, fallback: AssistantComposerSessionState = {}) {
    const state = composers.get(sessionId)?.read() || readAssistantComposerSessionState(sessionId, fallback)
    const configuration = { model: state.model, effort: state.effort, runtimeMode: state.runtimeMode, fastModeEnabled: state.fastModeEnabled }
    return { sessionId, revision: appOwnerRevision(`composer:${sessionId}`, configuration), nextTurn: configuration, owner: 'Desktop-profile Chat composer', effect: 'next-turn-from-desktop', currentTurnUnchanged: true, remembersChoices: false }
}
export function stageAppComposer(sessionId: string, patch: ChatComposerPatch, expectedRevision: number, fallback: AssistantComposerSessionState = {}) {
    const before = inspectAppComposer(sessionId, fallback)
    if (expectedRevision !== before.revision) throw new Error('The composer choices changed. Read them again before applying.')
    const owner = composers.get(sessionId)
    if (owner) owner.apply(patch)
    else writeAssistantComposerSessionState(sessionId, { ...readAssistantComposerSessionState(sessionId, fallback), ...patch }, { strict: true })
    return { ...inspectAppComposer(sessionId, fallback), applied: true }
}

let stopOwner: ((sessionId: string, turnId: string) => Promise<Record<string, unknown>>) | null = null
export function registerAppStopOwner(owner: NonNullable<typeof stopOwner>) { stopOwner = owner; return () => { if (stopOwner === owner) stopOwner = null } }
export function stopAppTurn(sessionId: string, turnId: string) {
    if (!stopOwner) throw new Error('The Chat Stop owner is unavailable.')
    return stopOwner(sessionId, turnId)
}

export type QueueOwner = { inspect: (sessionId: string) => Record<string, unknown>; operate: (sessionId: string, operation: string, input: Record<string, unknown>, expectedRevision?: number) => Promise<Record<string, unknown>> }
let queueOwner: QueueOwner | null = null
export function registerAppQueueOwner(owner: QueueOwner) { queueOwner = owner; return () => { if (queueOwner === owner) queueOwner = null } }
export function inspectAppQueue(sessionId: string) {
    if (!queueOwner) throw new Error('The Desktop queue owner is not mounted. Recovered work remains held; no other device was substituted.')
    return queueOwner.inspect(sessionId)
}
export function operateAppQueue(sessionId: string, operation: string, input: Record<string, unknown>, expectedRevision?: number) {
    if (!queueOwner) throw new Error('The Desktop queue owner is not mounted.')
    return queueOwner.operate(sessionId, operation, input, expectedRevision)
}
