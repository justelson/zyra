import type { ChatGptPoolSnapshot } from '@shared/onboarding/contracts'

const eventName = 'zyra:chatgpt-accounts-updated'
export function publishChatGptAccounts(pool: ChatGptPoolSnapshot) {
    window.dispatchEvent(new CustomEvent(eventName, { detail: pool }))
}
export function subscribeChatGptAccounts(listener: (pool: ChatGptPoolSnapshot) => void) {
    const handle = (event: Event) => listener((event as CustomEvent<ChatGptPoolSnapshot>).detail)
    window.addEventListener(eventName, handle)
    return () => window.removeEventListener(eventName, handle)
}
export async function renameChatGptAccount(accountId: string, alias: string) {
    const result = await window.devscope.onboarding.updateChatGptAccounts({ action: 'alias', accountId, alias })
    if (!result.success) throw new Error('Could not save account name.')
    publishChatGptAccounts(result.pool)
    return true
}
