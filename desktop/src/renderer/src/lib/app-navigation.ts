import type { NavigateFunction } from 'react-router-dom'
import { type AppNavigationCommand } from '@shared/keybindings'
import { requestAssistantInspectorNavigation } from '../pages/assistant/assistant-inspector-navigation'
import { requestAssistantComposerFocus } from '../pages/assistant/assistant-composer-focus'
import { cycleAssistantChat, selectAssistantChatAt } from '../pages/assistant/assistant-chat-cycling'
import { requestAssistantConversationFind } from '../pages/assistant/assistant-conversation-find'
import { requestAssistantFileSave } from '../pages/assistant/assistant-file-save-requests'
import { assistantStore } from './assistant/assistant-store-core'
import { getActiveAssistantThread, getSelectedAssistantSession } from './assistant/selectors'

function stopActiveAssistantTurn(): void {
    const state = assistantStore.getState()
    const session = getSelectedAssistantSession(state.snapshot)
    const thread = getActiveAssistantThread(session)
    const turn = thread?.latestTurn
    if (session && turn?.state === 'running') void assistantStore.interruptTurn(turn.id, session.id)
}

export function dispatchAppNavigation(command: AppNavigationCommand, navigate: NavigateFunction, currentPathname = ''): void {
    if (command === 'app.shortcuts') { navigate('/settings/app/keyboard-shortcuts'); return }
    if (command === 'app.plugins') { navigate('/plugins'); return }
    if (command === 'app.newProject') { window.dispatchEvent(new Event('zyra:new-project')); return }
    if (command === 'app.themeSearch' || command === 'app.usageSearch' || command === 'app.actionSearch') { window.dispatchEvent(new CustomEvent('zyra:palette-query', { detail: command === 'app.themeSearch' ? 'theme ' : command === 'app.actionSearch' ? 'action ' : 'usage' })); return }
    if (command === 'app.sidebar') { window.dispatchEvent(new Event('zyra:toggle-assistant-sidebar')); return }
    if (command === 'app.nextChat' || command === 'app.previousChat' || /^app\.chat[1-9]$/.test(command)) {
        navigate('/assistant')
        if (command === 'app.nextChat') cycleAssistantChat(1)
        else if (command === 'app.previousChat') cycleAssistantChat(-1)
        else selectAssistantChatAt(Number(command.slice(-1)) - 1)
        return
    }
    if (command === 'app.findInChat') { requestAssistantConversationFind(); return }
    if (command === 'app.searchFiles' || command === 'app.searchProjectContents') { window.dispatchEvent(new CustomEvent('zyra:quick-open', { detail: command === 'app.searchProjectContents' ? 'contents' : 'files' })); return }
    if (command === 'app.saveFile') { requestAssistantFileSave(); return }
    if (command === 'app.stopTurn') { stopActiveAssistantTurn(); return }
    if (command === 'app.toggleFiles' || command === 'app.toggleBrowser' || command === 'app.toggleTerminal' || command === 'app.toggleInspector') {
        requestAssistantInspectorNavigation({ workspace: command === 'app.toggleFiles' ? 'explorer' : command === 'app.toggleBrowser' ? 'browser' : command === 'app.toggleTerminal' ? 'terminal' : 'review', toggle: true })
        return
    }
    const opensInspectorWorkspace = command === 'app.files'
        || command === 'app.browser'
        || command === 'app.review'
        || command === 'app.terminal'
        || command === 'app.threadDetails'
        || command === 'app.resources'
        || command === 'app.agents'
    const alreadyInChat = currentPathname === '/assistant' || currentPathname.startsWith('/assistant/chat/')
    if (!opensInspectorWorkspace || !alreadyInChat) navigate('/assistant')
    if (command === 'app.chat') return
    if (command === 'app.composer') { requestAssistantComposerFocus(); return }
    if (command === 'app.nextWorkspaceTab' || command === 'app.previousWorkspaceTab' || command === 'app.closeWorkspaceTab') {
        requestAssistantInspectorNavigation({ workspace: 'tabs', action: command === 'app.nextWorkspaceTab' ? 'next' : command === 'app.previousWorkspaceTab' ? 'previous' : 'close' })
        return
    }
    if (command === 'app.threadDetails') { requestAssistantInspectorNavigation({ workspace: 'control' }); return }
    if (command === 'app.resources') { requestAssistantInspectorNavigation({ workspace: 'resources' }); return }
    if (command === 'app.agents') { requestAssistantInspectorNavigation({ workspace: 'agents' }); return }
    requestAssistantInspectorNavigation({ workspace: command === 'app.files' ? 'explorer' : command === 'app.browser' ? 'browser' : command === 'app.terminal' ? 'terminal' : 'review' })
}
