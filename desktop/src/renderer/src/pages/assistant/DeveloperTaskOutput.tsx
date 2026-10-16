import { ArrowLeft, ExternalLink, LoaderCircle, MessageSquare, Square } from 'lucide-react'
import type { DeveloperTask } from '@shared/contracts/developer-workflow'
import { requestAssistantContextFile } from './assistant-code-context'
import { openDesktopLink } from '@/lib/desktop-links'
import type { DeveloperActionRunner } from './useDeveloperActions'

export function DeveloperTaskOutput({ task, history, pending, run, onBack, onSelect }: {
    task: DeveloperTask; history: DeveloperTask[]; pending: ReadonlySet<string>; run: DeveloperActionRunner; onBack: () => void; onSelect: (id: string) => void
}) {
    const stopping = pending.has(`script:stop:${task.id}`)
    return <div className="space-y-2 text-xs">
        <div className="flex items-center gap-2"><button type="button" aria-label="Back to scripts" onClick={onBack} className="grid size-6 shrink-0 place-items-center rounded-md hover:bg-[var(--surface-hover)]"><ArrowLeft size={13} /></button><span className="min-w-0 flex-1 truncate font-medium">{task.name}</span><span className={task.state === 'failed' ? 'text-rose-400' : task.state === 'running' ? 'text-amber-400' : task.state === 'passed' && !task.stale ? 'text-emerald-400' : 'text-sparkle-text-muted'}>{task.stale && task.state !== 'running' ? 'Source changed' : task.state}</span></div>
        {history.length > 1 && <select aria-label="Run history" value={task.id} onChange={event => onSelect(event.target.value)} className="h-7 w-full rounded-md border border-[var(--surface-divider)] bg-[var(--surface-floating)] px-2 text-[11px]">{history.map(item => <option key={item.id} value={item.id}>{new Date(item.startedAt).toLocaleString()} · {item.state}</option>)}</select>}
        <p className="truncate font-mono text-[10px] text-sparkle-text-muted" title={task.command}>{task.command}{task.exitCode != null ? ` · exit ${task.exitCode}` : ''}</p>
        <div className="flex flex-wrap gap-2 text-[11px]">
            {task.state === 'running' && <button type="button" disabled={stopping} className="inline-flex items-center gap-1 text-amber-400" onClick={() => void run(async () => { const result = await window.devscope.stopDeveloperTask(task.id); if (!result.success) throw new Error(result.error) }, `script:stop:${task.id}`)}>{stopping ? <LoaderCircle size={12} className="animate-spin" /> : <Square size={11} />}Stop</button>}
            {task.urls.map(url => <button type="button" key={url} className="inline-flex items-center gap-1 text-sky-400" onClick={() => void openDesktopLink(url)}><ExternalLink size={11} />{url}</button>)}
            {task.output && <button type="button" disabled={pending.has(`script:attach:${task.id}`)} className="inline-flex items-center gap-1 text-sparkle-text-secondary" onClick={() => void run(() => requestAssistantContextFile({ id: `task-${task.id}-${Date.now()}`, path: `task-output:${task.id}`, name: `${task.name}.log`, kind: 'doc', mimeType: 'text/plain', source: 'manual', previewText: task.output.slice(0, 180), content: `Project task ${task.command}\nWorking folder: ${task.root}\nStatus: ${task.state}; exit: ${task.exitCode ?? 'not finished'}; started: ${task.startedAt}\nSource revision: ${task.sourceRevision}${task.stale ? ' (changed)' : ''}\n\n${task.output}` }), `script:attach:${task.id}`)}><MessageSquare size={12} />Ask Zyra</button>}
        </div>
        <pre className="min-h-24 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-[var(--surface-divider)] bg-[var(--surface-hover)] p-2.5 font-mono text-[11px] leading-relaxed text-sparkle-text-secondary">{task.output || (task.state === 'running' ? 'Waiting for output…' : 'No output.')}</pre>
    </div>
}
