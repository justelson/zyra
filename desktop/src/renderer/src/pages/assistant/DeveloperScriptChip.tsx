import { AlertCircle, Check, LoaderCircle, RotateCcw, Square } from 'lucide-react'
import { ScriptPlayIcon } from '@/components/ui/ScriptPlayIcon'
import type { DeveloperTask } from '@shared/contracts/developer-workflow'

export function DeveloperScriptChip({ name, command, tone, task, starting, stopping, onRun, onStop, onInspect, canRun = true }: {
    name: string; command: string; tone: string; task?: DeveloperTask; starting: boolean; stopping: boolean
    onRun: () => void; onStop: () => void; onInspect: () => void
    canRun?: boolean
}) {
    const running = task?.state === 'running'
    const pending = starting || stopping
    const status = task?.stale && !running ? 'Source changed' : task?.state
    const stateIcon = running ? <LoaderCircle size={13} className="animate-spin" /> : task?.stale ? <RotateCcw size={13} /> : task?.state === 'passed' ? <Check size={13} /> : task?.state === 'failed' ? <AlertCircle size={13} /> : task?.state === 'stopped' ? <Square size={12} /> : null
    return <div data-developer-script={name} aria-busy={pending || running} title={`${name}\n${command}${status ? ` · ${status}` : ''}`} className={`inline-flex h-6 min-w-0 max-w-[calc(50%_-_2px)] items-center overflow-hidden rounded-full border border-[var(--surface-divider)] bg-[var(--surface-hover)] pl-1 ${running || pending ? 'text-amber-400' : task?.state === 'failed' && !task.stale ? 'text-rose-400' : tone}`}>
        <button type="button" disabled={pending || (!running && !canRun)} onClick={running ? onStop : onRun} aria-label={`${running ? 'Stop' : 'Run'} ${name}`} title={pending ? stopping ? 'Stopping…' : 'Starting…' : running ? 'Stop script' : !canRun ? 'Script removed from package' : task ? 'Run again' : 'Run script'} className="group grid size-5 shrink-0 place-items-center rounded-full hover:bg-[var(--surface-hover)] disabled:cursor-default">
            {pending ? <LoaderCircle size={13} className="animate-spin" /> : stateIcon ? <><span className="group-hover:hidden group-focus-visible:hidden">{stateIcon}</span><span className="hidden group-hover:inline group-focus-visible:inline">{running ? <Square size={12} /> : <ScriptPlayIcon size={13} />}</span></> : <ScriptPlayIcon size={13} />}
        </button>
        <button type="button" disabled={!task} onClick={onInspect} aria-label={`View output for ${name}`} className="min-w-0 truncate py-0.5 pl-0.5 pr-2 text-[10px] font-medium leading-4 text-sparkle-text-secondary enabled:hover:text-sparkle-text disabled:cursor-default">{name}</button>
    </div>
}
