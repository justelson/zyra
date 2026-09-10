import { nativeImage, type NativeImage, type Rectangle, type WebContents } from 'electron'

const captures = new WeakMap<WebContents, Promise<NativeImage>>()

async function bounded<T>(operation: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
        return await Promise.race([operation, new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('Browser screenshot timed out.')), 4_000)
        })])
    } finally { clearTimeout(timer) }
}

// Electron capturePage can return the last presented frame for an occluded native view.
// Ask Chromium for a fresh compositor frame first, including late canvas/app hydration.
export function captureBrowserPage(guest: WebContents, rect?: Rectangle): Promise<NativeImage> {
    const previous = captures.get(guest)
    const capture = (previous?.catch(() => undefined) || Promise.resolve()).then(async () => {
        if (guest.isDestroyed()) throw new Error('The Browser tab was closed.')
        const errors: string[] = []
        try {
            // Keep this page-owned transport until close, agent release or DevTools takes over.
            // Detaching a temporary connection can interrupt a concurrent agent attachment.
            if (!guest.debugger.isAttached()) guest.debugger.attach('1.3')
            const viewport = rect ? await bounded(guest.executeJavaScript('({ width: innerWidth, height: innerHeight })')) as { width: number; height: number } : undefined
            for (const fromSurface of [true, false]) {
                try {
                    const result = await bounded(guest.debugger.sendCommand('Page.captureScreenshot', {
                        format: 'png', fromSurface, captureBeyondViewport: false
                    }))
                    const image = nativeImage.createFromBuffer(Buffer.from(result.data || '', 'base64'))
                    if (!image.isEmpty()) {
                        // Normalize device scale before cropping CSS viewport coordinates.
                        return rect && viewport ? image.resize({ width: viewport.width, height: viewport.height }).crop(rect) : image
                    }
                    errors.push('Chromium returned an empty frame.')
                } catch (error) { errors.push(error instanceof Error ? error.message : String(error)) }
            }
        } catch (error) { errors.push(error instanceof Error ? error.message : String(error)) }
        // DevTools can own the debugger. Preserve ordinary screenshots in that case.
        try {
            const image = await bounded(guest.capturePage(rect))
            if (!image.isEmpty()) return image
        } catch (error) { errors.push(error instanceof Error ? error.message : String(error)) }
        throw new Error(`Could not capture the Browser tab: ${errors.join('; ')}`)
    })
    captures.set(guest, capture)
    void capture.finally(() => { if (captures.get(guest) === capture) captures.delete(guest) }).catch(() => undefined)
    return capture
}
