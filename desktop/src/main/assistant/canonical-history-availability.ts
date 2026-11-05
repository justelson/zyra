import type { AssistantHistoryPage } from '../../shared/assistant/contracts'

/** SQLite owns imported rows; the canonical cursor owns the unimported prefix. */
export function withCanonicalAssistantHistoryAvailability<T extends AssistantHistoryPage>(
    page: T,
    canonicalHasOlder: boolean,
    fallbackCursor?: string | null
): T {
    if (!canonicalHasOlder) return page
    return {
        ...page,
        pageInfo: { ...page.pageInfo, hasOlder: true, oldestCursor: page.pageInfo.oldestCursor || fallbackCursor || null }
    }
}
