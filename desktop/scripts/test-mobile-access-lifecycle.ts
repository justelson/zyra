import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { acquireHostLock } from '../../mobile/gateway/src/process-lock.mjs'

// Stub unrelated runtime/feature adapters. The manager, queue, filesystem writes,
// profile lock and listener recovery run through their production implementations.
for (const [module, name] of [
    ['mobile-terminal-access', 'MobileTerminalAccess'], ['mobile-voice-access', 'MobileVoiceAccess'],
    ['mobile-plugin-access', 'MobilePluginAccess'], ['mobile-fleet-access', 'MobileFleetAccess'],
    ['mobile-review-access', 'MobileReviewAccess']
]) mock.module(`../src/main/${module}`, () => ({ [name]: class {} }))
mock.module('../src/main/mobile-project-presentation', () => ({ MobileProjectPresentations: class { clear() {} async get() { return {} } } }))
mock.module('../src/main/zyra/zyra-root', () => ({ resolveZyraRoot: () => '/unused-runtime' }))
mock.module('../src/main/assistant/zyra-agent-server-worker', () => ({ resolveDesktopAgentServerNamespace: () => ({}) }))

let creates = 0, closes = 0, active = 0, maxActive = 0, preparations = 0
let rejectNext: Error | null = null
const ports: number[] = []
mock.module('../../mobile/gateway/src/desktop-entry.mjs', () => ({
    DeviceStore: class { list() { return [] } },
    hostTls: async () => ({ fingerprint: 'fixture-certificate' }),
    prepareHostProcessIdentity: async () => { await Promise.resolve(); preparations++ },
    pairingDisplay: async (_gateway: unknown, _tls: unknown, origin: string) => ({ link: origin, image: 'fixture', expiresAt: Date.now() + 1000 }),
    createGateway: (options: { directory: string }) => {
        assert.equal(preparations, creates + 1, 'native identity is prepared asynchronously before gateway construction')
        const release = acquireHostLock(options.directory, { readIdentity: () => ({ id: 'fixture-process-generation', startedAtMs: 1 }) })
        creates++; active++; maxActive = Math.max(maxActive, active)
        let closed = false
        return {
            listen: async (_address: string, port: number) => {
                ports.push(port)
                if (rejectNext) { const reason = rejectNext; rejectNext = null; throw reason }
                if (port === 47321) throw Object.assign(Error('port occupied by another profile'), { code: 'EADDRINUSE' })
                return { address: '127.0.0.1', port: port || 51234 }
            },
            connectedDeviceIds: () => [],
            close: async () => { if (!closed) { closed = true; closes++; active--; release() } }
        }
    }
}))
const { MobileAccessManager } = await import('../src/main/mobile-access')
const directory = await mkdtemp(path.join(os.tmpdir(), 'zyra-mobile-lifecycle-'))
const mobile = path.join(directory, 'mobile-access')
await mkdir(mobile)
const settings = path.join(mobile, 'settings.json')
const devices = path.join(mobile, 'devices.json')
const sentinel = 'existing pairing data must remain byte-identical'
await writeFile(devices, sentinel)
await writeFile(settings, JSON.stringify({ enabled: true, address: '127.0.0.1', projects: [directory], port: 47321 }))
function manager() {
    const value = new MobileAccessManager(directory, (() => ({ getStatus: async () => ({}) })) as any)
    value.addresses = () => [{ name: 'fixture', address: '127.0.0.1' }]
    ;(value as any).clientFactory = async () => () => ({})
    return value
}
const first = manager(), reopened = manager()
try {
    await Promise.all([first.restore(), first.restore()])
    assert.equal(creates, 1, 'repeated startup reuses its existing gateway instead of tripping its own lock')
    assert.equal(preparations, 1, 'repeated startup does not repeat OS process queries')
    assert.equal(closes, 0, 'successful repeated startup does not disconnect phones')
    assert.deepEqual(ports, [47321, 0])
    assert.equal((await first.state()).running, true)
    assert.equal((await first.state()).error, undefined)
    assert.equal(JSON.parse(await readFile(settings, 'utf8')).port, 51234, 'actual fallback port is persisted')
    assert.equal((await first.pair()).link, 'https://127.0.0.1:51234', 'pairing uses the actual recovered listener endpoint')
    await first.stop()
    await reopened.restore()
    assert.equal(ports.at(-1), 51234, 'later startup retains the saved endpoint')
    await reopened.stop()
    rejectNext = Object.assign(Error('network denied'), { code: 'EACCES' })
    await first.restore()
    assert.equal((await first.state()).running, false)
    assert.equal((await first.state()).error, 'network denied')
    await first.restore()
    assert.equal((await first.state()).running, true)
    assert.equal((await first.state()).error, undefined, 'successful recovery clears the prior error')
    assert.equal(maxActive, 1, 'no overlapping host owns the profile store')
    assert.equal(await readFile(devices, 'utf8'), sentinel, 'pairings survive collision recovery and restarts')
} finally {
    await first.stop(); await reopened.stop(); await rm(directory, { recursive: true, force: true })
}
console.log('Mobile manager repeated restore, collision recovery, persistence, pairing origin and error recovery: ok')
