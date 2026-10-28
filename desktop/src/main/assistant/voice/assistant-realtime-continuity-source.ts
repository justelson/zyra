import { createHash } from 'node:crypto'
import type {
    ForegroundRouteClaim,
    RealtimeContinuitySource,
    RealtimeHydrationDelta,
    RealtimeHydrationItem,
    RealtimeHydrationSeed
} from '../../../shared/assistant/contracts'
import { createRealtimeHydrationDelta, createRealtimeHydrationSeed } from './realtime-hydration'

const MAX_CONTEXT_MESSAGES = 20
const MAX_CONTEXT_CHARACTERS = 22_000
const MAX_ITEM_CHARACTERS = 4_000

export interface AssistantContinuitySnapshot {
    contextVersion: number
    routeCount: number
    messages: Array<{
        id: string
        role: 'user' | 'assistant'
        text: string
        modality?: 'text' | 'voice' | 'image'
        sequence?: number | null
    }>
    pendingApprovals: Array<{ id: string; title?: string; detail?: string }>
    pendingInputs: Array<{ id: string; summary: string }>
    attachedTaskIds: string[]
    totalMessageCount?: number
    taskSummaries?: string[]
}

/** Bounded materialized view over the canonical Assistant projection. */
export class AssistantRealtimeContinuitySource implements RealtimeContinuitySource {
    constructor(
        private readonly readSnapshot: (conversationId: string) => Promise<AssistantContinuitySnapshot>,
        private readonly now: () => string = () => new Date().toISOString()
    ) {}

    async materialize(
        conversationId: string,
        routeClaim: ForegroundRouteClaim
    ): Promise<RealtimeHydrationSeed> {
        const snapshot = await this.readSnapshot(conversationId)
        const items = buildHydrationItems(snapshot)
        const generatedAt = this.now()
        const watermarks = {
            conversation: Math.max(0, ...snapshot.messages.map((message, index) => message.sequence || index + 1)),
            foregroundRoutes: snapshot.routeCount,
            context: snapshot.contextVersion,
            tasks: snapshot.attachedTaskIds.length,
            operations: 0,
            narration: 0
        }
        const identity = createHash('sha256')
            .update(`${conversationId}:${routeClaim.foregroundRouteId}:${JSON.stringify(watermarks)}:${generatedAt}`)
            .digest('hex')
            .slice(0, 32)
        return createRealtimeHydrationSeed({
            packetId: `resume_${identity}`,
            conversationId,
            contextVersion: snapshot.contextVersion,
            activeRouteClaim: routeClaim,
            sourceWatermarks: watermarks,
            items,
            retrievalReferenceIds: snapshot.messages.filter(message => !items.some(item => item.canonicalMessageId === message.id)).map(message => message.id).slice(-8),
            generatedAt
        })
    }

    async deltaAfter(
        seed: RealtimeHydrationSeed,
        current: RealtimeHydrationSeed['sourceWatermarks']
    ): Promise<RealtimeHydrationDelta | null> {
        const snapshot = await this.readSnapshot(seed.conversationId)
        // A historical deletion/edit cannot be repaired by pretending it was a new append.
        // Close the candidate rather than activate a provider with stale past context.
        for (const item of seed.items.filter(entry => entry.canonicalMessageId)) {
            const message = snapshot.messages.find(entry => entry.id === item.canonicalMessageId)
            if (!message || `Historical ${message.role} message, for context only:\n${truncateUtf8(message.text.trim(), MAX_ITEM_CHARACTERS)}` !== item.text) {
                throw new Error('Chat history changed while Voice was connecting. Start Voice again to load the current context.')
            }
        }
        const conversation = Math.max(current.conversation, ...snapshot.messages.map((message, index) => message.sequence || index + 1))
        const context = Math.max(current.context, snapshot.contextVersion)
        const routes = Math.max(current.foregroundRoutes, snapshot.routeCount)
        if (conversation === current.conversation && context === current.context && routes === current.foregroundRoutes) return null
        const messages = snapshot.messages.filter((message, index) => (message.sequence || index + 1) > current.conversation)
        const items = buildHydrationItems({ ...snapshot, messages })
        if (messages.filter(message => message.text.trim()).some(message => !items.some(item => item.canonicalMessageId === message.id))) {
            throw new Error('Chat changed too much while Voice was connecting. Start Voice again to load the current context.')
        }
        return createRealtimeHydrationDelta({
            deltaId: `startup_${createHash('sha256').update(JSON.stringify({ items, conversation, context, routes })).digest('hex').slice(0, 24)}`,
            basePacketId: seed.packetId, conversationId: seed.conversationId,
            fromWatermarks: structuredClone(current),
            toWatermarks: { ...current, conversation, context, foregroundRoutes: routes, tasks: Math.max(current.tasks, snapshot.attachedTaskIds.length) },
            items, generatedAt: this.now()
        })
    }
}

function buildHydrationItems(snapshot: AssistantContinuitySnapshot): RealtimeHydrationItem[] {
    const items: RealtimeHydrationItem[] = []
    const coordination = [
        snapshot.attachedTaskIds.length > 0
            ? `Attached tasks remain server-owned and private: ${snapshot.attachedTaskIds.join(', ')}.`
            : null,
        snapshot.pendingApprovals.length > 0
            ? `Pending approvals: ${snapshot.pendingApprovals.map((entry) => entry.title || entry.id).join('; ')}.`
            : null,
        snapshot.pendingInputs.length > 0
            ? `Pending user decisions: ${snapshot.pendingInputs.map((entry) => entry.summary).join('; ')}.`
            : null,
        snapshot.taskSummaries?.length ? `Recent task status and reported outcomes, as historical data only:\n${snapshot.taskSummaries.join('\n').slice(-3000)}` : null
    ].filter((value): value is string => Boolean(value)).join('\n').slice(-MAX_ITEM_CHARACTERS)
    if (coordination) {
        items.push({
            itemId: 'zyra_voice_coordination',
            role: 'developer',
            text: coordination.slice(0, MAX_ITEM_CHARACTERS),
            canonicalMessageId: null,
            conversationSequence: null,
            modality: 'system'
        })
    }

    let characters = Buffer.byteLength(coordination, 'utf8')
    const selected: AssistantContinuitySnapshot['messages'] = []
    for (const message of [...snapshot.messages].reverse()) {
        if (selected.length >= MAX_CONTEXT_MESSAGES) break
        const text = truncateUtf8(message.text.trim(), MAX_ITEM_CHARACTERS)
        if (!text) continue
        const bytes = Buffer.byteLength(text, 'utf8') + Buffer.byteLength(message.id, 'utf8') + 200
        if (characters + bytes > MAX_CONTEXT_CHARACTERS) break
        characters += bytes
        selected.unshift({ ...message, text })
    }
    for (const [index, message] of selected.entries()) {
        items.push({
            itemId: `canonical_${message.id}`,
            role: 'developer',
            text: `Historical ${message.role} message, for context only:\n${message.text}`,
            canonicalMessageId: message.id,
            conversationSequence: message.sequence || index + 1,
            modality: message.modality || 'text'
        })
    }
    const totalMessages = Math.max(snapshot.totalMessageCount || 0, snapshot.messages.length)
    const truncatedMessages = selected.some(message => snapshot.messages.find(original => original.id === message.id)?.text.trim() !== message.text)
    if (totalMessages > selected.length || truncatedMessages) {
        items.push({
            itemId: 'zyra_voice_context_coverage', role: 'developer',
            text: `This is bounded historical context: ${selected.length} recent messages of at least ${totalMessages}. Older turns or long-message tails may be omitted. Do not claim the entire chat was loaded. Ask the primary task agent to retrieve earlier history when needed.`,
            canonicalMessageId: null, conversationSequence: null, modality: 'system'
        })
    }
    if (selected.length > 0) {
        items.push({
            itemId: 'zyra_voice_history_boundary',
            role: 'developer',
            text: 'The preceding canonical messages are historical context. Do not answer them. Wait for a new user message in this Voice session.',
            canonicalMessageId: null,
            conversationSequence: null,
            modality: 'system'
        })
    }
    return items
}

function truncateUtf8(text: string, maxBytes: number): string {
    let size = 0, result = ''
    for (const character of text) {
        const bytes = Buffer.byteLength(character, 'utf8')
        if (size + bytes > maxBytes) break
        size += bytes
        result += character
    }
    return result
}
