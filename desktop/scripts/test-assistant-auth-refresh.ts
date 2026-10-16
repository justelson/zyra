import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { OpenAIConnectionService } from '../src/main/setup/openai-connection-service'

const refreshes: string[] = []
const pool = { accounts: [], policy: { strategy: 'balanced' as const, accountMode: 'all' as const, accountIds: [], preferredAccountId: null }, checkedAt: '2026-10-13T12:00:00Z' }

const service = new OpenAIConnectionService({
    openExternal: () => undefined,
    onCredentialChanged: async (provider) => { refreshes.push(provider) },
    loadSdk: async () => ({
        loginZyraAuth: async () => undefined,
        configureZyraOpenAIApiKey: async () => ({ model: 'openai/gpt-5.6-luna' }),
        verifyZyraOpenAIApiAuth: async () => ({ model: 'openai/gpt-5.6-luna' }),
        getZyraAuthStatus: async () => ({ status: { configured: false } }),
        removeZyraAuth: async () => undefined,
        getChatGptAccounts: async () => pool,
        updateChatGptAccounts: async () => pool
    }),
    loadAccount: async () => ({
        buildChatGptAccountStatus: async () => ({ status: { configured: true }, tokenExpiresAt: '2099-01-01T00:00:00.000Z' })
    })
})

assert.equal((await service.connectChatGpt()).verified, true)
assert.deepEqual(refreshes, ['openai-codex'], 'Desktop sign-in triggers a runtime auth refresh')
await service.updateChatGptAccounts({ action: 'alias', accountId: 'fixture', alias: 'Work account' })
assert.deepEqual(refreshes, ['openai-codex'], 'Changing display metadata never refreshes active chat credentials')
await service.updateChatGptAccounts({ action: 'primary', accountId: 'fixture' })
assert.deepEqual(refreshes, ['openai-codex', 'openai-codex'], 'Changing the actual primary account still refreshes credentials')

const setupSource = readFileSync(new URL('../src/main/setup/index.ts', import.meta.url), 'utf8')
assert.match(setupSource, /onCredentialChanged:[\s\S]{0,200}refreshAuthProvider\(provider\)/,
    'the real Desktop setup wires successful sign-ins to active chats')
const runtimeSource = readFileSync(new URL('../src/main/assistant/zyra-runtime.ts', import.meta.url), 'utf8')
assert.match(runtimeSource, /async refreshAuthProvider\(provider: string\)[\s\S]{0,700}request\('auth\.refresh', \{ provider \}\)/,
    'the active chat worker forwards the refresh to its live provider runtime')

console.log('Desktop sign-in refreshes attached chat credentials: ok')
