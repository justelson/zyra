import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

const noop = () => {}
let pool: any = { snapshot: null, busy: false, error: null, refresh: noop, update: noop }
const connection: any = {
    desktopHost: true, connectionError: null, connectionAction: null, connectionBusy: false,
    chatGptConnection: { configured: true, verified: true }, apiKeyConnection: { configured: false },
    activeDefaultMethod: 'chatgpt', apiKeyDialogOpen: false, apiKeyDraft: '', disconnectMethod: null,
    setApiKeyDialogOpen: noop, setApiKeyDraft: noop, setDisconnectMethod: noop, refreshAll: noop,
    connectChatGpt: noop, connectApiKey: noop, switchDefaultConnection: noop, disconnect: noop,
    settings: { assistantUsageDisplayMode: 'remaining' }, updateSettings: noop,
    overview: { rateLimitsByLimitId: {}, resetCredits: [], availableResetCount: 0, fetchedAt: '2026-10-07T12:00:00Z' },
    overviewLoading: false, overviewError: null, initialAccountLoading: false,
    loadOverview: noop, applyAccountOverview: noop,
    usageCards: [{id:'codex-week',bucketLabel:'Codex',durationLabel:'Weekly',percent:64,percentLabel:'64% remaining',resetSummary:'Resets tomorrow'}]
}
mock.module('../src/renderer/src/pages/settings/providers/useOpenAIAccountSettings', () => ({
    useOpenAIAccountSettings: () => connection, connectionStatusLabel: () => 'Connected', connectionStatusTone: () => 'ready'
}))
mock.module('../src/renderer/src/pages/settings/providers/useChatGptAccountPool', () => ({ useChatGptAccountPool: () => pool }))
// The owning pages and their real connection/usage rows are rendered; unrelated provider discovery is isolated.
mock.module('../src/renderer/src/pages/settings/ModelProviderConnections', () => ({ ModelProviderConnections: ({children}: {children:ReactNode}) => <div>{children}</div> }))
const { default: ProviderConnections } = await import('../src/renderer/src/pages/settings/providers/ProviderConnections')
const { default: AccountSettings } = await import('../src/renderer/src/pages/settings/AccountSettings')
const render = (page: ReactNode) => renderToStaticMarkup(<MemoryRouter>{page}</MemoryRouter>)
for (const error of [null, 'Account pool unavailable']) {
    pool = {...pool, snapshot:null, error}
    assert.match(render(<ProviderConnections/>), /Manage ChatGPT connection/, 'Legacy configured account keeps its management control without a pool snapshot')
    const limits = render(<AccountSettings/>)
    assert.match(limits, /64% remaining/, 'Legacy usage stays visible when the pool API is unsupported or fails')
    assert.match(limits, /Weekly/, 'Legacy usage window is retained')
    assert.doesNotMatch(limits, /Checking usage|ChatGPT usage rules/, 'No unusable pool placeholders replace successful legacy data')
}
pool = {...pool, error:null, snapshot:{accounts:[],policy:{strategy:'balanced',accountMode:'all',accountIds:[]}}}
assert.doesNotMatch(render(<ProviderConnections/>), /Manage ChatGPT connection/, 'An authoritative pool snapshot disables the legacy row')
const limits = render(<AccountSettings/>)
assert.match(limits, /Connect a ChatGPT account/, 'An authoritative empty pool uses the new empty state')
assert.doesNotMatch(limits, /64% remaining/, 'Legacy limits never duplicate an authoritative pool')
console.log('PASS: real Providers and Limits pages preserve legacy accounts/data only without an authoritative pool snapshot')
