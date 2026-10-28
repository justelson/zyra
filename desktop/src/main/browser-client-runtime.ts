import { app } from 'electron'
import { readRuntimeActivation, subscribeRuntimeActivation } from './assistant/runtime-activation'
import { CHROME_EXTENSION_STORE_ID, CHROME_EXTENSION_DEVELOPMENT_ID, chromeExtensionOrigins } from '../shared/chrome-extension-identity'
import { connectChromeExtension } from './agent-control'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import type { WebContents } from 'electron'
import {
    BROWSER_ASSISTANT_BRIDGE_DESCRIPTOR_NAME
} from '../shared/browser-assistant-bridge'
import type {
    AssistantPersistClipboardImageInput,
    AssistantTranscribeVoiceInput,
    AssistantVoiceTranscriptionState
} from '../shared/assistant/contracts'
import { BrowserAssistantBridge, getBrowserAssistantBridgeOrigins } from './assistant/browser-assistant-bridge'
import { setActiveBrowserAssistantClientCount } from './assistant/browser-client-lease'
import type { AssistantService } from './assistant/service'
import { BrowserClientHost, getBrowserClientHostOrigins } from './browser-client-host'
import { BrowserDevscopeRelay } from './browser-devscope-relay'

export type BrowserClientRuntimeDependencies = {
    getAssistantService: () => AssistantService | null
    getDevscopeTarget: () => WebContents | null
    userDataPath: string
    staticRoot: string
    rendererUrl?: string
    persistClipboardImage: (input: AssistantPersistClipboardImageInput) => Promise<string>
    resolveClipboardAttachment: (reference: string) => Promise<string | null>
    getVoiceTranscriptionState: () => Promise<AssistantVoiceTranscriptionState>
    transcribeVoice: (input: AssistantTranscribeVoiceInput) => Promise<string>
    saveVoiceHistory: (input: import('./assistant/voice-history').SaveVoiceHistoryInput) => Promise<void>
    listVoiceHistory: (input: { page?: number }) => Promise<import('./assistant/voice-history').VoiceHistoryPage>
    getFailedVoiceRecording: (id: string) => Promise<string | null>
    deleteVoiceHistory: (id: string) => Promise<void>
    isOnboardingComplete: () => boolean
    clientPort?: number
}

export class BrowserClientRuntime {
    private bridge: BrowserAssistantBridge | null = null
    private clientHost: BrowserClientHost | null = null
    private devscopeRelay: BrowserDevscopeRelay | null = null
    private generation = 0
    private startPromise: Promise<{ host: string; port: number; origin: string }> | null = null

    constructor(private readonly dependencies: BrowserClientRuntimeDependencies) {}

    start(): Promise<{ host: string; port: number; origin: string }> {
        if (this.startPromise) return this.startPromise
        const generation = ++this.generation
        const startPromise = this.startGeneration(generation).catch(async (error) => {
            if (this.generation === generation) await this.stop()
            throw error
        })
        this.startPromise = startPromise
        return startPromise
    }

    async stop(): Promise<void> {
        this.generation += 1
        this.startPromise = null
        const clientHost = this.clientHost
        const bridge = this.bridge
        const devscopeRelay = this.devscopeRelay
        this.clientHost = null
        this.bridge = null
        this.devscopeRelay = null
        devscopeRelay?.dispose()
        await Promise.all([
            clientHost?.stop().catch(() => undefined),
            bridge?.stop().catch(() => undefined)
        ])
    }

    private async startGeneration(generation: number): Promise<{ host: string; port: number; origin: string }> {
        const capability = randomBytes(32).toString('base64url')
        const allowedOrigins = getBrowserClientHostOrigins(this.dependencies.clientPort)
        if (this.dependencies.rendererUrl) {
            for (const origin of getBrowserAssistantBridgeOrigins(this.dependencies.rendererUrl)) allowedOrigins.add(origin)
        }

        const devscopeRelay = new BrowserDevscopeRelay(this.dependencies.getDevscopeTarget)
        const bridge = new BrowserAssistantBridge({
            getService: this.dependencies.getAssistantService,
            allowedOrigins,
            capability,
            descriptorPath: join(this.dependencies.userDataPath, BROWSER_ASSISTANT_BRIDGE_DESCRIPTOR_NAME),
            invokeDevscope: (path, args) => path.length === 2 && path[0] === 'runtimeActivation' && path[1] === 'getState'
                ? Promise.resolve(readRuntimeActivation()) : devscopeRelay.invoke(path, args),
            subscribeDevscopeEvents: (listener) => {
                const stopRelay = devscopeRelay.subscribeEvents(listener)
                const stopRuntime = subscribeRuntimeActivation(payload => listener({ event: 'runtimeActivationChanged', payload }))
                return () => { stopRelay(); stopRuntime() }
            },
            onAssistantClientCountChanged: setActiveBrowserAssistantClientCount,
            persistClipboardImage: this.dependencies.persistClipboardImage,
            resolveClipboardAttachment: this.dependencies.resolveClipboardAttachment,
            getVoiceTranscriptionState: this.dependencies.getVoiceTranscriptionState,
            transcribeVoice: this.dependencies.transcribeVoice,
            saveVoiceHistory: this.dependencies.saveVoiceHistory,
            listVoiceHistory: this.dependencies.listVoiceHistory,
            getFailedVoiceRecording: this.dependencies.getFailedVoiceRecording,
            deleteVoiceHistory: this.dependencies.deleteVoiceHistory,
            isOnboardingComplete: this.dependencies.isOnboardingComplete
        })
        this.devscopeRelay = devscopeRelay
        this.bridge = bridge

        const bridgeAddress = await bridge.start()
        if (generation !== this.generation) throw new Error('The local browser runtime stopped during startup.')

        const clientHost = new BrowserClientHost({
            extensionOrigins: chromeExtensionOrigins([
                CHROME_EXTENSION_STORE_ID,
                ...(!app.isPackaged ? [CHROME_EXTENSION_DEVELOPMENT_ID] : [])
            ]),
            connectExtension: connectChromeExtension,
            getRuntimeStatus: readRuntimeActivation,
            bridge: { ...bridgeAddress, capability },
            ...(this.dependencies.clientPort ? { port: this.dependencies.clientPort } : {}),
            ...(this.dependencies.rendererUrl
                ? { devRendererUrl: this.dependencies.rendererUrl }
                : { staticRoot: this.dependencies.staticRoot })
        })
        this.clientHost = clientHost
        const clientAddress = await clientHost.start()
        if (generation !== this.generation) throw new Error('The local browser runtime stopped during startup.')
        return clientAddress
    }
}
