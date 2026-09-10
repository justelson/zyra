export type SettingsPageSection = { id: string; label: string }

export function readSettingsPageSections(root: ParentNode & Node): SettingsPageSection[] {
    const seen = new Set<string>()
    return [...root.querySelectorAll<HTMLElement>('section[data-settings-search-target]')].flatMap(section => {
        const id = section.getAttribute('data-settings-search-target') || ''
        const label = (section.querySelector('h2')?.textContent || section.getAttribute('aria-label') || '').trim()
        const hiddenAncestor = section.closest('[hidden], [aria-hidden="true"], [inert]')
        if (!/^settings-section-[a-z0-9-]+$/.test(id) || !label || seen.has(id)
            || hiddenAncestor && root.contains(hiddenAncestor)) return []
        seen.add(id)
        return [{ id, label }]
    })
}

export function sameSettingsPageSections(left: SettingsPageSection[], right: SettingsPageSection[]): boolean {
    return left.length === right.length && left.every((section, index) => section.id === right[index]?.id && section.label === right[index]?.label)
}
