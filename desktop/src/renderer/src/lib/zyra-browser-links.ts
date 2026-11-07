import { desktopWebLink, type DesktopLinkResult } from '@shared/desktop-link-policy'
import { openAccessory } from './accessories'
import { requestAssistantInspectorNavigation } from '../pages/assistant/assistant-inspector-navigation'

type BrowserLinkOpener = (url: string) => Promise<DesktopLinkResult>
type ChatBrowserOwner = { sessionId: string; threadId: string }
let chatOwner: ChatBrowserOwner | null = null

/** Only the mounted chat owns this route. Capture its lease before a chooser opens. */
export function installChatBrowserLinkHandler(owner: ChatBrowserOwner): () => void {
    chatOwner = owner
    return () => { if (chatOwner === owner) chatOwner = null }
}

export function captureZyraBrowserLinkOpener(): BrowserLinkOpener {
    const owner = chatOwner
    return async value => {
        const url = desktopWebLink(value)
        if (!url) return { success: false, error: 'Only HTTP and HTTPS links without embedded credentials can be opened.' }
        if (owner) {
            if (owner !== chatOwner) return { success: false, error: 'The chat changed. Open the link again from its chat.' }
            requestAssistantInspectorNavigation({ workspace: 'browser', url, ...owner })
            return { success: true }
        }
        return openAccessory({ kind: 'browser', sessionMode: 'normal', url })
    }
}
