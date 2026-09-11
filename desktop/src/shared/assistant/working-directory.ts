type WorkingDirectorySource = { workingRoot?: string | null; projectPath?: string | null; cwd?: string | null }

/** Old projectless chats persisted an app-owned scratch directory as their cwd. */
export function isAssistantInternalWorkspace(value?: string | null): boolean {
    return /(?:^|\/)assistant\/global-workspace(?:\/|$)/i.test(String(value || '').replace(/\\/g, '/'))
}

export function resolveAssistantWorkingDirectory(source: WorkingDirectorySource, projectsFolder?: string | null): string | null {
    const explicit = source.workingRoot?.trim() || source.projectPath?.trim()
    if (explicit) return explicit
    const cwd = source.cwd?.trim()
    if (cwd && !isAssistantInternalWorkspace(cwd)) return cwd
    return projectsFolder?.trim() || cwd || null
}
