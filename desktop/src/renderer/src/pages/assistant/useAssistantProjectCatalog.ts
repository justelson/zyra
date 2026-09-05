import { useCallback, useEffect, useRef, useState } from 'react'
import { PROJECT_CATALOG_CHANGED } from '@/lib/projects/project-catalog-events'
import type {
    AssistantAssociateProjectFolderInput,
    AssistantCreateProjectInput,
    AssistantProject,
    AssistantProjectCatalog,
    AssistantProjectMigrationCandidate,
    AssistantRemoveProjectFolderInput,
    AssistantUpdateProjectInput
} from '@shared/assistant/contracts'

const EMPTY_CATALOG: AssistantProjectCatalog = {
    migrationVersion: 0,
    projects: [],
    candidates: []
}

export function useAssistantProjectCatalog() {
    const [catalog, setCatalog] = useState<AssistantProjectCatalog>(EMPTY_CATALOG)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const requestRevision = useRef(0)

    const refresh = useCallback(async () => {
        const revision = ++requestRevision.current
        setLoading(true)
        try {
            const result = await window.devscope.assistant.listProjects()
            if (!result.success) throw new Error(result.error || 'Could not load Projects.')
            if (revision === requestRevision.current) {
                setCatalog(result.catalog)
                setError(null)
            }
            return result.catalog
        } catch (refreshError) {
            if (revision === requestRevision.current) setError(refreshError instanceof Error ? refreshError.message : 'Could not load Projects.')
            return null
        } finally {
            if (revision === requestRevision.current) setLoading(false)
        }
    }, [])

    useEffect(() => {
        void refresh()
        const changed = () => { void refresh() }
        window.addEventListener(PROJECT_CATALOG_CHANGED, changed)
        return () => {
            requestRevision.current += 1
            window.removeEventListener(PROJECT_CATALOG_CHANGED, changed)
        }
    }, [refresh])

    const importCandidate = useCallback(async (
        candidate: AssistantProjectMigrationCandidate
    ): Promise<AssistantProject | null> => {
        const result = await window.devscope.assistant.createProject({
            name: candidate.suggestedName,
            folderPath: candidate.path,
            folderAccess: 'read-write'
        }, candidate.id)
        if (!result.success) {
            setError(result.error || 'Could not create Project.')
            return null
        }
        await refresh()
        return result.project
    }, [refresh])

    const createProject = useCallback(async (input: AssistantCreateProjectInput): Promise<AssistantProject | null> => {
        const result = await window.devscope.assistant.createProject(input)
        if (!result.success) {
            setError(result.error || 'Could not create Project.')
            return null
        }
        await refresh()
        return result.project
    }, [refresh])

    const associateFolder = useCallback(async (input: AssistantAssociateProjectFolderInput): Promise<AssistantProject | null> => {
        const result = await window.devscope.assistant.associateProjectFolder(input)
        if (!result.success) {
            setError(result.error || 'Could not associate folder.')
            return null
        }
        await refresh()
        return result.project
    }, [refresh])

    const removeFolder = useCallback(async (input: AssistantRemoveProjectFolderInput): Promise<AssistantProject | null> => {
        const result = await window.devscope.assistant.removeProjectFolder(input)
        if (!result.success) {
            setError(result.error || 'Could not remove folder association.')
            return null
        }
        await refresh()
        return result.project
    }, [refresh])

    const dismissCandidate = useCallback(async (candidateId: string): Promise<boolean> => {
        const result = await window.devscope.assistant.dismissProjectCandidate({ candidateId })
        if (!result.success) {
            setError(result.error || 'Could not dismiss detected folder.')
            return false
        }
        await refresh()
        return true
    }, [refresh])

    const updateProject = useCallback(async (input: AssistantUpdateProjectInput): Promise<AssistantProject | null> => {
        const result = await window.devscope.assistant.updateProject(input)
        if (!result.success) {
            setError(result.error || 'Could not update Project.')
            return null
        }
        await refresh()
        return result.project
    }, [refresh])

    return {
        catalog,
        loading,
        error,
        refresh,
        importCandidate,
        createProject,
        associateFolder,
        removeFolder,
        dismissCandidate,
        updateProject
    }
}
