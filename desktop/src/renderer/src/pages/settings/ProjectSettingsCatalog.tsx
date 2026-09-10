import { useMemo, useState } from 'react'
import { Archive, FolderKanban, FolderOpen, FolderPlus, Plus, RotateCcw, X } from 'lucide-react'
import type { AssistantProject, AssistantProjectCatalog, AssistantProjectMigrationCandidate } from '@shared/assistant/contracts'
import { SettingsActionsMenu } from './SettingsActionsMenu'
import { SettingsListPagination } from './SettingsListPagination'
import { paginateSettingsItems } from './settings-list-page'
import { SettingsButton, SettingsDialog, SettingsInput, SettingsNotice, SettingsRow, SettingsSection, SettingsSelect } from './settings-layout'

type CatalogProps = {
    catalog: AssistantProjectCatalog
    loading: boolean
    error: string | null
    creating: boolean
    onCreate: () => Promise<void>
    onOpenHome: (project: AssistantProject) => Promise<unknown>
    onAddFolder: (projectId: string, access: 'read-only' | 'read-write') => Promise<unknown>
    onRemoveFolder: (projectId: string, folderId: string) => Promise<unknown>
    onArchive: (projectId: string, archived: boolean) => Promise<unknown>
    onImport: (candidate: AssistantProjectMigrationCandidate) => Promise<unknown>
    onDismiss: (candidateId: string) => Promise<unknown>
}

export function ProjectSettingsCatalog(props: CatalogProps) {
    const [view, setView] = useState<'active' | 'detected' | 'archived'>('active')
    const [query, setQuery] = useState('')
    const [requestedPage, setPage] = useState(0)
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    const [actionError, setActionError] = useState<string | null>(null)
    const selected = props.catalog.projects.find(project => project.id === selectedId) || null
    const filtered = useMemo(() => {
        const records: Array<AssistantProject | AssistantProjectMigrationCandidate> = view === 'detected'
            ? props.catalog.candidates.filter(candidate => candidate.status === 'pending')
            : props.catalog.projects.filter(project => Boolean(project.archived) === (view === 'archived'))
        const term = query.trim().toLowerCase()
        return term ? records.filter(record => ('folders' in record
            ? `${record.name} ${record.homePath} ${record.folders.map(folder => folder.path).join(' ')}`
            : `${record.suggestedName} ${record.path}`).toLowerCase().includes(term)) : records
    }, [props.catalog, query, view])
    const page = paginateSettingsItems(filtered, requestedPage)
    const run = async (action: () => Promise<unknown>) => {
        if (busy) return
        setBusy(true); setActionError(null)
        try { await action() } catch (error) { setActionError(error instanceof Error ? error.message : 'Project action failed.') }
        finally { setBusy(false) }
    }
    return <>
        <SettingsSection title="Project catalog" headerAction={<SettingsButton onClick={() => void run(props.onCreate)} disabled={props.creating || busy}><Plus size={13} />New project</SettingsButton>}>
            <div className="flex flex-wrap items-center gap-2 border-b border-[var(--settings-row-divider)] px-4 py-3">
                <SettingsInput value={query} onChange={event => { setQuery(event.target.value); setPage(0) }} placeholder="Search projects" aria-label="Search project catalog" className="min-w-0 flex-1 sm:w-auto" />
                <SettingsSelect value={view} onChange={event => { setView(event.target.value as typeof view); setPage(0) }} aria-label="Project catalog view" className="!min-w-0 !w-32"><option value="active">Active ({props.catalog.projects.filter(project => !project.archived).length})</option><option value="detected">Detected ({props.catalog.candidates.filter(candidate => candidate.status === 'pending').length})</option><option value="archived">Archived ({props.catalog.projects.filter(project => project.archived).length})</option></SettingsSelect>
            </div>
            {props.error || actionError ? <SettingsNotice tone="error">{props.error || actionError}</SettingsNotice> : null}
            {props.loading ? <SettingsNotice>Refreshing projects…</SettingsNotice> : null}
            <div className="max-h-[520px] overflow-y-auto [scrollbar-gutter:stable]">
                {page.items.map(record => 'folders' in record ? <SettingsRow
                    key={record.id}
                    title={record.name}
                    icon={<FolderKanban size={16} className="text-[var(--settings-text-muted)]" />}
                    description={`${record.folders.length} associated ${record.folders.length === 1 ? 'folder' : 'folders'}${record.archived ? ', archived' : ''}.`}
                    info={<div className="space-y-1"><span className="font-medium">Project home</span><code className="block break-all text-[11px]">{record.homePath}</code></div>}
                    status={record.folders.some(folder => !folder.available) ? 'Folder unavailable' : undefined}
                    statusTone="warning"
                    control={<SettingsActionsMenu ariaLabel={`Manage ${record.name}`} disabled={busy} items={[
                        { id: 'folders', label: 'View folders', icon: <FolderOpen size={13} />, onSelect: () => setSelectedId(record.id) },
                        { id: 'home', label: 'Open project home', icon: <FolderOpen size={13} />, onSelect: () => run(() => props.onOpenHome(record)) },
                        ...(!record.archived ? [
                            { id: 'add', label: 'Add folder', icon: <FolderPlus size={13} />, onSelect: () => run(() => props.onAddFolder(record.id, 'read-write')) },
                            { id: 'add-read-only', label: 'Add read-only folder', icon: <FolderPlus size={13} />, onSelect: () => run(() => props.onAddFolder(record.id, 'read-only')) }
                        ] : []),
                        { id: 'archive', label: record.archived ? 'Restore project' : 'Archive project', icon: record.archived ? <RotateCcw size={13} /> : <Archive size={13} />, separatorBefore: true, onSelect: () => run(() => props.onArchive(record.id, !record.archived)) }
                    ]} />}
                /> : <SettingsRow
                    key={record.id}
                    title={record.suggestedName}
                    description="Detected folder awaiting your review."
                    info={<code className="break-all text-[11px]">{record.path}</code>}
                    status="Review required" statusTone="warning"
                    control={<div className="flex gap-2"><SettingsButton disabled={busy} onClick={() => void run(() => props.onImport(record))}>Review & import</SettingsButton><SettingsActionsMenu label="More" ariaLabel={`Actions for ${record.suggestedName}`} disabled={busy} items={[{ id: 'dismiss', label: 'Dismiss suggestion', icon: <X size={13} />, onSelect: () => run(() => props.onDismiss(record.id)) }]} /></div>}
                />)}
                {!props.loading && !props.error && page.total === 0 ? <SettingsNotice>{query ? 'No matching projects.' : view === 'active' ? 'No active projects.' : view === 'archived' ? 'No archived projects.' : 'No detected folders to review.'}</SettingsNotice> : null}
            </div>
            <SettingsListPagination {...page} onPageChange={setPage} />
        </SettingsSection>
        <SettingsDialog open={selected !== null} title={selected ? `${selected.name} folders` : 'Project folders'} description="Folder access controls the scope of work in this Project." onClose={() => setSelectedId(null)}
            className="max-w-[640px]" footer={<SettingsButton onClick={() => setSelectedId(null)}>Done</SettingsButton>}>
            {props.error || actionError ? <SettingsNotice tone="error">{props.error || actionError}</SettingsNotice> : null}
            {selected ? <>
                <div className="flex items-center justify-between gap-3">
                    <span className="text-[12px] text-[var(--settings-text-secondary)]">{selected.folders.length} folders</span>
                    {!selected.archived ? <SettingsActionsMenu label="Add folder" disabled={busy} items={[
                        { id: 'write', label: 'Read and write', onSelect: () => run(() => props.onAddFolder(selected.id, 'read-write')) },
                        { id: 'read', label: 'Read only', onSelect: () => run(() => props.onAddFolder(selected.id, 'read-only')) }
                    ]} /> : null}
                </div>
                <div className="max-h-80 overflow-y-auto [scrollbar-gutter:stable] divide-y divide-[var(--settings-row-divider)]">
                    {selected.folders.map(folder => <div key={folder.associationId} className="flex items-center gap-3 py-3">
                        <div className="min-w-0 flex-1">
                            <div className="text-[12px] font-medium">{folder.label}<span className="ml-2 text-[10px] font-normal text-[var(--settings-text-muted)]">{folder.access === 'read-only' ? 'Read only' : 'Read and write'}{!folder.available ? ' · Unavailable' : ''}</span></div>
                            <code title={folder.path} className="mt-1 block truncate text-[11px] text-[var(--settings-text-secondary)]">{folder.path}</code>
                        </div>
                        <SettingsButton variant="ghost" disabled={busy || selected.archived} onClick={() => void run(() => props.onRemoveFolder(selected.id, folder.folderId))}>Detach</SettingsButton>
                    </div>)}
                    {selected.folders.length === 0 ? <SettingsNotice>This Project uses its home folder until you associate another folder.</SettingsNotice> : null}
                </div>
            </> : null}
        </SettingsDialog>
    </>
}
