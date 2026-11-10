import { initializeNativeOverlayDocument, type NativeOverlayDocument } from './native-overlay-document'
import { getOverlayActiveElement, getOverlayEventDocuments, registerOverlayDocument } from './native-overlay-events'
import { dismissTransientMenus } from '@/lib/transient-menu'
import type { NativeOverlayApi, NativeOverlayKind, NativeOverlayBounds } from '@shared/contracts/native-overlay'

type Kind = NativeOverlayKind
type NativeOverlayBridge = Pick<NativeOverlayApi, 'prepareNativeOverlay' | 'setNativeOverlayVisible'> & Partial<Pick<NativeOverlayApi, 'onNativeOverlayDismiss' | 'recoverNativeOverlay'>>
interface Surface { window: Window; frameName: string; document: NativeOverlayDocument; unregister: () => void }
const activityListeners = new Set<() => void>()
const notifyActivity = () => { for (const listener of activityListeners) listener() }
export interface NativeOverlayLease {
    ready: Promise<HTMLElement | null>
    present: () => Promise<boolean>
    setBounds: (bounds: NativeOverlayBounds | null) => void
    release: () => void
}

function bridge(): NativeOverlayBridge | null {
    if (typeof window === 'undefined') return null
    const api = window.devscope as unknown as Partial<NativeOverlayBridge> | undefined
    return api?.prepareNativeOverlay && api.setNativeOverlayVisible ? api as NativeOverlayBridge : null
}
export function supportsNativeOverlay(): boolean { return Boolean(bridge()) }

function dismissCallers() {
    dismissTransientMenus()
    for (const document of getOverlayEventDocuments()) {
        const KeyboardEvent = document.defaultView?.KeyboardEvent
        if (KeyboardEvent) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    }
}

class NativeOverlayHost {
    private surface: Surface | null = null
    private pending: Promise<Surface | null> | null = null
    private pendingGeneration = 0
    private pendingFrameName: string | null = null
    private revision = Date.now() * 1000
    private visibility = false
    private boundsKey = ''
    private leaseBounds = new Map<symbol, NativeOverlayBounds | null>()
    private visibilityPending: Promise<void> | null = null
    private hideFrame = 0
    private restoreFocus: HTMLElement | null = null
    private leases = new Set<symbol>()
    private presented = new Set<symbol>()
    private suspended = new Set<symbol>()
    private hasPresented = () => [...this.presented].some(id => !this.suspended.has(id))
    isPresented = () => this.hasPresented()
    private changes = new Set<() => void>()
    private generation = 0
    private disposed = false

    constructor(readonly kind: Kind) {}
    snapshot = () => this.generation
    subscribe = (listener: () => void) => { this.changes.add(listener); return () => { this.changes.delete(listener) } }
    matches = (frameName: string) => this.surface?.frameName === frameName || (!this.surface && this.pendingFrameName === frameName)

    private presentationBounds(): NativeOverlayBounds | null {
        const values = [...this.presented].filter(id => !this.suspended.has(id)).map(id => this.leaseBounds.get(id))
        if (!values.length || values.some(value => !value)) return null
        const rectangles = values as NativeOverlayBounds[]
        const x = Math.max(0, Math.min(window.innerWidth, ...rectangles.map(value => value.x)))
        const y = Math.max(0, Math.min(window.innerHeight, ...rectangles.map(value => value.y)))
        return { x, y, width: Math.max(0, Math.min(window.innerWidth, Math.max(...rectangles.map(value => value.x + value.width))) - x), height: Math.max(0, Math.min(window.innerHeight, Math.max(...rectangles.map(value => value.y + value.height))) - y) }
    }

    private async setVisible(visible: boolean, requestFocus = false): Promise<void> {
        const bounds = this.kind === 'interactive' && visible ? this.presentationBounds() : null
        const boundsKey = JSON.stringify(bounds)
        const focus = this.kind === 'interactive' && visible && requestFocus
        if (!focus && this.visibility === visible && this.boundsKey === boundsKey) { await this.visibilityPending; return }
        this.visibility = visible
        this.boundsKey = boundsKey
        const api = bridge()
        const frameName = this.surface?.frameName
        if (api && frameName) {
            const revision = ++this.revision
            const request = api.setNativeOverlayVisible({ kind: this.kind, frameName, visible, revision, focus, bounds }).then(result => {
                if (!this.matches(frameName) || revision !== this.revision) return
                if (!result.success) {
                    this.visibility = false
                    throw new Error('Native overlay visibility was rejected')
                }
                // Only compensate for bounds the native host actually applied. Older running
                // hosts acknowledge visibility but ignore bounds during renderer-only HMR.
                const applied = result.bounds
                const root = this.surface?.document.container
                if (root) {
                    root.style.transform = applied ? `translate(${-applied.x}px, ${-applied.y}px)` : ''
                    root.style.width = applied ? `${window.innerWidth}px` : ''
                    root.style.height = applied ? `${window.innerHeight}px` : ''
                }
            })
            this.visibilityPending = request
            try { await request } finally { if (this.visibilityPending === request) this.visibilityPending = null }
        }
    }

    invalidate = () => {
        const child = this.surface?.window
        this.surface?.unregister()
        this.surface?.document.dispose()
        this.surface = null
        this.pendingFrameName = null
        if (child && !child.closed) child.close()
        this.visibility = false
        this.generation++
        for (const listener of this.changes) listener()
    }

    private getSurface(): Promise<Surface | null> {
        if (this.surface && !this.surface.window.closed) return Promise.resolve(this.surface)
        if (this.pending) {
            if (this.pendingGeneration === this.generation) return this.pending
            return this.pending.catch(() => null).then(() => this.leases.size && !this.disposed ? this.getSurface() : null)
        }
        const api = bridge()
        if (!api) return Promise.resolve(null)
        const generation = this.generation
        this.pendingGeneration = generation
        const attempt = async (): Promise<Surface> => {
            let cancelled = false
            let created: Surface | undefined
            let timer: ReturnType<typeof setTimeout>
            const operation = async () => {
                const prepared = await api.prepareNativeOverlay({ kind: this.kind })
                if (cancelled || this.disposed || generation !== this.generation || !this.leases.size) throw new Error('Overlay preparation cancelled')
                if (!prepared.success) throw new Error(prepared.error || 'Native overlay was not prepared')
                this.pendingFrameName = prepared.frameName
                const child = window.open('about:blank', prepared.frameName)
                if (!child) throw new Error('Native overlay window was unavailable')
                const document = initializeNativeOverlayDocument(window.document, child.document)
                const unregister = this.kind === 'interactive' ? registerOverlayDocument(child.document) : () => {}
                created = { window: child, frameName: prepared.frameName, document, unregister }
                await document.ready
                if (cancelled || this.disposed || generation !== this.generation || !this.leases.size || child.closed) throw new Error('Overlay document unavailable')
                this.surface = created
                return created
            }
            try {
                return await Promise.race([operation(), new Promise<never>((_, reject) => {
                    timer = setTimeout(() => reject(new Error('Native overlay preparation timed out')), 8000)
                })])
            } catch (error) {
                cancelled = true
                created?.unregister()
                created?.document.dispose()
                if (this.pendingFrameName === created?.frameName) this.pendingFrameName = null
                if (created && !created.window.closed) created.window.close()
                throw error
            } finally { clearTimeout(timer!) }
        }
        const request = (async () => {
            installDismissListener(api)
            while (!this.disposed) {
                let failure: unknown
                for (let count = 0; count < 2; count++) {
                    try { return await attempt() } catch (error) { failure = error }
                    if (!this.leases.size || this.disposed || generation !== this.generation) return null
                }
                if (!api.recoverNativeOverlay) throw failure
                const decision = await api.recoverNativeOverlay({ kind: this.kind })
                if (this.disposed || !this.leases.size || generation !== this.generation) return null
                if (decision.success && decision.retry) continue
                dismissCallers()
                return null
            }
            return null
        })().finally(() => { if (this.pending === request) { this.pending = null; this.pendingFrameName = null } })
        this.pending = request
        return request
    }

    /** A lease remains held while React runs existing exit animations and nested content. */
    acquire(bounds: NativeOverlayBounds | null = null, focusOnPresent = false): NativeOverlayLease {
        const id = Symbol('native-overlay')
        this.leases.add(id)
        this.leaseBounds.set(id, bounds)
        cancelAnimationFrame(this.hideFrame)
        if (this.leases.size === 1 && this.kind === 'interactive') this.restoreFocus = getOverlayActiveElement()
        return {
            setBounds: bounds => {
                if (!this.leases.has(id)) return
                this.leaseBounds.set(id, bounds)
                if (this.presented.has(id)) void this.setVisible(this.hasPresented()).catch(error => console.error('Native overlay bounds update failed', error))
            },
            ready: this.getSurface().then(value => this.leases.has(id) ? value?.document.container ?? null : null),
            present: async () => {
                if (!this.leases.has(id) || !this.surface) return false
                const presentingFrameName = this.surface.frameName
                const firstPresentation = !this.presented.has(id)
                this.presented.add(id)
                notifyActivity()
                if (this.suspended.has(id)) return true
                cancelAnimationFrame(this.hideFrame)
                try { await this.setVisible(true, firstPresentation && focusOnPresent); return true }
                catch (error) {
                    const api = bridge()
                    if (!api?.recoverNativeOverlay) throw error
                    const decision = await api.recoverNativeOverlay({ kind: this.kind })
                    if (decision.success && decision.retry && this.leases.has(id)) {
                        if (this.matches(presentingFrameName)) this.invalidate()
                    }
                    else dismissCallers()
                    return false
                }
            },
            release: () => {
                if (!this.leases.delete(id)) return
                this.presented.delete(id)
                this.leaseBounds.delete(id)
                this.suspended.delete(id)
                notifyActivity()
                if (this.hasPresented()) {
                    void this.setVisible(true).catch(error => console.error('Native overlay bounds update failed', error))
                    return
                }
                cancelAnimationFrame(this.hideFrame)
                this.hideFrame = requestAnimationFrame(() => {
                    if (this.hasPresented()) return
                    const ownedFocus = this.surface?.window.document.hasFocus() === true
                    void this.setVisible(false).then(() => {
                        if (this.hasPresented() || this.kind !== 'interactive') return
                        const active = document.activeElement
                        if (ownedFocus && document.hasFocus() && (active === document.body || active === this.restoreFocus) && this.restoreFocus?.isConnected) this.restoreFocus.focus({ preventScroll: true })
                        this.restoreFocus = null
                    }).catch(error => console.error('Native overlay dismissal failed', error))
                })
            }
        }
    }

    /** Temporarily move existing modal surfaces behind an owned Browser view.
     * New leases (such as a link chooser) can still present normally.
     */
    suspendCurrentPresentation(): () => void {
        const ids = [...this.leases].filter(id => !this.suspended.has(id))
        for (const id of ids) this.suspended.add(id)
        notifyActivity()
        cancelAnimationFrame(this.hideFrame)
        void this.setVisible(this.hasPresented()).catch(error => console.error('Overlay suspension failed', error))
        let restored = false
        return () => {
            if (restored) return
            restored = true
            for (const id of ids) this.suspended.delete(id)
            notifyActivity()
            if (!this.disposed && this.hasPresented()) void this.setVisible(true).catch(error => console.error('Overlay restoration failed', error))
        }
    }

    dispose(closeWindow = true) {
        this.disposed = true
        cancelAnimationFrame(this.hideFrame)
        this.leases.clear()
        this.leaseBounds.clear()
        this.presented.clear()
        const child = this.surface?.window
        this.surface?.unregister()
        this.surface?.document.dispose()
        this.surface = null
        if (closeWindow && child && !child.closed) child.close()
    }
}

const hosts = { interactive: new NativeOverlayHost('interactive'), passive: new NativeOverlayHost('passive') }
let removeDismiss: (() => void) | undefined
function installDismissListener(api: NativeOverlayBridge) {
    if (removeDismiss) return
    removeDismiss = api.onNativeOverlayDismiss?.(({ kind, frameName, reason }) => {
        // Losing app focus dismisses transient callers through their blur listener, not dialogs.
        if (reason === 'closed' && hosts[kind].matches(frameName)) hosts[kind].invalidate()
    })
}
export function getNativeOverlayHost(passive = false) { return hosts[passive ? 'passive' : 'interactive'] }
export function isNativeOverlayActive(): boolean { return Object.values(hosts).some(host => host.isPresented()) }
export function subscribeNativeOverlayActivity(listener: () => void): () => void {
    activityListeners.add(listener)
    return () => activityListeners.delete(listener)
}

function disposeHosts(closeWindows = true) {
    removeDismiss?.()
    for (const host of Object.values(hosts)) host.dispose(closeWindows)
}
// beforeunload is cancellable: save/close dialogs still need their native hosts.
// On committed exit, main owns child destruction; avoid reentrant child.close().
const ownerPageExited = () => disposeHosts(false)
if (typeof window !== 'undefined') window.addEventListener('pagehide', ownerPageExited, { once: true })
if (import.meta.hot) import.meta.hot.dispose(() => {
    window.removeEventListener('pagehide', ownerPageExited)
    disposeHosts()
})
