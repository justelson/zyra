import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import https from 'node:https'
import { createGateway } from '../../mobile/gateway/src/server.mjs'
import { hostTls } from '../../mobile/gateway/src/tls.mjs'
import { listenForMobile } from '../src/main/mobile-listener'

const directory = await mkdtemp(path.join(os.tmpdir(), 'zyra-mobile-gateway-listen-'))
const stableDirectory = path.join(directory, 'stable'), previewDirectory = path.join(directory, 'preview')
await mkdir(stableDirectory); await mkdir(previewDirectory)
const stable = createGateway({ tls: await hostTls(stableDirectory), directory: stableDirectory, projects: [directory], clientFactory: () => { throw Error('No runtime should be contacted') } })
const tls = await hostTls(previewDirectory)
const options = { tls, directory: previewDirectory, projects: [directory], clientFactory: () => { throw Error('No runtime should be contacted') } }
let preview = createGateway(options)
function request(port: number, pairing?: { secret: string; name: string }): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
        // Only these disposable fixture certificates bypass trust verification.
        const req = https.request({ hostname: '127.0.0.1', port, path: pairing ? '/pair' : '/', method: pairing ? 'POST' : 'GET', rejectUnauthorized: false,
            headers: pairing ? { 'Content-Type': 'application/json' } : {} }, response => {
            let body = ''; response.on('data', chunk => body += chunk); response.on('end', () => resolve({ status: response.statusCode!, body: JSON.parse(body) }))
        })
        req.on('error', reject); req.setTimeout(5000, () => req.destroy(Error('Fixture request timed out')))
        req.end(pairing ? JSON.stringify(pairing) : undefined)
    })
}
try {
    const original = await stable.listen('127.0.0.1', 0)
    const recovered = await listenForMobile(preview, '127.0.0.1', original.port)
    assert.notEqual(recovered.port, original.port, 'actual TLS gateway recovers from another profile occupying its port')
    assert.equal((await request(original.port)).status, 404, 'other profile stays reachable')
    const pairing = preview.devices.createPairing()
    const response = await request(recovered.port, { secret: pairing.secret, name: 'Fixture phone' })
    assert.equal(response.status, 200, 'pairing works through the recovered TLS listener')
    assert.equal(preview.devices.list().length, 1)
    assert.equal(stable.devices.list().length, 0, 'pairing never attaches to the other profile')
    await preview.close()
    preview = createGateway(options)
    const restored = await listenForMobile(preview, '127.0.0.1', recovered.port)
    assert.equal(restored.port, recovered.port)
    assert.equal(preview.devices.list().length, 1, 'paired device survives restarting on the saved endpoint')
} finally {
    await preview.close(); await stable.close(); await rm(directory, { recursive: true, force: true })
}
console.log('Real mobile TLS gateway: occupied-port recovery, HTTP pairing, profile isolation and device persistence: ok')
