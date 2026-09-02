export const ASSISTANT_COMPOSER_USAGE_VISIBILITY_STORAGE_KEY = 'zyra-ui:assistant-composer-context-usage-visible:v1'
export const ASSISTANT_COMPOSER_USAGE_VISIBILITY_EVENT = 'zyra:assistant-composer-context-usage-visibility-changed'

type UsageVisibilityStorage = Pick<Storage, 'getItem' | 'setItem'>

function resolveUsageVisibilityStorage(storage?: UsageVisibilityStorage): UsageVisibilityStorage | null {
    if (storage) return storage
    if (typeof window === 'undefined') return null
    try {
        return window.localStorage
    } catch {
        return null
    }
}

export function readAssistantComposerUsageVisibility(storage?: UsageVisibilityStorage): boolean {
    try {
        return resolveUsageVisibilityStorage(storage)?.getItem(ASSISTANT_COMPOSER_USAGE_VISIBILITY_STORAGE_KEY) === 'true'
    } catch {
        return false
    }
}

export function setAssistantComposerUsageVisibility(
    visible: boolean | null,
    storage?: UsageVisibilityStorage
): boolean {
    const targetStorage = resolveUsageVisibilityStorage(storage)
    const nextVisible = visible ?? !readAssistantComposerUsageVisibility(targetStorage || undefined)
    try {
        targetStorage?.setItem(ASSISTANT_COMPOSER_USAGE_VISIBILITY_STORAGE_KEY, String(nextVisible))
    } catch {
        // Keep the current window responsive when storage is unavailable.
    }
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent<boolean>(ASSISTANT_COMPOSER_USAGE_VISIBILITY_EVENT, {
            detail: nextVisible
        }))
    }
    return nextVisible
}

export function subscribeAssistantComposerUsageVisibility(listener: (visible: boolean) => void): () => void {
    if (typeof window === 'undefined') return () => undefined

    const handleVisibilityChange = (event: Event) => {
        const visible = event instanceof CustomEvent && typeof event.detail === 'boolean'
            ? event.detail
            : readAssistantComposerUsageVisibility()
        listener(visible)
    }
    const handleStorage = (event: StorageEvent) => {
        if (event.key !== ASSISTANT_COMPOSER_USAGE_VISIBILITY_STORAGE_KEY) return
        listener(event.newValue === 'true')
    }

    window.addEventListener(ASSISTANT_COMPOSER_USAGE_VISIBILITY_EVENT, handleVisibilityChange)
    window.addEventListener('storage', handleStorage)
    return () => {
        window.removeEventListener(ASSISTANT_COMPOSER_USAGE_VISIBILITY_EVENT, handleVisibilityChange)
        window.removeEventListener('storage', handleStorage)
    }
}
