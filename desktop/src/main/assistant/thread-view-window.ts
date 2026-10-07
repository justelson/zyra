import { BrowserWindow, type WebContents } from 'electron'
import type { AssistantThreadViewInput } from '../../shared/assistant/contracts'

const tracked = new WeakMap<WebContents, { input: AssistantThreadViewInput }>()

/** Route visibility comes from the renderer; native focus is verified here. */
export function reportDesktopThreadView(
    sender: WebContents,
    input: AssistantThreadViewInput,
    report: (viewId: string, input: AssistantThreadViewInput) => Promise<unknown>
): Promise<unknown> {
    const window = BrowserWindow.fromWebContents(sender)
    if (!window || sender.isDestroyed()) return Promise.resolve({ success: false, error: 'Chat window is unavailable.' })
    let state = tracked.get(sender)
    if (state && !input.viewing && state.input.threadId !== input.threadId) return Promise.resolve({ success: true })
    if (!state) {
        state = { input }
        tracked.set(sender, state)
        const clear = () => { void report(`desktop:${sender.id}`, { ...state!.input, viewing: false }).catch(() => undefined) }
        window.on('blur', clear)
        window.on('hide', clear)
        window.on('minimize', clear)
        sender.once('destroyed', () => {
            clear()
            window.removeListener('blur', clear)
            window.removeListener('hide', clear)
            window.removeListener('minimize', clear)
            tracked.delete(sender)
        })
    }
    state.input = input
    return report(`desktop:${sender.id}`, { ...input, viewing: input.viewing === true && window.isFocused() && window.isVisible() && !window.isMinimized() })
}
