import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { WindowsSidecarConnection } from '../src/main/agent-control/drivers/windows-sidecar-connection'

class SocketFixture extends EventEmitter {
    writable = true
    destroyed = false
    writes: Array<{ id: string; method: string }> = []
    autoHealth = true
    setEncoding() {}
    write(line: string, callback?: (error?: Error) => void) {
        const { id, method } = JSON.parse(line)
        this.writes.push({ id, method })
        callback?.()
        if (method === 'health' && this.autoHealth || method === 'emergency_stop') queueMicrotask(() => this.reply(id, {}))
        return true
    }
    reply(id: string, result: unknown) { this.emit('data', JSON.stringify({ id, ok: true, result }) + '\n') }
    destroy() { this.destroyed = true; this.writable = false; return this }
}
class ChildFixture extends EventEmitter {
    exitCode: number | null = null
    pid = 999999
    stdin = Object.assign(new EventEmitter(), { write: () => true })
    stderr = Object.assign(new EventEmitter(), { setEncoding() {} })
}
const sockets: SocketFixture[] = [], children: ChildFixture[] = []
let holdConnect = false, holdHealth = false
let resolveConnection: ((socket: SocketFixture) => void) | undefined
let terminations = 0
const connection = new WindowsSidecarConnection('fixture-artifacts', {
    platform: 'win32', idleTimeoutMs: 20, terminationGraceMs: 20,
    launch: () => ({ command: 'fixture-sidecar', args: [] }),
    spawn: () => { const child = new ChildFixture(); children.push(child); return child as any },
    connect: async () => {
        const socket = new SocketFixture(); socket.autoHealth = !holdHealth; sockets.push(socket)
        if (holdConnect) { holdConnect = false; return await new Promise(resolve => { resolveConnection = resolve }) as any }
        return socket as any
    },
    terminate: child => { terminations++; (child as any).exitCode = 0 },
})
const wait = (ms = 1) => new Promise(resolve => setTimeout(resolve, ms))
async function until(predicate: () => boolean) {
    for (let i = 0; i < 100; i++) { if (predicate()) return; await wait() }
    throw Error('Synthetic lifecycle did not settle')
}
async function pending(method = 'list_windows', targetId?: string, signal?: AbortSignal, timeoutMs = 1000) {
    const before = sockets.reduce((n, socket) => n + socket.writes.length, 0)
    const result = connection.request(method, {}, signal, timeoutMs, targetId).then(value => ({ value, error: null }), error => ({ value: null, error }))
    await until(() => sockets.reduce((n, socket) => n + socket.writes.length, 0) > before && sockets.at(-1)!.writes.some(request => request.method === method))
    const socket = sockets.at(-1)!, request = socket.writes.findLast(request => request.method === method)!
    return { result, socket, request }
}
try {
    connection.retainTarget('old')
    const first = await pending(); first.socket.reply(first.request.id, { windows: [] })
    assert.equal((await first.result).error, null)
    const oldChild = children.at(-1)!
    connection.releaseTarget('old')
    assert.equal(first.socket.destroyed, true, 'normal last-target release still unloads the helper')

    const releaseAcquisition = connection.retainAcquisition()
    const terminationsBeforeGrace = terminations
    const replacement = await pending()
    const replacementChild = children.at(-1)!
    await wait(25)
    assert.equal(terminations, terminationsBeforeGrace + 1, 'retired helper receives a bounded cooperative exit grace')
    assert.equal(replacementChild.exitCode, null, 'retirement grace cannot terminate the replacement generation')
    connection.releaseTarget('old')
    connection.releaseIdle()
    oldChild.emit('exit', 0)
    first.socket.emit('close')
    first.socket.emit('error', new Error('late old pipe error'))
    assert.equal(replacement.socket.destroyed, false, 'stale cleanup cannot destroy a replacement acquisition')
    replacement.socket.reply(replacement.request.id, { windows: [] })
    assert.equal((await replacement.result).error, null)

    await wait(35)
    assert.equal(replacement.socket.destroyed, false, 'an acquisition lease covers gaps between discovery RPCs')
    releaseAcquisition(); releaseAcquisition()
    assert.equal(replacement.socket.destroyed, true, 'deferred turn cleanup runs as soon as the acquisition releases')

    const idleLease = connection.retainAcquisition()
    const idle = await pending(); idle.socket.reply(idle.request.id, { windows: [] })
    assert.equal((await idle.result).error, null)
    await wait(35)
    assert.equal(idle.socket.destroyed, false, 'an acquisition without explicit cleanup also pins the helper')
    idleLease()
    await wait(35)
    assert.equal(idle.socket.destroyed, true, 'unretained helper still stops after bounded idle')

    connection.retainTarget('active')
    const action = await pending('action', 'active')
    connection.releaseTarget('active')
    assert.equal((await action.result).error?.code, 'CONTROL_CANCELLED', 'release still interrupts work on the released last target')
    assert.equal(action.socket.writes.filter(request => request.method === 'action').length, 1, 'input is never retried implicitly')

    holdConnect = true
    const cancelledStart = connection.request('list_windows', {}).catch(error => error)
    await until(() => !!resolveConnection)
    const lateSocket = sockets.at(-1)!
    await connection.emergencyStop()
    holdHealth = true
    const newStart = connection.request('list_windows', {}).then(value => ({value,error:null}), error => ({value:null,error}))
    await until(() => sockets.at(-1) !== lateSocket && sockets.at(-1)!.writes.some(request => request.method === 'health'))
    const newSocket = sockets.at(-1)!
    resolveConnection!(lateSocket); resolveConnection = undefined
    assert.equal((await cancelledStart).code, 'CONTROL_CANCELLED')
    assert.equal(lateSocket.destroyed, true, 'a late connect result is closed without rebinding current socket')
    assert.equal(newSocket.destroyed, false)
    const another = connection.request('list_windows', {}).then(value => ({value,error:null}), error => ({value:null,error}))
    await wait(5)
    assert.equal(newSocket.writes.filter(request => request.method === 'list_windows').length, 0, 'concurrent requests must await the current health handshake')
    newSocket.reply(newSocket.writes.find(request => request.method === 'health')!.id, {})
    await until(() => newSocket.writes.filter(request => request.method === 'list_windows').length === 2)
    for (const request of newSocket.writes.filter(request => request.method === 'list_windows')) newSocket.reply(request.id, { windows: [] })
    assert.equal((await newStart).error, null); assert.equal((await another).error, null)
    holdHealth = false

    connection.retainTarget('cancel-target')
    const abort = new AbortController()
    const cancelled = await pending('action', 'cancel-target', abort.signal)
    abort.abort()
    assert.equal((await cancelled.result).error?.code, 'CONTROL_CANCELLED')
    assert.equal(cancelled.socket.destroyed, true, 'cancellation cannot leave native target input running')
    connection.releaseTarget('cancel-target')

    connection.retainTarget('timeout-target')
    const timed = await pending('observe', 'timeout-target', undefined, 10)
    assert.equal((await timed.result).error?.code, 'CONTROL_TIMEOUT')
    assert.equal(timed.socket.destroyed, true)
    connection.releaseTarget('timeout-target')

    const acquisitionLease = connection.retainAcquisition()
    const timedSelection = await pending('select_window', undefined, undefined, 10)
    assert.equal((await timedSelection.result).error?.code, 'CONTROL_TIMEOUT')
    assert.equal(timedSelection.socket.destroyed, true, 'a timed-out selection cannot leave the serial native pipe wedged')
    assert.equal(timedSelection.socket.writes.filter(request => request.method === 'select_window').length, 1, 'selection is never replayed')
    acquisitionLease()

    const endLease = connection.retainAcquisition()
    const activeDiscovery = await pending()
    await connection.emergencyStop()
    assert.equal((await activeDiscovery.result).error?.code, 'CONTROL_DRIVER_UNAVAILABLE', 'Emergency Stop overrides all normal leases')
    endLease()
    const final = await pending(); final.socket.reply(final.request.id, { windows: [] })
    assert.equal((await final.result).error, null, 'a later operation can start cleanly after emergency cleanup')
    const progress: unknown[] = []
    const streaming = connection.request('action', {}, undefined, 1000, 'pointer-test', cursor => progress.push(cursor))
    await until(() => sockets.at(-1)!.writes.at(-1)?.method === 'action')
    const progressSocket = sockets.at(-1)!, progressRequest = progressSocket.writes.at(-1)!
    const sendCursor = (id: string, cursor: unknown) => progressSocket.emit('data', JSON.stringify({ id, cursor }) + '\n')
    sendCursor('stale-id', {x: 100,y: 100,phase:'moving'})
    sendCursor(progressRequest.id, {x: -350,y: -40,phase:'dragging'})
    sendCursor(progressRequest.id, {x: 'not-a-number',y: 20,phase:'moving'})
    assert.deepEqual(progress, [{x:-350,y:-40,phase:'dragging'}], 'only valid in-flight native cursor events reach the driver')
    progressSocket.reply(progressRequest.id, {changed:true})
    assert.deepEqual(await streaming, {changed:true}, 'progress must not settle the action response')
    sendCursor(progressRequest.id, {x:999,y:999,phase:'moving'})
    assert.equal(progress.length, 1, 'completed requests cannot resurrect a stale cursor')
    connection.dispose()
    await assert.rejects(() => connection.request('list_windows', {}), /cancelled/)
    console.log(`Windows sidecar lifecycle: stale release/exit/close, acquisition lease, startup fencing, cancellation, timeout and emergency boundaries: ok (${terminations} synthetic terminations)`)
} finally { connection.dispose() }
