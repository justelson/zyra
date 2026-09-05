export interface CatalogModelIdentity {
    id: string
    provider?: string
}

/** Shared ordering for raw runtime models and provider-qualified UI selectors. */
export function sortModelsLatestFirst<T extends CatalogModelIdentity>(models?: readonly T[]): T[]

/** Highest versioned GPT entry in this catalog; null when release order is unknown. */
export function getLatestModelId(models?: readonly CatalogModelIdentity[]): string | null
