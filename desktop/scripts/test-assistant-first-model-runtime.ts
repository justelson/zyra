import assert from 'node:assert/strict'
import { mock } from 'bun:test'

const noop = () => undefined
mock.module('electron-log', () => ({ default: { info: noop, warn: noop, error: noop, debug: noop } }))
mock.module('../src/main/agent-control', () => ({ getAgentControlBroker: () => ({ revokePrincipal: noop }) }))
mock.module('electron', () => ({ app: { getPath: () => process.env.TEMP || process.cwd(), isReady: () => true, on: noop, once: noop },
    BrowserWindow: class { static getAllWindows() { return [] } }, screen: { getAllDisplays: () => [] },
    nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) }, webContents: { fromId: () => null }, safeStorage: { isEncryptionAvailable: () => false } }))
const { ZyraRuntime } = await import('../src/main/assistant/zyra-runtime')
const { createAssistantThread } = await import('../src/main/assistant/service-state')

for (const selected of ['', 'openai-codex/gpt-6.1-sol']) {
    const runtime = new ZyraRuntime()
    const requests: Record<string, unknown>[] = []
    const worker = {
        setControlRequestHandler: noop, onEvent: () => noop, isAlive: () => true, flushReplay: noop,
        dispose: noop,
        request: async (_type: string, payload: Record<string, unknown>) => {
            requests.push(payload)
            if (payload.model === 'openai-codex/gpt-5.5') {
                throw Error("Model 'openai-codex/gpt-5.5' not found or not authenticated (7 models available from: openai-codex). Use /models, or check your Zyra model/auth settings.")
            }
            return { threadId: 'first-canonical', model: 'openai-codex/gpt-6.1-sol' }
        }
    }
    ;(runtime as any).checkAvailability = async () => ({ available: true, reason: null })
    ;(runtime as any).getAgentServerConnection = () => ({ updatePluginAuthority: async () => {}, createWorker: () => worker })
    const thread = createAssistantThread('2026-10-06T15:12:07.526Z')
    thread.model = selected
    try {
        await runtime.connect(thread, process.cwd())
        assert.equal(requests[0]?.model || '', selected, 'blank configuration reaches the canonical runtime without an invented model; explicit choices remain exact')
    } finally {
        runtime.dispose()
    }
}
console.log('First attachment: unset defaults delegate to the authenticated runtime; explicit models are preserved: ok')
