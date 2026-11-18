import { ipcRenderer } from 'electron'
import {
    ACCESSORIES_IPC,
    type AccessoriesApi,
    type AccessoryBrowserDropZoneInput,
    type AccessoryBrowserTabsInput,
    type AccessoryBrowserTearOffBeginInput,
    type AccessoryBrowserTearOffFinishInput,
    type AccessoryOpenInput,
    type AccessoryWindowState
} from '../../shared/accessories'

export function createAccessoriesAdapter(): { accessories: AccessoriesApi } {
    return {
        accessories: {
            open: (input: AccessoryOpenInput) => ipcRenderer.invoke(ACCESSORIES_IPC.open, input),
            getState: () => ipcRenderer.invoke(ACCESSORIES_IPC.getState),
            acknowledge: (requestId: string) => ipcRenderer.invoke(ACCESSORIES_IPC.acknowledge, requestId),
            syncBrowserTabs: (input: AccessoryBrowserTabsInput) => ipcRenderer.invoke(ACCESSORIES_IPC.syncBrowserTabs, input),
            registerBrowserDropZone: (input: AccessoryBrowserDropZoneInput | null) => ipcRenderer.invoke(ACCESSORIES_IPC.registerBrowserDropZone, input),
            beginBrowserTabTearOff: (input: AccessoryBrowserTearOffBeginInput) => ipcRenderer.invoke(ACCESSORIES_IPC.beginBrowserTabTearOff, input),
            finishBrowserTabTearOff: (input: AccessoryBrowserTearOffFinishInput) => ipcRenderer.invoke(ACCESSORIES_IPC.finishBrowserTabTearOff, input),
            cancelBrowserTabTearOff: (sessionId: string) => ipcRenderer.invoke(ACCESSORIES_IPC.cancelBrowserTabTearOff, sessionId),
            onChanged: (callback: (state: AccessoryWindowState) => void) => {
                const listener = (_event: Electron.IpcRendererEvent, state: AccessoryWindowState) => callback(state)
                ipcRenderer.on(ACCESSORIES_IPC.changed, listener)
                return () => ipcRenderer.removeListener(ACCESSORIES_IPC.changed, listener)
            }
        }
    }
}
