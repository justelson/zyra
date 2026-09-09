import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { WindowsSidecarConnection } from '../src/main/agent-control/drivers/windows-sidecar-connection'

function fixture(holdHealth = false) {
    const writes: Array<{ id: string; method: string }> = []
    const socket = Object.assign(new EventEmitter(), {
        writable: true, destroyed: false,
        setEncoding() {},
        destroy() { this.destroyed = true; this.writable = false; return this },
        reply(id: string) { this.emit('data', JSON.stringify({ id, ok: true, result: {} }) + '\n') },
        write(line: string, callback?: () => void) {
            const request = JSON.parse(line); writes.push(request); callback?.()
            if (request.method === 'health' && !holdHealth) queueMicrotask(() => this.reply(request.id))
            return true
        }
    })
    const child = Object.assign(new EventEmitter(), {
        pid: 999999, exitCode: null,
        stdin: Object.assign(new EventEmitter(), { write() {} }),
        stderr: Object.assign(new EventEmitter(), { setEncoding() {} })
    })
    const connection = new WindowsSidecarConnection('fixture', {
        platform: 'win32', launch: () => ({ command: 'fixture', args: [] }),
        spawn: () => child as any, connect: async () => socket as any, terminate() {},
    })
    return { connection, socket, writes }
}
const wait = () => new Promise(resolve => setTimeout(resolve, 1))
async function until(predicate: () => boolean) {
    for (let i = 0; i < 100; i++) { if (predicate()) return; await wait() }
    throw Error('Target cancellation did not settle')
}
const outcome = (promise: Promise<unknown>) => promise.then(value => ({ value, error: null }), error => ({ value: null, error }))

test('releasing a target during shared startup cancels its queued input without stopping the other target', async () => {
    const { connection, socket, writes } = fixture(true)
    try {
        connection.retainTarget('released'); connection.retainTarget('other')
        let settled = false
        const released = outcome(connection.request('action', {}, undefined, 1000, 'released')).finally(() => { settled = true })
        const other = outcome(connection.request('observe', {}, undefined, 1000, 'other'))
        await until(() => writes.some(request => request.method === 'health'))
        connection.releaseTarget('released')
        await until(() => settled)
        assert.equal((await released).error?.code, 'CONTROL_CANCELLED')
        assert.equal(socket.destroyed, false, 'queued work can be cancelled without touching shared native startup')
        socket.reply(writes.find(request => request.method === 'health')!.id)
        await until(() => writes.some(request => request.method === 'observe'))
        assert.equal(writes.some(request => request.method === 'action'), false, 'revoked input must never reach the native pipe')
        socket.reply(writes.find(request => request.method === 'observe')!.id)
        assert.equal((await other).error, null)
    } finally { connection.dispose() }
})

test('releasing one retained target stops its already-sent native input even when another target remains', async () => {
    const { connection, socket, writes } = fixture()
    try {
        connection.retainTarget('released'); connection.retainTarget('other')
        const released = outcome(connection.request('action', {}, undefined, 1000, 'released'))
        await until(() => writes.some(request => request.method === 'action'))
        connection.releaseTarget('released')
        assert.equal(socket.destroyed, true, 'a remaining target cannot keep revoked native input running')
        assert.equal((await released).error?.code, 'CONTROL_CANCELLED')
        assert.equal(writes.filter(request => request.method === 'action').length, 1, 'ambiguous input is not replayed')
    } finally { connection.dispose() }
})

test('turn cleanup waits for the acquisition owner, then unloads promptly', async () => {
    const { connection, socket, writes } = fixture(true)
    try {
        const release = connection.retainAcquisition()
        const work = outcome(connection.request('list_windows', {}))
        await until(() => writes.some(request => request.method === 'health'))
        connection.releaseIdle()
        assert.equal(socket.destroyed, false)
        socket.reply(writes.find(request => request.method === 'health')!.id)
        await until(() => writes.some(request => request.method === 'list_windows'))
        socket.reply(writes.find(request => request.method === 'list_windows')!.id)
        assert.equal((await work).error, null)
        assert.equal(socket.destroyed, false, 'RPC completion does not end the acquisition lease')
        release()
        assert.equal(socket.destroyed, true, 'completed cleanup does not leave an unnecessary 15-second helper')
    } finally { connection.dispose() }
})
