import assert from 'node:assert/strict'
import { connectWithStablePluginAuthority, PluginAuthorityMutations } from '../src/main/assistant/assistant-plugin-authority'

const changes = new PluginAuthorityMutations()
let finishMutation!: () => void
let sources = ['old-release']
let connected: string[] | null = null
const mutation = changes.run(['affected-chat'], async () => {
    await new Promise<void>((resolve) => { finishMutation = resolve })
    sources = []
})
await Promise.resolve()
const connection = connectWithStablePluginAuthority({
    getGeneration: () => changes.generation('affected-chat'),
    waitForSettled: () => changes.wait('affected-chat'),
    resolve: async () => sources.slice(),
    connect: async (resolved) => { connected = resolved },
    disconnect: () => { throw new Error('Stable connection should not be detached') }
})
await Promise.resolve()
assert.equal(connected, null, 'connections wait until registry and server revocation settle')
let unrelatedConnects = 0
await connectWithStablePluginAuthority({
    getGeneration: () => changes.generation('unrelated-chat'),
    waitForSettled: () => changes.wait('unrelated-chat'),
    resolve: async () => [],
    connect: async () => { unrelatedConnects += 1 },
    disconnect: () => { throw new Error('Unrelated Chat must not detach') }
})
assert.equal(unrelatedConnects, 1)
assert.equal(changes.generation('unrelated-chat'), 0)
finishMutation()
await Promise.all([mutation, connection])
assert.deepEqual(connected, [])

const order: string[] = []
const failed = changes.run(['affected-chat'], async () => { order.push('failed'); throw new Error('fixture failure') })
const next = changes.run(['affected-chat'], async () => { order.push('next') })
await assert.rejects(() => failed, /fixture failure/)
await next
await changes.wait('affected-chat')
assert.deepEqual(order, ['failed', 'next'], 'a failed mutation does not poison the queue or reorder enable/disable')
console.log('Plugin authority mutation ordering, affected-Chat barriers and unrelated connections: ok')
