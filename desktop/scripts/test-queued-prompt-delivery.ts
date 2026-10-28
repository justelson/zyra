import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { QueuedPromptDeliveryOwner, type QueuedPromptDeliveryResult } from '../src/main/assistant/queued-prompt-delivery'

const root = await mkdtemp(join(tmpdir(), 'zyra-queued-delivery-'))
let passed = 0
const input = { sessionId: 'session-a', entryId: 'queue-a', payload: { prompt: 'PRIVATE SYNTHETIC PROMPT', images: ['PRIVATE SYNTHETIC IMAGE'] } }
const result: QueuedPromptDeliveryResult = { success: true, sessionId: input.sessionId, threadId: 'thread-original', turnId: 'turn-original' }
const filename = (value = input) => `${createHash('sha256').update(JSON.stringify([value.sessionId, value.entryId])).digest('hex')}.json`
const deferred = () => {
    let resolve!: () => void
    const promise = new Promise<void>(done => { resolve = done })
    return { promise, resolve }
}
async function test(name: string, body: (directory: string) => Promise<void>): Promise<void> {
    const directory = join(root, String(passed))
    await mkdir(directory)
    await body(directory)
    passed++
    console.log(`PASS ${name}`)
}
try {
    await test('simultaneous identical calls share one actual dispatch and original receipt', async directory => {
        const owner = new QueuedPromptDeliveryOwner(directory)
        const started = deferred(), release = deferred()
        let calls = 0
        const first = owner.run(input, async mark => { calls++; started.resolve(); await release.promise; mark(); return result })
        const second = owner.run({ ...input, payload: { images: input.payload.images, prompt: input.payload.prompt } }, async () => { throw new Error('duplicate dispatch') })
        assert.equal(first, second)
        assert.equal(owner.pendingCount, 1)
        await started.promise
        release.resolve()
        assert.deepEqual(await first, result)
        assert.deepEqual(await second, result)
        assert.equal(calls, 1)
        assert.equal(owner.pendingCount, 0)
        const replay = await new QueuedPromptDeliveryOwner(directory).run(input, async () => { throw new Error('restart redispatch') })
        assert.deepEqual(replay, result)
        const files = await readdir(directory)
        assert.deepEqual(files, [filename()])
        const raw = await readFile(join(directory, files[0]), 'utf8')
        assert.equal(raw.includes(input.payload.prompt), false)
        assert.equal(raw.includes(input.payload.images[0]), false)
        assert.match(JSON.parse(raw).payloadHash, /^[a-f0-9]{64}$/)
    })
    await test('Chat-scoped Stop preserves another Chat delivery', async directory => {
        const owner = new QueuedPromptDeliveryOwner(directory)
        const aStarted = deferred(), bStarted = deferred(), release = deferred()
        const first = owner.run(input, async mark => { aStarted.resolve(); await release.promise; mark(); return result })
        const stopped = assert.rejects(first, /cancelled before dispatch/)
        const other = owner.run({ ...input, sessionId: 'session-b' }, async mark => {
            bStarted.resolve(); await release.promise; mark(); return { ...result, sessionId: 'session-b' }
        })
        await Promise.all([aStarted.promise, bStarted.promise])
        owner.cancelPending(input.sessionId)
        release.resolve()
        await stopped
        assert.equal((await other).sessionId, 'session-b')
        assert.equal(owner.pendingCount, 0)
    })

    await test('conflicting in-flight and durable ID reuse are rejected', async directory => {
        const owner = new QueuedPromptDeliveryOwner(directory)
        const release = deferred()
        const first = owner.run(input, async mark => { await release.promise; mark(); return result })
        const conflict = { ...input, payload: { prompt: 'different' } }
        await assert.rejects(owner.run(conflict, async () => result), /conflicting payload/)
        release.resolve()
        await first
        await assert.rejects(new QueuedPromptDeliveryOwner(directory).run(conflict, async () => result), /conflicting payload/)
    })
    await test('failure before dispatch removes only new receipt and permits retry', async directory => {
        const owner = new QueuedPromptDeliveryOwner(directory)
        await assert.rejects(owner.run(input, async () => { throw new Error('preparation failed') }), /preparation failed/)
        assert.deepEqual(await readdir(directory), [])
        assert.deepEqual(await owner.run(input, async mark => { mark(); return result }), result)
    })
    await test('failure after dispatch retains pending and never auto-resubmits', async directory => {
        const owner = new QueuedPromptDeliveryOwner(directory)
        let calls = 0
        await assert.rejects(owner.run(input, async mark => { mark(); calls++; throw new Error('transport lost') }), /transport lost/)
        const file = join(directory, filename())
        const raw = await readFile(file, 'utf8')
        assert.equal(JSON.parse(raw).state, 'pending')
        await assert.rejects(owner.run(input, async () => { calls++; return result }), /Uncertain queued prompt delivery/)
        await assert.rejects(new QueuedPromptDeliveryOwner(directory).run(input, async () => { calls++; return result }), /Uncertain queued prompt delivery/)
        assert.equal(await readFile(file, 'utf8'), raw)
        assert.equal(calls, 1)
    })
    await test('corrupt and invalid receipt identity fail closed without deleting', async directory => {
        const file = join(directory, filename())
        for (const raw of ['{broken', 'null', '{}', JSON.stringify({ state: 'accepted', keyHash: 'bad', payloadHash: 'bad' })]) {
            await writeFile(file, raw)
            await assert.rejects(new QueuedPromptDeliveryOwner(directory).run(input, async () => { throw new Error('must not dispatch') }), /Uncertain queued prompt delivery/)
            assert.equal(await readFile(file, 'utf8'), raw)
        }
    })
    await test('unreadable receipt path is preserved', async directory => {
        const file = join(directory, filename())
        await mkdir(file)
        await assert.rejects(new QueuedPromptDeliveryOwner(directory).run(input, async () => result), /Uncertain queued prompt delivery/)
        assert.deepEqual(await readdir(directory), [filename()])
    })
    await test('cancel while async preparation is pending prevents callback, allows future runs', async directory => {
        const owner = new QueuedPromptDeliveryOwner(directory)
        let calls = 0
        const pending = owner.run(input, async mark => { mark(); calls++; return result })
        // Enter the asynchronous receipt read before cancellation.
        await Promise.resolve()
        owner.cancelPending()
        await assert.rejects(pending, /cancelled before dispatch/)
        assert.equal(calls, 0)
        assert.equal(owner.pendingCount, 0)
        assert.deepEqual(await owner.run(input, async mark => { mark(); calls++; return result }), result)
        assert.equal(calls, 1)
    })
    await test('cancel after callback starts makes markSubmitted throw before runtime call', async directory => {
        const owner = new QueuedPromptDeliveryOwner(directory)
        const started = deferred(), release = deferred()
        let dispatches = 0
        const pending = owner.run(input, async mark => {
            started.resolve()
            await release.promise
            mark()
            dispatches++
            return result
        })
        await started.promise
        owner.cancelPending()
        release.resolve()
        await assert.rejects(pending, /cancelled before dispatch/)
        assert.equal(dispatches, 0)
        assert.deepEqual(await readdir(directory), [])
        await owner.run(input, async mark => { mark(); dispatches++; return result })
        assert.equal(dispatches, 1)
    })
    await test('session/entry scopes are isolated and snapshotted before awaits', async directory => {
        const owner = new QueuedPromptDeliveryOwner(directory)
        const mutable = { ...input }
        const first = owner.run(mutable, async mark => { mark(); return result })
        mutable.sessionId = 'mutated-session'
        mutable.entryId = 'mutated-entry'
        assert.deepEqual(await first, result)
        const secondInput = { ...input, sessionId: 'session-b' }
        const secondResult = { ...result, sessionId: 'session-b', threadId: 'thread-b' }
        assert.deepEqual(await owner.run(secondInput, async mark => { mark(); return secondResult }), secondResult)
        await owner.run({ ...input, entryId: 'queue-b' }, async mark => { mark(); return result })
        assert.equal((await readdir(directory)).length, 3)
    })
    await test('invalid input/result identities and unmarked optimistic results are not receipts', async directory => {
        const owner = new QueuedPromptDeliveryOwner(directory)
        await assert.rejects(owner.run({ ...input, entryId: '' }, async () => result), /Invalid queued prompt/)
        await assert.rejects(owner.run({ ...input, payload: undefined }, async () => result), /Invalid queued prompt/)
        await assert.rejects(owner.run(input, async () => result), /without marking runtime submission/)
        assert.deepEqual(await readdir(directory), [])
        await assert.rejects(owner.run(input, async mark => { mark(); return { ...result, sessionId: 'wrong' } }), /result identity/)
        await assert.rejects(owner.run(input, async () => result), /Uncertain queued prompt delivery/)
    })
    await test('accepted receipt result corruption stays fail-closed', async directory => {
        await new QueuedPromptDeliveryOwner(directory).run(input, async mark => { mark(); return result })
        const file = join(directory, filename())
        const stored = JSON.parse(await readFile(file, 'utf8'))
        stored.result.sessionId = 'wrong-session'
        const raw = JSON.stringify(stored)
        await writeFile(file, raw)
        await assert.rejects(new QueuedPromptDeliveryOwner(directory).run(input, async () => result), /Uncertain queued prompt delivery/)
        assert.equal(await readFile(file, 'utf8'), raw)
    })
    await test('markSubmitted cannot be reused after callback failure and cleanup', async directory => {
        const owner = new QueuedPromptDeliveryOwner(directory)
        let lateMark!: () => void
        await assert.rejects(owner.run(input, async mark => { lateMark = mark; throw new Error('prepare failure') }), /prepare failure/)
        assert.throws(() => lateMark(), /claim is closed/)
        assert.deepEqual(await readdir(directory), [])
    })
    console.log(`Queued prompt delivery: ${passed} checks passed.`)
} finally {
    await rm(root, { recursive: true, force: true })
}
