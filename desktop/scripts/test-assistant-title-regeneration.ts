import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { AssistantDomainEvent, AssistantReviewTurnIndexEntry, AssistantSession } from '../src/shared/assistant/contracts'
import {
    DEFAULT_ASSISTANT_AUTO_TITLE_TURNS,
    MIN_ASSISTANT_AUTO_TITLE_TURNS,
    isAssistantTitleGenerationPrompt,
    normalizeAssistantAutoTitleTurnInterval
} from '../src/shared/assistant/title-generation'
import { buildSessionRetitlePrompt, queueGeneratedSessionTitle, regenerateSessionTitle, regenerateSessionTitleFromPrompt, shouldAutoRegenerateSessionTitle } from '../src/main/assistant/session-title-generation'

const turn = (number: number, prompt: string, response: string): AssistantReviewTurnIndexEntry => ({
    id: `turn-${number}`,
    number,
    state: 'completed',
    prompt: { id: `prompt-${number}`, text: prompt, truncated: false, createdAt: `2026-08-18T10:0${number}:00.000Z`, updatedAt: `2026-08-18T10:0${number}:00.000Z` },
    response: { id: `response-${number}`, text: response, truncated: false, createdAt: `2026-08-18T10:0${number}:30.000Z`, updatedAt: `2026-08-18T10:0${number}:30.000Z` },
    agentLabel: 'Agent',
    requestedAt: `2026-08-18T10:0${number}:00.000Z`,
    updatedAt: `2026-08-18T10:0${number}:30.000Z`,
    changes: []
})

const turns = [
    turn(1, 'Old topic that should fall outside the recent context.', 'Old final answer.'),
    turn(2, 'Fix Resources duplicates.', 'Resources now reconcile canonical and clipboard images.'),
    turn(3, 'Fix Review turn duplicates.', 'Optimistic and canonical replays now form one turn.'),
    turn(4, 'Add title regeneration.\n\nAttached files (1):\n1. screenshot.png [IMAGE]\nref: clipboard://title.png\nmime: image/png\nsize: 42 bytes', 'Added a manual regeneration action and synchronized title state.'),
    turn(5, 'Add an automatic interval.', 'Automatic regeneration now runs after the configured completed-turn interval.')
]
const prompt = buildSessionRetitlePrompt([...turns].reverse(), 'Resources Work')
assert.equal(isAssistantTitleGenerationPrompt(prompt), true, 'retitle utility prompts remain hidden from canonical Review')
assert.equal(isAssistantTitleGenerationPrompt([
    'You write concise titles for coding assistant chat sessions.',
    'Return only the title text.',
    '',
    'Completed conversation:',
    'User prompt: Fix the TUI'
].join('\n')), true, 'TUI title utility prompts share the same Desktop history filter')
assert.doesNotMatch(prompt, /Old topic that should fall outside/, 'retitle context is bounded to recent completed turns')
assert.match(prompt, /Fix Resources duplicates/)
assert.match(prompt, /Automatic regeneration now runs/)
assert.doesNotMatch(prompt, /clipboard:\/\/title\.png/, 'attachment manifests are stripped from title context')
assert.doesNotMatch(prompt, /tool calls|private reasoning/i, 'retitle prompt requests only user prompts and final responses')

const createdAt = '2026-08-18T10:00:00.000Z'
const session = {
    id: 'session-title-regeneration',
    title: 'Resources Work',
    mode: 'work',
    projectPath: 'C:/workspace',
    playgroundLabId: null,
    pendingLabRequest: null,
    archived: false,
    createdAt,
    updatedAt: createdAt,
    activeThreadId: 'thread-title-regeneration',
    threadIds: ['thread-title-regeneration'],
    threads: []
} satisfies AssistantSession
const patches: Array<Record<string, unknown>> = []
const generatedPrompts: string[] = []
const canonicalTitles: string[] = []
const nextTitle = await regenerateSessionTitle({
    sessionId: session.id,
    threadId: 'thread-title-regeneration',
    turns,
    seedTitle: session.title,
    cwd: 'C:/workspace',
    preferredModel: 'openai-codex/gpt-5.6-luna',
    generateText: async (titlePrompt, options) => {
        generatedPrompts.push(`${options.model}\n${titlePrompt}`)
        return { success: true, text: 'Title Regeneration Workflow' }
    },
    getSnapshot: () => ({ sessions: [session] }),
    appendEvent: (_type: AssistantDomainEvent['type'], _occurredAt: string, payload: Record<string, unknown>) => {
        const patch = payload.patch as Record<string, unknown>
        patches.push(patch)
        Object.assign(session, patch)
    },
    onApplied: (title) => { canonicalTitles.push(title) }
})
assert.equal(nextTitle, 'Title Regeneration Workflow')
assert.equal(generatedPrompts.length, 1)
assert.match(generatedPrompts[0] || '', /^openai-codex\/gpt-5\.6-luna/)
assert.deepEqual(patches.map((patch) => patch.titleGenerating), [true, false], 'all title surfaces share one generating lifecycle')
assert.equal(patches[1]?.title, 'Title Regeneration Workflow')
assert.deepEqual(canonicalTitles, ['Title Regeneration Workflow'])

const firstTurnSession = { ...session, id: 'session-first-turn-title', title: 'Fix the title', threads: [] }
const firstTurnPatches: Array<Record<string, unknown>> = []
const firstTurnPrompts: string[] = []
let finishAutomaticTitle: ((value: { success: boolean; text: string }) => void) | undefined
const automaticTitle = queueGeneratedSessionTitle({
    sessionId: firstTurnSession.id,
    threadId: 'thread-first-turn-title',
    messageText: 'Fix the title while the first turn is running.',
    seedTitle: firstTurnSession.title,
    cwd: 'C:/workspace',
    generateText: (titlePrompt) => {
        firstTurnPrompts.push(titlePrompt)
        return new Promise((resolve) => { finishAutomaticTitle = resolve })
    },
    getSnapshot: () => ({ sessions: [firstTurnSession] }),
    appendEvent: (_type, _occurredAt, payload) => {
        Object.assign(firstTurnSession, payload.patch)
    }
})
const manualTitle = regenerateSessionTitleFromPrompt({
    sessionId: firstTurnSession.id,
    threadId: 'thread-first-turn-title',
    messageText: 'Fix the title while the first turn is running.',
    seedTitle: firstTurnSession.title,
    cwd: 'C:/workspace',
    generateText: async () => { throw new Error('A second title request should not start.') },
    getSnapshot: () => ({ sessions: [firstTurnSession] }),
    appendEvent: (_type, _occurredAt, payload) => {
        const patch = payload.patch as Record<string, unknown>
        firstTurnPatches.push(patch)
        Object.assign(firstTurnSession, patch)
    }
})
finishAutomaticTitle?.({ success: true, text: 'First Turn Title Refresh' })
await automaticTitle
assert.equal(await manualTitle, 'First Turn Title Refresh', 'manual refresh joins the first-turn title request')
assert.equal(firstTurnPrompts.length, 1, 'an active first turn starts only one utility request')
assert.match(firstTurnPrompts[0] || '', /Fix the title while the first turn is running/)
assert.equal(firstTurnSession.title, 'First Turn Title Refresh')
assert.deepEqual(firstTurnPatches, [], 'joining automatic title generation does not add a duplicate lifecycle')

const directPromptTitle = await regenerateSessionTitleFromPrompt({
    sessionId: 'session-direct-first-turn',
    threadId: 'thread-direct-first-turn',
    messageText: 'Name the new chat before the answer completes.',
    seedTitle: 'New chat',
    cwd: 'C:/workspace',
    generateText: async (titlePrompt) => {
        assert.match(titlePrompt, /Name the new chat before the answer completes/)
        return { success: true, text: 'First Turn Chat Title' }
    },
    getSnapshot: () => ({ sessions: [{ ...firstTurnSession, id: 'session-direct-first-turn', title: 'New chat' }] }),
    appendEvent: (_type, _occurredAt, payload) => { firstTurnPatches.push(payload.patch as Record<string, unknown>) }
})
assert.equal(directPromptTitle, 'First Turn Chat Title')
assert.deepEqual(firstTurnPatches.map((patch) => patch.titleGenerating), [true, false])

assert.equal(normalizeAssistantAutoTitleTurnInterval(1), MIN_ASSISTANT_AUTO_TITLE_TURNS)
assert.equal(normalizeAssistantAutoTitleTurnInterval(undefined), DEFAULT_ASSISTANT_AUTO_TITLE_TURNS)
assert.equal(shouldAutoRegenerateSessionTitle(2, { enabled: true, turnInterval: 3 }), false)
assert.equal(shouldAutoRegenerateSessionTitle(3, { enabled: true, turnInterval: 3 }), true)
assert.equal(shouldAutoRegenerateSessionTitle(6, { enabled: true, turnInterval: 3 }), true)
assert.equal(shouldAutoRegenerateSessionTitle(6, { enabled: false, turnInterval: 3 }), false)

const threadDetailsSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantControlWorkspace.tsx', import.meta.url), 'utf8')
const headerSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantConversationHeader.tsx', import.meta.url), 'utf8')
const railSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantChatSessionsRail.tsx', import.meta.url), 'utf8')
const inboxSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantAgentInboxSidebar.tsx', import.meta.url), 'utf8')
const settingsSource = readFileSync(new URL('../src/renderer/src/pages/settings/ProviderModelSettings.tsx', import.meta.url), 'utf8')
const serviceSource = readFileSync(new URL('../src/main/assistant/service.ts', import.meta.url), 'utf8')
const titleTextSource = readFileSync(new URL('../src/renderer/src/pages/assistant/AssistantSessionTitleText.tsx', import.meta.url), 'utf8')
const rendererCssSource = readFileSync(new URL('../src/renderer/src/index.css', import.meta.url), 'utf8')
assert.match(threadDetailsSource, /aria-label="Regenerate title"/)
assert.match(threadDetailsSource, /aria-label="Thread title"/)
assert.match(headerSource, /AssistantSessionTitleText/)
assert.match(railSource, /AssistantSessionTitleText/)
assert.match(inboxSource, /AssistantSessionTitleText/)
assert.match(settingsSource, /Refresh chat titles/)
assert.match(settingsSource, /assistantTitleAutoRegenerateTurns/)
assert.match(serviceSource, /shouldAutoRegenerateSessionTitle\(completedTurns\.length, preferences\)/)
assert.match(serviceSource, /regenerateSessionTitleFromPrompt\(\{ \.\.\.titleArgs, messageText: firstPrompt! \}\)/)
assert.match(titleTextSource, /generating \? 'assistant-title-shimmer'/, 'all shared title surfaces enable the title-generation shimmer')
assert.match(rendererCssSource, /\.assistant-title-shimmer,\s*\.assistant-model-name-shimmer \{/, 'title generation shares the composer model-name shimmer treatment')
assert.match(rendererCssSource, /animation: assistantTextShimmer 2\.8s linear infinite/, 'shared text shimmer remains slow and smooth')

console.log('Assistant title regeneration workflow: ok')
