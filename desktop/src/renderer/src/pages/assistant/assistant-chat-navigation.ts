import type { NavigateFunction } from 'react-router-dom'
import { assistantStore } from '@/lib/assistant/assistant-store-core'
import { isAssistantUserFacingSession } from '@/lib/assistant/selectors'
import { isAssistantDraftSession } from './assistant-sessions-rail-utils'
import { buildAssistantChatRoute } from './assistant-chat-route'
import { getPinnedSessionIds, writePinnedSessionIds } from './assistant-pinned-sessions'
import { getAssistantInboxOrderSnapshot, reorderAssistantInboxSlots, setAssistantInboxGroupOrder, type AssistantInboxOrderGroup } from './assistant-agent-inbox-order'

export type AssistantChatNavigationGroups = Record<AssistantInboxOrderGroup | 'settled', string[]>
export type AssistantChatNavigationRegistration = {
    groups: AssistantChatNavigationGroups
    /** Complete effective groups, before the Project filter. */
    effective: Record<AssistantInboxOrderGroup, string[]>
    activeSessionId: string | null
    scope: string
    selectSession: (sessionId: string) => void | Promise<void>
    onOrderChange: (undo: (() => boolean) | null, label?: string) => void
}
type Owner = { id: string; value: AssistantChatNavigationRegistration }
const ownerEpoch = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`
let nextOwner = 0
const owners = new Map<string, Owner>()
let lastKnown: Owner | null = null
let revision = 0
let signature = ''
let cursor: { id: string; from: string | null; requested: Set<string> } | null = null
let undoSequence = 0
let undoRecord: { token: string; revision: number; owner: string; group: AssistantInboxOrderGroup; saved: string[]; visible: string[]; effective: string[]; affectedIds: string[] } | null = null
const cloneGroups = (groups: AssistantChatNavigationGroups): AssistantChatNavigationGroups => ({ pinned: [...groups.pinned], chats: [...groups.chats], settled: [...groups.settled] })
function currentOwner() { return [...owners.values()].at(-1) || null }

/** Register the committed FINAL stable layout, not desired groups or a separate sort. */
export function registerAssistantChatNavigation(value: AssistantChatNavigationRegistration) {
    const id = `assistant-agent-inbox:${ownerEpoch}:${++nextOwner}`
    const owner = { id, value }
    owners.set(id, owner)
    lastKnown = owner
    return {
        update(next: AssistantChatNavigationRegistration) {
            owner.value = next
            if (currentOwner() === owner) lastKnown = owner
            if (cursor && (next.activeSessionId === cursor.id || (next.activeSessionId !== cursor.from && !cursor.requested.has(next.activeSessionId || '')))) cursor = null
        },
        dispose() {
            owners.delete(id)
            if (currentOwner()) lastKnown = currentOwner()
            // Keep the last committed traversal when collapsed/unmounted. No creation-sort fallback.
        }
    }
}

export function getAssistantChatNavigationSnapshot(allowedSessionIds?: readonly string[]) {
    const live = currentOwner()
    const owner = live || lastKnown
    const stored = getAssistantInboxOrderSnapshot()
    const groups = owner ? cloneGroups(owner.value.groups) : { pinned: [], chats: [], settled: [] }
    // Cached layouts must never resurrect deleted, archived, draft or supporting transcripts.
    const eligible = live ? new Set(Object.values(groups).flat()) : new Set(assistantStore.getState().snapshot.sessions.filter(session => isAssistantUserFacingSession(session) && !session.archived && !isAssistantDraftSession(session)).map(session => session.id))
    const seen = new Set<string>()
    for (const group of ['pinned', 'chats', 'settled'] as const) groups[group] = groups[group].filter(id => eligible.has(id) && !seen.has(id) && !!seen.add(id))
    const effective = owner ? { pinned: [...owner.value.effective.pinned], chats: [...owner.value.effective.chats] } : { pinned: [], chats: [] }
    const nextSignature = JSON.stringify([owner?.id, !!live, owner?.value.scope, groups, effective, stored.revision])
    if (signature !== nextSignature) { signature = nextSignature; revision++ }
    const allowed = allowedSessionIds === undefined ? null : new Set(allowedSessionIds)
    const scoped = (ids: string[]) => allowed ? ids.filter(id => allowed.has(id)) : ids
    const scopedGroups = { pinned: scoped(groups.pinned), chats: scoped(groups.chats), settled: scoped(groups.settled) }
    return {
        owner: owner?.id || null,
        revision,
        source: live ? 'sidebar' as const : owner ? 'last-known-sidebar' as const : 'unavailable' as const,
        mounted: !!live,
        scope: allowed && !Object.values(scopedGroups).some(ids => ids.length) ? 'no-authorized-visible-chats' : owner?.value.scope || null,
        groups: scopedGroups,
        targetIds: [...scopedGroups.pinned, ...scopedGroups.chats, ...scopedGroups.settled],
        effective: { pinned: scoped(effective.pinned), chats: scoped(effective.chats) },
        saved: { pinned: scoped([...stored.order.pinned]), chats: scoped([...stored.order.chats]) }
    }
}

export type AssistantChatOrderOperation = {
    owner: string
    expectedRevision: number
    /** Authenticated bridge supplies authorized Chat IDs; omitted only for trusted local UI. */
    allowedSessionIds?: readonly string[]
} & ({ action: 'move'; group: AssistantInboxOrderGroup; sessionId: string; beforeSessionId?: string; afterSessionId?: string }
    | { action: 'undo'; undoToken: string })

export type AssistantChatOrderOperationResult = {
    success: boolean
    error?: string
    snapshot: ReturnType<typeof getAssistantChatNavigationSnapshot>
    undoToken?: string
}

/** Renderer-profile-local, CAS guarded, with the same synchronous writer and Undo as UI. */
export function performAssistantChatOrderOperation(input: AssistantChatOrderOperation): AssistantChatOrderOperationResult {
    const snapshot = getAssistantChatNavigationSnapshot()
    const responseSnapshot = () => getAssistantChatNavigationSnapshot(input?.allowedSessionIds)
    const allowed = input?.allowedSessionIds === undefined ? null : new Set(input.allowedSessionIds)
    const fail = (error: string) => ({ success: false as const, error, snapshot: responseSnapshot() })
    const owner = currentOwner()
    if (!input || !owner || input.owner !== owner.id) return fail('Sidebar order owner is unavailable or changed.')
    if (input.expectedRevision !== snapshot.revision) return fail('Sidebar order revision changed. Inspect again before moving.')
    if (input.action === 'undo') {
        const record = undoRecord
        if (!record || input.undoToken !== record.token || record.owner !== owner.id || record.revision !== snapshot.revision) return fail('Undo is stale or unavailable.')
        if (allowed && record.affectedIds.some(id => !allowed.has(id))) return fail('Undo targets an unavailable Chat.')
        try { setAssistantInboxGroupOrder(record.group, record.saved, { strict: true }) }
        catch { return fail('Could not persist Undo. The saved order is unchanged.') }
        owner.value = { ...owner.value, groups: { ...owner.value.groups, [record.group]: record.visible }, effective: { ...owner.value.effective, [record.group]: record.effective } }
        undoRecord = null
        owner.value.onOrderChange(null)
        return { success: true as const, snapshot: responseSnapshot() }
    }
    if (input.action !== 'move' || (input.group !== 'pinned' && input.group !== 'chats')) return fail('Only explicit within-group moves are supported.')
    const target = input.beforeSessionId || input.afterSessionId
    if (!target || !!input.beforeSessionId === !!input.afterSessionId) return fail('Specify exactly one beforeSessionId or afterSessionId.')
    if (allowed && (!allowed.has(input.sessionId) || !allowed.has(target))) return fail('Both exact Chats must be authorized.')
    const visible = snapshot.groups[input.group].filter(id => !allowed || allowed.has(id))
    if (!visible.includes(input.sessionId) || !visible.includes(target)) return fail('Both exact Chats must be visible in the requested group.')
    if (visible.some(id => !snapshot.effective[input.group].includes(id))) return fail('Sidebar group is held during a transition. Release the sidebar and inspect again.')
    if (input.sessionId === target) return fail('A Chat cannot be moved relative to itself.')
    const placement = input.beforeSessionId ? 'before' : 'after'
    const saved = reorderAssistantInboxSlots(snapshot.effective[input.group], snapshot.saved[input.group], visible, input.sessionId, target, placement)
    const moved = visible.filter(id => id !== input.sessionId)
    moved.splice(moved.indexOf(target) + (placement === 'after' ? 1 : 0), 0, input.sessionId)
    const visibleSet = new Set(visible)
    let index = 0
    const effective = snapshot.effective[input.group].map(id => visibleSet.has(id) ? moved[index++]! : id)
    try { setAssistantInboxGroupOrder(input.group, saved, { strict: true }) }
    catch { return fail('Could not persist Chat order. No move was accepted.') }
    let groupIndex = 0
    const fullVisible = snapshot.groups[input.group].map(id => visibleSet.has(id) ? moved[groupIndex++]! : id)
    owner.value = { ...owner.value, groups: { ...owner.value.groups, [input.group]: fullVisible }, effective: { ...owner.value.effective, [input.group]: effective } }
    const next = getAssistantChatNavigationSnapshot()
    const token = `chat-order-undo:${++undoSequence}`
    undoRecord = { token, revision: next.revision, owner: owner.id, group: input.group, saved: snapshot.saved[input.group], visible: snapshot.groups[input.group], effective: snapshot.effective[input.group], affectedIds: [input.sessionId, target] }
    owner.value.onOrderChange(() => performAssistantChatOrderOperation({ action: 'undo', owner: owner.id, expectedRevision: next.revision, undoToken: token }).success)
    return { success: true as const, snapshot: responseSnapshot(), undoToken: token }
}

export function performAssistantChatPinOperation(input: { owner: string; expectedRevision: number; sessionId: string; pinned: boolean; allowedSessionIds: readonly string[] }) {
    const owner = currentOwner(), before = getAssistantChatNavigationSnapshot(input.allowedSessionIds)
    if (!owner || owner.id !== input.owner || before.revision !== input.expectedRevision) throw new Error('Sidebar owner or revision changed. Inspect before pinning.')
    if (!input.allowedSessionIds.includes(input.sessionId)) throw new Error('This Chat is outside the caller scope.')
    const old = new Set(getPinnedSessionIds()), next = new Set(old)
    if (input.pinned) next.add(input.sessionId); else next.delete(input.sessionId)
    writePinnedSessionIds(next, { strict: true })
    owner.value.onOrderChange(() => {
        if (JSON.stringify([...getPinnedSessionIds()].sort()) !== JSON.stringify([...next].sort())) return false
        writePinnedSessionIds(old, { strict: true }); return true
    }, input.pinned ? 'Chat pinned' : 'Chat unpinned')
    return { success: true, pinned: input.pinned, sessionId: input.sessionId, owner: input.owner, persisted: true }
}

/** Live shortcuts call the exact same callback as row clicks. Cached traversal uses its exact route. */
export function selectAssistantChatNavigationTarget(id: string, navigate?: NavigateFunction): boolean {
    const snapshot = getAssistantChatNavigationSnapshot()
    if (!snapshot.targetIds.includes(id)) return false
    const owner = currentOwner()
    const from = owner?.value.activeSessionId ?? assistantStore.getState().snapshot.selectedSessionId
    cursor = { id, from, requested: new Set([...(cursor?.requested || []), id]) }
    if (owner) void owner.value.selectSession(id)
    else {
        const session = assistantStore.getState().snapshot.sessions.find(session => session.id === id)
        void assistantStore.selectSession(id)
        navigate?.(buildAssistantChatRoute(id, session?.activeThreadId || null))
    }
    return true
}

/** A deliberate pointer/row selection supersedes in-flight keyboard traversal. */
export function clearAssistantChatNavigationCursor(): void { cursor = null }

export function getAssistantChatNavigationCurrentId(): string | null {
    const owner = currentOwner()
    const selected = owner?.value.activeSessionId ?? assistantStore.getState().snapshot.selectedSessionId
    if (cursor && (selected === cursor.id || (selected !== cursor.from && !cursor.requested.has(selected || '')))) cursor = null
    return cursor?.id ?? selected
}
