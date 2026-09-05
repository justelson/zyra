export const PROJECT_CATALOG_CHANGED = 'zyra:project-catalog-changed'

export function notifyProjectCatalogChanged(): void {
    window.dispatchEvent(new Event(PROJECT_CATALOG_CHANGED))
}
