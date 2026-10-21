import { assistantCitationSourceHref, formatAssistantCitation, parseAssistantCitation, type AssistantCitation } from '@shared/assistant/assistant-citations'
import type { AssistantSnapshot } from '@shared/assistant/contracts'
import type { ComposerContextFile } from './assistant-composer-types'
export { assistantCitationSourceHref, parseAssistantCitation }
export type { AssistantCitation }

export function findAssistantCitationSource(snapshot: AssistantSnapshot, messageId: string) {
    for (const session of snapshot.sessions) {
        for (const thread of session.threads) {
            if (thread.messages.some(message => message.id === messageId && message.role === 'assistant')) return { sessionId: session.id, threadId: thread.id }
        }
    }
    return null
}

export function citationContextFile(value: AssistantCitation, id = `citation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`): ComposerContextFile {
    const citation = parseAssistantCitation(value)
    if (!citation) throw new Error('Select up to 8,000 characters from one response.')
    return { id, path: assistantCitationSourceHref(citation), name: 'Cited response', kind: 'code', mimeType: 'text/plain', source: 'manual', animateIn: false, citation, content: formatAssistantCitation(citation), previewText: citation.text.slice(0, 220) }
}

export function updateCitationComment(file: ComposerContextFile, comment: string): ComposerContextFile {
    if (!file.citation) return file
    return { ...file, ...citationContextFile({ ...file.citation, comment }, file.id) }
}
