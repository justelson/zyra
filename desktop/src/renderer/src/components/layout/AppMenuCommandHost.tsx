import { BrowserCaptureDraftHost } from '@/pages/assistant/BrowserCaptureDraftHost'
import { isAppNavigationCommand } from '@shared/keybindings'
import { dispatchAppNavigation } from '@/lib/app-navigation'
import { useEffect } from 'react'
import { addOverlayEventListener } from '@/components/ui/native-overlay-portal'
import { appShortcut, subscribeAppNavigationShortcuts } from '@/lib/keybindings'
import { dispatchAppMenuCommand } from './app-menu-command-actions'
import { useLocation, useNavigate } from 'react-router-dom'
import { useCommandPalette } from '@/lib/commandPalette'
import { useAssistantStoreActions } from '@/lib/assistant/assistant-store-hooks'
import { createAssistantChatAndNavigate } from '@/pages/assistant/create-assistant-chat-and-navigate'
import { useProjectCreation } from '@/lib/projects/project-creation'

/** One route-independent listener, including while Settings is open. */
export function AppMenuCommandHost() {
    const navigate = useNavigate()
    const { pathname } = useLocation()
    const { open } = useCommandPalette()
    const actions = useAssistantStoreActions()
    const createProject = useProjectCreation()
    useEffect(() => {
        const handler = () => { void createProject() }
        window.addEventListener('zyra:new-project', handler)
        return () => window.removeEventListener('zyra:new-project', handler)
    }, [createProject])
    useEffect(() => window.devscope.window.onAppMenuCommand(command => { if (command === 'browser-capture') { window.dispatchEvent(new Event('zyra:browser-capture-draft')); return } dispatchAppMenuCommand(command, {
        navigate,
        search: open,
        reload: () => window.location.reload(),
        newChat: () => { void createAssistantChatAndNavigate(actions, navigate) }
    }) }), [actions, navigate, open])
    useEffect(() => window.zyraKeybindings?.onCommand?.(command => dispatchAppNavigation(command, navigate, pathname)), [navigate, pathname])
    useEffect(() => {
        if (window.zyraKeybindings) return
        return subscribeAppNavigationShortcuts(command => dispatchAppNavigation(command, navigate, pathname))
    }, [navigate, pathname])
    useEffect(() => addOverlayEventListener('keydown', (event: KeyboardEvent) => {
        if (window.zyraKeybindings) return
        const id = appShortcut(event)
        if (isAppNavigationCommand(id)) { event.preventDefault(); dispatchAppNavigation(id, navigate, pathname); return }
        const command = id === 'app.search' ? 'search' : id === 'app.newChat' ? 'new-chat' : id === 'app.settings' ? 'settings' : id === 'app.reload' ? 'reload' : null
        if (!command) return
        event.preventDefault()
        dispatchAppMenuCommand(command, {
            navigate, search: open, reload: () => window.location.reload(),
            newChat: () => { void createAssistantChatAndNavigate(actions, navigate) }
        })
    }), [actions, navigate, open, pathname])
    return <BrowserCaptureDraftHost />
}
