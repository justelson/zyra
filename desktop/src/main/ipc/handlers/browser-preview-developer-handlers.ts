import { enqueueBrowserCaptureDraft, readBrowserCaptureDraft, acknowledgeBrowserCaptureDraft } from '../../browser-capture-handoff'
import { captureBrowserPage } from '../../browser-page-capture'
import { browserRecordingCapture, resolveBrowserRecordingController, type BrowserRecordingAudioSource } from '../../browser-recording-capture'
import { randomUUID } from 'crypto'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import {
    app,
    clipboard,
    nativeImage,
    shell,
    webContents,
    type IpcMainInvokeEvent,
    type NativeImage,
    type WebContents
} from 'electron'
import log from 'electron-log'
import {
    isTrustedBrowserTabId,
    trustedBrowserGuests
} from '../../agent-control/trusted-guest-registry'
import {
    BROWSER_PREVIEW_RECORDING_FRAME_CHANNEL,
    type DevScopeBrowserAnnotationInput,
    type DevScopeBrowserAnnotationPayload,
    type DevScopeBrowserAnnotationRect,
    type DevScopeBrowserAnnotationTheme,
    type DevScopeBrowserCaptureArtifact,
    type DevScopeBrowserColorScheme,
    type DevScopeBrowserGuestTargetInput,
    type DevScopeBrowserRecordingFrame
} from '../../../shared/contracts/devscope-api'
import { ZYRA_BROWSER_GLOBAL_PARTITION } from './browser-preview-handlers'
import {
    BROWSER_PREVIEW_ANNOTATION_CANCEL_SOURCE,
    BROWSER_PREVIEW_ANNOTATION_CAPTURED_SOURCE,
    browserPreviewAnnotationSource
} from './browser-preview-annotation-script'
import { session } from 'electron'
import { stageAssistantClipboardImageFile } from '../../assistant/clipboard-attachments'
import { getBrowserUserZoomFactor, setManagedBrowserUserZoomFactor } from '../../browser-view-presentation'
import { BrowserCaptureLibrary } from '../../browser-capture-library'

const BROWSER_ZOOM_MIN = 0.25
const BROWSER_ZOOM_MAX = 2
const SCREENSHOT_MAX_BYTES = 25 * 1024 * 1024
const SCREENSHOT_PREVIEW_MAX_WIDTH = 640
const SCREENSHOT_PREVIEW_MAX_HEIGHT = 440
const RECORDING_MAX_BYTES = 128 * 1024 * 1024
const ARTIFACT_LIMIT = 60
const BROWSER_PREVIEW_ANNOTATION_WORLD_ID = 1_004

type StoredArtifact = DevScopeBrowserCaptureArtifact & { ownerWebContentsId: number; path: string }
type ActiveAnnotation = {
    ownerWebContentsId: number
    guest: WebContents
    tabId: string
    cancel: () => Promise<void>
}
type ActiveRecording = {
    ownerWebContentsId: number
    ownerFrame: WebContents['mainFrame']
    guest: WebContents
    tabId: string
    startedAt: string
    started: boolean
    onOwnerDestroyed: () => void
    onDestroyed: () => void
}

const artifacts = new Map<string, StoredArtifact>()
const libraryGrants = new Map<number, Set<string>>()
const colorSchemeByGuestId = new Map<number, DevScopeBrowserColorScheme>()
const colorLifecycleInstalled = new Set<number>()
const activeAnnotations = new Map<number, ActiveAnnotation>()
const recordingSaveGrants = new Map<string, number>()
let activeRecording: ActiveRecording | null = null

function errorMessage(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback
}

function resolveGuest(event: IpcMainInvokeEvent, input: DevScopeBrowserGuestTargetInput): WebContents {
    const guestWebContentsId = Number(input?.guestWebContentsId)
    const tabId = String(input?.tabId || '')
    if (!Number.isInteger(guestWebContentsId) || guestWebContentsId <= 0) {
        throw new Error('The Browser guest identity is invalid.')
    }
    return trustedBrowserGuests.resolveOwned(event.sender.id, guestWebContentsId, tabId).guest
}

function getBrowserSession() {
    return session.fromPartition(ZYRA_BROWSER_GLOBAL_PARTITION, { cache: true })
}

async function ensureDebugger(guest: WebContents): Promise<void> {
    if (guest.isDestroyed()) throw new Error('The Browser tab was closed.')
    if (guest.isDevToolsOpened()) throw new Error('Close this tab’s DevTools before using Browser capture or emulation.')
    if (!guest.debugger.isAttached()) guest.debugger.attach('1.3')
}

async function applyColorScheme(guest: WebContents, colorScheme: DevScopeBrowserColorScheme): Promise<void> {
    await ensureDebugger(guest)
    await guest.debugger.sendCommand('Emulation.setEmulatedMedia', {
        features: colorScheme === 'system'
            ? []
            : [{ name: 'prefers-color-scheme', value: colorScheme }]
    })
}

function installColorLifecycle(guest: WebContents): void {
    if (colorLifecycleInstalled.has(guest.id)) return
    colorLifecycleInstalled.add(guest.id)
    guest.on('devtools-closed', () => {
        const scheme = colorSchemeByGuestId.get(guest.id) || 'system'
        if (guest.isDestroyed()) return
        void applyColorScheme(guest, scheme).catch((error) => {
            log.debug('[BrowserPreview] Could not restore color emulation after DevTools closed:', error)
        })
    })
    guest.once('destroyed', () => {
        colorLifecycleInstalled.delete(guest.id)
        colorSchemeByGuestId.delete(guest.id)
        void activeAnnotations.get(guest.id)?.cancel()
        if (activeRecording?.guest.id === guest.id) cleanupRecording(activeRecording)
    })
}

export async function inheritBrowserPreviewPresentation(source: WebContents, target: WebContents): Promise<void> {
    const colorScheme = colorSchemeByGuestId.get(source.id) || 'system'
    colorSchemeByGuestId.set(target.id, colorScheme)
    installColorLifecycle(target)
    target.setZoomFactor(getBrowserUserZoomFactor(source))
    await applyColorScheme(target, colorScheme)
}

function artifactDirectory(): string {
    return join(app.getPath('userData'), 'browser-preview', 'artifacts')
}

function rememberArtifact(artifact: StoredArtifact): DevScopeBrowserCaptureArtifact {
    artifacts.delete(artifact.artifactId)
    artifacts.set(artifact.artifactId, artifact)
    while (artifacts.size > ARTIFACT_LIMIT) {
        const oldest = artifacts.keys().next().value
        if (!oldest) break
        artifacts.delete(oldest)
    }
    const { ownerWebContentsId: _ownerWebContentsId, path: _path, ...publicArtifact } = artifact
    return publicArtifact
}

function capturePreview(artifact: DevScopeBrowserCaptureArtifact & { path: string }, maxWidth = 200, maxHeight = 120): DevScopeBrowserCaptureArtifact {
    const { path, ...capture } = artifact
    if (capture.kind !== 'screenshot') return capture
    try {
        const image = nativeImage.createFromPath(path)
        if (image.isEmpty()) return capture
        const size = image.getSize()
        const scale = Math.min(1, maxWidth / size.width, maxHeight / size.height)
        return { ...capture, width: size.width, height: size.height, thumbnailDataUrl: image.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) }).toDataURL() }
    } catch { return capture }
}

function ownedArtifact(event: IpcMainInvokeEvent, artifactId: string): StoredArtifact {
    const normalizedId = String(artifactId || '')
    const artifact = libraryGrants.get(event.sender.id)?.has(normalizedId)
        ? { ...new BrowserCaptureLibrary(artifactDirectory()).get(normalizedId), ownerWebContentsId: event.sender.id }
        : artifacts.get(normalizedId)
    if (!artifact || artifact.ownerWebContentsId !== event.sender.id) {
        throw new Error('That Browser capture is no longer available to this window.')
    }
    const stats = statSync(artifact.path)
    if (!stats.isFile() || stats.size !== artifact.sizeBytes) throw new Error('The Browser capture file changed or is missing.')
    return artifact
}

function normalizeRecordingBytes(value: unknown): Uint8Array {
    if (value instanceof Uint8Array) return value
    if (value instanceof ArrayBuffer) return new Uint8Array(value)
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    throw new Error('The Browser recording data is invalid.')
}

function finiteNumber(value: unknown, fallback = 0): number {
    const numeric = Number(value)
    return Number.isFinite(numeric) ? numeric : fallback
}

function normalizeAnnotationRect(value: unknown): DevScopeBrowserAnnotationRect | null {
    if (!value || typeof value !== 'object') return null
    const candidate = value as Record<string, unknown>
    const x = Math.max(0, Math.round(finiteNumber(candidate.x)))
    const y = Math.max(0, Math.round(finiteNumber(candidate.y)))
    const width = Math.min(16_384, Math.max(0, Math.round(finiteNumber(candidate.width))))
    const height = Math.min(16_384, Math.max(0, Math.round(finiteNumber(candidate.height))))
    if (width <= 0 || height <= 0) return null
    return { x, y, width, height }
}

function safeCssValue(value: unknown, fallback: string): string {
    const normalized = String(value || '').trim().slice(0, 160)
    return normalized && !/[;{}<>]/.test(normalized) ? normalized : fallback
}

function normalizeAnnotationTheme(value: unknown): DevScopeBrowserAnnotationTheme {
    const candidate = value && typeof value === 'object' ? value as Record<string, unknown> : {}
    return {
        colorScheme: candidate.colorScheme === 'light' ? 'light' : 'dark',
        background: safeCssValue(candidate.background, '#111318'),
        foreground: safeCssValue(candidate.foreground, '#f4f5f7'),
        popover: safeCssValue(candidate.popover, '#181b21'),
        mutedForeground: safeCssValue(candidate.mutedForeground, '#9ba3b0'),
        border: safeCssValue(candidate.border, 'rgba(255,255,255,.12)'),
        primary: safeCssValue(candidate.primary, '#7c3aed'),
        primaryForeground: safeCssValue(candidate.primaryForeground, '#ffffff'),
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    }
}

function normalizeAnnotationPayload(
    value: unknown,
    guest: WebContents,
    tabId: string
): DevScopeBrowserAnnotationPayload | null {
    if (!value || typeof value !== 'object') return null
    const candidate = value as Record<string, unknown>
    const createdAt = new Date().toISOString()
    const url = guest.getURL() === 'about:blank' ? null : guest.getURL().slice(0, 2_048)
    const title = guest.getTitle().slice(0, 512) || null
    const rawElements = Array.isArray(candidate.elements) ? candidate.elements.slice(0, 40) : []
    const rawRegions = Array.isArray(candidate.regions) ? candidate.regions.slice(0, 64) : []
    const rawStrokes = Array.isArray(candidate.strokes) ? candidate.strokes.slice(0, 64) : []
    const elements = rawElements.flatMap((raw, index) => {
        if (!raw || typeof raw !== 'object') return []
        const element = raw as Record<string, unknown>
        const rawAttributes = element.attributes && typeof element.attributes === 'object'
            ? element.attributes as Record<string, unknown>
            : {}
        const attributes: Record<string, string> = {}
        for (const [rawName, rawValue] of Object.entries(rawAttributes).slice(0, 20)) {
            const name = rawName.slice(0, 128)
            attributes[name] = /pass(word|code)|secret|token|authorization|cookie/i.test(name)
                ? '[redacted]'
                : String(rawValue ?? '').slice(0, 1_024)
        }
        if (String(attributes.type || '').toLowerCase() === 'password') attributes.value = '[redacted]'
        return [{
            id: String(element.id || `browser-element:${index + 1}`).slice(0, 160),
            tabId,
            url,
            title,
            selector: String(element.selector || element.tagName || 'element').slice(0, 512),
            tagName: String(element.tagName || 'element').toLowerCase().slice(0, 128),
            attributes,
            bounds: normalizeAnnotationRect(element.bounds),
            createdAt
        }]
    })
    const regions = rawRegions.flatMap((raw, index) => {
        if (!raw || typeof raw !== 'object') return []
        const region = raw as Record<string, unknown>
        const rect = normalizeAnnotationRect(region.rect)
        return rect ? [{ id: String(region.id || `region:${index + 1}`).slice(0, 160), rect }] : []
    })
    const strokes = rawStrokes.flatMap((raw, index) => {
        if (!raw || typeof raw !== 'object') return []
        const stroke = raw as Record<string, unknown>
        const points = (Array.isArray(stroke.points) ? stroke.points.slice(0, 2_048) : []).flatMap((rawPoint) => {
            if (!rawPoint || typeof rawPoint !== 'object') return []
            const annotationPoint = rawPoint as Record<string, unknown>
            return [{ x: Math.max(0, finiteNumber(annotationPoint.x)), y: Math.max(0, finiteNumber(annotationPoint.y)) }]
        })
        const bounds = normalizeAnnotationRect(stroke.bounds)
        if (points.length < 2 || !bounds) return []
        return [{
            id: String(stroke.id || `stroke:${index + 1}`).slice(0, 160),
            color: safeCssValue(stroke.color, '#7c3aed'),
            width: Math.min(32, Math.max(1, finiteNumber(stroke.width, 4))),
            points,
            bounds
        }]
    })
    if (elements.length === 0 && regions.length === 0 && strokes.length === 0) return null
    return {
        id: String(candidate.id || `browser-annotation:${randomUUID()}`).slice(0, 160),
        tabId,
        url,
        title,
        comment: String(candidate.comment || '').trim().slice(0, 4_000),
        elements,
        regions,
        strokes,
        styleChanges: [],
        createdAt
    }
}

function storeScreenshotArtifact(
    ownerWebContentsId: number,
    tabId: string,
    image: NativeImage
): DevScopeBrowserCaptureArtifact {
    if (image.isEmpty()) throw new Error('The Browser returned an empty screenshot.')
    const data = image.toPNG()
    if (data.byteLength <= 0 || data.byteLength > SCREENSHOT_MAX_BYTES) {
        throw new Error('The Browser screenshot exceeded the 25 MB capture limit.')
    }
    const originalSize = image.getSize()
    const thumbnailScale = Math.min(
        1,
        SCREENSHOT_PREVIEW_MAX_WIDTH / Math.max(1, originalSize.width),
        SCREENSHOT_PREVIEW_MAX_HEIGHT / Math.max(1, originalSize.height)
    )
    const thumbnail = image.resize({
        width: Math.max(1, Math.round(originalSize.width * thumbnailScale)),
        height: Math.max(1, Math.round(originalSize.height * thumbnailScale)),
        quality: 'good'
    })
    const artifactId = `browser-screenshot:${randomUUID()}`
    const directory = artifactDirectory()
    const path = join(directory, `${artifactId.slice('browser-screenshot:'.length)}.png`)
    mkdirSync(directory, { recursive: true })
    writeFileSync(path, data, { mode: 0o600 })
    return rememberArtifact({
        artifactId,
        ownerWebContentsId,
        tabId,
        kind: 'screenshot',
        path,
        mimeType: 'image/png',
        sizeBytes: data.byteLength,
        createdAt: new Date().toISOString(),
        width: originalSize.width,
        height: originalSize.height,
        thumbnailDataUrl: thumbnail.toDataURL()
    })
}

function recordingGrantKey(ownerWebContentsId: number, guestWebContentsId: number, tabId: string): string {
    return `${ownerWebContentsId}:${guestWebContentsId}:${tabId}`
}

function grantRecordingSave(recording: ActiveRecording): void {
    if (!recording.started) return
    const now = Date.now()
    recordingSaveGrants.set(recordingGrantKey(recording.ownerWebContentsId, recording.guest.id, recording.tabId), now + 60_000)
    for (const [key, expiresAt] of recordingSaveGrants) {
        if (expiresAt <= now) recordingSaveGrants.delete(key)
    }
}

function cleanupRecording(recording: ActiveRecording): void {
    grantRecordingSave(recording)
    browserRecordingCapture.cancel(recording.ownerWebContentsId)
    const owner = webContents.fromId(recording.ownerWebContentsId)
    owner?.removeListener('destroyed', recording.onOwnerDestroyed)
    if (owner && !owner.isDestroyed()) owner.send(BROWSER_PREVIEW_RECORDING_FRAME_CHANNEL, {
        tabId: recording.tabId, data: '', width: 0, height: 0, receivedAt: new Date().toISOString(), ended: true
    } satisfies DevScopeBrowserRecordingFrame)
    recording.guest.removeListener('destroyed', recording.onDestroyed)
    if (activeRecording === recording) activeRecording = null
}

export function assertBrowserPreviewDeveloperTransferable(guestWebContentsId: number): void {
    if (activeAnnotations.has(guestWebContentsId)) throw new Error('Attach or cancel the active Browser annotation before moving this tab.')
}

export function transferBrowserPreviewDeveloperOwner(
    guestWebContentsId: number,
    previousOwnerWebContentsId: number,
    ownerWebContentsId: number
): void {
    const annotation = activeAnnotations.get(guestWebContentsId)
    if (annotation?.ownerWebContentsId === previousOwnerWebContentsId) annotation.ownerWebContentsId = ownerWebContentsId
    // Capture/encoding belongs to its original renderer even when the native
    // guest moves to another window. The overlay forwards commands to that owner.
}

export async function handleHardReloadBrowserPreview(event: IpcMainInvokeEvent, input: DevScopeBrowserGuestTargetInput) {
    try {
        resolveGuest(event, input).reloadIgnoringCache()
        return { success: true as const }
    } catch (error) {
        return { success: false as const, error: errorMessage(error, 'Could not hard reload the Browser tab.') }
    }
}

export async function handleSetBrowserPreviewZoom(
    event: IpcMainInvokeEvent,
    input: DevScopeBrowserGuestTargetInput & { factor?: number }
) {
    try {
        const guest = resolveGuest(event, input)
        const requested = Number(input?.factor)
        if (!Number.isFinite(requested)) throw new Error('The Browser zoom factor is invalid.')
        const factor = Math.round(Math.min(BROWSER_ZOOM_MAX, Math.max(BROWSER_ZOOM_MIN, requested)) * 100) / 100
        if (!setManagedBrowserUserZoomFactor(guest, factor)) guest.setZoomFactor(factor)
        return { success: true as const, factor }
    } catch (error) {
        return { success: false as const, error: errorMessage(error, 'Could not change Browser zoom.') }
    }
}

export async function handleSetBrowserPreviewColorScheme(
    event: IpcMainInvokeEvent,
    input: DevScopeBrowserGuestTargetInput & { colorScheme?: DevScopeBrowserColorScheme }
) {
    try {
        const guest = resolveGuest(event, input)
        const colorScheme = input?.colorScheme
        if (colorScheme !== 'system' && colorScheme !== 'light' && colorScheme !== 'dark') {
            throw new Error('The Browser color scheme is invalid.')
        }
        colorSchemeByGuestId.set(guest.id, colorScheme)
        installColorLifecycle(guest)
        await applyColorScheme(guest, colorScheme)
        return { success: true as const }
    } catch (error) {
        return { success: false as const, error: errorMessage(error, 'Could not emulate the Browser color scheme.') }
    }
}

// Main-owned popup shortcuts share the same recording/annotation/debugger guards.
export function openBrowserPreviewDevTools(guest: WebContents, mode: 'docked' | 'popout' = 'docked'): void {
    if (activeRecording?.guest.id === guest.id) throw new Error('Stop this tab’s recording before opening DevTools.')
    if (activeAnnotations.has(guest.id)) throw new Error('Attach or cancel the annotation before opening DevTools.')
    if (guest.isDevToolsOpened()) guest.devToolsWebContents?.focus()
    else {
        if (guest.debugger.isAttached()) guest.debugger.detach()
        if (mode === 'popout') guest.openDevTools({ mode: 'detach', activate: true })
        else guest.openDevTools({ mode: 'left', activate: true })
    }
}

export async function handleOpenBrowserPreviewDevTools(event: IpcMainInvokeEvent, input: DevScopeBrowserGuestTargetInput & { mode?: 'docked' | 'popout' }) {
    try {
        openBrowserPreviewDevTools(resolveGuest(event, input), input?.mode)
        return { success: true as const }
    } catch (error) {
        return { success: false as const, error: errorMessage(error, 'Could not open Browser DevTools.') }
    }
}

export async function handleClearBrowserPreviewCache(_event: IpcMainInvokeEvent) {
    try {
        await getBrowserSession().clearCache()
        return { success: true as const, cleared: true as const }
    } catch (error) {
        return { success: false as const, error: errorMessage(error, 'Could not clear the Browser cache.') }
    }
}

export async function handleClearBrowserPreviewCookies(_event: IpcMainInvokeEvent) {
    try {
        const browserSession = getBrowserSession()
        await browserSession.clearStorageData({ storages: ['cookies'] })
        await browserSession.clearAuthCache()
        await browserSession.cookies.flushStore()
        return { success: true as const, cleared: true as const }
    } catch (error) {
        return { success: false as const, error: errorMessage(error, 'Could not clear Browser cookies.') }
    }
}

export async function handleCaptureBrowserPreviewScreenshot(event: IpcMainInvokeEvent, input: DevScopeBrowserGuestTargetInput) {
    try {
        const guest = resolveGuest(event, input)
        const artifact = storeScreenshotArtifact(event.sender.id, input.tabId, await captureBrowserPage(guest))
        return { success: true as const, artifact }
    } catch (error) {
        log.error('[BrowserPreview] Screenshot capture failed:', error)
        return { success: false as const, error: errorMessage(error, 'Could not capture the Browser tab.') }
    }
}

export async function handleStageBrowserPreviewArtifactForAssistant(event: IpcMainInvokeEvent, artifactId: string) {
    try {
        const artifact = ownedArtifact(event, artifactId)
        const reference = await stageAssistantClipboardImageFile({
            sourcePath: artifact.path,
            fileName: artifact.kind === 'screenshot' ? `preview-annotation-${artifact.artifactId.slice('browser-screenshot:'.length)}.png` : `browser-recording-${artifact.artifactId.split(':')[1]}.${artifact.mimeType.includes('mp4') ? 'mp4' : 'webm'}`
        })
        return { success: true as const, reference }
    } catch (error) {
        return { success: false as const, error: errorMessage(error, 'Could not attach the Browser annotation to chat.') }
    }
}

export async function handleOpenBrowserPreviewArtifact(event: IpcMainInvokeEvent, artifactId: string) {
    try {
        const error = await shell.openPath(ownedArtifact(event, artifactId).path)
        if (error) throw new Error(error)
        return { success: true as const }
    } catch (error) {
        return { success: false as const, error: errorMessage(error, 'Could not open the Browser capture.') }
    }
}

export async function handleRevealBrowserPreviewArtifact(event: IpcMainInvokeEvent, artifactId: string) {
    try {
        shell.showItemInFolder(ownedArtifact(event, artifactId).path)
        return { success: true as const }
    } catch (error) {
        return { success: false as const, error: errorMessage(error, 'Could not reveal the Browser capture.') }
    }
}

export async function handleCopyBrowserPreviewArtifact(
    event: IpcMainInvokeEvent,
    input: { artifactId?: string; mode?: 'image' | 'path' }
) {
    try {
        const artifact = ownedArtifact(event, String(input?.artifactId || ''))
        if (input?.mode === 'path') {
            clipboard.writeText(artifact.path)
        } else if (input?.mode === 'image' && artifact.kind === 'screenshot') {
            const image = nativeImage.createFromBuffer(readFileSync(artifact.path))
            if (image.isEmpty()) throw new Error('The screenshot could not be read.')
            clipboard.writeImage(image)
        } else {
            throw new Error('Only screenshots can be copied as images.')
        }
        return { success: true as const }
    } catch (error) {
        return { success: false as const, error: errorMessage(error, 'Could not copy the Browser capture.') }
    }
}

export async function handleStartBrowserPreviewAnnotation(
    event: IpcMainInvokeEvent,
    input: DevScopeBrowserAnnotationInput
) {
    let cancellationRequested = false
    let annotationSession: ActiveAnnotation | null = null
    try {
        const guest = resolveGuest(event, input)
        if (activeRecording?.guest.id === guest.id) throw new Error('Stop this tab’s recording before annotating.')
        await activeAnnotations.get(guest.id)?.cancel()
        const cancel = async () => {
            cancellationRequested = true
            if (guest.isDestroyed()) return
            await guest.executeJavaScriptInIsolatedWorld(
                BROWSER_PREVIEW_ANNOTATION_WORLD_ID,
                [{ code: BROWSER_PREVIEW_ANNOTATION_CANCEL_SOURCE }]
            ).catch(() => undefined)
        }
        annotationSession = {
            ownerWebContentsId: event.sender.id,
            guest,
            tabId: input.tabId,
            cancel
        }
        const onNavigation = (_event: Electron.Event, _url: string, _isInPlace: boolean, isMainFrame: boolean) => {
            if (isMainFrame) void cancel()
        }
        const onDestroyed = () => {
            cancellationRequested = true
        }
        guest.on('did-start-navigation', onNavigation)
        guest.once('destroyed', onDestroyed)
        activeAnnotations.set(guest.id, annotationSession)
        try {
            if (!guest.isFocused()) guest.focus()
            const raw = await guest.executeJavaScriptInIsolatedWorld(
                BROWSER_PREVIEW_ANNOTATION_WORLD_ID,
                [{ code: browserPreviewAnnotationSource(normalizeAnnotationTheme(input.theme), input.standalone === true) }],
                true
            ) as { status?: unknown; annotation?: unknown; captureRect?: unknown }
            if (raw?.status !== 'attached') {
                return { success: true as const, annotation: null, artifact: null }
            }
            const annotation = normalizeAnnotationPayload(raw.annotation, guest, input.tabId)
            if (!annotation) throw new Error('The annotation did not contain a valid target.')
            const captureRect = normalizeAnnotationRect(raw.captureRect)
            const image = await captureBrowserPage(guest, captureRect || undefined)
            const artifact = storeScreenshotArtifact(annotationSession.ownerWebContentsId, input.tabId, image)
            return { success: true as const, annotation, artifact }
        } catch (error) {
            if (cancellationRequested || guest.isDestroyed()) {
                return { success: true as const, annotation: null, artifact: null }
            }
            throw error
        } finally {
            if (!guest.isDestroyed()) {
                await guest.executeJavaScriptInIsolatedWorld(
                    BROWSER_PREVIEW_ANNOTATION_WORLD_ID,
                    [{ code: BROWSER_PREVIEW_ANNOTATION_CAPTURED_SOURCE }]
                ).catch(() => undefined)
            }
            guest.removeListener('did-start-navigation', onNavigation)
            guest.removeListener('destroyed', onDestroyed)
            if (activeAnnotations.get(guest.id) === annotationSession) activeAnnotations.delete(guest.id)
        }
    } catch (error) {
        log.error('[BrowserPreview] Annotation failed:', error)
        return { success: false as const, error: errorMessage(error, 'Could not annotate the Browser tab.') }
    }
}

export async function handleCancelBrowserPreviewAnnotation(event: IpcMainInvokeEvent, input: DevScopeBrowserGuestTargetInput) {
    try {
        const guest = resolveGuest(event, input)
        const annotation = activeAnnotations.get(guest.id)
        if (annotation && (annotation.ownerWebContentsId !== event.sender.id || annotation.tabId !== input.tabId)) {
            throw new Error('That window does not own the active Browser annotation.')
        }
        await annotation?.cancel()
        return { success: true as const }
    } catch (error) {
        return { success: false as const, error: errorMessage(error, 'Could not cancel Browser annotation.') }
    }
}

export async function handleStartBrowserPreviewRecording(event: IpcMainInvokeEvent, input: DevScopeBrowserGuestTargetInput) {
    try {
        const guest = resolveGuest(event, input)
        if (activeAnnotations.has(guest.id)) throw new Error('Attach or cancel the annotation before recording.')
        if (activeRecording) {
            if (activeRecording.guest.id === guest.id && activeRecording.tabId === input.tabId) {
                resolveBrowserRecordingController(activeRecording, event.sender.id, event.senderFrame, input)
                return { success: true as const, startedAt: activeRecording.startedAt, tabAudioSupported: true, systemAudioSupported: process.platform === 'win32' }
            }
            throw new Error('Another Browser tab is already recording.')
        }
        if (event.senderFrame !== event.sender.mainFrame) throw new Error('Only the Browser owner can start recording.')
        const startedAt = new Date().toISOString()
        const recording: ActiveRecording = {
            ownerWebContentsId: event.sender.id, ownerFrame: event.sender.mainFrame, guest, tabId: input.tabId,
            startedAt, started: true,
            onOwnerDestroyed: () => cleanupRecording(recording),
            onDestroyed: () => cleanupRecording(recording)
        }
        browserRecordingCapture.arm(event.sender, guest, 'off')
        event.sender.once('destroyed', recording.onOwnerDestroyed)
        guest.once('destroyed', recording.onDestroyed)
        activeRecording = recording
        return { success: true as const, startedAt, tabAudioSupported: true, systemAudioSupported: process.platform === 'win32' }
    } catch (error) {
        return { success: false as const, error: errorMessage(error, 'Could not start Browser recording.') }
    }
}

export async function handlePrepareBrowserPreviewRecordingAudio(
    event: IpcMainInvokeEvent,
    input: DevScopeBrowserGuestTargetInput & { source: Exclude<BrowserRecordingAudioSource, 'off'> }
) {
    try {
        const recording = resolveBrowserRecordingController(activeRecording, event.sender.id, event.senderFrame, input)
        if (input.source !== 'tab' && input.source !== 'system') throw new Error('Choose tab audio or system audio.')
        browserRecordingCapture.arm(event.sender, recording.guest, input.source)
        return { success: true as const }
    } catch (error) {
        return { success: false as const, error: errorMessage(error, 'Could not prepare recording audio.') }
    }
}

export async function handleStopBrowserPreviewRecording(event: IpcMainInvokeEvent, input: DevScopeBrowserGuestTargetInput) {
    try {
        if (!activeRecording) return { success: true as const }
        const recording = resolveBrowserRecordingController(activeRecording, event.sender.id, event.senderFrame, input)
        cleanupRecording(recording)
        return { success: true as const }
    } catch (error) {
        return { success: false as const, error: errorMessage(error, 'Could not stop Browser recording.') }
    }
}

export async function handleSaveBrowserPreviewRecording(
    event: IpcMainInvokeEvent,
    input: DevScopeBrowserGuestTargetInput & { mimeType?: string; data?: unknown }
) {
    try {
        const guestWebContentsId = Number(input?.guestWebContentsId)
        const tabId = String(input?.tabId || '')
        const grantKey = recordingGrantKey(event.sender.id, guestWebContentsId, tabId)
        const grantExpiresAt = recordingSaveGrants.get(grantKey) || 0
        if (!Number.isInteger(guestWebContentsId) || !isTrustedBrowserTabId(tabId) || grantExpiresAt <= Date.now()) {
            throw new Error('This window no longer owns a Browser recording save grant.')
        }
        const mimeType = String(input?.mimeType || '').toLowerCase()
        if (!/^video\/(?:webm|mp4)(?:;|$)/.test(mimeType)) throw new Error('The Browser recording format is not supported.')
        const data = normalizeRecordingBytes(input?.data)
        if (data.byteLength <= 0 || data.byteLength > RECORDING_MAX_BYTES) {
            throw new Error('The Browser recording must be between 1 byte and 128 MB.')
        }
        // Consume before asynchronous disk I/O so concurrent save requests cannot
        // reuse a closed tab's grant and create duplicate artifacts.
        recordingSaveGrants.delete(grantKey)
        const artifactId = `browser-recording:${randomUUID()}`
        const extension = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm'
        const directory = artifactDirectory()
        const path = join(directory, `${artifactId.slice('browser-recording:'.length)}.${extension}`)
        await mkdir(directory, { recursive: true })
        await writeFile(path, data, { mode: 0o600 })
        const artifact = rememberArtifact({
            artifactId,
            ownerWebContentsId: event.sender.id,
            tabId,
            kind: 'recording',
            path,
            mimeType,
            sizeBytes: data.byteLength,
            createdAt: new Date().toISOString()
        })
        return { success: true as const, artifact }
    } catch (error) {
        log.error('[BrowserPreview] Recording save failed:', error)
        return { success: false as const, error: errorMessage(error, 'Could not save Browser recording.') }
    }
}

export async function handleListBrowserCaptures(event: IpcMainInvokeEvent, input: { offset?: number; limit?: number; kind?: 'screenshot' | 'recording' } = {}) {
    try {
        const page = new BrowserCaptureLibrary(artifactDirectory()).list(input || {})
        const grants = libraryGrants.get(event.sender.id) || new Set<string>()
        for (const capture of page.captures) grants.add(capture.artifactId)
        while (grants.size > 1_024) grants.delete(grants.values().next().value!)
        libraryGrants.set(event.sender.id, grants)
        if (libraryGrants.size > 32) libraryGrants.delete(libraryGrants.keys().next().value!)
        const captures = page.captures.map(capture => capturePreview(capture))
        return { success: true as const, ...page, captures }
    } catch (error) { return { success: false as const, error: errorMessage(error, 'Could not load Browser captures.') } }
}
export async function handleDeleteBrowserCapture(event: IpcMainInvokeEvent, artifactId: string) {
    try {
        if (!libraryGrants.get(event.sender.id)?.has(artifactId)) throw new Error('Open the capture library before deleting a capture.')
        new BrowserCaptureLibrary(artifactDirectory()).delete(artifactId)
        artifacts.delete(artifactId)
        libraryGrants.get(event.sender.id)?.delete(artifactId)
        return { success: true as const }
    } catch (error) { return { success: false as const, error: errorMessage(error, 'Could not delete the capture.') } }
}

export async function handleAttachBrowserCaptureToChat(event: IpcMainInvokeEvent, input: { artifactId: string; sessionId?: string | null; annotation?: import('../../../shared/contracts/devscope-api').DevScopeBrowserAnnotationPayload }) {
    try {
        const artifact = ownedArtifact(event, input?.artifactId)
        if (input.annotation && (typeof input.annotation.id !== 'string' || typeof input.annotation.comment !== 'string' || JSON.stringify(input.annotation).length > 100_000)) throw new Error('Selection is too large to attach.')
        const staged = await handleStageBrowserPreviewArtifactForAssistant(event, artifact.artifactId)
        if (!staged.success) return staged
        enqueueBrowserCaptureDraft({ sessionId: typeof input.sessionId === 'string' ? input.sessionId.slice(0, 200) : null, reference: staged.reference, artifact: capturePreview((({ ownerWebContentsId: _owner, ...capture }) => capture)(artifact), 640, 440), annotation: input.annotation })
        return { success: true as const }
    } catch (error) { return { success: false as const, error: errorMessage(error, 'Could not attach capture to chat.') } }
}
export async function handleReadBrowserCaptureDraft(event: IpcMainInvokeEvent) {
    try { return { success: true as const, draft: readBrowserCaptureDraft(event.sender.id) } }
    catch (error) { return { success: false as const, error: errorMessage(error, 'Could not read capture draft.') } }
}
export async function handleAcknowledgeBrowserCaptureDraft(event: IpcMainInvokeEvent, id: string) {
    try { acknowledgeBrowserCaptureDraft(event.sender.id, id); return { success: true as const } }
    catch (error) { return { success: false as const, error: errorMessage(error, 'Could not acknowledge capture draft.') } }
}
