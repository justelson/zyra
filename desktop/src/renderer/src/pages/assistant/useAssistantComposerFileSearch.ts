import { useEffect, useMemo, useRef, useState } from 'react'
import type { AssistantComposerProjectRoot } from './assistant-composer-types'
import {
    buildAssistantComposerFileSearchItems,
    type AssistantComposerFileSearchItem
} from './assistant-composer-file-search'

const FILE_RESULT_LIMIT = 40

export function useAssistantComposerFileSearch(input: {
    active: boolean
    query: string
    roots: AssistantComposerProjectRoot[]
}): {
    items: AssistantComposerFileSearchItem[]
    loading: boolean
    error: string | null
} {
    const roots = useMemo(() => dedupeRoots(input.roots), [input.roots])
    const rootsSignature = roots.map((root) => `${root.path}\u0000${root.label}`).join('\u0001')
    const [items, setItems] = useState<AssistantComposerFileSearchItem[]>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const requestSequenceRef = useRef(0)

    useEffect(() => {
        const requestId = ++requestSequenceRef.current
        if (!input.active) {
            setItems([])
            setLoading(false)
            setError(null)
            return
        }
        if (roots.length === 0) {
            setItems([])
            setLoading(false)
            setError('Choose a Project before including a file.')
            return
        }

        setItems([])
        setLoading(true)
        setError(null)
        const timer = window.setTimeout(() => {
            void window.devscope.searchIndexedPaths({
                roots: roots.map((root) => root.path),
                term: input.query.trim(),
                limit: FILE_RESULT_LIMIT,
                includeFiles: true,
                includeDirectories: false,
                includeAncestors: false,
                showHidden: false
            }).then((result) => {
                if (requestSequenceRef.current !== requestId) return
                if (!result.success) {
                    setError(result.error || 'File search failed.')
                    return
                }
                setItems(buildAssistantComposerFileSearchItems(result.entries || [], roots))
            }).catch((searchError: unknown) => {
                if (requestSequenceRef.current !== requestId) return
                setError(searchError instanceof Error ? searchError.message : 'File search failed.')
            }).finally(() => {
                if (requestSequenceRef.current === requestId) setLoading(false)
            })
        }, input.query.trim() ? 55 : 0)

        return () => window.clearTimeout(timer)
    }, [input.active, input.query, rootsSignature])

    return { items, loading, error }
}

function dedupeRoots(roots: AssistantComposerProjectRoot[]): AssistantComposerProjectRoot[] {
    const seen = new Set<string>()
    return roots.filter((root) => {
        const normalized = String(root.path || '').trim().replace(/\\/g, '/').replace(/\/+$/, '').toLocaleLowerCase()
        if (!normalized || seen.has(normalized)) return false
        seen.add(normalized)
        return true
    })
}
