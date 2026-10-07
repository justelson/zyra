type ProjectIdentity = {
    projectPath?: string | null
    projectId?: string | null
    workingRoot?: string | null
    chatScope?: { projectId: string; workingRoot: string } | null
}

/** A working folder provides file access; it does not assign a Project. */
export function resolveAssistantSessionProjectPath(session: ProjectIdentity): string {
    return session.projectPath?.trim()
        || (session.projectId || session.chatScope?.projectId
            ? session.chatScope?.workingRoot?.trim() || session.workingRoot?.trim() || ''
            : '')
}

/** Canonical storage identifies a CLI project, but must not reassign a known Desktop chat. */
export function resolveImportedAssistantProjectPath(input: {
    canonicalProjectPath: string | null
    existingSession?: ProjectIdentity
}): string | null {
    if (input.existingSession) return resolveAssistantSessionProjectPath(input.existingSession) || null
    return input.canonicalProjectPath
}
