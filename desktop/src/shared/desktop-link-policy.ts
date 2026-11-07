export type DesktopLinkPreference = 'ask' | 'zyra' | 'system'
export type DesktopLinkResult = { success: boolean; error?: string; cancelled?: boolean }
export const DESKTOP_LINK_PREFERENCE_KEY = 'zyra.desktop.link-destination.v1'

export function normalizeDesktopLinkPreference(value: unknown): DesktopLinkPreference {
    return value === 'zyra' || value === 'system' ? value : 'ask'
}

/** Navigation URLs are never persisted with the preference. */
export function desktopWebLink(value: unknown): string | null {
    if (typeof value !== 'string' || value.length > 16_384 || /[\u0000-\u001f\u007f]/.test(value)) return null
    try {
        const url = new URL(value.trim())
        return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password ? url.href : null
    } catch { return null }
}

export function createDesktopLinkDispatcher<Context = undefined>(options: {
    preference: () => DesktopLinkPreference
    remember: (value: DesktopLinkPreference) => void
    choose: (url: string | null) => void
    captureContext?: () => Context
    open: (url: string, destination: 'zyra' | 'system', context: Context | undefined) => Promise<DesktopLinkResult>
}) {
    let pending: { url: string; context: Context | undefined; resolve: (result: DesktopLinkResult) => void } | null = null
    const cancel = () => {
        const previous = pending
        pending = null
        options.choose(null)
        previous?.resolve({ success: true, cancelled: true })
    }
    const open = async (url: string, destination: 'zyra' | 'system', context: Context | undefined) => {
        try { return await options.open(url, destination, context) }
        catch (error) { return { success: false, error: error instanceof Error ? error.message : 'Could not open this link.' } }
    }
    return {
        cancel,
        async request(value: unknown): Promise<DesktopLinkResult> {
            const url = desktopWebLink(value)
            if (!url) return { success: false, error: 'Only HTTP and HTTPS links without embedded credentials can be opened.' }
            const context = options.captureContext?.()
            const destination = options.preference()
            if (destination !== 'ask') return open(url, destination, context)
            cancel()
            return new Promise(resolve => { pending = { url, context, resolve }; options.choose(url) })
        },
        async select(destination: 'zyra' | 'system', remember: boolean) {
            const selected = pending
            if (!selected) return
            pending = null
            options.choose(null)
            const result = await open(selected.url, destination, selected.context)
            if (result.success && !result.cancelled && remember) {
                try { options.remember(destination) }
                catch { selected.resolve({ success: false, error: 'The link opened, but the browser preference could not be saved.' }); return }
            }
            selected.resolve(result)
        }
    }
}
