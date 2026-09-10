import { randomUUID } from 'crypto'
import { mkdirSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { ControlAction, ControlElement, ControlObservation, ControlTarget } from '../../../shared/agent-control/contracts'
import { CONTROL_BOUNDS, normalizedOrigin } from '../../../shared/agent-control/policy'
import { AgentControlError } from '../control-errors'
import type { ChromePairingEvent, ChromePairingServer } from '../chrome-pairing-server'
import type { RegisteredControlTarget } from '../target-registry'
import type { AgentControlDriver, DriverActionContext, DriverObservationOptions } from './driver'

type ChromeTrustedTab = { pairId: string; extensionId: string; tabId: number; documentId: string; tabToken: string }

export class ChromeExtensionDriver implements AgentControlDriver {
    readonly kind = 'chrome-tab' as const
    private readonly targetByTab = new Map<string, string>()
    private onRegister?: (input: { target: Omit<Extract<ControlTarget, { kind: 'chrome-tab' }>, 'targetId'>; trustedIdentity: ChromeTrustedTab }) => string
    private onRemove?: (targetId: string, reason: string) => void
    private disconnectedReason: string | undefined
    private readonly artifacts = new Map<string, string>()

    constructor(private readonly pairing: ChromePairingServer, private readonly artifactDirectory: string) {
        pairing.on('extension-event', (event: ChromePairingEvent) => this.handleEvent(event))
    }

    setRegistrationHandlers(handlers: {
        register: (input: { target: Omit<Extract<ControlTarget, { kind: 'chrome-tab' }>, 'targetId'>; trustedIdentity: ChromeTrustedTab }) => string
        remove: (targetId: string, reason: string) => void
    }): void {
        this.onRegister = handlers.register
        this.onRemove = handlers.remove
    }

    async observe(target: RegisteredControlTarget, options: DriverObservationOptions): Promise<ControlObservation> {
        const trusted = target.trustedIdentity as ChromeTrustedTab
        const result = await this.pairing.request(trusted.pairId, {
            type: 'observe', tabId: trusted.tabId, documentId: trusted.documentId,
            observationRevision: options.revision,
            includeScreenshot: options.includeScreenshot,
            bounds: { maxElements: CONTROL_BOUNDS.maxObservationElements, maxBytes: CONTROL_BOUNDS.maxObservationBytes }
        }, undefined, options.signal) as Record<string, unknown>
        const elements = normalizeElements(result.elements)
        const screenshotRef = this.persistScreenshot(result.screenshotData)
        const url = safeString(result.url, CONTROL_BOUNDS.maxUrlLength)
        const origin = normalizedOrigin(url) || undefined
        if (target.target.kind === 'chrome-tab') {
            target.target.origin = origin || null
            target.target.url = url || undefined
            target.target.title = safeString(result.title, 512) || undefined
        }
        return {
            version: 1,
            observationId: `control-observation:${randomUUID()}`,
            revision: options.revision,
            targetId: target.target.targetId,
            capturedAt: new Date().toISOString(),
            targetState: normalizeState(result.targetState),
            url: url || undefined,
            title: safeString(result.title, 512) || undefined,
            origin,
            viewport: normalizeViewport(result.viewport),
            elements,
            screenshotRef,
            focusedElementRef: safeString(result.focusedElementRef, 192) || undefined,
            truncation: normalizeTruncation(result.truncation),
            redactions: Array.isArray(result.redactions) ? result.redactions.map((entry) => safeString(entry, 128)).filter(Boolean).slice(0, 32) : []
        }
    }

    async act(target: RegisteredControlTarget, action: ControlAction, context: DriverActionContext): Promise<{ changed: boolean }> {
        const trusted = target.trustedIdentity as ChromeTrustedTab
        const result = await this.pairing.request(trusted.pairId, {
            type: 'action', tabId: trusted.tabId, documentId: trusted.documentId,
            observationRevision: context.revision,
            allowWindowFocus: context.allowWindowFocus === true,
            action
        }, action.type === 'stroke' ? Math.min(30_000, Math.max(15_000, action.points.length * 55 + (action.durationMs || 400) + 2_000)) : undefined, context.signal) as Record<string, unknown>
        if (result.documentId && result.documentId !== trusted.documentId) trusted.documentId = safeString(result.documentId, 192)
        return { changed: result.changed !== false }
    }

    async release(target: RegisteredControlTarget): Promise<void> {
        const trusted = target.trustedIdentity as ChromeTrustedTab
        await this.pairing.request(trusted.pairId, { type: 'revoke-tab', tabId: trusted.tabId }, 2_000).catch(() => undefined)
        this.targetByTab.delete(`${trusted.pairId}:${trusted.tabId}`)
    }

    async emergencyStop(): Promise<void> {
        this.disconnectedReason = 'emergency-stop'
        this.clearArtifacts()
        await this.pairing.stop('emergency-stop')
    }

    private persistScreenshot(value: unknown): string | undefined {
        const encoded = safeString(value, 512 * 1024)
        if (!encoded) return undefined
        const bytes = Buffer.from(encoded, 'base64')
        if (bytes.length === 0 || bytes.length > CONTROL_BOUNDS.maxScreenshotBytes) return undefined
        mkdirSync(this.artifactDirectory, { recursive: true })
        const screenshotRef = `control-artifact:${randomUUID()}`
        const file = join(this.artifactDirectory, `${screenshotRef.slice('control-artifact:'.length)}.jpg`)
        writeFileSync(file, bytes, { mode: 0o600 })
        this.artifacts.set(screenshotRef, file)
        while (this.artifacts.size > 20) {
            const oldest = this.artifacts.keys().next().value
            if (!oldest) break
            const oldFile = this.artifacts.get(oldest)
            this.artifacts.delete(oldest)
            if (oldFile) { try { unlinkSync(oldFile) } catch {} }
        }
        return screenshotRef
    }

    private clearArtifacts(): void {
        for (const file of this.artifacts.values()) { try { unlinkSync(file) } catch {} }
        this.artifacts.clear()
    }

    health() {
        const state = this.pairing.state().state
        return {
            state: state === 'paired' ? 'ready' as const : state === 'error' ? 'degraded' as const : 'disconnected' as const,
            lastDisconnectReason: this.disconnectedReason
        }
    }

    private handleEvent(event: ChromePairingEvent): void {
        if (event.type === 'tab.register') {
            const key = `${event.pairId}:${event.tabId}`
            const existing = this.targetByTab.get(key)
            if (existing) this.onRemove?.(existing, 'Chrome tab was re-paired with a new document.')
            const tabToken = `chrome-tab-token:${randomUUID()}`
            const trustedIdentity: ChromeTrustedTab = {
                pairId: event.pairId,
                extensionId: event.extensionId,
                tabId: event.tabId,
                documentId: event.documentId,
                tabToken
            }
            const targetId = this.onRegister?.({
                target: { kind: 'chrome-tab', accessMode: event.mode || 'control', pairId: event.pairId, tabToken, title: safeString(event.title, 512), url: safeString(event.url, CONTROL_BOUNDS.maxUrlLength), origin: normalizedOrigin(event.url) },
                trustedIdentity
            })
            if (targetId) this.targetByTab.set(key, targetId)
            this.disconnectedReason = undefined
            return
        }
        if (event.type === 'tab.closed') {
            const key = `${event.pairId}:${event.tabId}`
            const targetId = this.targetByTab.get(key)
            if (targetId) this.onRemove?.(targetId, 'Paired Chrome tab closed.')
            this.targetByTab.delete(key)
            return
        }
        for (const [key, targetId] of [...this.targetByTab]) {
            if (!key.startsWith(`${event.pairId}:`)) continue
            this.onRemove?.(targetId, `Chrome extension disconnected: ${event.reason}`)
            this.targetByTab.delete(key)
        }
        this.disconnectedReason = event.reason
    }
}

function safeString(value: unknown, max: number): string {
    return typeof value === 'string' ? value.slice(0, max) : ''
}

function normalizeElements(value: unknown): ControlElement[] {
    if (!Array.isArray(value)) return []
    return value.slice(0, CONTROL_BOUNDS.maxObservationElements).flatMap((entry, index) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
        const element = entry as Record<string, unknown>
        return [{
            elementRef: safeString(element.elementRef, 192) || `chrome-element:${index + 1}`,
            role: safeString(element.role, 128) || 'generic',
            name: safeString(element.name, 512) || undefined,
            text: safeString(element.text, 2_048) || undefined,
            value: safeString(element.value, 2_048) || undefined,
            description: safeString(element.description, 512) || undefined,
            bounds: normalizeBounds(element.bounds),
            states: Array.isArray(element.states) ? element.states.map((item) => safeString(item, 64)).filter(Boolean).slice(0, 24) : undefined,
            actions: Array.isArray(element.actions) ? element.actions.map((item) => safeString(item, 64)).filter(Boolean).slice(0, 16) : undefined,
            sensitive: element.sensitive === true
        }]
    })
}

function normalizeBounds(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
    const bounds = value as Record<string, unknown>
    const numbers = ['x', 'y', 'width', 'height'].map((key) => Number(bounds[key]))
    return numbers.every(Number.isFinite) ? { x: numbers[0], y: numbers[1], width: numbers[2], height: numbers[3] } : undefined
}

function normalizeViewport(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
    const viewport = value as Record<string, unknown>
    const width = Number(viewport.width)
    const height = Number(viewport.height)
    const scale = Number(viewport.scale || 1)
    return [width, height, scale].every(Number.isFinite) ? { width, height, scale } : undefined
}

function normalizeTruncation(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
    const truncation = value as Record<string, unknown>
    const totalElements = Number(truncation.totalElements)
    const returnedElements = Number(truncation.returnedElements)
    return [totalElements, returnedElements].every(Number.isFinite) ? { totalElements, returnedElements } : undefined
}

function normalizeState(value: unknown): ControlObservation['targetState'] {
    return ['ready', 'navigating', 'detached', 'closed', 'blocked'].includes(String(value)) ? value as ControlObservation['targetState'] : 'ready'
}
