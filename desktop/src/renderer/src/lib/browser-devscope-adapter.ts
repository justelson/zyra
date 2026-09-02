import { createDefaultAssistantSnapshot } from '@shared/assistant/projector'
import type {
    AssistantAccountOverviewPayload,
    AssistantActivity,
    AssistantBootstrapPayload,
    AssistantEventStreamPayload,
    AssistantMessage,
    AssistantModelInfo,
    AssistantRuntimeStatus,
    AssistantSession,
    AssistantSessionTurnUsageEntry,
    AssistantSessionTurnUsageResultPayload,
    AssistantSnapshot,
    AssistantThread,
    AssistantVoiceTranscriptionState
} from '@shared/assistant/contracts'
import type {
    DevScopeApi,
    DevScopeResult,
    DevScopeUpdateActionResult,
    DevScopeUpdateState
} from '@shared/contracts/devscope-api'
import { createBrowserAssistantBridgeAdapter } from './browser-assistant-bridge-adapter'
import { createLiveBrowserDevscopeAdapter } from './browser-devscope-live-adapter'
import { formatDesktopVersion, resolveDesktopReleaseChannel } from './release-build-metadata'

const BROWSER_PREVIEW_SESSION_ID = 'browser-preview-session'
const BROWSER_PREVIEW_THREAD_ID = 'browser-preview-thread'
const BROWSER_PREVIEW_ERROR = 'This action requires the Zyra desktop bridge.'
const BROWSER_RAIL_DEV_CHAT_PATH = '/assistant/dev/full-chat'
const BROWSER_RAIL_LIVE_CHAT_PATH = '/assistant/dev/live-work'
const BROWSER_RAIL_DEV_CHAT_MODES = new Set(['rail', 'full', 'full-chat', 'timeline'])
const BROWSER_RAIL_LIVE_CHAT_MODES = new Set(['rail-live', 'live', 'live-work'])
const BROWSER_RAIL_DEV_BASE_TIME = Date.parse('2026-07-07T08:00:00.000Z')

type BrowserPreviewMode = 'empty' | 'rail-dev-chat' | 'rail-live-chat'

const previewModels: AssistantModelInfo[] = [
    { id: 'gpt-5.5', label: 'gpt-5.5' },
    { id: 'gpt-5.4', label: 'gpt-5.4' },
    { id: 'gpt-5.4-mini', label: 'gpt-5.4-mini' },
    { id: 'gpt-5.3-codex', label: 'gpt-5.3-codex' }
]

const browserUpdateState: DevScopeUpdateState = {
    enabled: false,
    status: 'disabled',
    currentVersion: __ZYRA_DESKTOP_VERSION__,
    currentDisplayVersion: formatDesktopVersion(__ZYRA_DESKTOP_VERSION__),
    channel: resolveDesktopReleaseChannel(__ZYRA_DESKTOP_VERSION__),
    repository: '',
    releasePageUrl: '',
    disabledReason: 'Updates are managed by the hosting Zyra Desktop app.',
    availableVersion: null,
    availableDisplayVersion: null,
    downloadedVersion: null,
    downloadedDisplayVersion: null,
    downloadPercent: null,
    checkedAt: null,
    message: null,
    errorContext: null,
    canRetry: false
}

const browserVoiceTranscriptionState: AssistantVoiceTranscriptionState = {
    provider: 'codex',
    status: 'unavailable',
    available: false,
    signedIn: false,
    message: 'ChatGPT transcription requires the Zyra desktop bridge.'
}

function getBrowserPreviewMode(): BrowserPreviewMode {
    const hash = window.location.hash || ''
    const hashPath = hash.startsWith('#') ? hash.slice(1).split('?')[0] || '' : ''
    if (hashPath === BROWSER_RAIL_DEV_CHAT_PATH) return 'rail-dev-chat'
    if (hashPath === BROWSER_RAIL_LIVE_CHAT_PATH) return 'rail-live-chat'

    const params = new URLSearchParams(window.location.search || '')
    const hashQuery = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : ''
    const hashParams = new URLSearchParams(hashQuery)
    const mode = (hashParams.get('devChat') || params.get('devChat') || '').trim().toLowerCase()
    if (BROWSER_RAIL_LIVE_CHAT_MODES.has(mode)) return 'rail-live-chat'
    return BROWSER_RAIL_DEV_CHAT_MODES.has(mode) ? 'rail-dev-chat' : 'empty'
}

function getBrowserPreviewRunningCommandCount(): number {
    const hash = window.location.hash || ''
    const hashQuery = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : ''
    const params = new URLSearchParams(window.location.search || '')
    const hashParams = new URLSearchParams(hashQuery)
    const requested = Number.parseInt(hashParams.get('runningCommands') || params.get('runningCommands') || '1', 10)
    return Number.isFinite(requested) ? Math.max(1, Math.min(4, requested)) : 1
}

function createBrowserStatus(mode: BrowserPreviewMode): AssistantRuntimeStatus {
    return {
        available: true,
        connected: true,
        selectedSessionId: BROWSER_PREVIEW_SESSION_ID,
        activeThreadId: BROWSER_PREVIEW_THREAD_ID,
        state: mode === 'rail-live-chat' ? 'running' : 'idle',
        reason: 'Browser preview bridge.'
    }
}

function devIso(minutes: number): string {
    return new Date(BROWSER_RAIL_DEV_BASE_TIME + minutes * 60_000).toISOString()
}

function liveIso(secondsAgo: number): string {
    return new Date(Date.now() - secondsAgo * 1000).toISOString()
}

function createDevMessage(input: {
    id: string
    role: AssistantMessage['role']
    text: string
    turnId: string | null
    minute: number
    updatedMinute?: number
}): AssistantMessage {
    const createdAt = devIso(input.minute)
    const updatedAt = devIso(input.updatedMinute ?? input.minute)
    return {
        id: input.id,
        role: input.role,
        text: input.text,
        turnId: input.turnId,
        streaming: false,
        createdAt,
        updatedAt
    }
}

function createDevActivity(input: {
    id: string
    kind: string
    tone?: AssistantActivity['tone']
    summary: string
    detail?: string
    turnId: string
    minute: number
    payload?: Record<string, unknown>
}): AssistantActivity {
    return {
        id: input.id,
        kind: input.kind,
        tone: input.tone || 'tool',
        summary: input.summary,
        detail: input.detail,
        turnId: input.turnId,
        createdAt: devIso(input.minute),
        payload: input.payload
    }
}

const railDevReferenceTurnSpecs = [
    {
        prompt: 'Locate the chat rail code and explain why the checkpoint marker is landing in the message body.',
        response: 'The marker was being measured from the message content, then rendered from inside a translated container. I moved the rail ownership up to the timeline pane so the minimap belongs to the chat surface.'
    },
    {
        prompt: 'Apply the screenshot reference: keep the rail as a small hoverable table of contents, not literal marks on each message.',
        response: 'I kept the markers detached from message rows. The rail uses prompt checkpoints for navigation and only expands into a preview card on hover.'
    },
    {
        prompt: 'Add tool-call rows so the fixture catches streaming and grouped activity layout issues.',
        response: 'This turn includes grouped command and file activity rows. The rail still anchors to user prompts, while the preview can summarize the next assistant response.'
    },
    {
        prompt: 'Scroll midway and make sure the active checkpoint follows the visible conversation.',
        response: 'The active checkpoint uses the scroll container position plus a stable viewport anchor, so the highlighted dash tracks the current turn instead of raw message offsets.'
    },
    {
        prompt: 'Make the hover target forgiving without turning the rail into a fat visible button.',
        response: 'The visible markers stay small. The button hitbox is wider and transparent, so pointer movement can trigger the wave and preview without forcing a large control into the chat.'
    },
    {
        prompt: 'Check long assistant text and markdown blocks so the rail is still outside the content lane.',
        response: 'A longer answer should stretch the timeline without moving the rail. The rail is portalled into the pane overlay, so message height and markdown layout no longer affect its horizontal position.\n\n```tsx\n<AssistantTimelineCheckpointRail railHostRef={timelineRailHostRef} />\n```\n\nThe marker math is intentionally index-based like the reference instead of trying to mirror each row height.'
    },
    {
        prompt: 'Verify the bottom composer bubble and scroll-to-bottom button do not cover the rail.',
        response: 'The rail host is pointer-events-none and only the minimap button accepts pointer input. The composer remains in the bottom overlay lane, while the rail stays on the left edge of the timeline pane.'
    },
    {
        prompt: 'Final visual pass: the checkpoint rail should be visible as a left-side mini TOC with hover previews.',
        response: 'The full-chat dev fixture is now meant to stay available in browser preview. It gives the rail enough user turns to render consistently and gives us a stable URL to retest future fixes.'
    }
]

const RAIL_SCROLL_FIXTURE_TURN_COUNT = 180

const railDevTurnSpecs = Array.from({ length: RAIL_SCROLL_FIXTURE_TURN_COUNT }, (_, index) => {
    const reference = railDevReferenceTurnSpecs[index]
    if (reference) return reference

    const turnNumber = index + 1
    const sectionCount = turnNumber % 10 === 0 ? 8 : (turnNumber % 4) + 1
    const sections = Array.from({ length: sectionCount }, (_section, sectionIndex) => (
        `Variable-height section ${sectionIndex + 1}/${sectionCount} for turn ${turnNumber}. `
        + 'This paragraph deliberately wraps across several lines so late Markdown measurements exercise the virtual timeline anchor without moving the reader.'
    ))
    const codeBlock = turnNumber % 7 === 0
        ? `\n\n\`\`\`ts\nexport const fixtureTurn = ${turnNumber}\nexport const preservesViewportAnchor = true\n\`\`\``
        : ''

    return {
        prompt: `Scroll fixture turn ${turnNumber}: keep this message stable while nearby rows change height.`,
        response: `Fixture response ${turnNumber}.\n\n${sections.join('\n\n')}${codeBlock}`
    }
})

function createRailDevMessages(): AssistantMessage[] {
    return railDevTurnSpecs.flatMap((turn, index) => {
        const turnNumber = index + 1
        const turnId = `rail-dev-turn-${turnNumber}`
        const assistantMinute = turnNumber === 3 ? 23 : index * 8 + 3
        return [
            createDevMessage({
                id: `rail-dev-user-${turnNumber}`,
                role: 'user',
                text: turn.prompt,
                turnId,
                minute: index * 8
            }),
            createDevMessage({
                id: `rail-dev-assistant-${turnNumber}`,
                role: 'assistant',
                text: turn.response,
                turnId,
                minute: assistantMinute,
                updatedMinute: turnNumber === 3 ? 24 : index * 8 + 7
            })
        ]
    })
}

function createRailDevActivities(): AssistantActivity[] {
    return [
        createDevActivity({
            id: 'rail-dev-activity-read',
            kind: 'file-read',
            summary: 'Read file',
            detail: 'AssistantTimelineCheckpointRail.tsx',
            turnId: 'rail-dev-turn-1',
            minute: 1,
            payload: {
                paths: ['desktop/src/renderer/src/pages/assistant/AssistantTimelineCheckpointRail.tsx'],
                durationMs: 820,
                status: 'completed'
            }
        }),
        createDevActivity({
            id: 'rail-dev-activity-command',
            kind: 'command',
            summary: 'Ran command',
            detail: 'npm run ui:typecheck',
            turnId: 'rail-dev-turn-3',
            minute: 18,
            payload: {
                command: 'npm run ui:typecheck',
                output: 'tsc --noEmit -p tsconfig.typecheck.json\nDone.',
                durationMs: 4200,
                status: 'completed'
            }
        }),
        createDevActivity({
            id: 'rail-dev-internal-before-tools',
            kind: 'assistant.internal',
            summary: 'Internal message',
            detail: 'I should inspect the current files first, then run the smallest validation command that proves the rail and tool timeline still render correctly.',
            turnId: 'rail-dev-turn-3',
            minute: 17,
            payload: {
                category: 'assistant-internal',
                output: 'I should inspect the current files first, then run the smallest validation command that proves the rail and tool timeline still render correctly.',
                status: 'completed',
                streamKind: 'reasoning_summary_text'
            }
        }),
        createDevActivity({
            id: 'rail-dev-activity-raw-read',
            kind: 'tool',
            summary: 'Ran tool',
            detail: 'read',
            turnId: 'rail-dev-turn-3',
            minute: 19,
            payload: {
                toolName: 'read',
                args: { path: 'desktop/package.json' },
                result: {
                    content: [
                        {
                            type: 'text',
                            text: '{\n  "name": "zyra-desktop",\n  "version": "0.6.0",\n  "scripts": {\n    "typecheck": "tsc --noEmit -p tsconfig.typecheck.json"\n  }\n}'
                        }
                    ]
                },
                status: 'completed'
            }
        }),
        createDevActivity({
            id: 'rail-dev-activity-raw-bash',
            kind: 'tool',
            summary: 'Ran tool',
            detail: 'bash',
            turnId: 'rail-dev-turn-3',
            minute: 20,
            payload: {
                toolName: 'bash',
                args: { command: 'npm run ui:typecheck' },
                result: {
                    content: [
                        {
                            type: 'text',
                            text: '> zyra-desktop@0.6.0 typecheck\n> tsc --noEmit -p tsconfig.typecheck.json\n\nDone.'
                        }
                    ]
                },
                status: 'completed'
            }
        }),
        createDevActivity({
            id: 'rail-dev-activity-timeout-envelope',
            kind: 'tool',
            tone: 'error',
            summary: 'Failed bash',
            detail: 'bash',
            turnId: 'rail-dev-turn-3',
            minute: 21,
            payload: {
                toolName: 'bash',
                output: '{"content":[{"type":"text","text":"timeout:60 after 1m 1s.\\nCommand: npm run typecheck\\n\\nThe command is still running."}]}',
                status: 'failed'
            }
        }),
        createDevActivity({
            id: 'rail-dev-activity-git-status',
            kind: 'command',
            summary: 'Ran command',
            detail: 'git status --short',
            turnId: 'rail-dev-turn-3',
            minute: 21.5,
            payload: {
                command: 'git status --short',
                output: ' M AssistantTimelineRows.tsx',
                durationMs: 610,
                status: 'completed'
            }
        }),
        createDevActivity({
            id: 'rail-dev-activity-search',
            kind: 'tool',
            summary: 'Searched files',
            detail: 'rg',
            turnId: 'rail-dev-turn-3',
            minute: 22,
            payload: {
                toolName: 'rg',
                args: { pattern: 'turn-work-summary', path: 'desktop/src' },
                result: { content: [{ type: 'text', text: 'AssistantTimelineRows.tsx:457' }] },
                status: 'completed'
            }
        }),
        createDevActivity({
            id: 'rail-dev-activity-file-read-late',
            kind: 'file-read',
            summary: 'Read file',
            detail: 'AssistantTimelineRows.tsx',
            turnId: 'rail-dev-turn-3',
            minute: 24,
            payload: {
                paths: ['desktop/src/renderer/src/pages/assistant/AssistantTimelineRows.tsx'],
                durationMs: 740,
                status: 'completed'
            }
        }),
        createDevActivity({
            id: 'rail-dev-internal-after-tools',
            kind: 'assistant.internal',
            summary: 'Internal message',
            detail: 'The raw provider envelopes need to normalize before persistence, and the final response should arrive after these work steps instead of pulling them out of order.',
            turnId: 'rail-dev-turn-3',
            minute: 25,
            payload: {
                category: 'assistant-internal',
                output: 'The raw provider envelopes need to normalize before persistence, and the final response should arrive after these work steps instead of pulling them out of order.',
                status: 'completed',
                streamKind: 'reasoning_summary_text'
            }
        }),
        createDevActivity({
            id: 'rail-dev-activity-edit',
            kind: 'file-change',
            summary: 'Edited files',
            detail: 'Timeline pane rail host',
            turnId: 'rail-dev-turn-4',
            minute: 26,
            payload: {
                category: 'file-change',
                provider: 'codex',
                source: 'provider-result',
                revision: 3,
                authoritative: true,
                paths: [
                    'AssistantConversationTimelinePane.tsx',
                    'AssistantTimeline.tsx',
                    'AssistantTimelineCheckpointRail.tsx'
                ],
                changes: [
                    { path: 'AssistantConversationTimelinePane.tsx', kind: 'update' },
                    { path: 'AssistantTimeline.tsx', kind: 'update' },
                    { path: 'AssistantTimelineCheckpointRail.tsx', kind: 'update' }
                ],
                patch: [
                    '--- a/AssistantConversationTimelinePane.tsx',
                    '+++ b/AssistantConversationTimelinePane.tsx',
                    '@@ -1 +1 @@',
                    '-const rail = false',
                    '+const rail = true',
                    '--- a/AssistantTimeline.tsx',
                    '+++ b/AssistantTimeline.tsx',
                    '@@ -1 +1 @@',
                    '-const minimap = false',
                    '+const minimap = true',
                    '--- a/AssistantTimelineCheckpointRail.tsx',
                    '+++ b/AssistantTimelineCheckpointRail.tsx',
                    '@@ -1 +1 @@',
                    '-const compact = false',
                    '+const compact = true'
                ].join('\n'),
                additions: 3,
                deletions: 3,
                fileCount: 3,
                status: 'completed'
            }
        })
    ]
}

function createRailLiveMessages(): AssistantMessage[] {
    const userMessage = createDevMessage({
        id: 'rail-dev-live-user',
        role: 'user',
        text: 'Keep this turn running so I can judge the single activity rail while thoughts and tools are still arriving.',
        turnId: 'rail-dev-turn-live',
        minute: 72
    })
    userMessage.createdAt = liveIso(18)
    userMessage.updatedAt = userMessage.createdAt
    return [
        ...createRailDevMessages(),
        userMessage
    ]
}

function createRailLiveActivities(runningCommandCount = 1): AssistantActivity[] {
    const liveActivities = [
        createDevActivity({
            id: 'rail-dev-live-thought',
            kind: 'assistant.internal',
            summary: 'Internal message',
            detail: 'I am checking the active turn path first. The rail should already exist, keep one identity, and absorb each later tool without creating another work block.',
            turnId: 'rail-dev-turn-live',
            minute: 73,
            payload: {
                category: 'assistant-internal',
                output: 'I am checking the active turn path first. The rail should already exist, keep one identity, and absorb each later tool without creating another work block.',
                status: 'completed',
                streamKind: 'reasoning_summary_text'
            }
        }),
        createDevActivity({
            id: 'rail-dev-live-command',
            kind: 'command',
            summary: 'Running command',
            detail: 'bun run typecheck',
            turnId: 'rail-dev-turn-live',
            minute: 74,
            payload: {
                command: 'bun run typecheck',
                output: [
                    '01 Loading TypeScript config...',
                    '02 Checking shared contracts...',
                    '03 Checking main process...',
                    '04 Checking renderer state...',
                    '05 Checking assistant timeline...',
                    '06 Checking command cards...',
                    '07 Checking Markdown blocks...',
                    '08 Checking final diagnostics...'
                ].join('\n'),
                durationMs: 0,
                status: 'running'
            }
        }),
        createDevActivity({
            id: 'rail-dev-live-read',
            kind: 'file-read',
            summary: 'Read file',
            detail: 'assistant-timeline-helpers.ts',
            turnId: 'rail-dev-turn-live',
            minute: 75,
            payload: {
                paths: ['desktop/src/renderer/src/pages/assistant/assistant-timeline-helpers.ts'],
                durationMs: 520,
                status: 'completed'
            }
        }),
        createDevActivity({
            id: 'rail-dev-live-file-change',
            kind: 'file-change',
            summary: 'Editing file',
            detail: 'AssistantPage.tsx',
            turnId: 'rail-dev-turn-live',
            minute: 76,
            payload: {
                category: 'file-change',
                provider: 'codex',
                source: 'provider-live',
                revision: 2,
                authoritative: false,
                status: 'running',
                paths: ['AssistantPage.tsx'],
                changes: [{ path: 'AssistantPage.tsx', kind: 'update' }],
                patch: '--- a/AssistantPage.tsx\n+++ b/AssistantPage.tsx\n@@ -1 +1 @@\n-onViewDiff={undefined}\n+onViewDiff={handleViewDiff}\n',
                additions: 1,
                deletions: 1,
                fileCount: 1
            }
        })
    ]
    if (runningCommandCount > 1) {
        liveActivities.splice(2, 0, createDevActivity({
            id: 'rail-dev-live-command-secondary',
            kind: 'command',
            summary: 'Running command',
            detail: 'node scripts/check-contracts.mjs',
            turnId: 'rail-dev-turn-live',
            minute: 74,
            payload: {
                command: 'node scripts/check-contracts.mjs',
                output: '01 Loading contracts...\n02 Checking activity shapes...\n03 Waiting for final result...',
                durationMs: 0,
                status: 'running'
            }
        }))
    }
    for (const activity of liveActivities) {
        if (activity.id === 'rail-dev-live-thought') activity.createdAt = liveIso(15)
        else if (activity.id === 'rail-dev-live-command') activity.createdAt = liveIso(10)
        else if (activity.id === 'rail-dev-live-command-secondary') activity.createdAt = liveIso(8)
        else activity.createdAt = liveIso(5)
    }
    return [...createRailDevActivities(), ...liveActivities]
}

function createRailDevTurnUsage(): AssistantSessionTurnUsageEntry[] {
    return railDevTurnSpecs.map((_turn, index) => {
        const turnNumber = index + 1
        const completedMinute = turnNumber === 3 ? 26 : index * 8 + 3
        return {
            id: `rail-dev-turn-${turnNumber}`,
            sessionId: BROWSER_PREVIEW_SESSION_ID,
            threadId: BROWSER_PREVIEW_THREAD_ID,
            model: previewModels[0]!.id,
            state: 'completed',
            requestedAt: devIso(index * 8),
            startedAt: devIso(index * 8),
            completedAt: devIso(completedMinute),
            assistantMessageId: `rail-dev-assistant-${turnNumber}`,
            effort: 'medium',
            serviceTier: null,
            usage: null,
            updatedAt: devIso(completedMinute)
        }
    })
}

function createRailLiveTurnUsage(): AssistantSessionTurnUsageEntry[] {
    return [
        ...createRailDevTurnUsage(),
        {
            id: 'rail-dev-turn-live',
            sessionId: BROWSER_PREVIEW_SESSION_ID,
            threadId: BROWSER_PREVIEW_THREAD_ID,
            model: previewModels[0]!.id,
            state: 'running',
            requestedAt: liveIso(18),
            startedAt: liveIso(18),
            completedAt: null,
            assistantMessageId: null,
            effort: 'medium',
            serviceTier: null,
            usage: null,
            updatedAt: liveIso(0)
        }
    ]
}

function ok<T extends Record<string, unknown> = Record<string, never>>(payload?: T): Promise<DevScopeResult<T>> {
    return Promise.resolve({ success: true, ...(payload || {}) } as DevScopeResult<T>)
}

function unavailable<T extends Record<string, unknown> = Record<string, never>>(
    error = BROWSER_PREVIEW_ERROR
): Promise<DevScopeResult<T>> {
    return Promise.resolve({ success: false, error })
}

function noopUnsubscribe() {}

function createBrowserPreviewSnapshot(mode: BrowserPreviewMode, runningCommandCount = 1): AssistantSnapshot {
    const timestamp = new Date().toISOString()
    const hasRailFixture = mode !== 'empty'
    const isLiveRailFixture = mode === 'rail-live-chat'
    const railDevMessages = isLiveRailFixture ? createRailLiveMessages() : hasRailFixture ? createRailDevMessages() : []
    const railDevActivities = isLiveRailFixture ? createRailLiveActivities(runningCommandCount) : hasRailFixture ? createRailDevActivities() : []
    const railDevTurnUsage = isLiveRailFixture ? createRailLiveTurnUsage() : hasRailFixture ? createRailDevTurnUsage() : []
    const latestRailDevTurn = railDevTurnUsage[railDevTurnUsage.length - 1] || null
    const thread: AssistantThread = {
        id: BROWSER_PREVIEW_THREAD_ID,
        providerThreadId: null,
        source: 'root',
        parentThreadId: null,
        providerParentThreadId: null,
        subagentDepth: null,
        agentNickname: null,
        agentRole: null,
        model: previewModels[0]!.id,
        cwd: hasRailFixture ? 'C:\\projects\\zyra' : null,
        messageCount: railDevMessages.length,
        activityCount: railDevActivities.length,
        proposedPlanCount: 0,
        lastSeenCompletedTurnId: latestRailDevTurn?.id || null,
        runtimeMode: 'approval-required',
        interactionMode: 'default',
        state: isLiveRailFixture ? 'running' : 'idle',
        lastError: null,
        createdAt: hasRailFixture ? devIso(0) : timestamp,
        updatedAt: isLiveRailFixture ? timestamp : hasRailFixture ? devIso(64) : timestamp,
        latestTurn: latestRailDevTurn ? {
            id: latestRailDevTurn.id,
            state: latestRailDevTurn.state,
            requestedAt: latestRailDevTurn.requestedAt,
            startedAt: latestRailDevTurn.startedAt,
            completedAt: latestRailDevTurn.completedAt,
            assistantMessageId: latestRailDevTurn.assistantMessageId,
            effort: latestRailDevTurn.effort,
            serviceTier: latestRailDevTurn.serviceTier,
            usage: latestRailDevTurn.usage
        } : null,
        hasPendingApprovals: false,
        hasPendingUserInputs: false,
        hasActivePlan: false,
        activePlan: null,
        messages: railDevMessages,
        proposedPlans: [],
        activities: railDevActivities,
        pendingApprovals: [],
        pendingUserInputs: []
    }
    const session: AssistantSession = {
        id: BROWSER_PREVIEW_SESSION_ID,
        title: isLiveRailFixture ? 'Rail fixture: live work' : hasRailFixture ? 'Rail fixture: full chat' : 'New Session',
        mode: 'work',
        projectPath: hasRailFixture ? 'C:\\projects\\zyra' : null,
        playgroundLabId: null,
        pendingLabRequest: null,
        archived: false,
        createdAt: hasRailFixture ? devIso(0) : timestamp,
        updatedAt: isLiveRailFixture ? timestamp : hasRailFixture ? devIso(64) : timestamp,
        activeThreadId: thread.id,
        threadIds: [thread.id],
        threads: [thread]
    }

    return {
        ...createDefaultAssistantSnapshot(),
        updatedAt: timestamp,
        selectedSessionId: session.id,
        playground: {
            rootPath: null,
            labs: []
        },
        sessions: [session],
        knownModels: previewModels
    }
}

function createAsyncUnavailableProxy(label: string): Record<string, unknown> {
    return new Proxy({}, {
        get(_target, property) {
            if (property === 'then') return undefined
            if (typeof property === 'string' && property.startsWith('on')) return () => noopUnsubscribe
            return () => unavailable(`${String(property)} requires the Zyra desktop bridge (${label}).`)
        }
    })
}

function createBrowserDevscopeAdapter(): DevScopeApi {
    let previewMode = getBrowserPreviewMode()
    const liveAssistant = previewMode === 'empty' ? createBrowserAssistantBridgeAdapter() : null
    let runningCommandCount = getBrowserPreviewRunningCommandCount()
    let snapshot = createBrowserPreviewSnapshot(previewMode, runningCommandCount)
    const ensureSnapshot = () => {
        const nextMode = getBrowserPreviewMode()
        const nextRunningCommandCount = getBrowserPreviewRunningCommandCount()
        if (nextMode !== previewMode || nextRunningCommandCount !== runningCommandCount) {
            previewMode = nextMode
            runningCommandCount = nextRunningCommandCount
            snapshot = createBrowserPreviewSnapshot(previewMode, runningCommandCount)
        }
        return snapshot
    }
    const bootstrapPayload = (): AssistantBootstrapPayload => ({
        snapshot: ensureSnapshot(),
        status: createBrowserStatus(previewMode)
    })
    const updateAction = (): Promise<DevScopeUpdateActionResult> => Promise.resolve({
        accepted: false,
        completed: true,
        state: browserUpdateState
    })
    const previewPreferenceSnapshot = (surface: 'desktop' | 'browser') => ({
        schemaVersion: 1 as const,
        revision: 1,
        surface,
        settings: { settingsSchemaVersion: 4 },
        desktopLegacyMigrationComplete: true,
        updatedAt: new Date().toISOString()
    })
    const completedPreviewOnboarding = {
        hydrated: true as const,
        accessAllowed: true,
        showOnboarding: false,
        blockedReason: null,
        detectedSchemaVersion: null,
        recovery: null,
        record: null
    }

    const getBrowserThreadDetail = (threadId: string) => {
        const thread = ensureSnapshot().sessions.flatMap((session) => session.threads).find((entry) => entry.id === threadId)
        if (!thread) return null
        return {
            threadId,
            activePlan: thread.activePlan,
            pendingApprovals: thread.pendingApprovals,
            pendingUserInputs: thread.pendingUserInputs,
            history: {
                threadId,
                messages: thread.messages,
                activities: thread.activities,
                proposedPlans: thread.proposedPlans,
                pageInfo: { oldestCursor: null, newestCursor: null, hasOlder: false, hasNewer: false, turnCount: thread.messages.filter((message) => message.role === 'user').length },
                initialLoading: false,
                loadingOlder: false,
                loadingNewer: false,
                loadOlderError: null,
                loadNewerError: null,
                fullyLoaded: true
            }
        }
    }

    const base = {
        preferences: {
            get: (input: { surface: 'desktop' | 'browser' }) => previewMode === 'empty'
                ? unavailable('Device preferences require Zyra Desktop.')
                : ok({ snapshot: previewPreferenceSnapshot(input.surface) }),
            update: (input: { surface: 'desktop' | 'browser' }) => previewMode === 'empty'
                ? unavailable('Device preferences require Zyra Desktop.')
                : ok({ snapshot: previewPreferenceSnapshot(input.surface) }),
            onChanged: () => noopUnsubscribe
        },
        secrets: {
            updateHostedAiKeys: () => unavailable('Device secrets are available in Zyra Desktop only.'),
            migrateLegacyHostedAiKeys: () => unavailable('Device secrets are available in Zyra Desktop only.'),
            updateBrowserIntegrationSecrets: () => unavailable('Browser integration secrets are available in Zyra Desktop only.')
        },
        onboarding: {
            getState: () => previewMode === 'empty'
                ? unavailable('Setup status requires Zyra Desktop.')
                : ok({ snapshot: completedPreviewOnboarding }),
            getAuthStatus: () => unavailable('OpenAI setup requires Zyra Desktop.'),
            getConnectionsStatus: () => unavailable('OpenAI account changes require Zyra Desktop.'),
            connectChatGpt: () => unavailable('OpenAI setup requires Zyra Desktop.'),
            connectApiKey: () => unavailable('OpenAI setup requires Zyra Desktop.'),
            disconnectOpenAI: () => unavailable('OpenAI account changes require Zyra Desktop.'),
            updateAppearance: () => unavailable('Setup changes require Zyra Desktop.'),
            commitStep: () => unavailable('Setup changes require Zyra Desktop.'),
            navigate: () => unavailable('Setup changes require Zyra Desktop.'),
            beginReview: () => unavailable('Setup review requires Zyra Desktop.'),
            cancelReview: () => unavailable('Setup review requires Zyra Desktop.'),
            onChanged: () => noopUnsubscribe
        },
        window: {
            minimize: () => {},
            maximize: () => {},
            close: () => {},
            isMaximized: () => Promise.resolve(false),
            getRuntimeInfo: () => Promise.resolve({
                platform: 'browser' as const,
                architecture: 'browser',
                appVersion: browserUpdateState.currentVersion,
                electronVersion: null,
                isPackaged: false,
                nativeFrame: true,
                customWindowControls: false
            }),
            onMaximizedChange: () => noopUnsubscribe,
            onAppMenuCommand: () => noopUnsubscribe
        },
        updates: {
            getState: () => Promise.resolve(browserUpdateState),
            checkForUpdates: updateAction,
            downloadUpdate: updateAction,
            installUpdate: updateAction,
            onStateChange: () => noopUnsubscribe
        },
        assistantUtility: {
            getState: () => Promise.resolve({ success: false as const, error: 'Utility windows are unavailable in browser preview.' }),
            selectTab: () => Promise.resolve({ success: true }),
            closeTab: () => Promise.resolve({ success: true }),
            reorderTab: () => Promise.resolve({ success: true }),
            moveTab: () => Promise.resolve({ success: true }),
            registerDropZone: () => Promise.resolve({ success: true }),
            tabReady: () => Promise.resolve({ success: true }),
            updateTab: () => Promise.resolve({ success: true }),
            updateStateCapsule: () => Promise.resolve({ success: true }),
            addTab: () => Promise.resolve({ success: true }),
            detachMainTab: () => Promise.resolve({ success: true }),
            beginTearOff: () => Promise.resolve({ success: true }),
            finishTearOff: () => Promise.resolve({ success: true }),
            cancelTearOff: () => Promise.resolve({ success: true }),
            completeIncomingMainTab: () => Promise.resolve({ success: true }),
            onStateChange: () => noopUnsubscribe,
            onIncomingMainTab: () => noopUnsubscribe,
            onCancelIncomingMainTab: () => noopUnsubscribe
        },
        assistant: liveAssistant || {
            subscribe: () => ok(),
            unsubscribe: () => ok(),
            bootstrap: () => Promise.resolve(bootstrapPayload()),
            getSnapshot: () => Promise.resolve(ensureSnapshot()),
            getFleetSnapshot: (threadId: string) => ok({ snapshot: ensureSnapshot().fleetByThreadId[threadId] ?? null }),
            agentAction: () => unavailable('Agent actions require the Zyra desktop bridge.'),
            workflowAction: () => unavailable('Workflow actions require the Zyra desktop bridge.'),
            getStatus: () => Promise.resolve(createBrowserStatus(previewMode)),
            getAccountOverview: (): Promise<DevScopeResult<AssistantAccountOverviewPayload>> => ok({
                overview: {
                    provider: null,
                    source: null,
                    account: null,
                    accountId: null,
                    emailVerified: null,
                    tokenExpiresAt: null,
                    authMode: null,
                    requiresOpenaiAuth: true,
                    rateLimits: null,
                    rateLimitsByLimitId: {},
                    usageError: null,
                    availableResetCount: null,
                    resetCredits: [],
                    resetCreditsError: null,
                    fetchedAt: new Date().toISOString()
                }
            }),
            redeemAccountReset: () => unavailable('Banked resets require the Zyra desktop bridge.'),
            getSessionTurnUsage: (): Promise<DevScopeResult<AssistantSessionTurnUsageResultPayload>> => ok({
                usage: {
                    sessionId: BROWSER_PREVIEW_SESSION_ID,
                    turns: previewMode === 'rail-live-chat'
                        ? createRailLiveTurnUsage()
                        : previewMode === 'rail-dev-chat' ? createRailDevTurnUsage() : [],
                    fetchedAt: new Date().toISOString()
                }
            }),
            listModels: () => ok({ models: previewModels }),
            listProjects: () => ok({ catalog: { migrationVersion: 1, projects: [], candidates: [] } }),
            createProject: () => unavailable('Project creation requires the Zyra desktop bridge.'),
            associateProjectFolder: () => unavailable('Project folder changes require the Zyra desktop bridge.'),
            removeProjectFolder: () => unavailable('Project folder changes require the Zyra desktop bridge.'),
            updateProject: () => unavailable('Project changes require the Zyra desktop bridge.'),
            dismissProjectCandidate: () => unavailable('Project discovery review requires the Zyra desktop bridge.'),
            connect: () => ok(),
            disconnect: () => ok(),
            createSession: () => ok({ sessionId: BROWSER_PREVIEW_SESSION_ID }),
            selectSession: (sessionId: string) => ok({ sessionId, snapshot: ensureSnapshot() }),
            selectThread: (input: { sessionId: string; threadId: string }) => ok({
                sessionId: input.sessionId,
                threadId: input.threadId,
                snapshot: ensureSnapshot()
            }),
            getThreadDetailBootstrap: (threadId: string) => {
                const detail = getBrowserThreadDetail(threadId)
                return detail ? ok({ detail }) : unavailable('Assistant thread not found.')
            },
            getHistoryPage: () => unavailable('No older browser-preview history is available.'),
            hydrateHistoryBody: () => unavailable('No deferred browser-preview tool output is available.'),
            searchTurns: (input: { threadId: string; query: string }) => {
                const detail = getBrowserThreadDetail(input.threadId)
                const query = input.query.trim().toLowerCase()
                const turnIds = detail ? [...new Set([
                    ...detail.history.messages.filter((message) => message.text.toLowerCase().includes(query)).map((message) => message.turnId),
                    ...detail.history.activities.filter((activity) => JSON.stringify(activity).toLowerCase().includes(query)).map((activity) => activity.turnId)
                ].filter((turnId): turnId is string => Boolean(turnId)))] : []
                return ok({ result: { threadId: input.threadId, turnIds } })
            },
            getTurnDetail: (input: { threadId: string; turnId: string }) => {
                const detail = getBrowserThreadDetail(input.threadId)
                return detail ? ok({
                    detail: {
                        threadId: input.threadId,
                        turnId: input.turnId,
                        messages: detail.history.messages.filter((message) => message.turnId === input.turnId),
                        activities: detail.history.activities.filter((activity) => activity.turnId === input.turnId),
                        proposedPlans: detail.history.proposedPlans.filter((plan) => plan.turnId === input.turnId)
                    }
                }) : unavailable('Assistant turn not found.')
            },
            renameSession: (_sessionId: string, title: string) => {
                snapshot = {
                    ...snapshot,
                    sessions: snapshot.sessions.map((session) => (
                        session.id === BROWSER_PREVIEW_SESSION_ID ? { ...session, title } : session
                    ))
                }
                return ok()
            },
            regenerateSessionTitle: () => unavailable('Title regeneration requires the Zyra desktop bridge.'),
            archiveSession: () => ok(),
            deleteSession: () => unavailable('Deleting sessions requires the Zyra desktop bridge.'),
            deleteMessage: () => unavailable('Deleting messages requires the Zyra desktop bridge.'),
            clearLogs: () => ok(),
            setSessionProject: () => unavailable('Project selection requires the Zyra desktop bridge.'),
            setSessionProjectPath: () => unavailable('Project selection requires the Zyra desktop bridge.'),
            setPlaygroundRoot: () => ok({ playground: snapshot.playground }),
            createPlaygroundLab: () => unavailable('Playground labs require the Zyra desktop bridge.'),
            deletePlaygroundLab: () => unavailable('Playground labs require the Zyra desktop bridge.'),
            attachSessionToPlaygroundLab: () => unavailable('Playground labs require the Zyra desktop bridge.'),
            approvePendingPlaygroundLabRequest: () => unavailable('Playground labs require the Zyra desktop bridge.'),
            declinePendingPlaygroundLabRequest: () => ok(),
            getPathForFile: (file: File) => file.name,
            persistClipboardImage: () => unavailable('Clipboard image persistence requires the Zyra desktop bridge.'),
            resolveClipboardAttachment: () => ok({ path: null }),
            newThread: () => ok({ threadId: BROWSER_PREVIEW_THREAD_ID }),
            sendPrompt: () => unavailable('Sending messages requires the Zyra desktop bridge.'),
            interruptTurn: () => ok(),
            respondApproval: () => unavailable('Approvals require the Zyra desktop bridge.'),
            respondUserInput: () => unavailable('Guided responses require the Zyra desktop bridge.'),
            startRealtimeVoice: () => unavailable('Realtime voice requires the Zyra desktop bridge.'),
            sendRealtimeVoiceMessage: () => unavailable('Realtime voice requires the Zyra desktop bridge.'),
            ingestRealtimeVoiceEvent: () => unavailable('Realtime voice requires the Zyra desktop bridge.'),
            stopRealtimeVoice: () => ok(),
            onRealtimeVoiceEvent: () => noopUnsubscribe,
            getVoiceTranscriptionState: () => ok({ state: browserVoiceTranscriptionState }),
            transcribeVoice: () => unavailable('ChatGPT transcription requires the Zyra desktop bridge.'),
            onEvent: (_callback: (event: AssistantEventStreamPayload) => void) => noopUnsubscribe
        },
        agentControl: createAsyncUnavailableProxy('agent control'),
        terminal: createAsyncUnavailableProxy('terminal'),
        fonts: {
            listManaged: () => ok({ fonts: [] }),
            listSystem: () => ok({ fonts: [] }),
            downloadGoogle: () => unavailable('Google Font downloads require the Zyra desktop bridge.'),
            importFile: () => unavailable('Font imports require the Zyra desktop bridge.'),
            removeManaged: () => unavailable('Managed fonts require the Zyra desktop bridge.'),
            readManaged: () => unavailable('Managed fonts require the Zyra desktop bridge.')
        },
        agentscope: createAsyncUnavailableProxy('agentscope'),
        memory: {
            getOverview: () => ok({
                overview: {
                    rootPath: '',
                    memoryDirectory: '',
                    sessionsDirectory: '',
                    cliPath: '',
                    defaultModel: '',
                    defaultThinking: '',
                    memoryLayers: [],
                    recommendedPrompts: []
                }
            })
        },
        setStartupSettings: () => ok(),
        getStartupSettings: () => ok({ openAtLogin: false, openAsHidden: false, disabledReason: 'Browser preview' }),
        listInstalledPackageRuntimes: () => ok({ runtimes: [] }),
        getAiDebugLogs: () => ok({ logs: [] }),
        clearAiDebugLogs: () => ok(),
        testGroqConnection: () => unavailable('AI connection tests require the Zyra desktop bridge.'),
        testGeminiConnection: () => unavailable('AI connection tests require the Zyra desktop bridge.'),
        testCodexConnection: () => unavailable('AI connection tests require the Zyra desktop bridge.'),
        generateCommitMessage: () => unavailable('Commit message generation requires the Zyra desktop bridge.'),
        selectFolder: () => ok({ cancelled: true }),
        selectMarkdownFile: () => ok({ cancelled: true }),
        selectProjectIconFile: () => ok({ cancelled: true }),
        getUserHomePath: () => ok({ path: '' }),
        scanProjects: () => ok({ projects: [], folders: [], files: [], cached: false }),
        indexAllFolders: () => ok({ indexed: 0 }),
        searchIndexedPaths: () => ok({ results: [] }),
        openInExplorer: () => unavailable('Explorer actions require the Zyra desktop bridge.'),
        openInTerminal: () => unavailable('Terminal actions require the Zyra desktop bridge.'),
        getBrowserPreviewConfig: () => unavailable('Integrated Browser requires the Zyra desktop bridge.'),
        getBrowserPageIcon: () => ok({ dataUrl: null }),
        getBrowserHistory: () => unavailable('Browser history requires the Zyra desktop bridge.'),
        getBrowserSearchSuggestions: () => unavailable('Browser search suggestions require the Zyra desktop bridge.'),
        scanExternalBrowserHistoryProfiles: () => unavailable('External Browser history import requires Zyra Desktop.'),
        importExternalBrowserHistory: () => unavailable('External Browser history import requires Zyra Desktop.'),
        recordBrowserHistory: () => unavailable('Browser history requires the Zyra desktop bridge.'),
        clearBrowserHistory: () => unavailable('Browser history requires the Zyra desktop bridge.'),
        getBrowserAdBlockStatus: () => unavailable('Built-in ad blocking requires Zyra Desktop.'),
        setBrowserAdBlockEnabled: () => unavailable('Built-in ad blocking requires Zyra Desktop.'),
        onBrowserAdDetected: () => noopUnsubscribe,
        getBrowserBackgroundProviderStatus: () => unavailable('Live backgrounds require Zyra Desktop.'),
        validateBrowserUnsplashAccessKey: () => unavailable('Live backgrounds require Zyra Desktop.'),
        getBrowserRemoteBackgrounds: () => unavailable('Live backgrounds require Zyra Desktop.'),
        trackBrowserRemoteBackground: () => unavailable('Live backgrounds require Zyra Desktop.'),
        getRunningLocalServers: () => unavailable('Local server discovery requires the Zyra desktop bridge.'),
        clearBrowserPreviewData: () => unavailable('Clearing Browser data requires the Zyra desktop bridge.'),
        getBrowserLinkPreview: () => unavailable('Website previews require the Zyra desktop bridge.'),
        openBrowserPreviewExternal: () => unavailable('Opening external links requires the Zyra desktop bridge.'),
        listInstalledIdes: () => ok({ ides: [] }),
        openProjectInIde: () => unavailable('IDE actions require the Zyra desktop bridge.'),
        installProjectDependencies: () => unavailable('Dependency installation requires the Zyra desktop bridge.'),
        getProjectDetails: () => unavailable('Project details require the Zyra desktop bridge.'),
        recordProjectOpen: () => unavailable('Project navigation analytics requires the Zyra desktop bridge.'),
        getFileTree: () => ok({ tree: [], files: [], folders: [] }),
        listBranches: () => ok({ branches: [] }),
        getGitStatusDetailed: () => ok({ status: null }),
        copyToClipboard: async (value: string) => {
            await navigator.clipboard?.writeText?.(value).catch(() => undefined)
            return { success: true as const }
        },
        onGitCloneProgress: () => noopUnsubscribe,
        onPreviewTerminalEvent: () => noopUnsubscribe,
        onPythonPreviewEvent: () => noopUnsubscribe
    }

    const fallbackAdapter = new Proxy(base, {
        get(target, property) {
            if (property === 'then') return undefined
            if (property in target) return target[property as keyof typeof target]
            if (typeof property === 'string' && property.startsWith('on')) return () => noopUnsubscribe
            return () => unavailable(`${String(property)} requires the Zyra desktop bridge.`)
        }
    }) as unknown as DevScopeApi
    return liveAssistant ? createLiveBrowserDevscopeAdapter(fallbackAdapter) : fallbackAdapter
}

export function installBrowserDevscopeAdapter() {
    if (window.devscope) return
    window.devscope = createBrowserDevscopeAdapter()
}
