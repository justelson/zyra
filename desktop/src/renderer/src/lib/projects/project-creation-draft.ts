import type { AssistantCreateProjectInput } from '@shared/assistant/contracts'

export const PROJECT_CREATION_FOLDER_LIMIT = 32

export type ProjectCreationOptions = {
    name?: string
    folderPaths?: string[]
    candidateId?: string
    candidatePath?: string
}

export function projectFolderKey(value: string): string {
    const normalized = value.trim().replace(/\\/g, '/').replace(/\/+$/, '')
    return /^[a-z]:/i.test(normalized) || normalized.startsWith('//') ? normalized.toLowerCase() : normalized
}

export function addProjectDraftFolder(paths: string[], value: string): string[] {
    const path = value.trim()
    if (!path) throw new Error('Enter a folder path or choose Browse.')
    if (paths.some((entry) => projectFolderKey(entry) === projectFolderKey(path))) {
        throw new Error('That folder is already included.')
    }
    if (paths.length >= PROJECT_CREATION_FOLDER_LIMIT) throw new Error(`A Project can include up to ${PROJECT_CREATION_FOLDER_LIMIT} folders.`)
    return [...paths, path]
}

export function projectCreationInput(name: string, paths: string[]): AssistantCreateProjectInput {
    const normalizedName = name.replace(/\s+/g, ' ').trim()
    if (!normalizedName) throw new Error('Enter a project name.')
    if (normalizedName.length > 120) throw new Error('Project names can have up to 120 characters.')
    const folders = paths.reduce<string[]>((result, path) => addProjectDraftFolder(result, path), [])
    return { name: normalizedName, folders: folders.map((path) => ({ path, access: 'read-write' })) }
}

export function projectCreationCandidate(options: ProjectCreationOptions, paths: string[]): string | undefined {
    return options.candidateId && options.candidatePath
        && paths.some((path) => projectFolderKey(path) === projectFolderKey(options.candidatePath!))
        ? options.candidateId : undefined
}
