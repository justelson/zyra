import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Command, HelpCircle, Package, Search } from 'lucide-react'
import { ScriptPlayIcon } from '@/components/ui/ScriptPlayIcon'
import { cn } from '@/lib/utils'
import {
    SCRIPT_INTENT_BADGE_CLASSES,
    SCRIPT_INTENT_LABELS,
    detectScriptIntentWithConfidence,
    type ScriptIntentContext,
    type ScriptIntentPrediction
} from './scriptRun'
import { ProjectDetailsInlineLoading } from './ProjectDetailsInlineLoading'

export function ProjectDetailsSidebar({
    dockOpen = false,
    scripts,
    dependencies,
    devDependencies,
    dependencyInstallStatus,
    loadingProjectDetails = false,
    scriptPredictions,
    scriptIntentContext,
    onRunScript,
    onShowDependencies
}: {
    dockOpen?: boolean
    scripts?: Record<string, string>
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
    dependencyInstallStatus?: {
        installed: boolean | null
        checked: boolean
        ecosystem: 'node' | 'unknown'
        totalPackages: number
        installedPackages: number
        missingPackages: number
        missingDependencies?: string[]
        missingSample?: string[]
        reason?: string
    } | null
    loadingProjectDetails?: boolean
    scriptPredictions: Record<string, ScriptIntentPrediction>
    scriptIntentContext: ScriptIntentContext
    onRunScript: (name: string, command: string) => void
    onShowDependencies: () => void
}) {
    const [scriptQuery, setScriptQuery] = useState('')
    const scriptEntries = useMemo(() => Object.entries(scripts || {}), [scripts])
    const visibleScripts = useMemo(() => {
        const needle = scriptQuery.trim().toLocaleLowerCase()
        return needle ? scriptEntries.filter(([name, command]) => `${name} ${command}`.toLocaleLowerCase().includes(needle)) : scriptEntries
    }, [scriptEntries, scriptQuery])
    const mergedDependencies = [
        ...Object.entries(dependencies || {}).map(([name, version]) => ({ name, version, scope: 'runtime' as const })),
        ...Object.entries(devDependencies || {}).map(([name, version]) => ({ name, version, scope: 'dev' as const }))
    ]
    const previewDependencies = mergedDependencies.slice(0, 5)
    const totalDependencies = mergedDependencies.length
    const hasScripts = scriptEntries.length > 0
    const showLoadingCards = loadingProjectDetails && !hasScripts && totalDependencies === 0

    const installLabel = dependencyInstallStatus?.installed === true
        ? 'All Installed'
        : dependencyInstallStatus?.installed === false
            ? 'Missing Packages'
            : 'Status Unknown'

    const installIndicator = dependencyInstallStatus?.installed === true
        ? <CheckCircle2 size={13} className="text-emerald-300" />
        : dependencyInstallStatus?.installed === false
            ? <AlertTriangle size={13} className="text-amber-300" />
            : <HelpCircle size={13} className="text-white/50" />

    const installBadgeClass = dependencyInstallStatus?.installed === true
        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
        : dependencyInstallStatus?.installed === false
            ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
            : 'border-white/10 bg-white/5 text-white/60'

    return (
        <div className={cn(
            'col-span-12 flex flex-col gap-6',
            dockOpen ? 'mt-1' : 'lg:col-span-4'
        )}>
            {showLoadingCards && (
                <>
                    <div className="overflow-hidden rounded-2xl border border-white/5 bg-sparkle-card shadow-sm">
                        <ProjectDetailsInlineLoading
                            title="Loading scripts"
                            detail="Collecting runnable scripts and intent metadata from the project manifest."
                        />
                    </div>
                    <div className="overflow-hidden rounded-2xl border border-white/5 bg-sparkle-card shadow-sm">
                        <ProjectDetailsInlineLoading
                            title="Loading dependencies"
                            detail="Checking package metadata and install status for this project."
                        />
                    </div>
                </>
            )}

            {hasScripts && (
                <div className="bg-sparkle-card border border-white/5 rounded-2xl overflow-hidden shadow-sm flex flex-col">
                    <div className="px-5 py-4 border-b border-white/5 bg-white/[0.02] flex items-center justify-between">
                        <div className="flex items-center gap-2 text-white/80 font-medium">
                            <Command size={18} className="text-[var(--accent-primary)]" />
                            <span>Scripts</span>
                        </div>
                        <span className="text-xs bg-white/5 text-white/40 px-2 py-1 rounded-md">
                            {scriptEntries.length}
                        </span>
                    </div>
                    <div className="relative border-b border-white/5 px-3 py-2">
                        <Search size={13} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-white/35" />
                        <input type="search" aria-label="Search scripts" value={scriptQuery} onChange={event => setScriptQuery(event.target.value)} placeholder="Find a script" className="w-full rounded-md border border-white/10 bg-black/10 py-1.5 pl-8 pr-2 text-xs text-white/85 outline-none focus:border-[var(--accent-primary)]" />
                    </div>
                    <div className="max-h-[380px] overflow-y-auto custom-scrollbar p-2">
                        {visibleScripts.map(([name, command]) => {
                            const prediction = scriptPredictions[name] || detectScriptIntentWithConfidence(name, command, scriptIntentContext)

                            return (
                                <div key={name} className="group flex items-center gap-3 p-3 hover:bg-white/5 rounded-xl transition-colors border border-transparent hover:border-white/5">
                                    <button
                                        onClick={() => onRunScript(name, command)}
                                        className="p-2.5 rounded-full bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] group-hover:bg-[var(--accent-primary)] group-hover:text-white transition-all shrink-0"
                                        title="Run Script"
                                    >
                                        <ScriptPlayIcon size={16} />
                                    </button>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="text-sm font-medium text-white/90 truncate">{name}</span>
                                            <div className="flex items-center gap-1.5 shrink-0">
                                                <span className={cn('text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border', SCRIPT_INTENT_BADGE_CLASSES[prediction.intent])}>
                                                    {SCRIPT_INTENT_LABELS[prediction.intent]}
                                                </span>
                                            </div>
                                        </div>
                                        <p className="text-xs text-white/40 truncate font-mono mt-0.5">{command}</p>
                                    </div>
                                </div>
                            )
                        })}
                        {visibleScripts.length === 0 ? <div className="px-3 py-6 text-center text-xs text-white/45">No scripts match “{scriptQuery}”.</div> : null}
                    </div>
                </div>
            )}

            {totalDependencies > 0 && (
                <div className="bg-sparkle-card border border-white/5 rounded-2xl overflow-hidden shadow-sm">
                    <div className="px-5 py-4 border-b border-white/5 bg-white/[0.02] flex items-center justify-between">
                        <div className="flex items-center gap-2 text-white/80 font-medium min-w-0">
                            <Package size={18} className="text-purple-400" />
                            <span>Dependencies</span>
                            <span className="text-xs bg-white/5 text-white/40 px-2 py-1 rounded-md">
                                {totalDependencies}
                            </span>
                            <span className={cn('inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-md border shrink-0', installBadgeClass)}>
                                {installIndicator}
                                {installLabel}
                            </span>
                        </div>
                        <button
                            onClick={onShowDependencies}
                            className="text-xs text-white/40 hover:text-white transition-colors"
                        >
                            View All
                        </button>
                    </div>
                    <div className="p-2">
                        {previewDependencies.map(({ name, version, scope }) => (
                            <div key={`${scope}:${name}`} className="flex items-center justify-between p-2.5 rounded-lg hover:bg-white/5 transition-colors">
                                <span className="text-sm text-white/70 truncate max-w-[150px]" title={name}>{name}</span>
                                <div className="flex items-center gap-1.5 shrink-0">
                                    <span className={cn(
                                        'text-[10px] px-1.5 py-0.5 rounded border',
                                        scope === 'runtime'
                                            ? 'border-sky-500/30 bg-sky-500/10 text-sky-200'
                                            : 'border-violet-500/30 bg-violet-500/10 text-violet-200'
                                    )}>
                                        {scope}
                                    </span>
                                    <span className="text-xs font-mono text-white/30 bg-white/5 px-1.5 py-0.5 rounded">{version}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}
