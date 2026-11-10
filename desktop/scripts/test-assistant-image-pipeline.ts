import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { prepareAssistantPromptImages } from '../src/main/assistant/prompt-images'
import { mock } from 'bun:test'
import {
    buildPromptImageInputs,
    buildPromptWithContextFiles
} from '../src/renderer/src/pages/assistant/assistant-composer-utils'
import type { ComposerContextFile } from '../src/renderer/src/pages/assistant/assistant-composer-types'

const electronNoop = (): undefined => undefined
mock.module('electron', () => ({
    app: {
        getPath: () => process.env.TEMP || process.cwd(),
        isReady: () => true,
        on: electronNoop,
        once: electronNoop
    },
    BrowserWindow: class {
        static getAllWindows(): never[] { return [] }
        static fromWebContents(): null { return null }
    },
    screen: {
        getAllDisplays: () => [],
        getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 } })
    },
    nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) },
    webContents: { fromId: () => null },
    safeStorage: { isEncryptionAvailable: () => false },
    globalShortcut: { register: () => true, unregisterAll: electronNoop }
}))
const { ZyraRuntime } = await import('../src/main/assistant/zyra-runtime')

const tempDir = await mkdtemp(join(tmpdir(), 'zyra-image-pipeline-'))
let fixtureChild: ChildProcess | null = null
try {
    const imagePath = join(tempDir, 'capture.png')
    const unsupportedPath = join(tempDir, 'not-an-image.txt')
    const pngBytes = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64'
    )
    await writeFile(imagePath, pngBytes)
    await writeFile(unsupportedPath, 'plain text')

    const contextFiles: ComposerContextFile[] = [
        {
            id: 'image-1',
            path: imagePath,
            name: 'capture.png',
            mimeType: 'image/png',
            kind: 'image',
            source: 'paste'
        },
        {
            id: 'doc-1',
            path: join(tempDir, 'notes.txt'),
            name: 'notes.txt',
            mimeType: 'text/plain',
            kind: 'doc',
            source: 'manual'
        }
    ]

    const imageInputs = buildPromptImageInputs(contextFiles)
    assert.deepEqual(imageInputs, [{ path: imagePath, name: 'capture.png', mimeType: 'image/png' }])

    const serializedPrompt = buildPromptWithContextFiles('Inspect the marked control.', contextFiles.slice(0, 1))
    assert.equal(serializedPrompt.includes(imagePath), false, 'private clipboard storage paths must stay out of chat text')
    assert.match(serializedPrompt, /ref: clipboard:\/\/capture\.png/)

    const prepared = await prepareAssistantPromptImages(imageInputs)
    assert.equal(prepared.length, 1)
    assert.equal(prepared[0]?.type, 'image')
    assert.equal(prepared[0]?.mimeType, 'image/png')
    assert.deepEqual(Buffer.from(prepared[0]?.data || '', 'base64'), pngBytes)

    const preparedFromClipboardReference = await prepareAssistantPromptImages(
        [{ path: 'clipboard://capture.png', name: 'Pasted image', mimeType: 'image/png' }],
        { resolveClipboardAttachment: async () => imagePath }
    )
    assert.deepEqual(preparedFromClipboardReference, prepared)

    const fakeRoot = join(tempDir, 'fake-root')
    const fakeSdkDir = join(fakeRoot, 'src')
    const bridgeCapturePath = join(tempDir, 'bridge-capture.json')
    await mkdir(fakeSdkDir, { recursive: true })
    await writeFile(join(fakeSdkDir, 'zyra-sdk.mjs'), `
import { writeFile } from 'node:fs/promises'
export async function prepareZyraSessionRuntime() {}
export async function createZyraSession() {
    return {
        session: {
            getActiveToolNames: () => [],
            subscribe: () => () => {},
            steer: async (prompt, images) => writeFile(process.env.ZYRA_IMAGE_CAPTURE_PATH, JSON.stringify({ prompt, images })),
            followUp: async (prompt, images) => writeFile(process.env.ZYRA_IMAGE_CAPTURE_PATH, JSON.stringify({ prompt, images })),
            modelRegistry: { authStorage: { refreshAuthProvider: async () => ({ errors: new Map() }), modelRuntime: { refresh: async () => {} } } },
            sessionManager: { getSessionId: () => 'fake-provider-thread' },
            dispose: () => {}
        },
        managedBash: { subscribe: () => () => {}, abortAll: () => {} }
    }
}
export function describeRuntime() { return { sessionId: 'fake-provider-thread', model: 'fake/model', profile: 'default' } }
export async function setModel() {}
export function setThinking() {}
export function getZyraThinkingLevel() { return "medium" }
export function setZyraReasoningSummary() {}
export async function setProfile() {}
export async function runZyraPrompt(_runtime, prompt, options) {
    await writeFile(process.env.ZYRA_IMAGE_CAPTURE_PATH, JSON.stringify({ prompt, images: options.images }))
}
export function getZyraModelThinkingLevels() { return [] }
export function getZyraAvailableModels() { return [] }
export async function listAvailableModels() { return [] }
export async function warmupZyraRuntime() { return { models: [] } }
`)

    const bridgeProcess = spawn('node', [fileURLToPath(new URL('../../src/zyra-ui-bridge.mjs', import.meta.url))], {
        cwd: fakeRoot,
        env: {
            ...process.env,
            ZYRA_STANDALONE: "0",
            ZYRA_ROOT: fakeRoot,
            ZYRA_CALLER_CWD: tempDir,
            ZYRA_IMAGE_CAPTURE_PATH: bridgeCapturePath
        },
        stdio: ['pipe', 'pipe', 'pipe']
    })
    fixtureChild = bridgeProcess
    const bridgeExited = new Promise<void>((resolve) => bridgeProcess.once('close', () => resolve()))
    const bridgeLines = createInterface({ input: bridgeProcess.stdout })
    const bridgeErrors: string[] = []
    const bridgeOutput: string[] = []
    bridgeProcess.stderr.setEncoding('utf8')
    bridgeProcess.stderr.on('data', (chunk) => bridgeErrors.push(String(chunk)))
    const bridgeResponses = new Map<number, (message: Record<string, unknown>) => void>()
    bridgeLines.on('line', (line) => {
        bridgeOutput.push(line.slice(0, 2000))
        const message = JSON.parse(line) as Record<string, unknown>
        if (message['type'] !== 'response' || typeof message['id'] !== 'number') return
        bridgeResponses.get(message['id'])?.(message)
        bridgeResponses.delete(message['id'])
    })
    const requestBridge = async (id: number, type: string, payload: Record<string, unknown>) => {
        const response = new Promise<Record<string, unknown>>((resolve, reject) => {
            const timeout = setTimeout(() => {
                bridgeResponses.delete(id)
                reject(new Error(`Timed out waiting for bridge ${type}: ${bridgeErrors.join('')} | output: ${bridgeOutput.slice(-3).join('')}`))
            }, 30_000)
            bridgeResponses.set(id, (message) => {
                clearTimeout(timeout)
                resolve(message)
            })
        })
        bridgeProcess.stdin.write(`${JSON.stringify({ id, type, payload })}\n`)
        return await response
    }
    const connectResponse = await requestBridge(1, 'connect', {
        cwd: tempDir,
        surface: "memory-worker",
        noSession: true,
        model: 'fake/model',
        profile: 'default',
        thinking: 'medium'
    })
    assert.equal(connectResponse['ok'], true, JSON.stringify(connectResponse))
    const promptResponse = await requestBridge(2, 'prompt', {
        prompt: 'Inspect the image.',
        model: 'fake/model',
        profile: 'default',
        thinking: 'medium',
        images: prepared
    })
    assert.equal(promptResponse['ok'], true)
    const bridgeCapture = JSON.parse(await readFile(bridgeCapturePath, 'utf8')) as Record<string, unknown>
    assert.equal(bridgeCapture['prompt'], 'Inspect the image.')
    assert.deepEqual(bridgeCapture['images'], prepared, 'the JSON-line bridge must deliver native images to runZyraPrompt')
    for (const [index, type] of ['steer', 'follow_up'].entries()) {
        const accepted = await requestBridge(10 + index, type, { prompt: 'Image follow-up', images: prepared })
        assert.equal(accepted['ok'], true)
        assert.deepEqual(JSON.parse(await readFile(bridgeCapturePath, 'utf8')).images, prepared)
        const rejected = await requestBridge(20 + index, type, { prompt: 'Invalid image', images: [{ type: 'image', mimeType: 'image/png', data: 'AAAA' }] })
        assert.equal(rejected['ok'], false, type + ' must enforce the same image contract as prompts')
    }
    const imageOnly = await requestBridge(30, 'prompt', { prompt: '', images: prepared })
    assert.equal(imageOnly['ok'], true, 'image-only prompts must reach the runtime')
    await requestBridge(3, 'dispose', {})
    await bridgeExited
    bridgeLines.close()

    await assert.rejects(
        () => prepareAssistantPromptImages([{ path: unsupportedPath, name: 'not-an-image.txt' }]),
        /not a supported PNG, JPEG, GIF, or WebP image/
    )
    await assert.rejects(
        () => prepareAssistantPromptImages([{ path: join(tempDir, 'missing.png'), name: 'missing.png' }]),
        /no longer available/
    )

    const runtime = new ZyraRuntime()
    const promptRequests: Array<Record<string, unknown>> = []
    const turnId = 'turn-with-image'
    const runtimeContext = {
        localThreadId: 'thread-with-image',
        providerThreadId: 'provider-with-image',
        resumeProviderThreadId: 'provider-with-image',
        worker: {
            serverOwnedLifecycle: true,
            request: async (type: string, payload: Record<string, unknown>) => {
                if (type === 'prompt') promptRequests.push(payload)
                return {}
            },
            isAlive: () => true
        },
        connected: true,
        connectPromise: null,
        cwd: tempDir,
        model: 'openai-codex/gpt-5.5',
        thinking: 'medium',
        runtimeMode: 'approval-required',
        interactionMode: 'default',
        profile: 'default',
        activeTurnId: turnId,
        assistantMessageSequence: 0,
        activeAssistantItemId: null,
        toolArgsByCallId: new Map<string, Record<string, unknown>>(),
        toolStartedAtByCallId: new Map<string, string>(),
        commandActivityIdByJobId: new Map<string, string>(),
        assistantTextByItemId: new Map<string, string>(),
        assistantCompletedItemIds: new Set<string>(),
        internalTextByItemId: new Map<string, string>(),
        internalCompletedItemIds: new Set<string>(),
        activeCompaction: null,
        lastAssistantItemId: null,
        lastUsage: null
    }
    const runtimeRunner = runtime as unknown as {
        runPromptTurn: (
            context: typeof runtimeContext,
            activeTurnId: string,
            prompt: string,
            options: { images: typeof prepared }
        ) => Promise<void>
    }
    await runtimeRunner.runPromptTurn(runtimeContext, turnId, 'Inspect the image.', { images: prepared })
    assert.equal(promptRequests.length, 1)
    assert.deepEqual(promptRequests[0]?.['images'], prepared, 'the desktop runtime must send prepared images to the Pi bridge')

    const bridgeSource = await readFile(new URL('../../src/zyra-ui-bridge.mjs', import.meta.url), 'utf8')
    assert.match(
        bridgeSource,
        /runZyraPrompt\(runtime, payload\.prompt, \{\s*images,/,
        'the Pi bridge must forward native image content to the SDK'
    )

    const { sendAssistantPromptAction } = await import('../src/main/assistant/service-session-actions')
    const { createAssistantThread } = await import('../src/main/assistant/service-state')
    const { createAssistantSessionRecord } = await import('../src/main/assistant/service-records')
    const { createDefaultAssistantSnapshot } = await import('../src/shared/assistant/projector')
    const thread = createAssistantThread(new Date().toISOString())
    thread.latestTurn = { id: 'image-turn', state: 'running' } as typeof thread.latestTurn
    const session = createAssistantSessionRecord({ sessionId: 'image-session', title: 'Image fixture', projectPath: null, thread, createdAt: new Date().toISOString() })
    const snapshot = { ...createDefaultAssistantSnapshot(), selectedSessionId: session.id, sessions: [session] }
    let recorded = 0, dispatched = 0
    const deps: any = { ensureReady: async () => {}, getSnapshot: () => snapshot,
        appendEvent: () => { recorded++ },
        runtime: { ensurePromptAvailable: async () => {}, steerPrompt: async () => { dispatched++; return { turnId: 'image-turn' } } }
    }
    for (const dispatchMode of [undefined, 'steer'] as const) {
        await assert.rejects(sendAssistantPromptAction(deps, 'Inspect synthetic attachment', {
            sessionId: session.id, dispatchMode, targetTurnId: 'image-turn',
            images: [{ path: unsupportedPath, name: 'not-an-image.txt', mimeType: 'text/plain' }]
        }), /image/i)
    }
    assert.equal(recorded, 0, 'invalid images cannot create a durable user message in either send mode')
    assert.equal(dispatched, 0, 'invalid images cannot reach the working model')

    console.log('Assistant native image pipeline: ok')
} finally {
    if (fixtureChild && fixtureChild.exitCode == null) {
        const stopped = new Promise<void>(resolve => fixtureChild!.once("close", () => resolve()))
        fixtureChild.kill(); await stopped
    }
    assert.equal(dirname(resolve(tempDir)), resolve(tmpdir()))
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
}
