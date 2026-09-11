/** App integrations only. Runtime capability evidence remains a separate, stricter gate. */
export type ProviderFeatures = {
    id: string
    label: string
    authentication: readonly ('subscription' | 'api-key')[]
    voice: 'chatgpt' | null
    subscriptionUsage: boolean
    modelDiscovery: 'catalog' | 'endpoint'
}
const catalog: Record<string, ProviderFeatures> = {
    'openai-codex': { id: 'openai-codex', label: 'ChatGPT', authentication: ['subscription'], voice: 'chatgpt', subscriptionUsage: true, modelDiscovery: 'catalog' },
    openai: { id: 'openai', label: 'OpenAI API', authentication: ['api-key'], voice: null, subscriptionUsage: false, modelDiscovery: 'catalog' },
    opencode: { id: 'opencode', label: 'OpenCode Zen', authentication: ['api-key'], voice: null, subscriptionUsage: false, modelDiscovery: 'endpoint' },
    anthropic: { id: 'anthropic', label: 'Claude API', authentication: ['api-key'], voice: null, subscriptionUsage: false, modelDiscovery: 'endpoint' }
}
export const RECOMMENDED_PROVIDER = 'openai-codex'
export function providerFeatures(provider: string): ProviderFeatures {
    return catalog[provider] || { id: provider, label: 'Custom endpoint', authentication: ['api-key'], voice: null, subscriptionUsage: false, modelDiscovery: 'endpoint' }
}
export function providerForAppFeature(feature: 'voice' | 'subscriptionUsage'): string {
    return Object.values(catalog).find(provider => feature === 'voice' ? provider.voice !== null : provider.subscriptionUsage)!.id
}
