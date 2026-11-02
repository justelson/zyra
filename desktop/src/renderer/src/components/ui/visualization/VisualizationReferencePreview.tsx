import { lazy, memo, Suspense, useContext, useEffect, useState } from 'react'
import { Expand, RotateCcw } from 'lucide-react'
import type { VisualizationResource } from '@shared/visualization-resources'
import { VisualizationPreview } from './VisualizationPreview'
import { VisualizationThreadContext } from './visualization-thread-context'
import { MermaidDiagram } from '../markdown/MermaidDiagram'
import { ArtifactCreationState } from '../ArtifactCreationState'

const Scene3DViewer = lazy(() =>
    import('../scene3d/Scene3DViewer').then((module) => ({ default: module.Scene3DViewer })),
)
const VisualizationWorkspace = lazy(() => import('../visualization-resource/VisualizationWorkspace').then(module => ({ default: module.VisualizationWorkspace })))

/** References always render their authored revision, never the mutable latest pointer. */
export const VisualizationReferencePreview = memo(function VisualizationReferencePreview({
    id,
    version,
    complete,
    streaming,
}: {
    id: string
    version?: number
    complete: boolean
    streaming: boolean
}) {
    const threadId = useContext(VisualizationThreadContext)
    const [loaded, setLoaded] = useState<{ key: string; resource: VisualizationResource } | null>(null)
    const [error, setError] = useState('')
    const [attempt, setAttempt] = useState(0)
    const [expanded, setExpanded] = useState(false)
    const key = `${threadId}:${id}:${version}`
    useEffect(() => {
        setError('')
        setExpanded(false)
        if (!complete || !threadId || !version) return
        const api = window.devscope?.assistant?.getVisualization
        if (!api) {
            setError('Saved visualization viewing requires the updated Zyra client.')
            return
        }
        let cancelled = false
        void api({ threadId, id, version })
            .then((result) => {
                if (cancelled) return
                if (!result.success || !result.resource) {
                    setError(
                        !result.success
                            ? result.error || 'This saved visualization is unavailable.'
                            : 'This saved visualization is unavailable.',
                    )
                    return
                }
                setLoaded({ key, resource: result.resource })
            })
            .catch((error) => {
                if (!cancelled)
                    setError(error instanceof Error ? error.message : 'Could not open visualization.')
            })
        return () => {
            cancelled = true
        }
    }, [key, complete, threadId, id, version, attempt])
    if (!complete)
        return streaming ? (
            <section className="my-3 min-w-0"><div className="h-9" aria-hidden="true"/><div style={{ height: 320 }}><ArtifactCreationState kind="visualization" phase="creating" className="h-full !min-h-0 !rounded-none !border-0"/></div></section>
        ) : (
            <p role="status">Visualization reference incomplete.</p>
        )
    if (!threadId)
        return (
            <p role="status" className="text-xs text-sparkle-text-muted">
                Open this visualization in its owning chat.
            </p>
        )
    if (!version) return <p role="status">A saved visualization reference needs a specific version.</p>
    if (error)
        return (
            <div className="my-3 text-xs text-sparkle-text-muted" role="status">
                <p>{error}</p>
                <button
                    type="button"
                    className="mt-2 inline-flex items-center gap-1"
                    onClick={() => setAttempt((value) => value + 1)}
                >
                    <RotateCcw size={12} />
                    Retry
                </button>
            </div>
        )
    const resource = loaded?.key === key ? loaded.resource : null
    const revision = resource?.versions.find((item) => item.version === version)
    if (!resource || !revision) return <section className="my-3 min-w-0" data-visualization-resource-id={id} data-visualization-version={version}><div className="h-9" aria-hidden="true"/><div style={{ height: 320 }}><ArtifactCreationState kind="visualization" phase="loading" className="h-full !min-h-0 !rounded-none !border-0"/></div></section>
    return (
        <section
            className="my-3 min-w-0"
            data-visualization-resource-id={id}
            data-visualization-version={version}
        >
            <header className="mb-2 flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate font-medium">{revision.title}</span>
                <span className="shrink-0 text-sparkle-text-muted">v{version}</span>
                <button
                    type="button"
                    aria-label="Open saved visualization"
                    title="Open saved visualization"
                    onClick={() => setExpanded(true)}
                    className="inline-flex size-7 items-center justify-center rounded hover:bg-[var(--surface-hover)]"
                >
                    <Expand size={14} />
                </button>
            </header>
            <div className="min-w-0" style={resource.kind === 'scene3d' ? { height: 320 } : undefined}>
            <Suspense fallback={<ArtifactCreationState kind="visualization" phase="loading" className="h-full !min-h-0 !rounded-none !border-0"/>}>
                {resource.kind === 'html' ? (
                    <VisualizationPreview
                        hideHeader
                        block={{
                            kind: 'visualization',
                            start: 0,
                            title: revision.title,
                            summary: revision.summary,
                            height: revision.height,
                            html: revision.source,
                            state: 'complete',
                        }}
                        streaming={false}
                    />
                ) : resource.kind === 'mermaid' ? (
                    <MermaidDiagram chart={revision.source} natural hideExpand />
                ) : (
                    <Scene3DViewer source={revision.source} expanded />
                )}
            </Suspense>
            </div>
            {expanded ? <Suspense fallback={null}><VisualizationWorkspace resource={resource} initialVersion={version} threadId={threadId} onClose={() => setExpanded(false)}/></Suspense> : null}
        </section>
    )
})
