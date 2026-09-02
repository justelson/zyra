import { useMemo, useState } from 'react'
import { FolderOpen, Image, RefreshCw, X } from 'lucide-react'
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

type IndexResult = { success: boolean; projects: number; folders: number; files: number; error?: string }

export default function ProjectsSettings() {
    const { settings, updateSettings } = useSettings()
    const [indexing, setIndexing] = useState(false)
    const [indexResult, setIndexResult] = useState<IndexResult | null>(null)
    const roots = useMemo(() => [settings.projectsFolder, ...settings.additionalFolders].filter((value) => value.trim()), [settings.additionalFolders, settings.projectsFolder])

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
            <SettingsSection title="Project roots">
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
