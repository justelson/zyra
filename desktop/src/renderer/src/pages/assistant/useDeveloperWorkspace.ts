import { useCallback, useEffect, useRef, useState } from 'react'
import type { DeveloperWorkspace } from '@shared/contracts/developer-workflow'
import { useDeveloperActions } from './useDeveloperActions'

export function useDeveloperWorkspace(root: string, open: boolean) {
    const [workspace, setWorkspace] = useState<DeveloperWorkspace | null>(null)
    const [error, setError] = useState('')
    const generation = useRef(0)
    const currentRoot = useRef(root)
    currentRoot.current = root
    const refresh = useCallback(async () => {
        if (root !== currentRoot.current) return
        const token = ++generation.current
        try {
            const result = await window.devscope.getDeveloperWorkspace(root)
            if (token !== generation.current || root !== currentRoot.current) return
            if (!result.success) throw new Error(result.error)
            setWorkspace(result.workspace); setError('')
        } catch (reason) { if (token === generation.current && root === currentRoot.current) setError(reason instanceof Error ? reason.message : 'Could not load workspace.') }
    }, [root])
    useEffect(() => { setWorkspace(null); void refresh(); return () => { generation.current++ } }, [refresh])
    useEffect(() => {
        const changed = () => void refresh()
        window.addEventListener('zyra:developer-workspace-changed', changed)
        return () => window.removeEventListener('zyra:developer-workspace-changed', changed)
    }, [refresh])
    useEffect(() => {
        if (!open) return
        const timer = window.setInterval(() => { if (!document.hidden) void refresh() }, 3000)
        return () => window.clearInterval(timer)
    }, [open, refresh])
    const actions = useDeveloperActions(root, refresh, setError)
    return { workspace, refresh, error, ...actions }
}
