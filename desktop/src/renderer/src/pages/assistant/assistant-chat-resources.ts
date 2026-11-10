import { reconcileAssistantMessageReplays } from '@shared/assistant/message-reconciliation'
import type { AssistantActivity, AssistantMessage } from '@shared/assistant/contracts'
import { buildAssistantDiffTurns } from './assistant-diff-turns'
import type { AssistantDiffTurn } from './assistant-diff-types'
import { parseUserMessageAttachments } from './assistant-timeline-helpers'
import { buildAssistantResourceIndex, type AssistantResource } from './assistant-resource-index'
import { assistantResourceForPath } from './assistant-resource-labels'

/** Resource discovery follows the transcript, independently of Review hydration.
 * Keep every progress message, rather than only the turn's final answer. */
export function buildAssistantChatResourceTurns(input: {
    messages: AssistantMessage[]
    activities: AssistantActivity[]
    projectPath: string | null
}): AssistantDiffTurn[] {
    const messages = reconcileAssistantMessageReplays(input.messages)
    const turns = buildAssistantDiffTurns({ ...input, messages, projectRootPath: input.projectPath })
    const chronological = turns.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    const byId = new Map(turns.map(turn => [turn.id, turn]))
    const references: AssistantDiffTurn[] = []
    let cursor = 0
    for (const message of messages.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
        if (message.role !== 'user' && message.role !== 'assistant') continue
        while (cursor + 1 < chronological.length && chronological[cursor + 1].createdAt <= message.createdAt) cursor++
        const owner = (message.turnId ? byId.get(message.turnId) : undefined) || (chronological[cursor]?.createdAt <= message.createdAt ? chronological[cursor] : undefined)
        const parsed = parseUserMessageAttachments(message.text || '')
        references.push({
            id: owner?.id || message.turnId || message.id, number: owner?.number || 0,
            state: owner?.state || 'completed', reviewStatus: null,
            prompt: message.role === 'user' ? parsed.body : '', promptAvailable: true,
            promptAttachments: parsed.attachments,
            response: message.role === 'assistant' ? parsed.body : '', responseAvailable: true,
            historyUnavailable: false, searchText: '', createdAt: message.createdAt, updatedAt: message.updatedAt,
            files: [], changes: [], additions: 0, deletions: 0
        })
    }
    return [
        ...turns.map(turn => ({ ...turn, prompt: '', promptAttachments: [], response: '' })),
        ...references
    ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function buildAssistantPreviewResources(input: {
    turns: AssistantDiffTurn[]
    projectPath: string | null
    activeFile?: { path: string; name: string; type: string } | null
}): AssistantResource[] {
    const resources = buildAssistantResourceIndex(input).resources
    const file = input.activeFile
    if (!file || file.type !== 'image' || assistantResourceForPath(resources, file.path)) return resources
    // The opened image is known even if its older transcript page is not loaded.
    // Do not invent a turn/origin for this temporary entry.
    return [{
        id: `opened-image:${file.path}`, kind: 'image', title: file.name, subtitle: file.path,
        path: /^https?:\/\//i.test(file.path) ? null : file.path,
        url: /^https?:\/\//i.test(file.path) ? file.path : null,
        attachment: null, sources: ['mentioned'], origins: [], occurrenceCount: 0,
        latestAt: '', latestTurnId: '', latestTurnNumber: 0, latestDiffTarget: null,
        searchText: `${file.name} ${file.path}`.toLowerCase()
    }, ...resources]
}
