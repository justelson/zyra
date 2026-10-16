import { NativeOverlayPortal } from '@/components/ui/native-overlay-portal'
import { useMemo, useState } from 'react'
import { Command, Search, X } from 'lucide-react'
import { ScriptPlayIcon } from '@/components/ui/ScriptPlayIcon'

type ProjectScriptCatalogModalProps = {
    projectName?: string
    scripts: Record<string, string>
    scriptPredictions?: Record<string, { intent?: string; confidence?: number }>
    onRunScript: (name: string, command: string) => void
    onClose: () => void
}

export function ProjectScriptCatalogModal({
    projectName,
    scripts,
    scriptPredictions,
    onRunScript,
    onClose
}: ProjectScriptCatalogModalProps) {
    const [query, setQuery] = useState('')
    const entries = useMemo(
        () => Object.entries(scripts || {}).filter(([name, command]) => `${name} ${command}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).sort(([left], [right]) => left.localeCompare(right)),
        [scripts, query]
    )

    return (
        <NativeOverlayPortal><div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md animate-fadeIn" onClick={onClose}>
            <div
                className="m-4 flex max-h-[95vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-sparkle-card shadow-2xl"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="flex items-center justify-between border-b border-white/5 bg-black/15 px-5 py-4">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 text-white/85">
                            <Command size={18} className="text-[var(--accent-primary)]" />
                            <h3 className="truncate text-base font-semibold">Scripts</h3>
                        </div>
                        <p className="mt-1 truncate text-sm text-white/45">
                            {projectName ? `${projectName} script catalog` : 'Project script catalog'}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg border border-white/10 p-2 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
                        title="Close scripts"
                    >
                        <X size={16} />
                    </button>
                </div>

                <div className="relative border-b border-white/5 px-4 py-3"><Search size={15} className="pointer-events-none absolute left-7 top-1/2 -translate-y-1/2 text-white/35" /><input type="search" aria-label="Search scripts" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search scripts or commands" className="w-full rounded-md border border-white/10 bg-black/10 py-2 pl-9 pr-3 text-sm text-white/85 outline-none focus:border-[var(--accent-primary)]" /></div>
                <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar p-3">
                    {entries.length > 0 ? (
                        <div className="space-y-2">
                            {entries.map(([name, command]) => {
                                const prediction = scriptPredictions?.[name]
                                return (
                                    <div
                                        key={name}
                                        className="flex items-center gap-3 rounded-xl border border-white/5 bg-black/10 px-3 py-3 transition-colors hover:border-white/10 hover:bg-white/[0.03]"
                                    >
                                        <button
                                            type="button"
                                            onClick={() => {
                                                onRunScript(name, command)
                                                onClose()
                                            }}
                                            className="shrink-0 rounded-full bg-[var(--accent-primary)]/12 p-2.5 text-[var(--accent-primary)] transition-colors hover:bg-[var(--accent-primary)] hover:text-white"
                                            title={`Run ${name}`}
                                        >
                                            <ScriptPlayIcon size={15} />
                                        </button>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2">
                                                <span className="truncate text-sm font-medium text-white/88">{name}</span>
                                                {prediction?.intent && (
                                                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/50">
                                                        {prediction.intent}
                                                    </span>
                                                )}
                                            </div>
                                            <p className="mt-1 truncate font-mono text-xs text-white/38">{command}</p>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    ) : (
                        <div className="flex h-full flex-col items-center justify-center text-white/30">
                            <Command size={42} className="mb-4 opacity-25" />
                            <p className="text-sm">{query ? 'No matching scripts' : 'No scripts found'}</p>
                        </div>
                    )}
                </div>
            </div>
        </div></NativeOverlayPortal>
    )
}
