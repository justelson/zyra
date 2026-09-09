import type {
    AssistantDomainEvent,
    AssistantMessage,
    AssistantPendingApproval,
    AssistantPendingUserInput,
    AssistantSession,
    AssistantSnapshot,
    AssistantThread
} from './contracts'
import { reconcileAssistantMessageReplays } from './message-reconciliation'

// A tool-start notification can precede its permission decision. Keep that
// activity out of the execution UI until the matching request resolves.
function activityNeedsApproval(thread: AssistantThread, activity: AssistantThread['activities'][number]): boolean {
    return thread.pendingApprovals.some((approval) => approval.status === 'pending' && Boolean(approval.toolCallId) && (
        approval.toolCallId === activity.payload?.toolCallId || activity.id === `zyra-tool-${approval.toolCallId}`
    ))
}

function projectApprovalWaitingState(thread: AssistantThread, resume = false, projectActivities = true): void {
    const pending = thread.pendingApprovals.filter((entry) => entry.status === 'pending')
    const waiting = pending.length > 0 || thread.pendingUserInputs.some((entry) => entry.status === 'pending')
    if (waiting && (thread.state === 'running' || thread.state === 'starting')) thread.state = 'waiting'
    else if (resume && !waiting && thread.state === 'waiting' && thread.latestTurn?.state === 'running') thread.state = 'running'
    if (!projectActivities) return
    let changed = false
    const activities = thread.activities.map((activity) => {
        const approvalPending = activityNeedsApproval(thread, activity)
        if (Boolean(activity.payload?.approvalPending) === approvalPending) return activity
        changed = true
        return { ...activity, payload: { ...activity.payload, approvalPending } }
    })
    if (changed) thread.activities = activities
}

type ThreadLocation = {
    sessionIndex: number
    threadIndex: number
}

function findSessionIndex(snapshot: AssistantSnapshot, sessionId: string): number {
    return snapshot.sessions.findIndex((session) => session.id === sessionId)
}

function findThreadLocation(snapshot: AssistantSnapshot, threadId: string): ThreadLocation | null {
    for (let sessionIndex = 0; sessionIndex < snapshot.sessions.length; sessionIndex += 1) {
        const threadIndex = snapshot.sessions[sessionIndex]?.threads.findIndex((thread) => thread.id === threadId) ?? -1
        if (threadIndex >= 0) {
            return { sessionIndex, threadIndex }
        }
    }
    return null
}

function sortThreadsNewestFirst(threadIds: string[], threads: AssistantThread[]): string[] {
    const updatedAtById = new Map(threads.map((thread) => [thread.id, thread.updatedAt] as const))
    return [...threadIds].sort((left, right) => {
        const leftUpdatedAt = updatedAtById.get(left) || ''
        const rightUpdatedAt = updatedAtById.get(right) || ''
        return rightUpdatedAt.localeCompare(leftUpdatedAt) || right.localeCompare(left)
    })
}

function sortSessionsNewestFirst(sessions: AssistantSession[]): AssistantSession[] {
    return [...sessions].sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id)
    )
}

function normalizeAssistantSessionRoute(session: AssistantSession): AssistantSession {
    return {
        ...session,
        mode: 'work',
        playgroundLabId: null,
        pendingLabRequest: null
    }
}

function pickNextSelectedSessionId(sessions: AssistantSession[], selectedSessionId: string | null, removedSessionId: string): string | null {
    if (selectedSessionId !== removedSessionId) return selectedSessionId
    const nextSession = sessions.find((session) => !session.archived) || sessions[0]
    return nextSession?.id || null
}

function mergeThreadRecordsById<T extends { id: string }>(
    current: T[],
    incoming: T[],
    removedIds: unknown
): T[] {
    const removed = new Set(Array.isArray(removedIds) ? removedIds.map((entry) => String(entry || '')).filter(Boolean) : [])
    const merged = new Map(current.map((entry) => [entry.id, entry]))
    for (const entry of incoming) merged.set(entry.id, entry)
    for (const id of removed) merged.delete(id)
    return [...merged.values()]
}

function cloneThreadBase(thread: AssistantThread): AssistantThread {
    return {
        ...thread,
        messages: thread.messages,
        proposedPlans: thread.proposedPlans,
        activities: thread.activities,
        pendingApprovals: thread.pendingApprovals,
        pendingUserInputs: thread.pendingUserInputs
    }
}

function ensureSessionWritable(
    next: AssistantSnapshot,
    previousSessions: AssistantSession[],
    sessionIndex: number
): { session: AssistantSession; previousSession: AssistantSession } | null {
    const previousSession = previousSessions[sessionIndex]
    if (!previousSession) return null

    if (next.sessions === previousSessions) {
        next.sessions = [...previousSessions]
    }

    const currentSession = next.sessions[sessionIndex]
    if (currentSession === previousSession) {
        next.sessions[sessionIndex] = {
            ...previousSession,
            threadIds: previousSession.threadIds,
            threads: previousSession.threads
        }
    }

    return {
        session: next.sessions[sessionIndex]!,
        previousSession
    }
}

function ensureThreadWritable(
    next: AssistantSnapshot,
    previousSessions: AssistantSession[],
    location: ThreadLocation
): { session: AssistantSession; previousSession: AssistantSession; thread: AssistantThread; previousThread: AssistantThread } | null {
    const writableSession = ensureSessionWritable(next, previousSessions, location.sessionIndex)
    if (!writableSession) return null

    const { session, previousSession } = writableSession
    if (session.threads === previousSession.threads) {
        session.threads = [...previousSession.threads]
    }

    const previousThread = previousSession.threads[location.threadIndex]
    if (!previousThread) return null

    const currentThread = session.threads[location.threadIndex]
    if (currentThread === previousThread) {
        session.threads[location.threadIndex] = cloneThreadBase(previousThread)
    }

    return {
        session,
        previousSession,
        thread: session.threads[location.threadIndex]!,
        previousThread
    }
}

function ensureThreadMessagesWritable(thread: AssistantThread, previousThread: AssistantThread): void {
    if (thread.messages === previousThread.messages) {
        thread.messages = [...previousThread.messages]
    }
}

function ensureThreadActivitiesWritable(thread: AssistantThread, previousThread: AssistantThread): void {
    if (thread.activities === previousThread.activities) {
        thread.activities = [...previousThread.activities]
    }
}

function ensureThreadProposedPlansWritable(thread: AssistantThread, previousThread: AssistantThread): void {
    if (thread.proposedPlans === previousThread.proposedPlans) {
        thread.proposedPlans = [...previousThread.proposedPlans]
    }
}

function ensureThreadPendingApprovalsWritable(thread: AssistantThread, previousThread: AssistantThread): void {
    if (thread.pendingApprovals === previousThread.pendingApprovals) {
        thread.pendingApprovals = [...previousThread.pendingApprovals]
    }
}

function ensureThreadPendingUserInputsWritable(thread: AssistantThread, previousThread: AssistantThread): void {
    if (thread.pendingUserInputs === previousThread.pendingUserInputs) {
        thread.pendingUserInputs = [...previousThread.pendingUserInputs]
    }
}

function areMessagesEquivalent(left: AssistantMessage, right: AssistantMessage): boolean {
    return left.id === right.id
        && left.role === right.role
        && left.text === right.text
        && left.turnId === right.turnId
        && left.streaming === right.streaming
        && left.timelineSequence === right.timelineSequence
        && left.createdAt === right.createdAt
        && left.updatedAt === right.updatedAt
}

function upsertMessage(messages: AssistantMessage[], nextMessage: AssistantMessage): AssistantMessage[] {
    const lastMessageIndex = messages.length - 1
    const lastMessage = lastMessageIndex >= 0 ? messages[lastMessageIndex] : null
    if (lastMessage?.id === nextMessage.id) {
        if (areMessagesEquivalent(lastMessage, nextMessage)) return messages
        const nextMessages = [...messages]
        nextMessages[lastMessageIndex] = nextMessage
        return nextMessages
    }

    const existingIndex = messages.findIndex((message) => message.id === nextMessage.id)
    if (existingIndex < 0) {
        return [...messages, nextMessage]
    }

    if (areMessagesEquivalent(messages[existingIndex]!, nextMessage)) return messages

    const nextMessages = [...messages]
    nextMessages[existingIndex] = nextMessage
    return nextMessages
}

export function createDefaultAssistantSnapshot(): AssistantSnapshot {
    return {
        snapshotSequence: 0,
        updatedAt: new Date(0).toISOString(),
        selectedSessionId: null,
        playground: {
            rootPath: null,
            labs: []
        },
        sessions: [],
        knownModels: [],
        fleetByThreadId: {}
    }
}

function applyAssistantDomainEventInternal(snapshot: AssistantSnapshot, event: AssistantDomainEvent): AssistantSnapshot {
    if (event.sequence <= snapshot.snapshotSequence) return snapshot

    const previousSessions = snapshot.sessions
    let next: AssistantSnapshot = {
        ...snapshot,
        snapshotSequence: event.sequence,
        updatedAt: event.occurredAt,
        sessions: snapshot.sessions
    }
    let shouldSortSessions = false

    switch (event.type) {
        case 'fleet.snapshot.updated': {
            const threadId = String(event.payload['threadId'] || event.threadId || '')
            if (threadId && event.payload['snapshot']) {
                next.fleetByThreadId = { ...snapshot.fleetByThreadId, [threadId]: event.payload['snapshot'] as AssistantSnapshot['fleetByThreadId'][string] }
            }
            break
        }
        case 'session.created': {
            const session = normalizeAssistantSessionRoute(event.payload['session'] as AssistantSession)
            if (previousSessions.some((existing) => existing.id === session.id)) break
            next.sessions = [...previousSessions, session]
            next.selectedSessionId = session.id
            shouldSortSessions = true
            break
        }
        case 'session.selected': {
            next.selectedSessionId = String(event.payload['sessionId'] || '') || null
            break
        }
        case 'session.updated': {
            const sessionId = String(event.payload['sessionId'] || '')
            const sessionIndex = findSessionIndex(next, sessionId)
            const writable = ensureSessionWritable(next, previousSessions, sessionIndex)
            if (!writable) break

            Object.assign(writable.session, event.payload['patch'])
            writable.session.mode = 'work'
            writable.session.playgroundLabId = null
            writable.session.pendingLabRequest = null
            writable.session.threadIds = sortThreadsNewestFirst(writable.session.threadIds, writable.session.threads)
            shouldSortSessions = true
            break
        }
        case 'session.deleted': {
            const sessionId = String(event.payload['sessionId'] || '')
            next.sessions = previousSessions.filter((session) => session.id !== sessionId)
            next.selectedSessionId = pickNextSelectedSessionId(next.sessions, snapshot.selectedSessionId, sessionId)
            shouldSortSessions = true
            break
        }
        case 'playground.updated': {
            next.playground = event.payload['playground'] as AssistantSnapshot['playground']
            break
        }
        case 'thread.created': {
            const sessionId = String(event.payload['sessionId'] || '')
            const sessionIndex = findSessionIndex(next, sessionId)
            const writable = ensureSessionWritable(next, previousSessions, sessionIndex)
            const thread = event.payload['thread'] as AssistantThread
            const makeActive = event.payload['makeActive'] !== false
            if (!writable) break

            if (writable.session.threads === writable.previousSession.threads) {
                writable.session.threads = [...writable.previousSession.threads]
            }
            if (writable.session.threadIds === writable.previousSession.threadIds) {
                writable.session.threadIds = [...writable.previousSession.threadIds]
            }
            writable.session.threads.unshift(thread)
            writable.session.threadIds = sortThreadsNewestFirst([thread.id, ...writable.session.threadIds], writable.session.threads)
            if (makeActive) {
                writable.session.activeThreadId = thread.id
            }
            writable.session.updatedAt = event.occurredAt
            shouldSortSessions = true
            break
        }
        case 'thread.updated': {
            const threadId = String(event.payload['threadId'] || '')
            const location = findThreadLocation(next, threadId)
            const writable = location ? ensureThreadWritable(next, previousSessions, location) : null
            if (!writable) break

            const patch = { ...((event.payload['patch'] as Record<string, unknown> | undefined) || {}) }
            const messages = Array.isArray(patch.messages) ? patch.messages as AssistantThread['messages'] : null
            const activities = Array.isArray(patch.activities) ? patch.activities as AssistantThread['activities'] : null
            const proposedPlans = Array.isArray(patch.proposedPlans) ? patch.proposedPlans as AssistantThread['proposedPlans'] : null
            const pendingApprovals = Array.isArray(patch.pendingApprovals) ? patch.pendingApprovals as AssistantThread['pendingApprovals'] : null
            const pendingUserInputs = Array.isArray(patch.pendingUserInputs) ? patch.pendingUserInputs as AssistantThread['pendingUserInputs'] : null
            delete patch.messages
            delete patch.activities
            delete patch.proposedPlans
            delete patch.pendingApprovals
            delete patch.pendingUserInputs
            Object.assign(writable.thread, patch)
            if (messages || Array.isArray(event.payload['removedMessageIds'])) {
                writable.thread.messages = reconcileAssistantMessageReplays(
                    mergeThreadRecordsById(writable.thread.messages, messages || [], event.payload['removedMessageIds'])
                )
            }
            if (activities || Array.isArray(event.payload['removedActivityIds'])) writable.thread.activities = mergeThreadRecordsById(writable.thread.activities, activities || [], event.payload['removedActivityIds'])
            if (proposedPlans || Array.isArray(event.payload['removedProposedPlanIds'])) writable.thread.proposedPlans = mergeThreadRecordsById(writable.thread.proposedPlans, proposedPlans || [], event.payload['removedProposedPlanIds'])
            if (pendingApprovals || Array.isArray(event.payload['removedPendingApprovalIds'])) writable.thread.pendingApprovals = mergeThreadRecordsById(writable.thread.pendingApprovals, pendingApprovals || [], event.payload['removedPendingApprovalIds'])
            if (pendingUserInputs || Array.isArray(event.payload['removedPendingUserInputIds'])) writable.thread.pendingUserInputs = mergeThreadRecordsById(writable.thread.pendingUserInputs, pendingUserInputs || [], event.payload['removedPendingUserInputIds'])
            writable.thread.hasPendingApprovals = writable.thread.pendingApprovals.some((entry) => entry.status === 'pending')
            writable.thread.hasPendingUserInputs = writable.thread.pendingUserInputs.some((entry) => entry.status === 'pending')
            writable.thread.hasActivePlan = Boolean(writable.thread.activePlan)
            projectApprovalWaitingState(writable.thread, false, Boolean(activities || pendingApprovals))

            const patchUpdatedAt = typeof patch['updatedAt'] === 'string' ? patch['updatedAt'] : null
            if (patchUpdatedAt) {
                writable.thread.updatedAt = patchUpdatedAt
                writable.session.updatedAt = patchUpdatedAt
            }
            break
        }
        case 'thread.message.user':
        case 'thread.message.assistant.delta':
        case 'thread.message.assistant.completed': {
            const threadId = String(event.payload['threadId'] || event.threadId || '')
            const location = findThreadLocation(next, threadId)
            const writable = location ? ensureThreadWritable(next, previousSessions, location) : null
            if (!writable) break

            const loadedMessageCountBefore = writable.thread.messages.length
            if (event.type === 'thread.message.assistant.delta') {
                const messageId = String(event.payload['messageId'] || '')
                const delta = String(event.payload['delta'] || '')
                const existing = writable.thread.messages.find((message) => message.id === messageId)
                const nextMessage: AssistantMessage = existing
                    ? {
                        ...existing,
                        role: 'assistant',
                        text: `${existing.text}${delta}`,
                        turnId: existing.turnId || String(event.payload['turnId'] || '') || null,
                        streaming: true,
                        updatedAt: event.occurredAt
                    }
                    : {
                        id: messageId,
                        role: 'assistant',
                        text: delta,
                        turnId: String(event.payload['turnId'] || '') || null,
                        streaming: true,
                        timelineSequence: event.sequence,
                        createdAt: event.occurredAt,
                        updatedAt: event.occurredAt
                    }
                writable.thread.messages = upsertMessage(writable.thread.messages, nextMessage)
            } else if (event.type === 'thread.message.assistant.completed') {
                const messageId = String(event.payload['messageId'] || '')
                const existing = writable.thread.messages.find((message) => message.id === messageId)
                if (existing) {
                    const completedText = typeof event.payload['text'] === 'string'
                        ? event.payload['text'] as string
                        : existing.text
                    const completedMessage = event.payload['message'] as AssistantMessage | undefined
                    const canonicalCompletion = completedMessage?.id === messageId ? completedMessage : null
                    writable.thread.messages = upsertMessage(writable.thread.messages, {
                        ...existing,
                        ...(canonicalCompletion || {}),
                        id: messageId,
                        text: completedText,
                        turnId: canonicalCompletion?.turnId || existing.turnId || String(event.payload['turnId'] || '') || null,
                        streaming: false,
                        timelineSequence: canonicalCompletion?.timelineSequence ?? existing.timelineSequence,
                        createdAt: canonicalCompletion?.createdAt || existing.createdAt,
                        updatedAt: event.occurredAt
                    })
                }
            } else {
                const message = event.payload['message'] as AssistantMessage
                writable.thread.messages = upsertMessage(writable.thread.messages, {
                    ...message,
                    timelineSequence: message.timelineSequence ?? event.sequence
                })
            }

            writable.thread.messages = reconcileAssistantMessageReplays(writable.thread.messages)
            const addedMessageCount = Math.max(0, writable.thread.messages.length - loadedMessageCountBefore)
            if (addedMessageCount > 0) writable.thread.messageCount += addedMessageCount
            if (event.type !== 'thread.message.assistant.delta') {
                writable.thread.updatedAt = event.occurredAt
                writable.session.updatedAt = event.occurredAt
                writable.session.threadIds = sortThreadsNewestFirst(writable.session.threadIds, writable.session.threads)
                shouldSortSessions = true
            }
            break
        }
        case 'thread.plan.updated': {
            const threadId = String(event.payload['threadId'] || event.threadId || '')
            const location = findThreadLocation(next, threadId)
            const writable = location ? ensureThreadWritable(next, previousSessions, location) : null
            if (!writable) break

            writable.thread.activePlan = event.payload['activePlan'] as AssistantThread['activePlan']
            writable.thread.hasActivePlan = Boolean(writable.thread.activePlan)
            break
        }
        case 'thread.proposed-plan.upserted': {
            const threadId = String(event.payload['threadId'] || event.threadId || '')
            const location = findThreadLocation(next, threadId)
            const writable = location ? ensureThreadWritable(next, previousSessions, location) : null
            if (!writable) break

            const plan = event.payload['plan'] as AssistantThread['proposedPlans'][number]
            const index = writable.thread.proposedPlans.findIndex((entry) => entry.id === plan.id)
            const nextPlan = {
                ...plan,
                timelineSequence: writable.thread.proposedPlans[index]?.timelineSequence
                    ?? plan.timelineSequence
                    ?? event.sequence
            }
            if (index < 0) {
                writable.thread.proposedPlans = [...writable.thread.proposedPlans, nextPlan]
                writable.thread.proposedPlanCount += 1
            } else if (writable.thread.proposedPlans[index] !== nextPlan) {
                const nextPlans = [...writable.thread.proposedPlans]
                nextPlans[index] = nextPlan
                writable.thread.proposedPlans = nextPlans
            }
            break
        }
        case 'thread.activity.appended': {
            const threadId = String(event.payload['threadId'] || event.threadId || '')
            const location = findThreadLocation(next, threadId)
            const writable = location ? ensureThreadWritable(next, previousSessions, location) : null
            if (!writable) break

            const activity = event.payload['activity'] as AssistantThread['activities'][number]
            const index = writable.thread.activities.findIndex((entry) => entry.id === activity.id)
            const nextActivity = {
                ...activity,
                timelineSequence: writable.thread.activities[index]?.timelineSequence
                    ?? activity.timelineSequence
                    ?? event.sequence
            }
            const approvalPending = activityNeedsApproval(writable.thread, nextActivity)
            if (approvalPending || nextActivity.payload?.approvalPending) nextActivity.payload = { ...nextActivity.payload, approvalPending }
            if (index < 0) {
                writable.thread.activities = [...writable.thread.activities, nextActivity]
                writable.thread.activityCount += 1
            } else {
                const nextActivities = [...writable.thread.activities]
                nextActivities[index] = nextActivity
                writable.thread.activities = nextActivities
            }
            projectApprovalWaitingState(writable.thread, false, false)
            break
        }
        case 'thread.approval.updated': {
            const threadId = String(event.payload['threadId'] || event.threadId || '')
            const location = findThreadLocation(next, threadId)
            const writable = location ? ensureThreadWritable(next, previousSessions, location) : null
            if (!writable) break

            const approval = event.payload['approval'] as AssistantPendingApproval
            const index = writable.thread.pendingApprovals.findIndex((entry) => entry.requestId === approval.requestId)
            if (index < 0) {
                writable.thread.pendingApprovals = [...writable.thread.pendingApprovals, approval].sort((left, right) => left.createdAt.localeCompare(right.createdAt))
            } else if (writable.thread.pendingApprovals[index] !== approval) {
                const nextApprovals = [...writable.thread.pendingApprovals]
                nextApprovals[index] = approval
                writable.thread.pendingApprovals = nextApprovals
            }
            writable.thread.hasPendingApprovals = writable.thread.pendingApprovals.some((entry) => entry.status === 'pending')
            projectApprovalWaitingState(writable.thread, approval.status === 'resolved')
            if (approval.status === 'resolved' && approval.decision === 'decline' && approval.toolCallId) {
                writable.thread.activities = writable.thread.activities.map((activity) => (
                    activity.payload?.toolCallId === approval.toolCallId || activity.id === `zyra-tool-${approval.toolCallId}`
                        ? { ...activity, summary: 'Action declined', tone: 'warning' as const, payload: { ...activity.payload, status: 'failed', approvalPending: false } }
                        : activity
                ))
            }
            break
        }
        case 'thread.user-input.updated': {
            const threadId = String(event.payload['threadId'] || event.threadId || '')
            const location = findThreadLocation(next, threadId)
            const writable = location ? ensureThreadWritable(next, previousSessions, location) : null
            if (!writable) break

            const userInput = event.payload['userInput'] as AssistantPendingUserInput
            const index = writable.thread.pendingUserInputs.findIndex((entry) => entry.requestId === userInput.requestId)
            if (index < 0) {
                writable.thread.pendingUserInputs = [...writable.thread.pendingUserInputs, userInput].sort((left, right) => left.createdAt.localeCompare(right.createdAt))
            } else if (writable.thread.pendingUserInputs[index] !== userInput) {
                const nextInputs = [...writable.thread.pendingUserInputs]
                nextInputs[index] = userInput
                writable.thread.pendingUserInputs = nextInputs
            }
            writable.thread.hasPendingUserInputs = writable.thread.pendingUserInputs.some((entry) => entry.status === 'pending')
            projectApprovalWaitingState(writable.thread, userInput.status === 'resolved')
            break
        }
        case 'thread.latest-turn.updated': {
            const threadId = String(event.payload['threadId'] || event.threadId || '')
            const location = findThreadLocation(next, threadId)
            const writable = location ? ensureThreadWritable(next, previousSessions, location) : null
            if (!writable) break

            writable.thread.latestTurn = event.payload['latestTurn'] as AssistantThread['latestTurn']
            break
        }
    }

    if (shouldSortSessions) {
        next.sessions = sortSessionsNewestFirst(next.sessions)
    }

    return next
}

export function applyAssistantDomainEvents(snapshot: AssistantSnapshot, events: AssistantDomainEvent[]): AssistantSnapshot {
    if (events.length === 0) return snapshot

    let next = snapshot
    for (const event of events) {
        next = applyAssistantDomainEventInternal(next, event)
    }
    return next
}

export function applyAssistantDomainEvent(snapshot: AssistantSnapshot, event: AssistantDomainEvent): AssistantSnapshot {
    return applyAssistantDomainEvents(snapshot, [event])
}
