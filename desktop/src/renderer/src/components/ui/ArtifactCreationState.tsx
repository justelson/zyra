import { ChartLine } from 'lucide-react'

export function ArtifactCreationState({ kind, phase, className = '' }: { kind: 'diagram' | 'visualization'; phase: 'creating' | 'loading'; className?: string }) {
    const label = `${phase === 'creating' ? 'Creating' : 'Loading'} ${kind}`
    return <div role="status" aria-label={label} data-artifact-kind={kind} data-artifact-phase={phase} data-artifact-creating={phase === 'creating' ? kind : undefined} data-mermaid-creating={(kind === 'diagram' && phase === 'creating') || undefined}
        className={`flex flex-col items-center justify-center gap-3 rounded-lg border border-[var(--surface-divider)] bg-sparkle-card p-4 text-sm text-sparkle-text-muted ${kind === 'diagram' ? 'mermaid-canvas min-h-[220px]' : 'min-h-40'} ${className}`}>
        {kind === 'visualization' ? <ChartLine size={24} strokeWidth={1.4} aria-hidden="true" className="opacity-50"/> : null}
        <span aria-hidden="true" className="inline-flex items-baseline">
            <span className="assistant-title-shimmer creation-text">{label}</span>
            <span className="creation-dots ml-0.5 inline-flex w-[1.1em]" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span>
        </span>
    </div>
}
