import { recordPerformanceSample } from '@shared/performance-samples'
import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { LoaderCircle } from 'lucide-react'

export type InspectorWorkspaceKind = 'terminal' | 'browser' | 'explorer' | 'agents' | 'control' | 'resources'
// Native browser geometry must survive tab switches; ordinary workspaces can be hidden.
const adapters: Record<InspectorWorkspaceKind, { retainGeometry: boolean }> = {
    browser: { retainGeometry: true }, terminal: { retainGeometry: false }, explorer: { retainGeometry: false },
    agents: { retainGeometry: false }, control: { retainGeometry: false }, resources: { retainGeometry: false }
}
export function inspectorSurfaceClass(kind: InspectorWorkspaceKind, active: boolean): string {
    return active ? 'flex min-h-0 min-w-0 flex-1' : adapters[kind].retainGeometry ? 'pointer-events-none invisible absolute inset-0 flex min-h-0 min-w-0' : 'hidden'
}
function WorkspaceReady({ kind, startedAt, active }: { kind: InspectorWorkspaceKind; startedAt: number; active: boolean }) {
    useLayoutEffect(() => {
        if (active) recordPerformanceSample({ area: 'inspector', stage: `${kind}-module-ready`, elapsedMs: performance.now() - startedAt })
    }, [active, kind, startedAt])
    return null
}
export function InspectorWorkspaceSurface({ kind, mounted, active, open = true, children, fallback }: { kind: InspectorWorkspaceKind; mounted: boolean; active: boolean; open?: boolean; children: ReactNode; fallback?: ReactNode }) {
    const presented = active && open
    const started = useRef(performance.now())
    const previousActive = useRef(false)
    if (presented && !previousActive.current) started.current = performance.now()
    previousActive.current = presented
    useLayoutEffect(() => {
        if (mounted && presented) recordPerformanceSample({ area: 'inspector', stage: `${kind}-presented`, elapsedMs: performance.now() - started.current })
    }, [kind, mounted, presented])
    if (!mounted) return null
    return <div className={inspectorSurfaceClass(kind, active)} data-inspector-workspace={kind} aria-hidden={!presented} inert={!presented ? true : undefined}>
        <Suspense fallback={fallback || <div className="flex min-h-0 flex-1 items-center justify-center" role="status" aria-label="Opening workspace"><LoaderCircle size={18} className="animate-spin text-[var(--accent-primary)]/75" /></div>}>
            {children}
            <WorkspaceReady kind={kind} startedAt={started.current} active={presented} />
        </Suspense>
    </div>
}

/** Loading callbacks belong to the workspace and generation which created them. */
export function useInspectorWorkspaceLoading(workspaceKey: string) {
    const [transitionLoadingTabId, setTransitionLoadingTabId] = useState<string | null>(null)
    const [contentLoadingTabs, setContentLoadingTabs] = useState<ReadonlySet<string>>(new Set())
    const owners = useRef(new Map<string, string>())
    const clearContentLoading = useCallback((tabId?: string) => {
        setContentLoadingTabs(current => { const next = new Set(current); if (tabId) next.delete(tabId); else next.clear(); return next })
        if (tabId) owners.current.delete(tabId); else owners.current.clear()
    }, [])
    const timer = useRef(0)
    const generation = useRef(workspaceKey)
    const callbacks = useRef(new Map<string, (loading: boolean) => void>())
    if (generation.current !== workspaceKey) {
        generation.current = workspaceKey
        owners.current.clear()
        callbacks.current.clear()
        setTransitionLoadingTabId(null)
        setContentLoadingTabs(new Set())
    }
    const beginTabTransition = useCallback((tabId: string) => {
        window.clearTimeout(timer.current)
        setTransitionLoadingTabId(tabId)
        timer.current = window.setTimeout(() => setTransitionLoadingTabId(current => current === tabId ? null : current), 480)
    }, [])
    const loadingFor = useCallback((tabId: string, view = '') => {
        const key = `${workspaceKey}:${tabId}:${view}`
        owners.current.set(tabId, key)
        if (!callbacks.current.has(key)) callbacks.current.set(key, loading => {
            if (generation.current !== workspaceKey || owners.current.get(tabId) !== key) return
            setContentLoadingTabs(current => {
                if (current.has(tabId) === loading) return current
                const next = new Set(current); if (loading) next.add(tabId); else next.delete(tabId); return next
            })
        })
        return callbacks.current.get(key)!
    }, [workspaceKey])
    // Never reset loading in a parent effect after a child has reported its first load.
    useEffect(() => () => window.clearTimeout(timer.current), [workspaceKey])
    return { transitionLoadingTabId, setTransitionLoadingTabId, contentLoadingTabs, clearContentLoading, beginTabTransition, loadingFor }
}
