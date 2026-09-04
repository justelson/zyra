import type {
    AssistantActivity,
    AssistantMessage,
    AssistantProposedPlan,
    AssistantSession,
    AssistantThread
} from '../../shared/assistant/contracts'

export const ASSISTANT_DEVELOPMENT_LIGHT_SESSION_ID = 'assistant-session:development-fixture:light-v1'
export const ASSISTANT_DEVELOPMENT_HEAVY_SESSION_ID = 'assistant-session:development-fixture:heavy-v1'
const ASSISTANT_DEVELOPMENT_FIXTURE_SESSION_IDS = new Set([
    ASSISTANT_DEVELOPMENT_LIGHT_SESSION_ID,
    ASSISTANT_DEVELOPMENT_HEAVY_SESSION_ID
])

export function isAssistantDevelopmentChatFixtureSessionId(sessionId: string | null | undefined): boolean {
    return Boolean(sessionId && ASSISTANT_DEVELOPMENT_FIXTURE_SESSION_IDS.has(sessionId))
}

const LIGHT_TURN_COUNT = 6
const HEAVY_TURN_COUNT = 220
const HEAVY_STRESS_TURN = HEAVY_TURN_COUNT - 1
const HEAVY_STRESS_ACTION_COUNT = 132

export type AssistantDevelopmentChatFixtureSummary = {
    sessionId: string
    threadId: string
    title: string
    turns: number
    messages: number
    activities: number
    characters: number
}

export type AssistantDevelopmentChatFixtures = {
    sessions: AssistantSession[]
    summaries: AssistantDevelopmentChatFixtureSummary[]
}

type FixtureCollections = {
    messages: AssistantMessage[]
    activities: AssistantActivity[]
    proposedPlans: AssistantProposedPlan[]
    sequence: number
}

function timestamp(baseTime: number, sequence: number): string {
    return new Date(baseTime + sequence * 1_000).toISOString()
}

function createCollections(): FixtureCollections {
    return { messages: [], activities: [], proposedPlans: [], sequence: 1 }
}

function appendMessage(
    fixture: FixtureCollections,
    input: {
        id: string
        role: AssistantMessage['role']
        text: string
        turnId: string
        baseTime: number
    }
): AssistantMessage {
    const createdAt = timestamp(input.baseTime, fixture.sequence)
    const message: AssistantMessage = {
        id: input.id,
        role: input.role,
        text: input.text,
        turnId: input.turnId,
        streaming: false,
        timelineSequence: fixture.sequence,
        createdAt,
        updatedAt: createdAt
    }
    fixture.sequence += 1
    fixture.messages.push(message)
    return message
}

function appendActivity(
    fixture: FixtureCollections,
    input: {
        id: string
        kind: string
        summary: string
        detail?: string
        payload: Record<string, unknown>
        turnId: string
        baseTime: number
    }
): AssistantActivity {
    const activity: AssistantActivity = {
        id: input.id,
        kind: input.kind,
        tone: 'tool',
        summary: input.summary,
        detail: input.detail,
        turnId: input.turnId,
        timelineSequence: fixture.sequence,
        createdAt: timestamp(input.baseTime, fixture.sequence),
        payload: input.payload
    }
    fixture.sequence += 1
    fixture.activities.push(activity)
    return activity
}

function appendPlan(
    fixture: FixtureCollections,
    input: { id: string; turnId: string; turn: number; baseTime: number }
): void {
    const createdAt = timestamp(input.baseTime, fixture.sequence)
    fixture.proposedPlans.push({
        id: input.id,
        turnId: input.turnId,
        planMarkdown: `1. Inspect fixture segment ${input.turn}\n2. Compare the visible hierarchy\n3. Verify scroll anchoring`,
        timelineSequence: fixture.sequence,
        createdAt,
        updatedAt: createdAt
    })
    fixture.sequence += 1
}

function createThread(input: {
    id: string
    createdAt: string
    updatedAt: string
    cwd: string
    collections: FixtureCollections
    latestTurnId: string
    latestAssistantMessage: AssistantMessage
}): AssistantThread {
    return {
        id: input.id,
        providerThreadId: null,
        source: 'root',
        parentThreadId: null,
        providerParentThreadId: null,
        subagentDepth: null,
        agentNickname: null,
        agentRole: null,
        model: 'development-fixture',
        cwd: input.cwd,
        messageCount: input.collections.messages.length,
        activityCount: input.collections.activities.length,
        proposedPlanCount: input.collections.proposedPlans.length,
        lastSeenCompletedTurnId: input.latestTurnId,
        runtimeMode: 'approval-required',
        interactionMode: 'default',
        webSearch: false,
        webFetch: false,
        state: 'ready',
        lastError: null,
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
        latestTurn: {
            id: input.latestTurnId,
            state: 'completed',
            requestedAt: input.latestAssistantMessage.createdAt,
            startedAt: input.latestAssistantMessage.createdAt,
            completedAt: input.latestAssistantMessage.updatedAt,
            assistantMessageId: input.latestAssistantMessage.id,
            effort: null,
            serviceTier: null,
            usage: null
        },
        hasPendingApprovals: false,
        hasPendingUserInputs: false,
        hasActivePlan: false,
        activePlan: null,
        messages: input.collections.messages,
        activities: input.collections.activities,
        proposedPlans: input.collections.proposedPlans,
        pendingApprovals: [],
        pendingUserInputs: []
    }
}

function createSession(input: {
    id: string
    thread: AssistantThread
    title: string
    createdAt: string
    updatedAt: string
}): AssistantSession {
    return {
        id: input.id,
        title: input.title,
        mode: 'work',
        projectPath: null,
        projectId: null,
        workingRoot: null,
        chatScope: null,
        playgroundLabId: null,
        pendingLabRequest: null,
        archived: false,
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
        activeThreadId: input.thread.id,
        threadIds: [input.thread.id],
        threads: [input.thread]
    }
}

function summarize(session: AssistantSession, turns: number): AssistantDevelopmentChatFixtureSummary {
    const thread = session.threads[0]!
    const characters = thread.messages.reduce((total, message) => total + message.text.length, 0)
        + thread.activities.reduce((total, activity) => total + activity.summary.length + (activity.detail?.length || 0) + JSON.stringify(activity.payload || {}).length, 0)
        + thread.proposedPlans.reduce((total, plan) => total + plan.planMarkdown.length, 0)
    return {
        sessionId: session.id,
        threadId: thread.id,
        title: session.title,
        turns,
        messages: thread.messages.length,
        activities: thread.activities.length,
        characters
    }
}

function createLightFixture(cwd: string, now: number): AssistantSession {
    const sessionId = ASSISTANT_DEVELOPMENT_LIGHT_SESSION_ID
    const threadId = 'assistant-thread:development-fixture:light-v1'
    const baseTime = now - 90 * 60_000
    const fixture = createCollections()
    let latestAssistantMessage: AssistantMessage | null = null

    for (let turn = 1; turn <= LIGHT_TURN_COUNT; turn += 1) {
        const turnId = `development-fixture:light:turn-${turn}`
        appendMessage(fixture, {
            id: `development-fixture:light:user-${turn}`,
            role: 'user',
            text: turn === 1
                ? 'This is a local light-chat fixture for checking ordinary spacing and Chat switching.'
                : `Short fixture prompt ${turn}. Keep this turn deliberately small.`,
            turnId,
            baseTime
        })
        if (turn === 2) {
            appendActivity(fixture, {
                id: 'development-fixture:light:activity-2',
                kind: 'command',
                summary: 'Ran fixture check',
                detail: 'printf light-fixture',
                turnId,
                baseTime,
                payload: { status: 'completed', command: 'printf light-fixture', output: 'light-fixture: ok' }
            })
        }
        latestAssistantMessage = appendMessage(fixture, {
            id: `development-fixture:light:assistant-${turn}`,
            role: 'assistant',
            text: turn === LIGHT_TURN_COUNT
                ? 'Light fixture complete. The full Chat should fit comfortably and remain intact after repeated switching.'
                : `Short fixture response ${turn}.`,
            turnId,
            baseTime
        })
    }

    const createdAt = timestamp(baseTime, 0)
    const updatedAt = new Date(now).toISOString()
    const thread = createThread({
        id: threadId,
        createdAt,
        updatedAt,
        cwd,
        collections: fixture,
        latestTurnId: `development-fixture:light:turn-${LIGHT_TURN_COUNT}`,
        latestAssistantMessage: latestAssistantMessage!
    })
    return createSession({
        id: sessionId,
        thread,
        title: `TEST — LIGHT CHAT — ${LIGHT_TURN_COUNT} TURNS — SAFE TO DELETE`,
        createdAt,
        updatedAt
    })
}

function longFixtureAnswer(turn: number): string {
    const paragraph = `Segment ${turn} carries intentionally repetitive local text so wrapping, Markdown measurement, virtualization, and retained-history limits can be inspected without relying on a real conversation. `
    return `## Heavy fixture result ${turn}\n\n${paragraph.repeat(18)}\n\n- Stable Chat identity\n- Long wrapped prose\n- Mixed action density\n- Durable pagination boundary\n\n\`\`\`ts\nexport const fixtureTurn = ${turn}\nexport const fixtureKind = 'heavy-chat'\n\`\`\``
}

function appendHeavyAction(fixture: FixtureCollections, turn: number, action: number, turnId: string, baseTime: number): void {
    const kindIndex = action % 4
    if (kindIndex === 0) {
        appendActivity(fixture, {
            id: `development-fixture:heavy:activity-${turn}-${action}`,
            kind: 'command',
            summary: `Ran fixture command ${action + 1}`,
            detail: `printf heavy-${turn}-${action + 1}`,
            turnId,
            baseTime,
            payload: { status: 'completed', command: `printf heavy-${turn}-${action + 1}`, output: `fixture ${turn}/${action + 1}: ok` }
        })
        return
    }
    if (kindIndex === 1) {
        appendActivity(fixture, {
            id: `development-fixture:heavy:activity-${turn}-${action}`,
            kind: 'file-read',
            summary: `Read fixture-${turn}.ts`,
            detail: `fixtures/fixture-${turn}.ts`,
            turnId,
            baseTime,
            payload: {
                status: 'completed',
                toolName: 'read',
                args: { path: `fixtures/fixture-${turn}.ts`, offset: action + 1, limit: 12 },
                paths: [`fixtures/fixture-${turn}.ts`],
                output: `export const fixture = ${turn};\n`
            }
        })
        return
    }
    if (kindIndex === 2) {
        appendActivity(fixture, {
            id: `development-fixture:heavy:activity-${turn}-${action}`,
            kind: 'search',
            summary: 'Searched fixture history',
            detail: `fixture marker ${turn}`,
            turnId,
            baseTime,
            payload: { status: 'completed', query: `fixture marker ${turn}`, output: `fixtures/fixture-${turn}.ts:1` }
        })
        return
    }
    appendActivity(fixture, {
        id: `development-fixture:heavy:activity-${turn}-${action}`,
        kind: 'file-change',
        summary: `Edited fixture-${turn}.ts`,
        detail: `fixtures/fixture-${turn}.ts`,
        turnId,
        baseTime,
        payload: {
            status: 'completed',
            paths: [`fixtures/fixture-${turn}.ts`],
            createdPaths: [],
            changes: [{ path: `fixtures/fixture-${turn}.ts`, kind: 'update', diff: `@@ -1 +1 @@\n-old-${turn}\n+new-${turn}\n` }],
            patch: `--- a/fixtures/fixture-${turn}.ts\n+++ b/fixtures/fixture-${turn}.ts\n@@ -1 +1 @@\n-old-${turn}\n+new-${turn}\n`,
            fileCount: 1
        }
    })
}

function createHeavyFixture(cwd: string, now: number): AssistantSession {
    const sessionId = ASSISTANT_DEVELOPMENT_HEAVY_SESSION_ID
    const threadId = 'assistant-thread:development-fixture:heavy-v1'
    const baseTime = now - 36 * 60 * 60_000
    const fixture = createCollections()
    let latestAssistantMessage: AssistantMessage | null = null

    for (let turn = 1; turn <= HEAVY_TURN_COUNT; turn += 1) {
        const turnId = `development-fixture:heavy:turn-${turn}`
        appendMessage(fixture, {
            id: `development-fixture:heavy:user-${turn}`,
            role: 'user',
            text: turn === 1
                ? 'This is a local heavy-chat fixture. Use it to inspect switching, pagination, long text, Work narration, and dense Action batches.'
                : `Inspect heavy fixture segment ${turn} and preserve its chronology.`,
            turnId,
            baseTime
        })
        if (turn < HEAVY_TURN_COUNT) {
            appendMessage(fixture, {
                id: `development-fixture:heavy:narration-${turn}`,
                role: 'assistant',
                text: `I’m checking heavy fixture segment ${turn} and keeping its generated evidence in order.`,
                turnId,
                baseTime
            })
        }

        const actionCount = turn === HEAVY_STRESS_TURN
            ? HEAVY_STRESS_ACTION_COUNT
            : turn === HEAVY_TURN_COUNT ? 1 : 5
        for (let action = 0; action < actionCount; action += 1) {
            appendHeavyAction(fixture, turn, action, turnId, baseTime)
        }
        if (turn % 25 === 0 && turn < HEAVY_TURN_COUNT) {
            appendPlan(fixture, {
                id: `development-fixture:heavy:plan-${turn}`,
                turnId,
                turn,
                baseTime
            })
        }

        latestAssistantMessage = appendMessage(fixture, {
            id: `development-fixture:heavy:assistant-${turn}`,
            role: 'assistant',
            text: turn === HEAVY_TURN_COUNT
                ? 'Newest fixture turn is intentionally short. Switching here must restore or backfill the older heavy context instead of leaving only this turn visible.'
                : turn % 5 === 0 || turn === HEAVY_STRESS_TURN
                    ? longFixtureAnswer(turn)
                    : `Heavy fixture segment ${turn} completed with ${actionCount} captured Actions.`,
            turnId,
            baseTime
        })
    }

    const createdAt = timestamp(baseTime, 0)
    const updatedAt = new Date(now - 1_000).toISOString()
    const thread = createThread({
        id: threadId,
        createdAt,
        updatedAt,
        cwd,
        collections: fixture,
        latestTurnId: `development-fixture:heavy:turn-${HEAVY_TURN_COUNT}`,
        latestAssistantMessage: latestAssistantMessage!
    })
    return createSession({
        id: sessionId,
        thread,
        title: `TEST — HEAVY CHAT — ${HEAVY_TURN_COUNT} TURNS + LONG TEXT — SAFE TO DELETE`,
        createdAt,
        updatedAt
    })
}

export function createAssistantDevelopmentChatFixtures(input: {
    cwd: string
    now?: number
}): AssistantDevelopmentChatFixtures {
    const now = Number.isFinite(input.now) ? Number(input.now) : Date.now()
    const sessions = [createLightFixture(input.cwd, now), createHeavyFixture(input.cwd, now)]
    return {
        sessions,
        summaries: [summarize(sessions[0]!, LIGHT_TURN_COUNT), summarize(sessions[1]!, HEAVY_TURN_COUNT)]
    }
}
