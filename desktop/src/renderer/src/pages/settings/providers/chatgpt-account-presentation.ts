import type { ChatGptAccountProfile, ChatGptRoutingPolicy } from '@shared/onboarding/contracts'
import type { useChatGptAccountPool } from './useChatGptAccountPool'

export const accountStates = { ready: 'Ready', limited: 'Limited', paused: 'Paused', 'needs-sign-in': 'Sign in again' }
export const accountLabel = (account: ChatGptAccountProfile) => account.email || `Account ${account.id.slice(0, 6)}`
export function accountPlan(account: ChatGptAccountProfile) {
    return (account.plan || 'ChatGPT').replace(/[_-]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase())
}
export function saveRoutingPolicy(pool: ReturnType<typeof useChatGptAccountPool>, patch: Partial<ChatGptRoutingPolicy>) {
    if (!pool.snapshot) return
    const { policy, accounts } = pool.snapshot
    const ids = new Set(accounts.map(account => account.id))
    void pool.update({ action: 'policy', policy: {
        ...policy,
        accountIds: policy.accountIds.filter(id => ids.has(id)),
        preferredAccountId: policy.preferredAccountId && ids.has(policy.preferredAccountId) ? policy.preferredAccountId : null,
        ...patch
    } })
}
