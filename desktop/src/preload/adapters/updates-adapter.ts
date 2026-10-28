import { ipcRenderer } from 'electron'
import { UPDATE_PREFLIGHT_CHANNEL, UPDATE_DEFER_CHANNEL, type AgentUpdateConfirmation } from '../../shared/agent-update'
import type { DevScopeUpdateState } from '../../shared/contracts/devscope-api'

const UPDATE_STATE_CHANNEL = 'devscope:updates:state'

export function createUpdatesAdapter() {
    return {
        updates: {
            getState: () => ipcRenderer.invoke('devscope:updates:getState'),
            checkForUpdates: () => ipcRenderer.invoke('devscope:updates:checkForUpdates'),
            downloadUpdate: () => ipcRenderer.invoke('devscope:updates:downloadUpdate'),
            preflightInstall: () => ipcRenderer.invoke(UPDATE_PREFLIGHT_CHANNEL),
            deferInstall: () => ipcRenderer.invoke(UPDATE_DEFER_CHANNEL),
            resumePreviousAgent: () => ipcRenderer.invoke('devscope:updates:resumePreviousAgent'),
            installUpdate: (confirmation?: AgentUpdateConfirmation) => ipcRenderer.invoke('devscope:updates:installUpdate', confirmation),
            onStateChange: (callback: (state: DevScopeUpdateState) => void) => {
                const listener = (_event: Electron.IpcRendererEvent, payload: DevScopeUpdateState) => {
                    callback(payload)
                }
                ipcRenderer.on(UPDATE_STATE_CHANNEL, listener)
                return () => {
                    ipcRenderer.removeListener(UPDATE_STATE_CHANNEL, listener)
                }
            }
        }
    }
}
