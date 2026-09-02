const RETIRED_PERMISSION_STORAGE_KEYS = [
    'zyra:browser-control-approval-preferences:v1',
    'zyra-ui:full-access-confirm-suppressed:v1'
] as const

/** Remove permission memories retired by the shared, chat-owned mode policy. */
export function clearRetiredAssistantPermissionPreferences(storage: Pick<Storage, 'removeItem'> = localStorage): void {
    try {
        for (const key of RETIRED_PERMISSION_STORAGE_KEYS) storage.removeItem(key)
    } catch {
        // Permission behavior must remain usable when renderer storage is unavailable.
    }
}
