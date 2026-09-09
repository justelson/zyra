import type { AssistantProject } from '@shared/assistant/contracts'

export type AssistantProjectChoice = {
    projectId: string
    label: string
    iconSourcePath: string | null
}

export function getAssistantProjectIconSourcePath(project: AssistantProject | null | undefined): string | null {
    // The catalog's first associated folder supplies the Project identity icon.
    // A folderless Project keeps the existing home/folder fallback.
    return project?.folders[0]?.path || project?.homePath || null
}

export function buildAssistantProjectChoices(projects: readonly AssistantProject[]): AssistantProjectChoice[] {
    return projects.filter(project => !project.archived).map(project => ({
        projectId: project.id,
        label: project.name,
        iconSourcePath: getAssistantProjectIconSourcePath(project)
    }))
}
