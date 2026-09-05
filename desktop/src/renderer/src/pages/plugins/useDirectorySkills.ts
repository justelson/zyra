import { useCallback, useEffect, useRef, useState } from 'react'
import type { AssistantPromptSkillResource } from '@shared/assistant/contracts'

export function useDirectorySkills(desktopHost: boolean, projectPath: string | null) {
    const [snapshot, setSnapshot] = useState<{ projectPath: string | null; skills: AssistantPromptSkillResource[] } | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const generation = useRef(0)
    const refresh = useCallback(async () => {
        if (!desktopHost) { setLoading(false); return }
        const current = ++generation.current
        setLoading(true)
        setError(null)
        try {
            if (typeof window.devscope.assistant.listPromptResources !== 'function') throw new Error('Restart Zyra Desktop to load Skills.')
            const result = await window.devscope.assistant.listPromptResources(projectPath, true)
            if (current !== generation.current) return
            if (!result.success) throw new Error(result.error || 'Could not load Skills.')
            setSnapshot({ projectPath, skills: result.skills })
        } catch (cause) {
            if (current === generation.current) {
                setSnapshot(null)
                setError(cause instanceof Error ? cause.message : 'Could not load Skills.')
            }
        } finally {
            if (current === generation.current) setLoading(false)
        }
    }, [desktopHost, projectPath])
    useEffect(() => {
        void refresh()
        return () => { generation.current += 1 }
    }, [refresh])
    return { skills: snapshot?.projectPath === projectPath ? snapshot.skills : [], loading, error, refresh }
}
