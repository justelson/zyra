import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { AssistantProject } from '@shared/assistant/contracts'
import { ProjectCreationDialog } from '@/components/projects/ProjectCreationDialog'
import { notifyProjectCatalogChanged } from './project-catalog-events'
import { projectFolderKey, type ProjectCreationOptions } from './project-creation-draft'

type RequestProjectCreation = (options?: ProjectCreationOptions) => Promise<AssistantProject | null>
type PendingCreation = {
    options: ProjectCreationOptions
    promise: Promise<AssistantProject | null>
    resolve: (project: AssistantProject | null) => void
}
const ProjectCreationContext = createContext<RequestProjectCreation | null>(null)

export function ProjectCreationProvider({ children }: { children: ReactNode }) {
    const pendingRef = useRef<PendingCreation | null>(null)
    const [pending, setPending] = useState<PendingCreation | null>(null)
    const request = useCallback<RequestProjectCreation>((options = {}) => {
        if (pendingRef.current) return pendingRef.current.promise
        let resolve!: PendingCreation['resolve']
        const promise = new Promise<AssistantProject | null>((complete) => { resolve = complete })
        const next = { options, promise, resolve }
        pendingRef.current = next
        setPending(next)
        return promise
    }, [])
    const finish = useCallback((project: AssistantProject | null) => {
        const current = pendingRef.current
        if (!current) return
        pendingRef.current = null
        setPending(null)
        if (project) notifyProjectCatalogChanged()
        current.resolve(project)
    }, [])
    useEffect(() => () => {
        pendingRef.current?.resolve(null)
        pendingRef.current = null
    }, [])

    return <ProjectCreationContext.Provider value={request}>
        {children}
        {pending ? <ProjectCreationDialog options={pending.options} onCreated={(project) => finish(project)} onClose={() => finish(null)} /> : null}
    </ProjectCreationContext.Provider>
}

export function useProjectCreation(): RequestProjectCreation {
    const request = useContext(ProjectCreationContext)
    if (!request) throw new Error('Project creation requires its setup provider.')
    return request
}

// Preserve selecting an existing Project by folder. A previously unknown folder
// must pass through the same name-and-folders review as the New project action.
export async function chooseProjectFolder(request: RequestProjectCreation): Promise<{ project: AssistantProject; workingRoot: string } | null> {
    const selected = await window.devscope.selectFolder()
    if (!selected.success) throw new Error(selected.error || 'Could not choose a folder.')
    if (selected.cancelled || !selected.folderPath) return null
    const folderPath = selected.folderPath
    const catalog = await window.devscope.assistant.listProjects()
    if (!catalog.success) throw new Error(catalog.error || 'Could not load Projects.')
    const existing = catalog.catalog.projects.find((project) => !project.archived && (
        projectFolderKey(project.homePath) === projectFolderKey(folderPath)
        || project.folders.some((folder) => projectFolderKey(folder.path) === projectFolderKey(folderPath))
    ))
    if (existing) return { project: existing, workingRoot: folderPath }
    const project = await request({ name: folderPath.split(/[\\/]/).filter(Boolean).at(-1), folderPaths: [folderPath] })
    if (!project) return null
    return { project, workingRoot: project.folders.find((folder) => projectFolderKey(folder.path) === projectFolderKey(folderPath))?.path || project.homePath }
}
