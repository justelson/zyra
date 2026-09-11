import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import type { Worker } from 'node:worker_threads'
import { OpenAIAuthWorkerClient } from '../src/main/setup/openai-auth-worker-client'
import { ZyraAccountService } from '../src/main/assistant/zyra-account-service'

const credit = { id: 'fixture-credit', title: 'Fixture reset', status: 'available', expiresAt: '2099-01-01T00:00:00.000Z' }
let consumed = false, created = 0
const operations: string[] = []
class WorkerFixture extends EventEmitter {
    unref() {}
    async terminate() { return 0 }
    postMessage(message: { id: number; operation: string }) {
        operations.push(message.operation)
        let result: unknown
        if (message.operation === 'buildChatGptAccountStatus') result = { provider: 'openai-codex', status: { configured: true }, usage: { primary: { usedPercent: 25 } } }
        else if (message.operation === 'fetchCodexResetCredits') result = { credits: [{ ...credit, status: consumed ? 'redeemed' : 'available' }] }
        else throw Error('Only account reads belong in this worker test')
        queueMicrotask(() => this.emit('message', { type: 'result', id: message.id, result }))
    }
}
const client = new OpenAIAuthWorkerClient(() => { created++; return new WorkerFixture() as unknown as Worker })
const service = new ZyraAccountService(async () => ({
    ...client.account,
    redeemCodexResetCredit: async (creditId: string) => {
        assert.equal(creditId, credit.id); consumed = true; operations.push('consume-on-main')
        return { code: 'reset', windowsReset: 1 }
    }
}))
try {
    const overview = await service.getOverview()
    assert.equal(overview.requiresOpenaiAuth, false)
    assert.equal(overview.availableResetCount, 1)
    assert.equal(overview.rateLimits?.primary?.usedPercent, 25)
    assert.deepEqual(operations, ['buildChatGptAccountStatus', 'fetchCodexResetCredits'])
    await assert.rejects(() => service.redeemAccountReset({ creditId: credit.id, confirmed: false }), /Confirm/)
    assert.equal(consumed, false)
    operations.length = 0
    const result = await service.redeemAccountReset({ creditId: credit.id, confirmed: true })
    assert.deepEqual(operations, ['fetchCodexResetCredits', 'consume-on-main', 'buildChatGptAccountStatus', 'fetchCodexResetCredits'], 'fresh availability, original mutation owner, then refreshed account data')
    assert.equal(result.redemption.windowsReset, 1)
    assert.equal(result.overview?.availableResetCount, 0)
    assert.equal(result.refreshError, null)
    operations.length = 0
    await assert.rejects(() => service.redeemAccountReset({ creditId: credit.id, confirmed: true }), /no longer available/)
    assert.deepEqual(operations, ['fetchCodexResetCredits'], 'a used credit cannot be consumed again')
    assert.equal(created, 1, 'overview and reset reads reuse the same auth worker')
} finally { await client.dispose() }
const serviceSource = readFileSync(new URL('../src/main/assistant/zyra-account-service.ts', import.meta.url), 'utf8')
const loaderSource = serviceSource.split('async function loadChatGptAccountModule()')[1]!.split('export class ZyraAccountService')[0]!
assert.match(loaderSource, /const \{ account \} = getSharedProviderWorkerClient\(\)/)
assert.match(loaderSource, /buildChatGptAccountStatus: account\.buildChatGptAccountStatus/)
assert.match(loaderSource, /fetchCodexResetCredits: account\.fetchCodexResetCredits/)
assert.match(loaderSource, /redeemCodexResetCredit: redeemResetOnMain/, 'mutation remains on its existing main-owned path')
assert.doesNotMatch(loaderSource, /import\(|chatgpt-account\.mjs/, 'merely opening Account cannot import the model/auth runtime in main')
const workerSource = readFileSync(new URL('../../src/desktop-provider-worker.mjs', import.meta.url), 'utf8')
assert.match(workerSource, /case "fetchCodexResetCredits":\s*return fetchCodexResetCredits\(/)
assert.doesNotMatch(workerSource, /redeemCodexResetCredit/, 'a worker exit cannot lose the result of a reset POST')
console.log('Account worker transport: shared read worker, unchanged mutation owner, confirmation/fresh availability and single consumption: ok')
