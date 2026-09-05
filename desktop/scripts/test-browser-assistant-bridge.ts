import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { AssistantEventStreamPayload, AssistantRealtimeVoiceEvent } from '../src/shared/assistant/contracts'
import {
    BROWSER_ASSISTANT_BRIDGE_CAPABILITY_HEADER,
    BROWSER_ASSISTANT_BRIDGE_EVENTS_PATH,
    BROWSER_ASSISTANT_BRIDGE_HEADER,
    BROWSER_ASSISTANT_BRIDGE_HEADER_VALUE,
    BROWSER_ASSISTANT_BRIDGE_INVOKE_PATH,
    BROWSER_ASSISTANT_CLIENT_ID_HEADER,
    BROWSER_DEVSCOPE_BRIDGE_EVENTS_PATH,
    BROWSER_DEVSCOPE_BRIDGE_INVOKE_PATH,
    BROWSER_FILE_BRIDGE_PATH,
    BROWSER_REALTIME_VOICE_EVENTS_PATH,
    isBrowserDevscopeBridgePath,
    type BrowserDevscopeRelayEvent
} from '../src/shared/browser-assistant-bridge'
import { BrowserAssistantBridge } from '../src/main/assistant/browser-assistant-bridge'
import type { AssistantService } from '../src/main/assistant/service'

const titleBarSource = readFileSync(new URL('../src/renderer/src/components/layout/TitleBar.tsx', import.meta.url), 'utf8')
const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8')
const browserRuntimeSource = readFileSync(new URL('../src/main/browser-client-runtime.ts', import.meta.url), 'utf8')
const assistantHandlersSource = readFileSync(new URL('../src/main/ipc/handlers/assistant-handlers.ts', import.meta.url), 'utf8')
const assistantServiceSource = readFileSync(new URL('../src/main/assistant/service.ts', import.meta.url), 'utf8')
const fixtureSeederSource = readFileSync(new URL('../../scripts/seed-development-chat-fixtures.mjs', import.meta.url), 'utf8')
const preloadRelaySource = readFileSync(new URL('../src/preload/browser-devscope-relay.ts', import.meta.url), 'utf8')
const mainRelaySource = readFileSync(new URL('../src/main/browser-devscope-relay.ts', import.meta.url), 'utf8')
const liveDevscopeSource = readFileSync(new URL('../src/renderer/src/lib/browser-devscope-live-adapter.ts', import.meta.url), 'utf8')
const browserAssistantAdapterSource = readFileSync(new URL('../src/renderer/src/lib/browser-assistant-bridge-adapter.ts', import.meta.url), 'utf8')
assert.equal(titleBarSource.includes('{desktopWindowControlsAvailable ? ('), true, 'browser clients must not render native window buttons')
assert.equal(titleBarSource.includes("appMenuOpen ? 'text-sparkle-text' : 'text-sparkle-text-secondary hover:text-sparkle-text'"), true, 'the Zyra menu trigger should change only text/icon color rather than painting a button background')
assert.equal(titleBarSource.includes("appMenuOpen ? 'bg-[var(--surface-hover)]"), false, 'the Zyra wordmark trigger must not retain a highlighted button surface')
assert.equal(browserRuntimeSource.includes('onAssistantClientCountChanged: setActiveBrowserAssistantClientCount'), true, 'the live bridge must activate the browser Assistant selection lease')
assert.equal(mainSource.includes("staticRoot: join(__dirname, '../renderer')"), true, 'packaged Desktop must serve its built renderer to the local browser')
assert.equal(mainSource.includes('new BrowserClientRuntime'), true, 'Desktop must supervise the production browser runtime independently of renderer startup')
assert.equal(mainSource.includes("log.info('[BrowserClientHost] ready'"), true, 'the stable local browser URL must be discoverable in Desktop logs')
assert.match(
    mainSource,
    /app\.on\('window-all-closed', \(\) => \{\s*if \(process\.platform === 'darwin'\) return\s*app\.quit\(\)/,
    'closing the last macOS window must keep the browser runtime alive until the app actually quits'
)
assert.match(mainSource, /app\.on\('before-quit', \(event\) => \{[\s\S]*event\.preventDefault\(\)[\s\S]*flushGlobalBrowserProfileStorage\(\)\.then[\s\S]*Promise\.all\([\s\S]*disposeAssistantService\(\)[\s\S]*Zyra kept running because local state could not be committed/, 'Desktop quit persists Browser and Assistant state and refuses to discard a failed batch')
assert.equal(assistantHandlersSource.includes('withDesktopAssistantSelectionLease(() => getAssistantService().connect(options))'), true, 'Desktop auto-reconnect must not steal a browser-routed chat')
assert.equal(preloadRelaySource.includes('Object.prototype.hasOwnProperty.call'), true, 'the generic relay must only invoke methods owned by the exposed Desktop adapter')
assert.equal(isBrowserDevscopeBridgePath(['analytics', 'capture']), false, 'remote Browser clients must never proxy analytics')
assert.equal(preloadRelaySource.includes("relayEvent('previewTerminal'"), true, 'terminal output must cross the browser event relay')
assert.equal(preloadRelaySource.includes("relayEvent('agentControlState'"), true, 'Agent Control state must cross the browser event relay')
assert.equal(preloadRelaySource.includes('BROWSER_DEVSCOPE_RELAY_READY_CHANNEL'), true, 'preload must announce that native browser actions are ready')
assert.equal(mainRelaySource.includes('waitForReadyTarget'), true, 'browser actions must wait for the Desktop preload instead of being dropped during startup')
assert.equal(liveDevscopeSource.includes('MAX_CONCURRENT_BACKGROUND_BROWSER_ACTIONS = 1'), true, 'background native reads must leave capacity for browser navigation and user actions')
assert.equal(liveDevscopeSource.includes('isPriorityBrowserAction'), true, 'interactive native browser actions must bypass background read backlog')
assert.equal(browserAssistantAdapterSource.includes('waitForVoiceStream()'), true, 'browser Voice start must wait until its owner-scoped event stream is connected')
assert.equal(browserAssistantAdapterSource.includes('realtimeVoiceIngestQueue'), true, 'browser WebRTC control events must preserve provider ordering across HTTP requests')
assert.match(assistantServiceSource, /app\.isPackaged \|\| !\/\^zyra-dev/, 'the live fixture owner rejects packaged and non-development profiles')
assert.match(assistantServiceSource, /async connect[\s\S]{0,600}isAssistantDevelopmentChatFixtureSessionId[\s\S]{0,400}return \{ success: true as const, threadId: fixtureThread\.id \}/, 'opening a TEST Chat cannot attach it to a provider')
assert.match(assistantServiceSource, /async selectSession[\s\S]{0,800}!isAssistantDevelopmentChatFixtureSessionId\(sessionId\)[\s\S]{0,180}scheduleSelectedCanonicalSessionSynchronization/, 'selecting a TEST Chat skips background canonical attachment')
assert.match(assistantServiceSource, /async sendPrompt[\s\S]{0,500}isAssistantDevelopmentChatFixtureSessionId\(session\?\.id\)[\s\S]{0,180}read-only local fixtures/, 'TEST Chat content cannot be mutated through the composer')
assert.match(fixtureSeederSource, /!\/\^zyra-dev/, 'the fixture command rejects production and path-like profile names before reading a bridge descriptor')
assert.match(fixtureSeederSource, /x-zyra-browser-capability['"]?: descriptor\.capability/, 'the fixture command uses the protected local service instead of editing a live database')

const allowedOrigin = 'http://localhost:5174'
const capability = 'test-browser-assistant-capability'
const stateDirectory = mkdtempSync(path.join(os.tmpdir(), 'zyra-browser-bridge-test-'))
const descriptorPath = path.join(stateDirectory, 'browser-assistant-bridge.json')
const browserFilePath = path.join(stateDirectory, 'browser-file.txt')
writeFileSync(browserFilePath, 'browser-file-content')
let eventListener: ((payload: AssistantEventStreamPayload) => void) | null = null
let realtimeVoiceEventListener: ((event: AssistantRealtimeVoiceEvent) => void) | null = null
let devscopeEventListener: ((event: BrowserDevscopeRelayEvent) => void) | null = null
const browserClientCounts: number[] = []
const devscopeInvocations: Array<{ methodPath: string[]; args: unknown[] }> = []
const service = {
    subscribeExternalEvents(listener: (payload: AssistantEventStreamPayload) => void) {
        eventListener = listener
        return () => { eventListener = null }
    },
    getExternalEventReplay() {
        return { events: [{ eventId: 'event:replay', type: 'session.selected' } as any] }
    },
    subscribeExternalRealtimeVoiceEvents(listener: (event: AssistantRealtimeVoiceEvent) => void) {
        realtimeVoiceEventListener = listener
        return () => { realtimeVoiceEventListener = null }
    },
    async getBootstrap() {
        return {
            snapshot: {
                selectedSessionId: 'session:real',
                sessions: [{ id: 'session:real', title: 'Shared browser session' }]
            },
            status: {
                available: true,
                connected: true,
                selectedSessionId: 'session:real',
                activeThreadId: 'thread:real',
                state: 'idle',
                reason: null
            }
        }
    },
    async getSnapshot() { return { selectedSessionId: 'session:real', sessions: [] } },
    async getStatus() { return { available: true, connected: true, state: 'idle' } },
    async getPluginCatalog() {
        return {
            success: true as const,
            catalog: {
                version: 1,
                revision: 1,
                sources: [{ id: 'source:one', kind: 'local', label: 'Local source', locator: 'C:\\private\\plugin-source', createdAt: '', updatedAt: '' }],
                plugins: [],
                releases: [{ id: 'release:one', packagePath: 'C:\\private\\installed-release' }],
                pluginSets: [],
                chatScopes: []
            }
        }
    },
    async setPluginSet() { return this.getPluginCatalog() },
    async setPluginState() { return this.getPluginCatalog() },
    async rollbackPlugin() { return this.getPluginCatalog() },
    async seedDevelopmentChatFixtures() {
        return { success: true as const, fixtures: [{ title: 'TEST — LIGHT CHAT', turns: 6 }] }
    },
    async startRealtimeVoice() { return { success: true as const, sdp: 'answer', realtimeVersion: 'v3' } },
    async sendRealtimeVoiceMessage() { return { success: true as const, mode: 'text-turn' as const } },
    async ingestRealtimeVoiceEvent() { return { success: true as const } },
    async stopRealtimeVoice() {
        realtimeVoiceEventListener?.({ type: 'session.closed', reason: 'test-stop' })
        return { success: true as const }
    }
} as unknown as AssistantService

const bridge = new BrowserAssistantBridge({
    service,
    allowedOrigins: new Set([allowedOrigin]),
    capability,
    descriptorPath,
    port: 0,
    invokeDevscope: async (methodPath, args) => {
        devscopeInvocations.push({ methodPath, args })
        return { methodPath, args }
    },
    subscribeDevscopeEvents: (listener) => {
        devscopeEventListener = listener
        return () => { devscopeEventListener = null }
    },
    onAssistantClientCountChanged: (count) => browserClientCounts.push(count),
    persistClipboardImage: async () => 'persisted.png',
    resolveClipboardAttachment: async () => null,
    getVoiceTranscriptionState: async () => ({
        provider: 'codex',
        status: 'ready',
        available: true,
        signedIn: true,
        message: null
    }),
    transcribeVoice: async () => 'transcript'
})

const address = await bridge.start()
assert.equal(eventListener, null, 'starting the local Browser listener must not eagerly bind or construct Assistant')
const descriptor = JSON.parse(readFileSync(descriptorPath, 'utf8'))
assert.equal(descriptor.port, address.port)
assert.equal(descriptor.capability, capability, 'bridge discovery must use a per-process capability outside browser code')
const baseUrl = `http://127.0.0.1:${address.port}`
const voiceClientId = 'browser-voice-client-0001'
const headers = {
    Origin: allowedOrigin,
    'Content-Type': 'application/json',
    [BROWSER_ASSISTANT_BRIDGE_HEADER]: BROWSER_ASSISTANT_BRIDGE_HEADER_VALUE,
    [BROWSER_ASSISTANT_BRIDGE_CAPABILITY_HEADER]: capability
}

try {
    const bootstrapResponse = await fetch(`${baseUrl}${BROWSER_ASSISTANT_BRIDGE_INVOKE_PATH}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ method: 'bootstrap', args: [] })
    })
    assert.equal(bootstrapResponse.status, 200)
    const bootstrap = await bootstrapResponse.json() as any
    assert.equal(bootstrap.ok, true)
    assert.equal(bootstrap.value.snapshot.sessions[0].title, 'Shared browser session', 'browser bootstrap must use the live AssistantService')
    assert.equal(typeof eventListener, 'function', 'the first protected Browser request binds live Assistant events')
    assert.equal(bootstrapResponse.headers.get('access-control-allow-origin'), allowedOrigin)

    const pluginCatalogResponse = await fetch(`${baseUrl}${BROWSER_ASSISTANT_BRIDGE_INVOKE_PATH}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ method: 'getPluginCatalog', args: [] })
    })
    assert.equal(pluginCatalogResponse.status, 200)
    const pluginCatalog = await pluginCatalogResponse.json() as any
    assert.equal(pluginCatalog.value.catalog.sources[0].locator, '', 'browser Plugin catalogs hide Desktop source paths')
    assert.equal(pluginCatalog.value.catalog.releases[0].packagePath, '', 'browser Plugin catalogs hide installed release paths')
    assert.equal(pluginCatalog.value.catalog.sources[0].label, 'Local source')
    for (const method of ['setPluginSet', 'setPluginState', 'rollbackPlugin']) {
        const response = await fetch(`${baseUrl}${BROWSER_ASSISTANT_BRIDGE_INVOKE_PATH}`, { method: 'POST', headers, body: JSON.stringify({ method, args: [{}] }) })
        assert.equal(response.status, 200)
        const result = await response.json() as any
        assert.equal(result.value.catalog.sources[0].locator, '', `${method} hides Desktop source paths`)
        assert.equal(result.value.catalog.releases[0].packagePath, '', `${method} hides installation paths`)
    }

    const fixtureResponse = await fetch(`${baseUrl}${BROWSER_ASSISTANT_BRIDGE_INVOKE_PATH}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ method: 'seedDevelopmentChatFixtures', args: [] })
    })
    const fixtureResult = await fixtureResponse.json() as any
    assert.equal(fixtureResult.ok, true)
    assert.match(fixtureResult.value.fixtures[0].title, /^TEST — LIGHT CHAT/, 'the protected local bridge can invoke the dev-only fixture owner')

    const devscopeResponse = await fetch(`${baseUrl}${BROWSER_DEVSCOPE_BRIDGE_INVOKE_PATH}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ path: ['selectFolder'], args: [] })
    })
    const devscope = await devscopeResponse.json() as any
    assert.equal(devscope.ok, true)
    assert.deepEqual(devscope.value, { methodPath: ['selectFolder'], args: [] }, 'browser-native actions must relay through the real Desktop adapter')

    const browserFileSource = pathToFileURL(browserFilePath).href.replace(/^file:/, 'zyra:')
    const browserFileResponse = await fetch(`${baseUrl}${BROWSER_FILE_BRIDGE_PATH}?source=${encodeURIComponent(browserFileSource)}`, {
        headers
    })
    assert.equal(browserFileResponse.status, 200)
    assert.equal(await browserFileResponse.text(), 'browser-file-content', 'browser clients must be able to render host files through the protected bridge')
    assert.equal(browserFileResponse.headers.get('content-type'), 'text/plain', 'browser file responses preserve the allowlisted local MIME type')
    assert.equal(browserFileResponse.headers.get('accept-ranges'), 'bytes')

    const browserFileRange = await fetch(`${baseUrl}${BROWSER_FILE_BRIDGE_PATH}?source=${encodeURIComponent(browserFileSource)}`, {
        headers: { ...headers, Range: 'bytes=8-11' }
    })
    assert.equal(browserFileRange.status, 206)
    assert.equal(await browserFileRange.text(), 'file')
    assert.equal(browserFileRange.headers.get('content-range'), 'bytes 8-11/20')

    const prototypeTraversal = await fetch(`${baseUrl}${BROWSER_DEVSCOPE_BRIDGE_INVOKE_PATH}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ path: ['constructor', 'constructor'], args: [] })
    })
    assert.equal(prototypeTraversal.status, 400, 'browser action paths must reject prototype traversal')

    const desktopOnlyMethods = ['getBrowserHistory', 'recordBrowserHistory', 'clearBrowserHistory', 'getRunningLocalServers', 'getBrowserSearchSuggestions', 'getBrowserAdBlockStatus', 'setBrowserAdBlockEnabled', 'onBrowserAdDetected', 'getBrowserBackgroundProviderStatus', 'validateBrowserUnsplashAccessKey', 'getBrowserRemoteBackgrounds', 'trackBrowserRemoteBackground', 'scanExternalBrowserHistoryProfiles', 'importExternalBrowserHistory']
    for (const method of desktopOnlyMethods) {
        const desktopOnlyBypass = await fetch(`${baseUrl}${BROWSER_DEVSCOPE_BRIDGE_INVOKE_PATH}`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ path: [method], args: [] })
        })
        assert.equal(desktopOnlyBypass.status, 400, `thin Browser clients cannot bypass the adapter to invoke ${method}`)
    }
    assert.deepEqual(
        devscopeInvocations.map(({ methodPath }) => methodPath),
        [['selectFolder']],
        'raw HTTP attempts for every Desktop-only Browser operation are rejected before the native adapter runs'
    )

    const rejectedOrigin = await fetch(`${baseUrl}${BROWSER_ASSISTANT_BRIDGE_INVOKE_PATH}`, {
        method: 'POST',
        headers: { ...headers, Origin: 'https://example.com' },
        body: JSON.stringify({ method: 'bootstrap', args: [] })
    })
    assert.equal(rejectedOrigin.status, 403, 'non-renderer origins must not access local sessions')

    const invalidCapability = await fetch(`${baseUrl}${BROWSER_ASSISTANT_BRIDGE_INVOKE_PATH}`, {
        method: 'POST',
        headers: { ...headers, [BROWSER_ASSISTANT_BRIDGE_CAPABILITY_HEADER]: 'wrong-capability' },
        body: JSON.stringify({ method: 'bootstrap', args: [] })
    })
    assert.equal(invalidCapability.status, 403, 'browser bridge requests must carry the current process capability')

    const missingClientHeader = await fetch(`${baseUrl}${BROWSER_ASSISTANT_BRIDGE_INVOKE_PATH}`, {
        method: 'POST',
        headers: { Origin: allowedOrigin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'bootstrap', args: [] })
    })
    assert.equal(missingClientHeader.status, 403, 'state-changing bridge requests must require a preflighted client header')

    const eventController = new AbortController()
    const eventResponse = await fetch(`${baseUrl}${BROWSER_ASSISTANT_BRIDGE_EVENTS_PATH}`, {
        headers: {
            Origin: allowedOrigin,
            [BROWSER_ASSISTANT_BRIDGE_HEADER]: BROWSER_ASSISTANT_BRIDGE_HEADER_VALUE,
            [BROWSER_ASSISTANT_BRIDGE_CAPABILITY_HEADER]: capability
        },
        signal: eventController.signal
    })
    assert.equal(eventResponse.status, 200)
    assert.equal(eventResponse.headers.get('content-type')?.startsWith('text/event-stream'), true)
    assert.equal(browserClientCounts.at(-1), 1, 'an open browser event stream must own the Assistant selection lease')
    assert.ok(eventListener, 'event stream must subscribe to AssistantService events')
    eventListener!({ events: [{ eventId: 'event:browser', type: 'session.selected' } as any] })
    const reader = eventResponse.body!.getReader()
    const decoder = new TextDecoder()
    let eventText = ''
    for (let attempt = 0; attempt < 4 && !eventText.includes('event:browser'); attempt += 1) {
        const chunk = await reader.read()
        if (chunk.done) break
        eventText += decoder.decode(chunk.value)
    }
    assert.equal(eventText.includes('event:replay'), true, 'browser reconnects must replay the bounded AssistantService event journal')
    assert.equal(eventText.includes('event:browser'), true, 'live AssistantService events must reach the browser stream')
    eventController.abort()
    await reader.cancel().catch(() => undefined)
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(browserClientCounts.at(-1), 0, 'closing the browser stream must release the Assistant selection lease')

    const voiceEventController = new AbortController()
    const voiceEventResponse = await fetch(`${baseUrl}${BROWSER_REALTIME_VOICE_EVENTS_PATH}`, {
        headers: {
            Origin: allowedOrigin,
            [BROWSER_ASSISTANT_BRIDGE_HEADER]: BROWSER_ASSISTANT_BRIDGE_HEADER_VALUE,
            [BROWSER_ASSISTANT_BRIDGE_CAPABILITY_HEADER]: capability,
            [BROWSER_ASSISTANT_CLIENT_ID_HEADER]: voiceClientId
        },
        signal: voiceEventController.signal
    })
    assert.equal(voiceEventResponse.status, 200)
    const otherVoiceEventController = new AbortController()
    const otherVoiceEventResponse = await fetch(`${baseUrl}${BROWSER_REALTIME_VOICE_EVENTS_PATH}`, {
        headers: {
            Origin: allowedOrigin,
            [BROWSER_ASSISTANT_BRIDGE_HEADER]: BROWSER_ASSISTANT_BRIDGE_HEADER_VALUE,
            [BROWSER_ASSISTANT_BRIDGE_CAPABILITY_HEADER]: capability,
            [BROWSER_ASSISTANT_CLIENT_ID_HEADER]: 'browser-voice-client-0002'
        },
        signal: otherVoiceEventController.signal
    })
    assert.equal(otherVoiceEventResponse.status, 200)
    const otherVoiceReader = otherVoiceEventResponse.body!.getReader()
    await otherVoiceReader.read()
    const startVoiceResponse = await fetch(`${baseUrl}${BROWSER_ASSISTANT_BRIDGE_INVOKE_PATH}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            method: 'startRealtimeVoice',
            clientId: voiceClientId,
            args: [{ sdp: 'offer', conversationId: 'thread:real', sessionId: 'session:real' }]
        })
    })
    const startVoice = await startVoiceResponse.json() as any
    assert.equal(startVoice.ok, true)
    assert.equal(startVoice.value.success, true, 'the browser Voice owner should start through the typed Assistant bridge')
    const secondVoiceStart = await fetch(`${baseUrl}${BROWSER_ASSISTANT_BRIDGE_INVOKE_PATH}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            method: 'startRealtimeVoice',
            clientId: 'browser-voice-client-0002',
            args: [{ sdp: 'offer', conversationId: 'thread:real', sessionId: 'session:real' }]
        })
    }).then((response) => response.json()) as any
    assert.equal(secondVoiceStart.value.success, false, 'another browser tab must not replace the current Voice owner')
    const secondVoiceClient = await fetch(`${baseUrl}${BROWSER_ASSISTANT_BRIDGE_INVOKE_PATH}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            method: 'stopRealtimeVoice',
            clientId: 'browser-voice-client-0002',
            args: []
        })
    }).then((response) => response.json()) as any
    assert.equal(secondVoiceClient.value.success, false, 'another browser tab must not control the current Voice session')
    assert.ok(realtimeVoiceEventListener, 'browser Voice must subscribe directly to AssistantService realtime events')
    realtimeVoiceEventListener!({ type: 'session.started', realtimeVersion: 'v3' })
    realtimeVoiceEventListener!({
        type: 'client.command',
        commandId: 'voice-command-owner-1',
        adapterSessionId: 'adapter-owner-1',
        threadId: 'thread:real',
        realtimeSessionId: 'realtime-owner-1',
        realtimeSessionGeneration: 1,
        messages: [{
            type: 'session.context.append',
            channel: 'speakable',
            content: [{ type: 'input_text', text: 'Owner-scoped narration.' }]
        }]
    })
    const voiceReader = voiceEventResponse.body!.getReader()
    const voiceDecoder = new TextDecoder()
    let voiceEventText = ''
    for (let attempt = 0; attempt < 4 && !voiceEventText.includes('voice-command-owner-1'); attempt += 1) {
        const chunk = await voiceReader.read()
        if (chunk.done) break
        voiceEventText += voiceDecoder.decode(chunk.value)
    }
    assert.equal(voiceEventText.includes('streamId'), true, 'browser Voice events need a process stream identity for reconnect deduplication')
    assert.equal(voiceEventText.includes('session.started'), true, 'browser Voice events must reach the owning renderer')
    assert.equal(voiceEventText.includes('voice-command-owner-1'), true, 'owner-scoped WebRTC commands must reach only the owning renderer')
    const leakedVoiceEvent = await Promise.race<string>([
        otherVoiceReader.read().then((chunk) => chunk.done ? '' : voiceDecoder.decode(chunk.value)),
        new Promise((resolve) => setTimeout(() => resolve('owner-isolated'), 60))
    ])
    assert.equal(leakedVoiceEvent, 'owner-isolated', 'browser Voice events must not leak into another tab stream')
    otherVoiceEventController.abort()
    await otherVoiceReader.cancel().catch(() => undefined)
    voiceEventController.abort()
    await voiceReader.cancel().catch(() => undefined)
    await new Promise((resolve) => setTimeout(resolve, 20))

    const voiceReconnectController = new AbortController()
    const voiceReconnectResponse = await fetch(`${baseUrl}${BROWSER_REALTIME_VOICE_EVENTS_PATH}`, {
        headers: {
            Origin: allowedOrigin,
            [BROWSER_ASSISTANT_BRIDGE_HEADER]: BROWSER_ASSISTANT_BRIDGE_HEADER_VALUE,
            [BROWSER_ASSISTANT_BRIDGE_CAPABILITY_HEADER]: capability,
            [BROWSER_ASSISTANT_CLIENT_ID_HEADER]: voiceClientId
        },
        signal: voiceReconnectController.signal
    })
    assert.equal(voiceReconnectResponse.status, 200)
    const sendAfterReconnect = await fetch(`${baseUrl}${BROWSER_ASSISTANT_BRIDGE_INVOKE_PATH}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            method: 'sendRealtimeVoiceMessage',
            clientId: voiceClientId,
            args: [{ text: 'still connected' }]
        })
    }).then((response) => response.json()) as any
    assert.equal(sendAfterReconnect.value.success, true, 'a brief Voice event-stream reconnect must preserve tab ownership')
    const stopVoice = await fetch(`${baseUrl}${BROWSER_ASSISTANT_BRIDGE_INVOKE_PATH}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ method: 'stopRealtimeVoice', clientId: voiceClientId, args: [] })
    }).then((response) => response.json()) as any
    assert.equal(stopVoice.value.success, true)
    voiceReconnectController.abort()
    await voiceReconnectResponse.body?.cancel().catch(() => undefined)

    const orphanController = new AbortController()
    const orphanResponse = await fetch(`${baseUrl}${BROWSER_REALTIME_VOICE_EVENTS_PATH}`, {
        headers: {
            Origin: allowedOrigin,
            [BROWSER_ASSISTANT_BRIDGE_HEADER]: BROWSER_ASSISTANT_BRIDGE_HEADER_VALUE,
            [BROWSER_ASSISTANT_BRIDGE_CAPABILITY_HEADER]: capability,
            [BROWSER_ASSISTANT_CLIENT_ID_HEADER]: voiceClientId
        },
        signal: orphanController.signal
    })
    const orphanReader = orphanResponse.body!.getReader()
    await orphanReader.read()
    const orphanStart = await fetch(`${baseUrl}${BROWSER_ASSISTANT_BRIDGE_INVOKE_PATH}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            method: 'startRealtimeVoice',
            clientId: voiceClientId,
            args: [{ sdp: 'offer', conversationId: 'thread:real', sessionId: 'session:real' }]
        })
    }).then((response) => response.json()) as any
    assert.equal(orphanStart.value.success, true)
    orphanController.abort()
    await orphanReader.cancel().catch(() => undefined)
    await new Promise((resolve) => setTimeout(resolve, 2_750))

    const orphanReplayController = new AbortController()
    const orphanReplayResponse = await fetch(`${baseUrl}${BROWSER_REALTIME_VOICE_EVENTS_PATH}`, {
        headers: {
            Origin: allowedOrigin,
            [BROWSER_ASSISTANT_BRIDGE_HEADER]: BROWSER_ASSISTANT_BRIDGE_HEADER_VALUE,
            [BROWSER_ASSISTANT_BRIDGE_CAPABILITY_HEADER]: capability,
            [BROWSER_ASSISTANT_CLIENT_ID_HEADER]: voiceClientId
        },
        signal: orphanReplayController.signal
    })
    const orphanReplayReader = orphanReplayResponse.body!.getReader()
    let orphanReplayText = ''
    for (let attempt = 0; attempt < 3 && !orphanReplayText.includes('session.closed'); attempt += 1) {
        const chunk = await orphanReplayReader.read()
        if (chunk.done) break
        orphanReplayText += voiceDecoder.decode(chunk.value)
    }
    assert.equal(orphanReplayText.includes('session.closed'), true, 'late reconnects must replay the terminal event after orphan cleanup')
    orphanReplayController.abort()
    await orphanReplayReader.cancel().catch(() => undefined)

    const devscopeEventController = new AbortController()
    const devscopeEventResponse = await fetch(`${baseUrl}${BROWSER_DEVSCOPE_BRIDGE_EVENTS_PATH}`, {
        headers: {
            Origin: allowedOrigin,
            [BROWSER_ASSISTANT_BRIDGE_HEADER]: BROWSER_ASSISTANT_BRIDGE_HEADER_VALUE,
            [BROWSER_ASSISTANT_BRIDGE_CAPABILITY_HEADER]: capability
        },
        signal: devscopeEventController.signal
    })
    assert.equal(devscopeEventResponse.status, 200)
    assert.ok(devscopeEventListener, 'the bridge must subscribe to trusted Desktop events')
    devscopeEventListener!({ event: 'previewTerminal', payload: { sessionId: 'terminal:1', data: 'ready' } })
    const devscopeReader = devscopeEventResponse.body!.getReader()
    const devscopeDecoder = new TextDecoder()
    let devscopeEventText = ''
    for (let attempt = 0; attempt < 3 && !devscopeEventText.includes('terminal:1'); attempt += 1) {
        const chunk = await devscopeReader.read()
        if (chunk.done) break
        devscopeEventText += devscopeDecoder.decode(chunk.value)
    }
    assert.equal(devscopeEventText.includes('previewTerminal'), true, 'trusted Desktop events must reach browser subscribers')
    assert.equal(browserClientCounts.at(-1), 0, 'non-Assistant event streams must not claim Assistant selection')
    devscopeEventController.abort()
    await devscopeReader.cancel().catch(() => undefined)

    const replayController = new AbortController()
    const replayResponse = await fetch(`${baseUrl}${BROWSER_DEVSCOPE_BRIDGE_EVENTS_PATH}`, {
        headers: {
            Origin: allowedOrigin,
            [BROWSER_ASSISTANT_BRIDGE_HEADER]: BROWSER_ASSISTANT_BRIDGE_HEADER_VALUE,
            [BROWSER_ASSISTANT_BRIDGE_CAPABILITY_HEADER]: capability
        },
        signal: replayController.signal
    })
    const replayReader = replayResponse.body!.getReader()
    const replayDecoder = new TextDecoder()
    let replayText = ''
    for (let attempt = 0; attempt < 3 && !replayText.includes('terminal:1'); attempt += 1) {
        const replayChunk = await replayReader.read()
        if (replayChunk.done) break
        replayText += replayDecoder.decode(replayChunk.value)
    }
    assert.equal(replayText.includes('terminal:1'), true, 'browser action events must replay after a short disconnect')
    assert.equal(replayText.includes('streamId'), true, 'replayed events must carry a process identity for client deduplication')
    assert.equal(replayText.includes('sequence'), true, 'replayed events must carry a monotonic sequence')
    replayController.abort()
    await replayReader.cancel().catch(() => undefined)

    console.log('Browser assistant bridge: ok')
} finally {
    await bridge.stop()
    assert.equal(existsSync(descriptorPath), false, 'stopping Desktop must remove browser bridge discovery')
    rmSync(stateDirectory, { recursive: true, force: true })
}
