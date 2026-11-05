export type AssistantCanonicalHistoryWindow = {
    before: string | null
    hasOlder: boolean
    modifiedAt: string
    entryCount: number
}

export function parseAssistantCanonicalHistoryWindow(value: unknown): AssistantCanonicalHistoryWindow | null {
    if (!value || typeof value !== 'object') return null
    const record = value as Record<string, unknown>
    if (typeof record.hasOlder !== 'boolean' || typeof record.modifiedAt !== 'string'
        || !Number.isSafeInteger(record.entryCount) || Number(record.entryCount) < 0
        || record.before !== null && typeof record.before !== 'string'
        || record.hasOlder && !record.before) return null
    return record as AssistantCanonicalHistoryWindow
}
