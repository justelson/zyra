import { useCallback, useMemo, useState } from 'react'
import { parseAssistantHistoryBodyRef, type AssistantActivity, type AssistantHistoryBody } from '@shared/assistant/contracts'

export function useAssistantHydratedActivity(sourceActivity: AssistantActivity) {
    const historyBodyRef = useMemo(
        () => parseAssistantHistoryBodyRef(sourceActivity.payload?.historyBodyRef),
        [sourceActivity.payload?.historyBodyRef]
    )
    const [hydratedBody, setHydratedBody] = useState<AssistantHistoryBody | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const activity = useMemo<AssistantActivity>(() => hydratedBody ? {
        ...sourceActivity,
        payload: { ...(sourceActivity.payload || {}), ...hydratedBody.payload }
    } : sourceActivity, [hydratedBody, sourceActivity])

    const hydrate = useCallback(async () => {
        if (!historyBodyRef || hydratedBody || loading) return activity
        setLoading(true)
        setError(null)
        try {
            const result = await window.devscope.assistant.hydrateHistoryBody({ activityId: sourceActivity.id, ref: historyBodyRef })
            if (!result.success) throw new Error(result.error)
            setHydratedBody(result.body)
            return {
                ...sourceActivity,
                payload: { ...(sourceActivity.payload || {}), ...result.body.payload }
            } as AssistantActivity
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Failed to load historical evidence.')
            return activity
        } finally {
            setLoading(false)
        }
    }, [activity, historyBodyRef, hydratedBody, loading, sourceActivity])

    return { activity, historyBodyRef, loading, error, hydrate }
}
