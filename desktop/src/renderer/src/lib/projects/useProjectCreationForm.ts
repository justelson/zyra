import { useRef, useState } from 'react'
import type { AssistantProject } from '@shared/assistant/contracts'
import { addProjectDraftFolder, projectCreationCandidate, projectCreationInput, type ProjectCreationOptions } from './project-creation-draft'

export function useProjectCreationForm(options: ProjectCreationOptions, onCreated: (project: AssistantProject) => void) {
    const [name, setName] = useState(options.name || '')
    const [folders, setFolders] = useState(options.folderPaths || [])
    const [folderDraft, setFolderDraft] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState<'browse' | 'create' | null>(null)
    const operation = useRef(false)

    const addFolder = (path: string) => {
        try {
            setFolders(addProjectDraftFolder(folders, path))
            setFolderDraft('')
            setError(null)
        } catch (error) {
            setError(error instanceof Error ? error.message : 'Could not add folder.')
        }
    }

    const browse = async () => {
        if (operation.current) return
        operation.current = true
        setBusy('browse')
        setError(null)
        try {
            const result = await window.devscope.selectFolder()
            if (!result.success) throw new Error(result.error || 'Could not choose a folder.')
            if (!result.cancelled && result.folderPath) addFolder(result.folderPath)
        } catch (error) {
            setError(error instanceof Error ? error.message : 'Could not choose a folder.')
        } finally {
            operation.current = false
            setBusy(null)
        }
    }

    const submit = async () => {
        if (operation.current) return
        // Do not silently discard a path the user has typed but not yet added.
        if (folderDraft.trim()) {
            setError('Add the folder path to the list, or clear it before creating the Project.')
            return
        }
        operation.current = true
        setBusy('create')
        setError(null)
        try {
            const input = projectCreationInput(name, folders)
            const result = await window.devscope.assistant.createProject(input, projectCreationCandidate(options, folders))
            if (!result.success) throw new Error(result.error || 'Could not create Project.')
            onCreated(result.project)
        } catch (error) {
            setError(error instanceof Error ? error.message : 'Could not create Project.')
        } finally {
            operation.current = false
            setBusy(null)
        }
    }

    return {
        name, setName, folders, folderDraft, setFolderDraft, error, busy, addFolder, browse, submit,
        removeFolder: (path: string) => { setFolders((current) => current.filter((entry) => entry !== path)); setError(null) }
    }
}
