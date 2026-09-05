export function resolveAssistantProjectLabel(
    name: string | null | undefined,
    projectId: string | null | undefined,
    path: string | null | undefined
): string {
    const label = String(name || '').trim()
    if (label) return label
    // Wait for the catalog name rather than showing a managed-home identifier.
    if (projectId) return ''
    const legacyName = String(path || '').split(/[\\/]/).filter(Boolean).at(-1) || ''
    return /^project_[0-9a-f-]{16,}$/i.test(legacyName) ? '' : legacyName
}
