import { useCallback, useRef } from 'react'
import type { AssistantSession } from '@shared/assistant/contracts'
import { useAssistantStoreActions } from '@/lib/assistant/assistant-store-hooks'
import type { AssistantToastInput } from './AssistantPageHelpers'

export function useAssistantRailTitleRegeneration(onShowToast: (input: AssistantToastInput) => void) {
    const actions = useAssistantStoreActions()
    const pending = useRef(new Set<string>())
    return useCallback(async (session: AssistantSession) => {
        if (session.titleGenerating || pending.current.has(session.id)) return
        pending.current.add(session.id)
        try {
            const result = await actions.regenerateSessionTitleResult(session.id)
            if (!result.success) onShowToast({ message: result.error || 'Could not regenerate the chat title.', tone: 'error' })
        } catch (error) {
            onShowToast({ message: error instanceof Error ? error.message : 'Could not regenerate the chat title.', tone: 'error' })
        } finally {
            pending.current.delete(session.id)
        }
    }, [actions, onShowToast])
}
