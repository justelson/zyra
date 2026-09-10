import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { ChromePairingServer } from '../src/main/agent-control/chrome-pairing-server'

const server = new ChromePairingServer()
const state = await server.start()
assert.equal(state.state, 'waiting')
const extensionId = 'a'.repeat(32)
const origin = `chrome-extension://${extensionId}`
const nonce = 'nonce_nonce_nonce_1234567890'
const hello = await post('/v1/pair/hello', { protocolVersion: 1, extensionId, nonce, code: state.code }, origin)
assert.equal(hello.status, 200)
const proof = createHmac('sha256', state.code!).update(`${nonce}:${hello.body.challenge}`).digest('base64url')
const paired = await post('/v1/pair/prove', { protocolVersion: 1, sessionId: hello.body.sessionId, proof }, origin)
assert.equal(paired.status, 200)
const token = paired.body.token
const firstPoll = await post('/v1/poll', {}, origin, token)
assert.equal(firstPoll.status, 200)
assert.ok(firstPoll.body.nextToken)
const replay = await post('/v1/poll', {}, origin, token)
assert.equal(replay.status, 403)
const forgedOrigin = await post('/v1/poll', {}, `https://example.test`, firstPoll.body.nextToken)
assert.equal(forgedOrigin.status, 403)
const eventPromise = new Promise<any>((resolve) => server.once('extension-event', resolve))
const tabEvent = await post('/v1/event', {
    type: 'tab.register', tabId: 42, documentId: 'document:test', url: 'https://example.test/', title: 'Fixture', mode: 'read'
}, origin, firstPoll.body.nextToken)
assert.equal(tabEvent.status, 200)
const event = await eventPromise
assert.equal(event.tabId, 42)
assert.equal(event.extensionId, extensionId)
assert.equal(event.mode, 'read', 'tab registration carries the user-selected access mode')
let currentToken = tabEvent.body.nextToken
async function authenticated(pathname: string, body: unknown) {
    const response = await post(pathname, body, origin, currentToken)
    if (response.body.nextToken) currentToken = response.body.nextToken
    return response
}
server.setAppearance({ theme: 'dark', accentColor: { primary: '#aabbcc' } })
assert.equal((await authenticated('/v1/poll', {})).body.appearance.theme, 'dark')
const cancellation = new AbortController()
const pendingInput = server.request(paired.body.pairId, { type: 'action', tabId: 42 }, 5_000, cancellation.signal)
const rejectedInput = assert.rejects(pendingInput, (error: any) => error.code === 'CONTROL_CANCELLED')
const delivered = (await authenticated('/v1/poll', {})).body.requests[0]
assert.ok(delivered.deadline > Date.now())
cancellation.abort()
await rejectedInput
const cancelCommand = (await authenticated('/v1/poll', {})).body.requests[0]
assert.equal(cancelCommand.operation.type, 'cancel')
assert.equal(cancelCommand.operation.requestId, delivered.requestId)
const late = await authenticated('/v1/respond', { requestId: delivered.requestId, ok: true, result: {} })
assert.equal(late.status, 409)
assert.ok(late.body.nextToken, 'a late response still rotates the authenticated transport token')
assert.equal((await authenticated('/v1/poll', {})).status, 200, 'connection remains usable after cancelling input')
await assert.rejects(server.request(paired.body.pairId, { type: 'action', tabId: 42 }, 15), (error: any) => error.code === 'CONTROL_TIMEOUT')
assert.deepEqual((await authenticated('/v1/poll', {})).body.requests, [], 'expired queued input must never reach the extension')
const disconnectPromise = new Promise<any>((resolve) => server.once('extension-event', resolve))
const disconnected = await post('/v1/event', { type: 'session.disconnect' }, origin, currentToken)
assert.equal(disconnected.status, 200)
const disconnectEvent = await disconnectPromise
assert.equal(disconnectEvent.type, 'session.disconnected')
assert.equal(disconnectEvent.pairId, paired.body.pairId)
assert.equal(server.state().state, 'stopped')
await server.stop('test-complete')
console.log('Chrome loopback pairing origin, proof, rotation, replay, exact-tab events, and explicit disconnect passed.')

async function post(pathname: string, body: unknown, origin: string, token?: string) {
    const response = await fetch(`http://127.0.0.1:${state.port}${pathname}`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body)
    })
    return { status: response.status, body: await response.json() as any }
}
