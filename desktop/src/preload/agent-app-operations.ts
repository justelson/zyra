import { contextBridge, ipcRenderer } from 'electron'
import { AGENT_APP_IPC, type RendererAppMessage, type RendererAppBridge } from '../shared/agent-app-operations'
export function installAgentAppBridge() {
    const bridge: RendererAppBridge = {
        onRequest: listener => {
            const callback = (_event: Electron.IpcRendererEvent, message: RendererAppMessage) => listener(message)
            ipcRenderer.on(AGENT_APP_IPC.request, callback)
            return () => ipcRenderer.removeListener(AGENT_APP_IPC.request, callback)
        },
        respond: response => ipcRenderer.send(AGENT_APP_IPC.response, response),
    }
    contextBridge.exposeInMainWorld('zyraAppOperations', bridge)
}
