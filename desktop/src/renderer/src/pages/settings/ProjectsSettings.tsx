import { useEffect, useMemo, useState } from 'react'
import { Archive, FolderOpen, FolderPlus, Image, Plus, RefreshCw, RotateCcw, X } from 'lucide-react'
import ProjectIcon from '@/components/ui/ProjectIcon'
import { useSettings } from '@/lib/settings'
import {
    SettingsButton,
    SettingsNotice,
    SettingsPageContainer,
    SettingsRow,
    SettingsSection
} from './settings-layout'
import { ExplorerPreferencesSections } from './ExplorerSettings'
import { useAssistantProjectCatalog } from '../assistant/useAssistantProjectCatalog'

type IndexResult = { success: boolean; projects: number; folders: number; files: number; error?: string }

export default function ProjectsSettings() {
    const { settings, updateSettings } = useSettings()
    const [indexing, setIndexing] = useState(false)
    const [indexResult, setIndexResult] = useState<IndexResult | null>(null)
    const [newProjectName, setNewProjectName] = useState('')
    const [projectActionPending, setProjectActionPending] = useState(false)
    const {
        catalog,
        loading: projectsLoading,
        error: projectsError,
        refresh: refreshProjects,
        importCandidate,
        createProject,
        associateFolder,
        removeFolder,
        dismissCandidate,
        updateProject
    } = useAssistantProjectCatalog()
    const roots = useMemo(() => [settings.projectsFolder, ...settings.additionalFolders].filter((value) => value.trim()), [settings.additionalFolders, settings.projectsFolder])

    useEffect(() => {
        void refreshProjects()
    }, [refreshProjects, roots])

    const chooseMainRoot = async () => {
        const result = await window.devscope.selectFolder()
        if (result.success && result.folderPath) {
            updateSettings({ projectsFolder: result.folderPath })
            setIndexResult(null)
        }
    }

    const addRoot = async () => {
        const result = await window.devscope.selectFolder()
        if (!result.success || !result.folderPath || roots.includes(result.folderPath)) return
        updateSettings({ additionalFolders: [...settings.additionalFolders, result.folderPath] })
        setIndexResult(null)
    }

    const createEmptyProject = async () => {
        const name = newProjectName.trim()
        if (!name || projectActionPending) return
        setProjectActionPending(true)
        try {
            const project = await createProject({ name })
            if (project) setNewProjectName('')
        } finally {
            setProjectActionPending(false)
        }
    }

    const addAssociatedFolder = async (projectId: string, access: 'read-only' | 'read-write') => {
        const result = await window.devscope.selectFolder()
        if (!result.success || !result.folderPath) return
        await associateFolder({ projectId, path: result.folderPath, access })
    }

    const addIconOverride = async () => {
        const project = await window.devscope.selectFolder()
        if (!project.success || !project.folderPath) return
        const icon = await window.devscope.selectProjectIconFile()
        if (!icon.success || !icon.filePath) return
        updateSettings({ projectIconOverrides: { ...settings.projectIconOverrides, [project.folderPath]: icon.filePath } })
    }

    const rebuildIndex = async () => {
        if (roots.length === 0) return
        setIndexing(true)
        setIndexResult(null)
        try {
            const result = await window.devscope.indexAllFolders(roots, { forceRefresh: true })
            setIndexResult({
                success: result.success,
                projects: result.success ? result.indexedCount || 0 : 0,
                folders: result.success ? result.indexedFolders || 0 : roots.length,
                files: result.success ? result.indexedFiles || 0 : 0,
                error: result.success ? undefined : result.error
            })
        } catch (error) {
            setIndexResult({ success: false, projects: 0, folders: roots.length, files: 0, error: error instanceof Error ? error.message : 'Indexing failed.' })
        } finally {
            setIndexing(false)
        }
    }

    return (
        <SettingsPageContainer title="Projects" backTo="/settings/workspace" backLabel="Workspace">
            <SettingsSection title="Discovery locations">
                <SettingsRow
                    title="Main projects folder"
                    description="Primary bounded root used for project discovery and indexing."
                    status={settings.projectsFolder || 'No folder selected'}
                    statusTone={settings.projectsFolder ? 'muted' : 'warning'}
                    control={<div className="flex gap-2"><SettingsButton onClick={() => void chooseMainRoot()}><FolderOpen size={13} />{settings.projectsFolder ? 'Change' : 'Choose'}</SettingsButton>{settings.projectsFolder ? <SettingsButton variant="ghost" onClick={() => updateSettings({ projectsFolder: '' })}>Clear</SettingsButton> : null}</div>}
                />
                {settings.additionalFolders.map((folder) => (
                    <SettingsRow
                        key={folder}
                        title="Additional root"
                        description="An explicit secondary root. Zyra does not crawl outside configured roots."
                        status={folder}
                        control={<SettingsButton variant="ghost" onClick={() => updateSettings({ additionalFolders: settings.additionalFolders.filter((candidate) => candidate !== folder) })}><X size={13} />Remove</SettingsButton>}
                    />
                ))}
                <SettingsRow title="Additional roots" description="Add another explicit folder to project discovery." control={<SettingsButton onClick={() => void addRoot()}><FolderOpen size={13} />Add folder</SettingsButton>} />
            </SettingsSection>

            <SettingsSection title="Project catalog">
                <SettingsRow
                    title="New Project"
                    description="Creates a named Project with its own Zyra-managed home. Folders can be associated afterward."
                    control={(
                        <div className="flex items-center gap-2">
                            <input
                                value={newProjectName}
                                onChange={(event) => setNewProjectName(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter') void createEmptyProject()
                                }}
                                placeholder="Project name"
                                className="h-8 w-44 rounded-md border border-[var(--surface-divider)] bg-[var(--surface-panel)] px-2 text-xs text-sparkle-text-primary outline-none focus:border-[var(--accent-primary)]/45"
                            />
                            <SettingsButton onClick={() => void createEmptyProject()} disabled={!newProjectName.trim() || projectActionPending}>
                                <Plus size={13} />Create
                            </SettingsButton>
                        </div>
                    )}
                />
                {projectsLoading ? <SettingsNotice>Loading Project catalog…</SettingsNotice> : null}
                {projectsError ? <SettingsNotice tone="error">{projectsError}</SettingsNotice> : null}
                {catalog.projects.filter((project) => !project.archived).map((project) => (
                    <div key={project.id} className="contents">
                        <SettingsRow
                            title={project.name}
                            description={project.homePath}
                            status={`Revision ${project.revision} · ${project.folders.length} associated ${project.folders.length === 1 ? 'folder' : 'folders'}`}
                            control={(
                                <div className="flex flex-wrap justify-end gap-2">
                                    <SettingsButton variant="ghost" onClick={() => void window.devscope.openInExplorer(project.homePath)}>
                                        <FolderOpen size={13} />Open home
                                    </SettingsButton>
                                    <SettingsButton variant="ghost" onClick={() => void addAssociatedFolder(project.id, 'read-only')}>
                                        <FolderPlus size={13} />Add read only
                                    </SettingsButton>
                                    <SettingsButton onClick={() => void addAssociatedFolder(project.id, 'read-write')}>
                                        <FolderPlus size={13} />Add folder
                                    </SettingsButton>
                                    <SettingsButton variant="ghost" onClick={() => void updateProject({ projectId: project.id, archived: true })}>
                                        <Archive size={13} />Archive
                                    </SettingsButton>
                                </div>
                            )}
                        />
                        {project.folders.map((folder) => (
                            <SettingsRow
                                key={folder.associationId}
                                title={`↳ ${folder.label}`}
                                description={folder.path}
                                status={`${folder.access === 'read-only' ? 'Read only' : 'Read and write'}${folder.available ? '' : ' · Folder unavailable'}`}
                                statusTone={folder.available ? 'muted' : 'warning'}
                                control={(
                                    <SettingsButton
                                        variant="ghost"
                                        onClick={() => void removeFolder({ projectId: project.id, folderId: folder.folderId })}
                                    >
                                        <X size={13} />Detach
                                    </SettingsButton>
                                )}
                            />
                        ))}
                    </div>
                ))}
                {catalog.projects.filter((project) => !project.archived).length === 0 && !projectsLoading ? (
                    <SettingsNotice>No Projects yet. Create one here or review a detected folder below.</SettingsNotice>
                ) : null}
                {catalog.candidates.filter((candidate) => candidate.status === 'pending').map((candidate) => (
                    <SettingsRow
                        key={candidate.id}
                        title={candidate.suggestedName}
                        description={candidate.path}
                        status="Detected folder · Review required"
                        statusTone="warning"
                        control={(
                            <div className="flex gap-2">
                                <SettingsButton onClick={() => void importCandidate(candidate)}>Import</SettingsButton>
                                <SettingsButton variant="ghost" onClick={() => void dismissCandidate(candidate.id)}><X size={13} />Dismiss</SettingsButton>
                            </div>
                        )}
                    />
                ))}
                {catalog.projects.filter((project) => project.archived).map((project) => (
                    <SettingsRow
                        key={project.id}
                        title={project.name}
                        description="Archived Project. External folders and existing Chats were preserved."
                        status="Archived"
                        control={(
                            <SettingsButton variant="ghost" onClick={() => void updateProject({ projectId: project.id, archived: false })}>
                                <RotateCcw size={13} />Restore
                            </SettingsButton>
                        )}
                    />
                ))}
            </SettingsSection>

            <SettingsSection title="Indexing" headerAction={<SettingsButton variant="ghost" onClick={() => void rebuildIndex()} disabled={indexing || roots.length === 0}><RefreshCw size={12} className={indexing ? 'animate-spin' : ''} />Rebuild</SettingsButton>}>
                <SettingsRow title="Configured roots" description="Only these roots are eligible for recursive indexing." control={<span className="font-mono text-xs tabular-nums text-sparkle-text-secondary">{roots.length}</span>} />
                <SettingsRow title="Persistence" description="The file index is stored incrementally and reused after restart." control={<span className="text-xs font-medium text-sparkle-text-secondary">On disk</span>} />
                <SettingsRow title="Traversal boundary" description="Home, app-data, and drive roots are rejected as implicit scan targets." control={<span className="text-xs font-medium text-emerald-300">Bounded</span>} />
                {indexResult ? (
                    <SettingsNotice tone={indexResult.success ? 'success' : 'error'}>
                        {indexResult.success ? `Indexed ${indexResult.projects} projects, ${indexResult.files} files, and ${indexResult.folders} folders.` : indexResult.error || 'Indexing failed.'}
                    </SettingsNotice>
                ) : null}
            </SettingsSection>

            <ExplorerPreferencesSections />

            <SettingsSection title="Project icons" headerAction={<SettingsButton variant="ghost" onClick={() => void addIconOverride()}><Image size={12} />Add override</SettingsButton>}>
                <SettingsRow title="Automatic detection" description="Zyra checks declared app icons, manifests, favicons, and bounded workspace assets." control={<span className="text-xs font-medium text-sparkle-text-secondary">Enabled</span>} />
                {Object.entries(settings.projectIconOverrides).map(([projectPath, iconPath]) => (
                    <SettingsRow
                        key={projectPath}
                        title={<span className="inline-flex min-w-0 items-center gap-2"><ProjectIcon customIconPath={iconPath} projectType="unknown" size={20} className="shrink-0 overflow-hidden rounded" /><span className="truncate">{projectPath.split(/[\\/]/).filter(Boolean).at(-1) || projectPath}</span></span>}
                        description={projectPath}
                        status={iconPath}
                        control={<SettingsButton variant="ghost" onClick={() => {
                            const projectIconOverrides = { ...settings.projectIconOverrides }
                            delete projectIconOverrides[projectPath]
                            updateSettings({ projectIconOverrides })
                        }}><X size={13} />Remove</SettingsButton>}
                    />
                ))}
                {Object.keys(settings.projectIconOverrides).length === 0 ? <SettingsNotice>No manual overrides. Detected project icons remain active.</SettingsNotice> : null}
            </SettingsSection>
        </SettingsPageContainer>
    )
}
