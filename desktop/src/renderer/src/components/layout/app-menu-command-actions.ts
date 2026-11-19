import type { DevScopeAppMenuCommand } from '@shared/contracts/devscope-api'

type MenuActions = {
    navigate: (route: string) => void
    search: () => void
    reload: () => void
    newChat: () => void
}

export function dispatchAppMenuCommand(command: DevScopeAppMenuCommand, actions: MenuActions): void {
    if (command === 'settings') actions.navigate('/settings')
    else if (command === 'browser-settings') actions.navigate('/settings/workspace/browser')
    else if (command === 'about') actions.navigate('/settings/about')
    else if (command === 'search') actions.search()
    else if (command === 'reload') actions.reload()
    else if (command === 'new-chat') actions.newChat()
}
