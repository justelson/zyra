import assert from 'node:assert/strict'
import net from 'node:net'
import { listenForMobile } from '../src/main/mobile-listener'

function gateway() {
    const server = net.createServer()
    const attempts: number[] = []
    return { attempts, server,
        listen(host: string, port: number): Promise<{ port: number }> {
            attempts.push(port)
            return new Promise((resolve, reject) => {
                const error = (reason: Error) => { server.off('listening', listening); reject(reason) }
                const listening = () => { server.off('error', error); resolve(server.address() as net.AddressInfo) }
                server.once('error', error); server.once('listening', listening); server.listen(port, host)
            })
        },
        close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
}
const host = '127.0.0.1'
const occupied = gateway(), candidate = gateway()
try {
    const original = await occupied.listen(host, 0)
    const chosen = await listenForMobile(candidate, host, original.port)
    assert.notEqual(chosen.port, original.port)
    assert.deepEqual(candidate.attempts, [original.port, 0])
    assert.equal((occupied.server.address() as net.AddressInfo).port, original.port, 'other profile remains running')
    await candidate.close()
    const restored = gateway()
    try {
        assert.equal((await listenForMobile(restored, host, chosen.port)).port, chosen.port, 'saved fallback port is reused on restart')
        assert.deepEqual(restored.attempts, [chosen.port])
    } finally { if (restored.server.listening) await restored.close() }
} finally {
    if (candidate.server.listening) await candidate.close()
    if (occupied.server.listening) await occupied.close()
}
let attempts = 0
const denied = Object.assign(Error('permission denied'), { code: 'EACCES' })
await assert.rejects(listenForMobile({ listen: async () => { attempts++; throw denied } }, host, 47321), error => error === denied)
assert.equal(attempts, 1, 'non-collision errors do not silently change the listener')
attempts = 0
const conflict = Object.assign(Error('conflict'), { code: 'EADDRINUSE' })
await assert.rejects(listenForMobile({ listen: async () => { attempts++; throw conflict } }, host, 0), error => error === conflict)
assert.equal(attempts, 1, 'ephemeral binding failure is not retried in a loop')
console.log('Mobile listener collision recovery, saved-port continuity and failure boundaries: ok')
