import { NativeOverlayPortal } from '@/components/ui/native-overlay-portal'
import { ChevronDown, X } from 'lucide-react'
import { ScriptPlayIcon } from '@/components/ui/ScriptPlayIcon'
import { cn } from '@/lib/utils'
import { AnimatedHeight } from '@/components/ui/AnimatedHeight'
import { SCRIPT_INTENT_BADGE_CLASSES, SCRIPT_INTENT_LABELS, type PackageScriptRunner } from './scriptRun'
import type { PendingScriptRun } from './types'

export function ServerScriptRunModal({
    pendingScriptRun,
    scriptPortInput,
    setScriptPortInput,
    scriptExposeNetwork,
    setScriptExposeNetwork,
    scriptAdvancedOpen,
    setScriptAdvancedOpen,
    scriptExtraArgsInput,
    setScriptExtraArgsInput,
    scriptEnvInput,
    setScriptEnvInput,
    scriptRunError,
    scriptCommandPreview,
    scriptRunner,
    onClose,
    onConfirm
}: {
    pendingScriptRun: PendingScriptRun | null
    scriptPortInput: string
    setScriptPortInput: (value: string) => void
    scriptExposeNetwork: boolean
    setScriptExposeNetwork: (value: boolean) => void
    scriptAdvancedOpen: boolean
    setScriptAdvancedOpen: (value: boolean) => void
    scriptExtraArgsInput: string
    setScriptExtraArgsInput: (value: string) => void
    scriptEnvInput: string
    setScriptEnvInput: (value: string) => void
    scriptRunError: string | null
    scriptCommandPreview: string
    scriptRunner: PackageScriptRunner
    onClose: () => void
    onConfirm: () => void
}) {
    if (!pendingScriptRun || pendingScriptRun.intent !== 'server') return null

    return (
        <NativeOverlayPortal><div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-md animate-fadeIn" onClick={onClose}>
            <div
                className="w-full max-w-3xl max-h-[95vh] rounded-2xl border border-white/10 bg-sparkle-card shadow-2xl m-4 overflow-hidden flex flex-col"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="flex items-center justify-between px-5 py-4 border-b border-white/5 bg-white/[0.03]">
                    <div className="flex items-center gap-2 text-white/90 font-medium">
                        <ScriptPlayIcon size={16} className="text-[var(--accent-primary)]" />
                        <span>Run Server Script</span>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-md text-white/40 hover:text-white hover:bg-white/10 transition-colors"
                        title="Close"
                    >
                        <X size={16} />
                    </button>
                </div>

                <div className="p-5 overflow-y-auto flex-1">
                    <div className="grid gap-4 lg:grid-cols-2">
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-medium text-white/60 mb-2">Port Override (Optional)</label>
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    placeholder="Use project default port"
                                    value={scriptPortInput}
                                    onChange={(event) => setScriptPortInput(event.target.value)}
                                    className="w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[var(--accent-primary)]/40"
                                />
                                <p className="text-[11px] text-white/40 mt-1">
                                    Leave empty to keep the script default.
                                </p>
                            </div>

                            <label className="flex items-start gap-3 rounded-lg border border-white/10 bg-black/20 px-3 py-3 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={scriptExposeNetwork}
                                    onChange={(event) => setScriptExposeNetwork(event.target.checked)}
                                    className="mt-0.5 h-4 w-4 rounded border-white/30 bg-black/30 text-[var(--accent-primary)] focus:ring-[var(--accent-primary)]"
                                />
                                <span className="text-sm text-white/75">
                                    Expose on local network (`0.0.0.0`).
                                    {!scriptExposeNetwork && <span className="block text-xs text-white/45 mt-0.5">Disabled = localhost/default host.</span>}
                                </span>
                            </label>

                            <button
                                type="button"
                                onClick={() => setScriptAdvancedOpen(!scriptAdvancedOpen)}
                                aria-expanded={scriptAdvancedOpen}
                                className="w-full flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white/80 hover:bg-black/30 transition-colors"
                            >
                                <span>Advanced Settings</span>
                                <ChevronDown
                                    size={16}
                                    className={cn(
                                        'transition-transform duration-[240ms] ease-[cubic-bezier(0.16,1,0.3,1)]',
                                        scriptAdvancedOpen && 'rotate-180'
                                    )}
                                />
                            </button>

                            <AnimatedHeight isOpen={scriptAdvancedOpen} duration={240}>
                                <div className="mt-3 space-y-3 rounded-lg border border-white/10 bg-black/15 p-3">
                                    <div>
                                        <label className="block text-xs font-medium text-white/60 mb-2">Additional Script Arguments (Optional)</label>
                                        <input
                                            type="text"
                                            placeholder="example: --strictPort --open"
                                            value={scriptExtraArgsInput}
                                            onChange={(event) => setScriptExtraArgsInput(event.target.value)}
                                            className="w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[var(--accent-primary)]/40"
                                        />
                                        <p className="text-[11px] text-white/40 mt-1">
                                            Passed to `{scriptRunner}` after the script name.
                                        </p>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-medium text-white/60 mb-2">Environment Overrides (Optional)</label>
                                        <textarea
                                            rows={3}
                                            placeholder={'PORT=4173\nAPI_BASE_URL=http://localhost:9000'}
                                            value={scriptEnvInput}
                                            onChange={(event) => setScriptEnvInput(event.target.value)}
                                            className="w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[var(--accent-primary)]/40 font-mono"
                                        />
                                        <p className="text-[11px] text-white/40 mt-1">
                                            One `KEY=VALUE` per line. Lines starting with `#` are ignored.
                                        </p>
                                    </div>
                                </div>
                            </AnimatedHeight>
                        </div>

                        <div className="space-y-4">
                            <div className="rounded-xl border border-white/10 bg-black/20 p-3 space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="text-xs text-white/50">Script</div>
                                    <div className="flex items-center gap-1.5">
                                        <span className={cn('text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border', SCRIPT_INTENT_BADGE_CLASSES[pendingScriptRun.intent])}>
                                            {SCRIPT_INTENT_LABELS[pendingScriptRun.intent]}
                                        </span>
                                        <span className="text-[10px] text-white/45 bg-white/10 px-1.5 py-0.5 rounded-full border border-white/10">
                                            {Math.round(pendingScriptRun.confidence * 100)}%
                                        </span>
                                    </div>
                                </div>
                                <div className="text-sm text-white/90 font-medium">{pendingScriptRun.name}</div>
                                <div className="text-xs text-white/45 font-mono break-all">{pendingScriptRun.command}</div>
                                <div className="text-xs text-white/45">
                                    App prediction: {SCRIPT_INTENT_LABELS[pendingScriptRun.intent]} script.
                                </div>
                            </div>

                            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                                <div className="text-[11px] text-white/50 mb-1">Final Command</div>
                                <code className="text-[11px] text-white/75 break-all">
                                    {scriptCommandPreview}
                                </code>
                                <div className="text-[11px] text-white/40 mt-2">
                                    Uses {scriptRunner} runner with server-focused overrides.
                                </div>
                            </div>
                        </div>
                    </div>

                    {scriptRunError && (
                        <div className="mt-4 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                            {scriptRunError}
                        </div>
                    )}
                </div>

                <div className="px-5 py-4 border-t border-white/5 bg-white/[0.03] flex items-center justify-end gap-2">
                    <button
                        onClick={onClose}
                        className="px-3 py-2 rounded-lg text-sm text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onConfirm}
                        className="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--accent-primary)] text-white hover:bg-[var(--accent-primary)]/85 transition-colors"
                    >
                        Run in Terminal
                    </button>
                </div>
            </div>
        </div></NativeOverlayPortal>
    )
}
