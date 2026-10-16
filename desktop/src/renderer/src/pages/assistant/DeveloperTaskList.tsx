import { Search } from 'lucide-react'
import type { DeveloperWorkspace } from '@shared/contracts/developer-workflow'
import { useState } from 'react'
import { groupDeveloperScripts } from './developer-script-groups'
import { DeveloperScriptChip } from './DeveloperScriptChip'
import { DeveloperTaskOutput } from './DeveloperTaskOutput'
import { NO_DEVELOPER_ACTIONS, type DeveloperActionRunner } from './useDeveloperActions'

export function DeveloperTaskList({ workspace, pending = NO_DEVELOPER_ACTIONS, run }: { workspace: DeveloperWorkspace; pending?: ReadonlySet<string>; run: DeveloperActionRunner }) {
    const [query, setQuery] = useState('')
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const groups = groupDeveloperScripts(workspace.scripts, query)
    const tasks = workspace.tasks.slice().sort((a, b) => Number(b.state === 'running') - Number(a.state === 'running') || b.startedAt.localeCompare(a.startedAt))
    const selected = tasks.find(task => task.id === selectedId)
    const previous = tasks.filter((task, index) => !(task.name in workspace.scripts) && tasks.findIndex(item => item.name === task.name) === index && task.name.toLowerCase().includes(query.toLowerCase()))
    if (selected) return <DeveloperTaskOutput task={selected} history={tasks.filter(task => task.name === selected.name)} pending={pending} run={run} onBack={() => setSelectedId(null)} onSelect={setSelectedId} />
    return <div className="space-y-3">
        <label className="flex h-8 items-center gap-2 border-b border-[var(--surface-divider)] px-1 text-sparkle-text-muted"><Search size={13} /><input aria-label="Filter package scripts" placeholder="Find a script…" value={query} onChange={event => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-xs text-sparkle-text outline-none" /></label>
        <div className="space-y-3">{groups.map(group => <section key={group.id}><div className={`mb-1.5 flex items-center gap-2 text-[10px] font-medium ${group.tone}`}><span>{group.label}</span><span className="text-sparkle-text-muted">{group.names.length}</span></div><div className="flex flex-wrap gap-1">{group.names.map(name => {
            const task = tasks.find(item => item.name === name)
            return <DeveloperScriptChip key={name} name={name} command={workspace.scripts[name]} tone={group.tone} task={task} starting={pending.has(`script:start:${name}`)} stopping={!!task && pending.has(`script:stop:${task.id}`)} onInspect={() => task && setSelectedId(task.id)} onRun={() => void run(async () => { const result = await window.devscope.startDeveloperTask(workspace.root, name); if (!result.success) throw new Error(result.error) }, `script:start:${name}`)} onStop={() => task && void run(async () => { const result = await window.devscope.stopDeveloperTask(task.id); if (!result.success) throw new Error(result.error) }, `script:stop:${task.id}`)} />
        })}</div></section>)}</div>
        {previous.length > 0 && <section><div className="mb-1.5 text-[10px] text-sparkle-text-muted">Previous runs</div><div className="flex flex-wrap gap-1">{previous.map(task => <DeveloperScriptChip key={task.id} name={task.name} command={task.command} tone="text-sparkle-text-muted" task={task} canRun={false} starting={false} stopping={pending.has(`script:stop:${task.id}`)} onRun={() => {}} onStop={() => void run(async () => { const result = await window.devscope.stopDeveloperTask(task.id); if (!result.success) throw new Error(result.error) }, `script:stop:${task.id}`)} onInspect={() => setSelectedId(task.id)} />)}</div></section>}
        {query && !groups.length && <p className="text-xs text-sparkle-text-muted">No matching scripts.</p>}
        {!Object.keys(workspace.scripts).length && <p className="text-xs text-sparkle-text-muted">No package scripts in this folder.</p>}
    </div>
}
