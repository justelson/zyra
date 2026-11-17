export const BROWSER_EXTENSIONS_IPC = {
    openPopup: 'devscope:browserExtensions:openPopup',
    list: 'devscope:browserExtensions:list',
    install: 'devscope:browserExtensions:install',
    inspectWebStore: 'devscope:browserExtensions:inspectWebStore',
    approveWebStore: 'devscope:browserExtensions:approveWebStore',
    discardWebStore: 'devscope:browserExtensions:discardWebStore',
    setEnabled: 'devscope:browserExtensions:setEnabled',
    remove: 'devscope:browserExtensions:remove',
    reload: 'devscope:browserExtensions:reload'
} as const

export type BrowserExtensionRecord = {
    id: string
    name: string
    version: string
    description: string
    path: string
    enabled: boolean
    permissions: string[]
    hostPermissions: string[]
    warnings: string[]
    source?: 'local' | 'chrome-web-store'
    storeUrl?: string
    sha256?: string
    hasPopup?: boolean
    pending?: boolean
}
