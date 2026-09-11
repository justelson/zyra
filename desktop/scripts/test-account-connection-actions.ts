import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const desktopRoot = resolve(import.meta.dirname, '..')
const account = readFileSync(resolve(desktopRoot, 'src/renderer/src/pages/settings/AccountSettings.tsx'), 'utf8')
const service = readFileSync(resolve(desktopRoot, 'src/main/setup/openai-connection-service.ts'), 'utf8')
const handlers = readFileSync(resolve(desktopRoot, 'src/main/ipc/handlers/setup-handlers.ts'), 'utf8')
const workerClient = readFileSync(resolve(desktopRoot, 'src/main/setup/provider-worker-client.ts'), 'utf8')
const narrowAuth = readFileSync(resolve(desktopRoot, '../src/desktop-openai-auth.mjs'), 'utf8')
const authWorker = readFileSync(resolve(desktopRoot, '../src/desktop-provider-worker.mjs'), 'utf8')
const browser = readFileSync(resolve(desktopRoot, 'src/renderer/src/lib/browser-devscope-adapter.ts'), 'utf8')
const settings = readFileSync(resolve(desktopRoot, 'src/renderer/src/lib/settings.tsx'), 'utf8')

assert.match(account, /connectChatGpt/)
assert.match(account, /connectApiKey/)
assert.match(account, /switchDefaultConnection/)
assert.match(account, /await updateSettings\(\{ assistantDefaultModel: target\.id \}\)/, 'connection switching waits for main-owned preference persistence before another account mutation')
assert.match(settings, /updateSettings: \(partial: Partial<Settings>\) => Promise<void>/, 'callers can await main-owned settings writes')
assert.match(account, /disconnectOpenAI\(\{ method: disconnectMethod, confirmed: true \}\)/)
assert.match(account, /Use for new chats/)
assert.match(account, /without changing existing chats/)
assert.match(account, /<ConfirmModal/)
assert.doesNotMatch(account, /window\.confirm/)
assert.match(account, /Open Zyra Desktop on this computer to connect, replace, switch, or disconnect/)
assert.match(service, /getConnectionsStatus/)
assert.match(service, /removeZyraAuth/)
assert.match(service, /desktop-openai-auth\.mjs/)
assert.doesNotMatch(service, /src\/zyra-sdk\.mjs/, 'Desktop connection checks must not synchronously import the full Pi runtime')
assert.match(service, /includeUsage: false, refreshCredential: false/, 'onboarding checks must avoid the account-usage network path')
assert.match(workerClient, /node:worker_threads/)
assert.match(workerClient, /ProviderWorkerClient/)
assert.match(workerClient, /getSharedProviderWorkerClient/, 'account and Voice paths must share one unrefed auth worker')
assert.match(authWorker, /buildChatGptAccountStatus/)
assert.match(authWorker, /case "resolveChatGptAccountAuth"[\s\S]{0,100}resolveChatGptAccountAuth\(\)/, 'Voice credential resolution must stay in the auth worker')
assert.match(narrowAuth, /createZyraAuthStorage/, 'Desktop auth uses Zyraâ€™s supported Pi ModelRuntime boundary')
assert.doesNotMatch(narrowAuth, /zyra-sdk/, 'narrow Desktop auth must stay independent from the full runtime')
assert.match(handlers, /ONBOARDING_IPC\.disconnectOpenAI/)
assert.match(handlers, /input\?\.confirmed !== true/)
assert.match(handlers, /CONFIRMATION_REQUIRED/)
assert.match(browser, /disconnectOpenAI: \(\) => unavailable\('OpenAI account changes require Zyra Desktop\.'/)

const { configureZyraOpenAIApiKey, loginZyraAuth } = await import(pathToFileURL(resolve(desktopRoot, '../src/desktop-openai-auth.mjs')).href)
const configuredApiProviders: Array<{ provider: string; credential: unknown }> = []
const apiVerification = await configureZyraOpenAIApiKey('test-openai-key', {
    authStorage: {
        set(provider: string, credential: unknown) { configuredApiProviders.push({ provider, credential }) }
    },
    fetch: async () => ({
        ok: true,
        status: 200,
        body: { cancel: async () => undefined }
    })
})
assert.equal(apiVerification.model, 'openai/gpt-5.6-luna', 'Desktop API-key verification returns the concrete model that onboarding can persist')
assert.equal(configuredApiProviders[0]?.provider, 'openai')

let oauthCallbackContractChecked = false
await loginZyraAuth('openai-codex', {
    authStorage: {
        async login(provider: string, callbacks: Record<string, unknown>) {
            assert.equal(provider, 'openai-codex')
            assert.equal(typeof callbacks.onSelect, 'function', 'Desktop OAuth must choose the browser flow through Pi’s current callback contract')
            assert.equal(typeof callbacks.onDeviceCode, 'function')
            assert.equal(typeof callbacks.onManualCodeInput, 'function')
            const selected = await (callbacks.onSelect as (prompt: { options: Array<{ id: string; label: string }> }) => Promise<string | undefined>)({
                options: [
                    { id: 'browser', label: 'Browser login (default)' },
                    { id: 'device_code', label: 'Device code login (headless)' }
                ]
            })
            assert.equal(selected, 'browser')
            oauthCallbackContractChecked = true
        },
        getAuthStatus: () => ({ configured: true })
    }
})
assert.equal(oauthCallbackContractChecked, true)

console.log('account connection actions: ok')
