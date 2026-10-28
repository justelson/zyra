import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { parseAssistantHistoryBodyRef, type AssistantActivity, type AssistantHistoryBody } from '@shared/assistant/contracts'

export function useAssistantHydratedActivity(sourceActivity: AssistantActivity) {
    const historyBodyRef = useMemo(
        () => parseAssistantHistoryBodyRef(sourceActivity.payload?.historyBodyRef),
        [sourceActivity.payload?.historyBodyRef]
    )
    const key = JSON.stringify([sourceActivity.id, historyBodyRef])
    const currentKey = useRef(key)
    currentKey.current = key
    const mounted = useRef(true)
    useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
    const [state, setState] = useState<{ key: string; body: AssistantHistoryBody | null; loading: boolean; error: string | null }>({ key, body: null, loading: false, error: null })
    const hydratedBody = state.key === key ? state.body : null
    const loading = state.key === key && state.loading
    const error = state.key === key ? state.error : null
    const pending = useRef<{ key: string; promise: Promise<AssistantActivity> } | null>(null)
    const activity = useMemo<AssistantActivity>(() => hydratedBody ? {
        ...sourceActivity,
        payload: { ...(sourceActivity.payload || {}), ...hydratedBody.payload }
    } : sourceActivity, [hydratedBody, sourceActivity])

    const hydrate = useCallback((): Promise<AssistantActivity> => {
        if (!historyBodyRef || hydratedBody) return Promise.resolve(activity)
        if (pending.current?.key === key) return pending.current.promise
        setState({ key, body: null, loading: true, error: null })
        const promise = (async () => {
            try {
                const result = await window.devscope.assistant.hydrateHistoryBody({ activityId: sourceActivity.id, ref: historyBodyRef })
                if (!result.success) throw new Error(result.error)
                if (mounted.current && currentKey.current === key) setState({ key, body: result.body, loading: false, error: null })
                return { ...sourceActivity, payload: { ...(sourceActivity.payload || {}), ...result.body.payload } } as AssistantActivity
            } catch (caught) {
                if (mounted.current && currentKey.current === key) setState({ key, body: null, loading: false, error: caught instanceof Error ? caught.message : 'Failed to load historical evidence.' })
                return activity
            }
        })()
        pending.current = { key, promise }
        void promise.finally(() => { if (pending.current?.promise === promise) pending.current = null })
        return promise
    }, [activity, historyBodyRef, hydratedBody, key, sourceActivity])

    return { activity, historyBodyRef, loading, error, hydrate, loaded: !historyBodyRef || Boolean(hydratedBody) }
}
