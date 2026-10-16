import { useEffect, useRef, useState } from 'react'
import type { QuickOpenFile } from './quick-open-model'
import { parseQuickOpenQuery, quickOpenRecentKey, rankQuickOpenFiles } from './quick-open-model'

export function readQuickOpenRecents(root: string): string[] {
    try {
        const value = JSON.parse(localStorage.getItem(quickOpenRecentKey(root)) || '[]')
        return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string').slice(0, 20) : []
    } catch { return [] }
}

export function rememberQuickOpenFile(root: string, path: string): void {
    try { localStorage.setItem(quickOpenRecentKey(root), JSON.stringify([path, ...readQuickOpenRecents(root).filter(entry => entry !== path)].slice(0, 20))) } catch { /* Best-effort history. */ }
}

export function useQuickOpenSearch(root: string, query: string, mode: 'files' | 'contents', fileFilter: string, active: boolean) {
    const [state, setState] = useState({ files: [] as QuickOpenFile[], pending: false, error: '', truncated: false, key: '', queryKey: '' })
    const sequence = useRef(0)
    const scope = `${root}\0${mode}`
    const queryKey = `${query}\0${fileFilter}`
    useEffect(() => {
        const request = ++sequence.current
        if (!active || !root) { setState({ files: [], pending: false, error: '', truncated: false, key: scope, queryKey }); return }
        setState(current => ({ ...current, files: current.key === scope ? current.files : [], key: scope, pending: true, error: '' }))
        const timer = window.setTimeout(() => {
            void (async () => {
                try {
                    if (mode === 'contents') {
                        if (!query.trim()) { if (sequence.current === request) setState({ files: [], pending: false, error: '', truncated: false, key: scope, queryKey }); return }
                        const result = await window.devscope.searchProjectContents({ root, query, fileFilter, limit: 200 })
                        if (sequence.current !== request) return
                        if (!result.success) throw new Error(result.error)
                        setState({ files: result.matches.map(match => ({ ...match, name: match.relativePath })), pending: false, error: '', truncated: result.truncated, key: scope, queryKey })
                    } else {
                        const { term, line } = parseQuickOpenQuery(query)
                        const result = await window.devscope.searchIndexedPaths({ roots: [root], term, limit: 100, includeFiles: true, includeDirectories: false, includeAncestors: false, showHidden: false })
                        if (sequence.current !== request) return
                        if (!result.success) throw new Error(result.error)
                        const files = result.entries.filter(entry => entry.type === 'file').map(entry => ({ path: entry.path, name: entry.name, line }))
                        setState({ files: rankQuickOpenFiles(files, readQuickOpenRecents(root), term), pending: false, error: '', truncated: false, key: scope, queryKey })
                    }
                } catch (error) {
                    if (sequence.current === request) setState(current => ({ ...current, files: [], pending: false, error: error instanceof Error ? error.message : 'Search failed.', queryKey }))
                }
            })()
        }, query.trim() ? 120 : 0)
        return () => { window.clearTimeout(timer); sequence.current++ }
    }, [root, query, mode, fileFilter, active])
    return state.key === scope ? { ...state, pending: state.pending || active && Boolean(root) && state.queryKey !== queryKey } : { ...state, files: [], pending: active && Boolean(root), error: '' }
}
