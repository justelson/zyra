export type AssistantProjectFolderAccess = 'read-only' | 'read-write'

export interface AssistantProjectFolder {
    associationId: string
    folderId: string
    projectId: string
    path: string
    label: string
    access: AssistantProjectFolderAccess
    available: boolean
    createdAt: string
    updatedAt: string
}

export interface AssistantProject {
    id: string
    name: string
    homePath: string
    archived: boolean
    revision: number
    folders: AssistantProjectFolder[]
    createdAt: string
    updatedAt: string
}

export type AssistantChatScopeRoot = {
    id: string
    kind: 'project-home' | 'associated-folder'
    path: string
    label: string
    access: AssistantProjectFolderAccess
}

export interface AssistantChatScope {
    projectId: string
    revision: number
    workingRoot: string
    roots: AssistantChatScopeRoot[]
    createdAt: string
    updatedAt: string
}

export interface AssistantProjectMigrationCandidate {
    id: string
    path: string
    suggestedName: string
    status: 'pending' | 'imported' | 'dismissed'
    projectId: string | null
    detectedAt: string
    updatedAt: string
}

export interface AssistantProjectCatalog {
    migrationVersion: number
    projects: AssistantProject[]
    candidates: AssistantProjectMigrationCandidate[]
}

export interface AssistantCreateProjectFolderInput {
    path: string
    access?: AssistantProjectFolderAccess
}

export interface AssistantCreateProjectInput {
    name?: string
    folderPath?: string
    folderAccess?: AssistantProjectFolderAccess
    /** When supplied, replaces the legacy folderPath/folderAccess selection. */
    folders?: AssistantCreateProjectFolderInput[]
}

export interface AssistantSetSessionProjectInput {
    projectId: string | null
    workingRoot?: string | null
}

export interface AssistantAssociateProjectFolderInput {
    projectId: string
    path: string
    access: AssistantProjectFolderAccess
}

export interface AssistantRemoveProjectFolderInput {
    projectId: string
    folderId: string
}

export interface AssistantDismissProjectCandidateInput {
    candidateId: string
}

export interface AssistantUpdateProjectInput {
    projectId: string
    name?: string
    archived?: boolean
}
